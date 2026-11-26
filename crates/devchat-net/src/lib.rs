use std::net::SocketAddr;
use std::sync::Arc;
use devchat_core::safety::select_lan_interface;
use devchat_core::types::NetworkInterfaceCandidate;
use thiserror::Error;
use tokio::net::UdpSocket;
use tokio::sync::mpsc;

pub const DEVCHAT_LAN_UDP_PORT: u16 = 41739;
const MAX_UDP_PACKET_BYTES: usize = 65_000;

#[derive(Debug, Error)]
pub enum NetError {
    #[error("network IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("LAN mesh sender closed")]
    ChannelClosed,
}

/// Enumerates real host IPv4 interfaces (Windows Wi-Fi, Ethernet, WSL, Hyper-V, VPN adapters).
pub fn enumerate_lan_interfaces() -> Vec<NetworkInterfaceCandidate> {
    let Ok(ifaces) = if_addrs::get_if_addrs() else {
        return Vec::new();
    };

    ifaces
        .into_iter()
        .filter_map(|iface| {
            let iface_is_loopback = iface.is_loopback();

            match iface.addr {
                if_addrs::IfAddr::V4(v4) => {
                    let ip = v4.ip.to_string();
                    let is_loopback =
                        iface_is_loopback || v4.ip.is_loopback();

                    Some(NetworkInterfaceCandidate {
                        description: format!(
                            "IPv4 Interface ({})",
                            iface.name
                        ),
                        name: iface.name,
                        ipv4: ip,
                        is_up: true,
                        is_loopback,
                    })
                }
                _ => None,
            }
        })
        .collect()
}

pub fn selected_lan_interface() -> Option<NetworkInterfaceCandidate> {
    let all = enumerate_lan_interfaces();
    select_lan_interface(&all)
}

#[derive(Clone)]
pub struct LanMeshHandle {
    pub local_addr: SocketAddr,
    tx: mpsc::Sender<Vec<u8>>,
}

impl LanMeshHandle {
    /// Starts a real UDP LAN mesh listener on port 41739 (falling back to an ephemeral port
    /// if another DevChat instance is already running on this machine).
    pub async fn start<F>(on_packet: F) -> Result<Self, NetError>
    where
        F: Fn(String, SocketAddr) + Send + Sync + 'static,
    {
        let socket = match UdpSocket::bind(("0.0.0.0", DEVCHAT_LAN_UDP_PORT)).await {
            Ok(sock) => sock,
            Err(_) => UdpSocket::bind(("0.0.0.0", 0)).await?,
        };
        socket.set_broadcast(true)?;
        let local_addr = socket.local_addr()?;
        let socket = Arc::new(socket);

        let (tx, mut rx) = mpsc::channel::<Vec<u8>>(128);

        // Outbound LAN broadcaster task
        let send_sock = Arc::clone(&socket);
        tokio::spawn(async move {
            let broadcast_target = format!("255.255.255.255:{DEVCHAT_LAN_UDP_PORT}");
            let loopback_target = format!("127.0.0.1:{DEVCHAT_LAN_UDP_PORT}");
            while let Some(payload) = rx.recv().await {
                if payload.len() <= MAX_UDP_PACKET_BYTES {
                    let _ = send_sock.send_to(&payload, &broadcast_target).await;
                    let _ = send_sock.send_to(&payload, &loopback_target).await;
                }
            }
        });

        // Inbound LAN receiver task
        let recv_sock = Arc::clone(&socket);
        tokio::spawn(async move {
            let mut buf = vec![0u8; MAX_UDP_PACKET_BYTES];
            while let Ok((len, src)) = recv_sock.recv_from(&mut buf).await {
                if let Ok(json_str) = String::from_utf8(buf[..len].to_vec()) {
                    on_packet(json_str, src);
                }
            }
        });

        Ok(Self { local_addr, tx })
    }

    pub async fn broadcast_json(&self, packet_json: String) -> Result<(), NetError> {
        self.tx
            .send(packet_json.into_bytes())
            .await
            .map_err(|_| NetError::ChannelClosed)
    }
}
