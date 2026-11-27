use crate::types::{DiscoveryStage, NetworkInterfaceCandidate};

const RESERVED_DEVICES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

const VIRTUAL_KEYWORDS: &[&str] = &[
    "vethernet",
    "wsl",
    "hyper-v",
    "virtual",
    "vmware",
    "vbox",
    "vpn",
    "wireguard",
    "tailscale",
    "zerotier",
    "tap-",
    "tun",
    "docker",
    "loopback",
];

/// Neutralize Windows path traversal, drive letters, reserved device names, and illegal NTFS characters.
pub fn sanitize_windows_filename(raw: &str) -> String {
    let leaf = raw.rsplit(['/', '\\']).next().unwrap_or("");

    let mut cleaned: String = leaf
        .chars()
        .filter(|&c| {
            let code = c as u32;
            code >= 0x20 && !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
        })
        .collect();

    while cleaned.ends_with('.') || cleaned.ends_with(' ') {
        cleaned.pop();
    }

    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        return "received-file".to_string();
    }

    let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    if RESERVED_DEVICES.contains(&stem.as_str()) {
        cleaned = format!("_{cleaned}");
    }

    if cleaned.chars().count() > 180 {
        cleaned = cleaned.chars().take(180).collect();
    }

    cleaned
}

pub fn is_virtual_adapter(name: &str, description: &str) -> bool {
    let n = name.to_ascii_lowercase();
    let d = description.to_ascii_lowercase();
    VIRTUAL_KEYWORDS
        .iter()
        .any(|kw| n.contains(kw) || d.contains(kw))
}

fn is_rfc1918(ip: &str) -> bool {
    let parts: Vec<u8> = ip.split('.').filter_map(|p| p.parse::<u8>().ok()).collect();
    if parts.len() != 4 {
        return false;
    }
    parts[0] == 10
        || (parts[0] == 172 && (16..=31).contains(&parts[1]))
        || (parts[0] == 192 && parts[1] == 168)
}

pub fn select_lan_interface(
    candidates: &[NetworkInterfaceCandidate],
) -> Option<NetworkInterfaceCandidate> {
    let mut physical: Vec<&NetworkInterfaceCandidate> = candidates
        .iter()
        .filter(|c| c.is_up && !c.is_loopback && !is_virtual_adapter(&c.name, &c.description))
        .collect();

    if physical.is_empty() {
        return None;
    }

    physical.sort_by_key(|c| {
        let d = c.description.to_ascii_lowercase();
        let n = c.name.to_ascii_lowercase();
        let wifi_or_eth = d.contains("wi-fi")
            || d.contains("wireless")
            || d.contains("wlan")
            || d.contains("ethernet")
            || d.contains("intel")
            || d.contains("realtek")
            || n.contains("wi-fi")
            || n.contains("ethernet")
            || n.starts_with("en")
            || n.starts_with("wl");
        let score = if is_rfc1918(&c.ipv4) { 2 } else { 0 } + if wifi_or_eth { 1 } else { 0 };
        std::cmp::Reverse(score)
    });

    physical.first().copied().cloned()
}

pub fn next_discovery_stage(
    current: DiscoveryStage,
    elapsed_secs: u64,
    peers_found: usize,
) -> DiscoveryStage {
    if peers_found > 0 {
        return current;
    }
    match current {
        DiscoveryStage::Mdns if elapsed_secs >= 4 => DiscoveryStage::UdpBroadcast,
        DiscoveryStage::UdpBroadcast if elapsed_secs >= 9 => DiscoveryStage::Manual,
        _ => current,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_windows_traversal_and_reserved_names() {
        assert_eq!(sanitize_windows_filename("..\\..\\evil.exe"), "evil.exe");
        assert_eq!(sanitize_windows_filename("CON.txt"), "_CON.txt");
        assert_eq!(sanitize_windows_filename("NUL"), "_NUL");
        assert_eq!(
            sanitize_windows_filename("C:\\Users\\a\\report?.pdf.. "),
            "report.pdf"
        );
        assert_eq!(sanitize_windows_filename("..."), "received-file");
    }

    #[test]
    fn filters_wsl_and_vpn_adapters() {
        let adapters = vec![
            NetworkInterfaceCandidate {
                name: "vEthernet (WSL)".into(),
                description: "Hyper-V Virtual Ethernet Adapter".into(),
                ipv4: "172.28.16.1".into(),
                is_up: true,
                is_loopback: false,
            },
            NetworkInterfaceCandidate {
                name: "Tailscale".into(),
                description: "Tailscale WireGuard Tunnel".into(),
                ipv4: "100.64.14.9".into(),
                is_up: true,
                is_loopback: false,
            },
            NetworkInterfaceCandidate {
                name: "Wi-Fi".into(),
                description: "Intel(R) Wi-Fi 6E AX211".into(),
                ipv4: "192.168.1.42".into(),
                is_up: true,
                is_loopback: false,
            },
        ];

        let chosen = select_lan_interface(&adapters).expect("should select physical Wi-Fi");
        assert_eq!(chosen.name, "Wi-Fi");
    }
}
