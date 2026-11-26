use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use devchat_core::join_code::generate_join_code as core_generate_join_code;
use devchat_core::safety::sanitize_windows_filename;
use devchat_core::types::NetworkInterfaceCandidate;
use devchat_crypto::dpapi::is_dpapi_active;
use devchat_net::{enumerate_lan_interfaces, selected_lan_interface, LanMeshHandle, DEVCHAT_LAN_UDP_PORT};
use devchat_store::{FtsSearchHit, LocalStore};
use serde::Serialize;
use tauri::{Emitter, State};
use tokio::sync::RwLock;

struct AppState {
    store: Mutex<LocalStore>,
    db_path: PathBuf,
    lan_mesh: Arc<RwLock<Option<LanMeshHandle>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    platform: String,
    rust_backend: bool,
    dpapi_enabled: bool,
    db_path: String,
    lan_ip: Option<String>,
    udp_port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IncomingLanEvent {
    packet_json: String,
    source_addr: String,
}

fn default_db_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("DevChat").join("devchat.db")
}

fn unix_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
async fn get_runtime_info(state: State<'_, AppState>) -> Result<RuntimeInfo, String> {
    let chosen = selected_lan_interface();
    let port = {
        let guard = state.lan_mesh.read().await;
        guard
            .as_ref()
            .map(|h| h.local_addr.port())
            .unwrap_or(DEVCHAT_LAN_UDP_PORT)
    };

    Ok(RuntimeInfo {
        platform: std::env::consts::OS.to_string(),
        rust_backend: true,
        dpapi_enabled: is_dpapi_active(),
        db_path: state.db_path.display().to_string(),
        lan_ip: chosen.map(|c| c.ipv4),
        udp_port: port,
    })
}

#[tauri::command]
fn list_windows_adapters() -> Vec<NetworkInterfaceCandidate> {
    enumerate_lan_interfaces()
}

#[tauri::command]
fn load_workspace(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let store = state.store.lock().map_err(|_| "store lock poisoned".to_string())?;
    store.load_workspace_json().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_workspace(state: State<'_, AppState>, workspace_json: String) -> Result<(), String> {
    let store = state.store.lock().map_err(|_| "store lock poisoned".to_string())?;
    store
        .save_workspace_json(&workspace_json, unix_now_ms())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_workspace(state: State<'_, AppState>) -> Result<(), String> {
    let store = state.store.lock().map_err(|_| "store lock poisoned".to_string())?;
    store.clear_workspace().map_err(|e| e.to_string())
}

#[tauri::command]
fn index_message_fts(
    state: State<'_, AppState>,
    message_id: String,
    room_id: String,
    author_name: String,
    body: String,
) -> Result<(), String> {
    let store = state.store.lock().map_err(|_| "store lock poisoned".to_string())?;
    store
        .index_message(&message_id, &room_id, &author_name, &body)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn search_room_fts(
    state: State<'_, AppState>,
    room_id: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<FtsSearchHit>, String> {
    let store = state.store.lock().map_err(|_| "store lock poisoned".to_string())?;
    store
        .search_room_fts(&room_id, &query, limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn broadcast_lan_packet(state: State<'_, AppState>, packet_json: String) -> Result<(), String> {
    let guard = state.lan_mesh.read().await;
    if let Some(handle) = guard.as_ref() {
        handle
            .broadcast_json(packet_json)
            .await
            .map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn sanitize_filename(raw_name: String) -> String {
    sanitize_windows_filename(&raw_name)
}

#[tauri::command]
fn generate_join_code() -> String {
    core_generate_join_code()
}

#[tauri::command]
fn save_attachment_to_downloads(raw_name: String, contents_utf8: String) -> Result<String, String> {
    let safe_name = sanitize_windows_filename(&raw_name);
    let downloads = dirs::download_dir().ok_or_else(|| "Downloads folder unavailable".to_string())?;
    let target = downloads.join(&safe_name);

    // Ensure resolved target stays strictly inside Downloads
    if target.parent() != Some(downloads.as_path()) {
        return Err("Refused unsafe attachment destination path".to_string());
    }

    std::fs::write(&target, contents_utf8.as_bytes()).map_err(|e| e.to_string())?;
    Ok(target.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_path = default_db_path();
    let store = LocalStore::open(&db_path)
        .or_else(|_| LocalStore::open_in_memory())
        .expect("failed to initialize local SQLite store");

    let lan_mesh = Arc::new(RwLock::new(None));
    let lan_mesh_setup = Arc::clone(&lan_mesh);

    tauri::Builder::default()
        .manage(AppState {
            store: Mutex::new(store),
            db_path,
            lan_mesh,
        })
        .setup(move |app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let emitter = app_handle.clone();
                if let Ok(handle) = LanMeshHandle::start(move |packet_json, source_addr| {
                    let _ = emitter.emit(
                        "devchat://lan-packet",
                        IncomingLanEvent {
                            packet_json,
                            source_addr: source_addr.to_string(),
                        },
                    );
                })
                .await
                {
                    let mut guard = lan_mesh_setup.write().await;
                    *guard = Some(handle);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_info,
            list_windows_adapters,
            load_workspace,
            save_workspace,
            clear_workspace,
            index_message_fts,
            search_room_fts,
            broadcast_lan_packet,
            sanitize_filename,
            generate_join_code,
            save_attachment_to_downloads
        ])
        .run(tauri::generate_context!())
        .expect("error while running DevChat Windows desktop application");
}
