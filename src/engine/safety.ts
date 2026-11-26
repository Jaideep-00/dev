import type { DiscoveryStage, NetworkInterfaceCandidate } from './types';

const WINDOWS_FORBIDDEN = /[<>:"/\\|?*\x00-\x1f]/g;
const RESERVED_DEVICES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/** Neutralize Windows path traversal, drive letters, reserved device names, and illegal chars. */
export function sanitizeWindowsFilename(raw: string): string {
  const segments = raw.split(/[/\\]/);
  const leaf = segments[segments.length - 1] ?? '';

  let cleaned = leaf.replace(WINDOWS_FORBIDDEN, '').replace(/[. ]+$/g, '');

  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return 'received-file';
  }

  const stem = (cleaned.split('.')[0] ?? '').toUpperCase();
  if (RESERVED_DEVICES.has(stem)) {
    cleaned = `_${cleaned}`;
  }

  if (cleaned.length > 180) {
    cleaned = cleaned.slice(0, 180);
  }
  return cleaned;
}

const VIRTUAL_KEYWORDS = [
  'vethernet',
  'wsl',
  'hyper-v',
  'virtual',
  'vmware',
  'vbox',
  'vpn',
  'wireguard',
  'tailscale',
  'zerotier',
  'tap-',
  'tun',
  'docker',
  'loopback',
];

export function isVirtualAdapter(name: string, description: string): boolean {
  const n = name.toLowerCase();
  const d = description.toLowerCase();
  return VIRTUAL_KEYWORDS.some((kw) => n.includes(kw) || d.includes(kw));
}

function isRfc1918(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function selectLanInterface(
  candidates: NetworkInterfaceCandidate[],
): NetworkInterfaceCandidate | null {
  const physical = candidates.filter(
    (c) => c.isUp && !c.isLoopback && !isVirtualAdapter(c.name, c.description),
  );
  if (physical.length === 0) return null;

  return physical.sort((a, b) => {
    const score = (c: NetworkInterfaceCandidate) => {
      const desc = c.description.toLowerCase();
      const wifiOrEth =
        desc.includes('wi-fi') ||
        desc.includes('wireless') ||
        desc.includes('wlan') ||
        desc.includes('ethernet') ||
        desc.includes('intel') ||
        desc.includes('realtek');
      return (isRfc1918(c.ipv4) ? 2 : 0) + (wifiOrEth ? 1 : 0);
    };
    return score(b) - score(a);
  })[0];
}

export function nextDiscoveryStage(
  current: DiscoveryStage,
  elapsedSecs: number,
  peersFound: number,
): DiscoveryStage {
  if (peersFound > 0) return current;
  if (current === 'mdns' && elapsedSecs >= 4) return 'udp_broadcast';
  if (current === 'udp_broadcast' && elapsedSecs >= 9) return 'manual';
  return current;
}

/** Deterministic geometric room sigil derived from room ID (never user-chosen icons). */
export function roomSigil(roomId: string): {
  shape: 'square' | 'diamond' | 'hex';
  color: string;
} {
  let hash = 2166136261;
  for (let i = 0; i < roomId.length; i++) {
    hash ^= roomId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const shapes = ['square', 'diamond', 'hex'] as const;
  const palette = ['#E0A030', '#6FB07A', '#6A9FB5', '#E07B39', '#D2605A'];
  return {
    shape: shapes[Math.abs(hash) % shapes.length],
    color: palette[Math.abs(hash >> 4) % palette.length],
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SAMPLE_WINDOWS_ADAPTERS: NetworkInterfaceCandidate[] = [
  {
    name: 'vEthernet (WSL)',
    description: 'Hyper-V Virtual Ethernet Adapter',
    ipv4: '172.28.16.1',
    isUp: true,
    isLoopback: false,
  },
  {
    name: 'Tailscale',
    description: 'Tailscale WireGuard Tunnel',
    ipv4: '100.64.14.9',
    isUp: true,
    isLoopback: false,
  },
  {
    name: 'Wi-Fi',
    description: 'Intel(R) Wi-Fi 6E AX211 160MHz',
    ipv4: '192.168.1.42',
    isUp: true,
    isLoopback: false,
  },
  {
    name: 'vEthernet (Default Switch)',
    description: 'Hyper-V Virtual Switch',
    ipv4: '172.24.112.1',
    isUp: true,
    isLoopback: false,
  },
];
