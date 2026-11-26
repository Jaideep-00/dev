import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { NetworkInterfaceCandidate } from './types';

export interface NativeRuntimeInfo {
  platform: string;
  rustBackend: boolean;
  dpapiEnabled: boolean;
  dbPath: string;
  lanIp: string | null;
  udpPort: number;
}

interface IncomingLanEvent {
  packetJson: string;
  sourceAddr: string;
}

/** True when running inside the compiled Rust + Tauri 2 Windows desktop shell. */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function getNativeRuntimeInfo(): Promise<NativeRuntimeInfo | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<NativeRuntimeInfo>('get_runtime_info');
  } catch {
    return null;
  }
}

export async function listNativeWindowsAdapters(): Promise<NetworkInterfaceCandidate[] | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<NetworkInterfaceCandidate[]>('list_windows_adapters');
  } catch {
    return null;
  }
}

export async function loadNativeWorkspace(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<string | null>('load_workspace');
  } catch {
    return null;
  }
}

export async function saveNativeWorkspace(workspaceJson: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    await invoke('save_workspace', { workspaceJson });
    return true;
  } catch {
    return false;
  }
}

export async function clearNativeWorkspace(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke('clear_workspace');
  } catch {
    // ignore cleanup failures
  }
}

export async function indexNativeMessageFts(
  messageId: string,
  roomId: string,
  authorName: string,
  body: string,
): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke('index_message_fts', { messageId, roomId, authorName, body });
  } catch {
    // ignore indexing failures
  }
}

export async function broadcastNativeLanPacket(packet: unknown): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke('broadcast_lan_packet', { packetJson: JSON.stringify(packet) });
  } catch {
    // ignore transient UDP send errors
  }
}

export async function subscribeNativeLanPackets(
  onPacket: (parsedPacket: unknown, sourceAddr: string) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await listen<IncomingLanEvent>('devchat://lan-packet', (event) => {
      try {
        const parsed = JSON.parse(event.payload.packetJson) as unknown;
        onPacket(parsed, event.payload.sourceAddr);
      } catch {
        // drop malformed UDP frames
      }
    });
  } catch {
    return null;
  }
}
