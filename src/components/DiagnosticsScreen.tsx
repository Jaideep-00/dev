import { useEffect, useState } from 'react';
import { ArrowLeft, Download, RefreshCw, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import { deriveDiscoveryToken } from '../engine/crypto';
import {
  isVirtualAdapter,
  SAMPLE_WINDOWS_ADAPTERS,
  selectLanInterface,
} from '../engine/safety';
import {
  getNativeRuntimeInfo,
  listNativeWindowsAdapters,
  type NativeRuntimeInfo,
} from '../engine/tauriBridge';
import type {
  DiagnosticsCounters,
  DiscoveryStage,
  NetworkInterfaceCandidate,
  RoomData,
  SimNetSettings,
} from '../engine/types';

interface DiagnosticsScreenProps {
  rooms: RoomData[];
  activeRoom: RoomData | null;
  diagnostics: DiagnosticsCounters;
  discoveryStage: DiscoveryStage;
  simNet: SimNetSettings;
  allPeersOffline: boolean;
  onBack: () => void;
  onCycleDiscoveryStage: () => void;
  onToggleAllPeersOffline: () => void;
  onUpdateSimNet: (patch: Partial<SimNetSettings>) => void;
  onInjectGap: () => void;
  onRunHaveWantSync: () => void;
  onSimulateSecurityTest: (kind: 'forged_sig' | 'duplicate_replay' | 'oversized' | 'removed_peer') => void;
}

export function DiagnosticsScreen({
  rooms,
  activeRoom,
  diagnostics,
  discoveryStage,
  simNet,
  allPeersOffline,
  onBack,
  onCycleDiscoveryStage,
  onToggleAllPeersOffline,
  onUpdateSimNet,
  onInjectGap,
  onRunHaveWantSync,
  onSimulateSecurityTest,
}: DiagnosticsScreenProps) {
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [lastNotice, setLastNotice] = useState<string | null>(null);
  const [adapters, setAdapters] = useState<NetworkInterfaceCandidate[]>(SAMPLE_WINDOWS_ADAPTERS);
  const [nativeInfo, setNativeInfo] = useState<NativeRuntimeInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadNative() {
      const [hostAdapters, info] = await Promise.all([
        listNativeWindowsAdapters(),
        getNativeRuntimeInfo(),
      ]);
      if (cancelled) return;
      if (hostAdapters && hostAdapters.length > 0) {
        setAdapters(hostAdapters);
      }
      if (info) {
        setNativeInfo(info);
      }
    }
    void loadNative();
    return () => {
      cancelled = true;
    };
  }, []);

  const chosen = selectLanInterface(adapters);

  useEffect(() => {
    let cancelled = false;
    async function computeTokens() {
      const next: Record<string, string> = {};
      for (const room of rooms) {
        const key = room.keys[room.currentEpoch]?.keyBase64;
        if (key) {
          next[room.roomId] = await deriveDiscoveryToken(key);
        }
      }
      if (!cancelled) setTokens(next);
    }
    void computeTokens();
    return () => {
      cancelled = true;
    };
  }, [rooms]);

  const totalPeersSeen = new Set(
    rooms.flatMap((r) =>
      Object.values(r.members)
        .filter((m) => m.status === 'active')
        .map((m) => m.id),
    ),
  ).size;

  function handleExportDiagnostics() {
    const bundle = {
      exportedAt: new Date().toISOString(),
      note: 'Sanitized diagnostics bundle — contains zero message text or private key material.',
      chosenInterface: chosen,
      ignoredAdapters: adapters.filter((a) => isVirtualAdapter(a.name, a.description)),
      nativeRuntime: nativeInfo,
      firewallStatus: nativeInfo
        ? `Rust UDP/${nativeInfo.udpPort} (DPAPI ${nativeInfo.dpapiEnabled ? 'active' : 'off'})`
        : 'Allowed (Private & Public WiFi UDP/41739)',
      discoveryStage,
      peersSeen: totalPeersSeen,
      simNet,
      securityCounters: diagnostics,
      roomDiscoveryTokens: rooms.map((r) => ({
        roomIdPrefix: r.roomId.slice(0, 8),
        epoch: r.currentEpoch,
        rotatingToken: tokens[r.roomId] ?? 'pending',
      })),
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'devchat-diagnostics-sanitized.json';
    a.click();
    URL.revokeObjectURL(url);
    setLastNotice('Exported sanitized diagnostics bundle (no message text included).');
  }

  const discoveryLabel: Record<DiscoveryStage, string> = {
    mdns: 'mDNS (_devchat._udp.local)',
    udp_broadcast: 'UDP broadcast fallback (255.255.255.255:4001)',
    manual: 'Manual host ip:port only',
  };

  return (
    <div className="max-w-[760px] mx-auto my-6 px-4 pb-10 space-y-6">
      <div
        className="p-6 rounded-[6px] border space-y-6"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold m-0">Network diagnostics</h1>
            <p className="text-xs m-0 mt-1" style={{ color: 'var(--muted)' }}>
              LAN adapter selection, rotating 5-minute discovery tokens, protocol drop counters, and SimNet verification.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportDiagnostics}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[4px] cursor-pointer"
              style={{ backgroundColor: 'var(--accent-fill)', color: 'var(--accent-on-fill)' }}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export diagnostics (no message text)</span>
            </button>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          </div>
        </div>

        {lastNotice && (
          <div
            role="status"
            className="px-3 py-2 rounded-[4px] border text-xs"
            style={{
              backgroundColor: 'var(--bg)',
              borderColor: 'var(--success)',
              color: 'var(--success)',
            }}
          >
            {lastNotice}
          </div>
        )}

        {/* Network Summary Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            className="p-4 rounded-[4px] border space-y-2"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-sm font-semibold m-0">Interface & discovery</h2>
            <dl className="m-0 space-y-1.5 text-xs">
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--muted)' }}>Chosen LAN adapter</dt>
                <dd className="m-0 font-mono text-right">
                  {chosen ? `${chosen.name} (${chosen.ipv4})` : 'None'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--muted)' }}>
                  {nativeInfo ? 'Rust backend & DPAPI' : 'Firewall binding'}
                </dt>
                <dd className="m-0 font-mono text-right" style={{ color: 'var(--success)' }}>
                  {nativeInfo
                    ? `UDP/${nativeInfo.udpPort} · DPAPI ${nativeInfo.dpapiEnabled ? 'ON' : 'OFF'}`
                    : 'LAN UDP/41739 ready'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--muted)' }}>Active discovery</dt>
                <dd className="m-0 font-mono text-right">{discoveryLabel[discoveryStage]}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--muted)' }}>Unique peers seen</dt>
                <dd className="m-0 font-mono tabular-nums">{totalPeersSeen}</dd>
              </div>
            </dl>
            <div className="pt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onCycleDiscoveryStage}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-[4px] border cursor-pointer"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                <RefreshCw className="w-3 h-3" />
                <span>Step fallback order</span>
              </button>
              <button
                type="button"
                onClick={onToggleAllPeersOffline}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-[4px] border cursor-pointer"
                style={{
                  borderColor: allPeersOffline ? 'var(--warning)' : 'var(--border)',
                  color: allPeersOffline ? 'var(--warning)' : 'var(--text)',
                }}
              >
                {allPeersOffline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                <span>{allPeersOffline ? 'Reconnect LAN peers' : 'Simulate all peers offline'}</span>
              </button>
            </div>
          </div>

          <div
            className="p-4 rounded-[4px] border space-y-2"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-sm font-semibold m-0">Security drop counters</h2>
            <dl className="m-0 space-y-1.5 text-xs">
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--muted)' }}>Invalid signature</dt>
                <dd
                  className="m-0 font-mono tabular-nums font-semibold"
                  style={{
                    color:
                      diagnostics.droppedInvalidSignature > 0 ? 'var(--danger)' : 'var(--text)',
                  }}
                >
                  {diagnostics.droppedInvalidSignature}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--muted)' }}>Removed author / stale epoch</dt>
                <dd
                  className="m-0 font-mono tabular-nums font-semibold"
                  style={{
                    color: diagnostics.droppedRemovedAuthor > 0 ? 'var(--warning)' : 'var(--text)',
                  }}
                >
                  {diagnostics.droppedRemovedAuthor}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--muted)' }}>Duplicate replays</dt>
                <dd className="m-0 font-mono tabular-nums">{diagnostics.droppedDuplicate}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--muted)' }}>Oversized (&gt; 64 KB)</dt>
                <dd className="m-0 font-mono tabular-nums">{diagnostics.droppedOversized}</dd>
              </div>
            </dl>
          </div>
        </section>

        {/* Adapter Filtering Audit */}
        <section className="pt-4 border-t space-y-2.5" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold m-0">Windows adapter filter audit</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                  <th className="py-2 pr-3 font-semibold">Adapter</th>
                  <th className="py-2 pr-3 font-semibold">Description</th>
                  <th className="py-2 pr-3 font-semibold">IPv4</th>
                  <th className="py-2 font-semibold">Selection</th>
                </tr>
              </thead>
              <tbody>
                {adapters.map((a) => {
                  const virt = isVirtualAdapter(a.name, a.description);
                  const isChosen = chosen?.name === a.name;
                  return (
                    <tr
                      key={a.name}
                      className="border-b last:border-b-0"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <td className="py-2 pr-3 font-mono">{a.name}</td>
                      <td className="py-2 pr-3" style={{ color: 'var(--muted)' }}>
                        {a.description}
                      </td>
                      <td className="py-2 pr-3 font-mono tabular-nums">{a.ipv4}</td>
                      <td
                        className="py-2 font-mono"
                        style={{
                          color: isChosen
                            ? 'var(--success)'
                            : virt
                              ? 'var(--muted)'
                              : 'var(--text)',
                        }}
                      >
                        {isChosen ? 'Selected (LAN)' : virt ? 'Ignored (virtual/VPN)' : 'Standby'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Rotating 5-minute Discovery Tokens */}
        <section className="pt-4 border-t space-y-2.5" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold m-0">
            5-minute rotating discovery tokens (HMAC-SHA256 from room key)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {rooms.map((r) => (
              <div
                key={r.roomId}
                className="px-3 py-2 rounded-[4px] border flex items-center justify-between gap-2 text-xs font-mono"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <span className="truncate font-sans font-semibold">{r.name}</span>
                <span style={{ color: 'var(--accent-text)' }}>
                  {tokens[r.roomId] ?? 'computing…'}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* SimNet Fault-Injection & Security Negative Tests */}
        <section className="pt-4 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-sm font-semibold m-0">
              SimNet sync & security negative test harness
            </h2>
            <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--muted)' }}>
              Exercise gap detection, Have/Want reconciliation, and security frame rejection directly against{' '}
              <span className="font-mono">{activeRoom ? activeRoom.name : 'the active room'}</span>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onInjectGap();
                setLastNotice(
                  'Injected out-of-order message (skipped a sequence number). Return to the room to see the gap notice, or run Have/Want Sync to heal it.',
                );
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
              style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
            >
              Inject out-of-order gap
            </button>
            <button
              type="button"
              onClick={() => {
                onRunHaveWantSync();
                setLastNotice('Executed Have/Want/Data reconciliation across connected LAN peers.');
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
              style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
            >
              Run Have/Want sync
            </button>
            <button
              type="button"
              onClick={() => {
                onSimulateSecurityTest('forged_sig');
                setLastNotice('Dropped forged-signature frame and incremented Invalid Signature counter.');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--danger)' }}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Test forged signature</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onSimulateSecurityTest('duplicate_replay');
                setLastNotice('Rejected duplicate (author_id, sequence) replay packet.');
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              Test duplicate replay
            </button>
            <button
              type="button"
              onClick={() => {
                onSimulateSecurityTest('oversized');
                setLastNotice('Rejected oversized (> 64 KB) frame before ingestion.');
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              Test &gt;64 KB payload
            </button>
            <button
              type="button"
              onClick={() => {
                onSimulateSecurityTest('removed_peer');
                setLastNotice('Rejected post-removal epoch frame from banned peer.');
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              Test banned peer frame
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-1 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={simNet.autoReplyEnabled}
                onChange={(e) => onUpdateSimNet({ autoReplyEnabled: e.target.checked })}
              />
              <span>Simulated LAN teammates respond to new messages</span>
            </label>
            <label className="flex items-center gap-2">
              <span style={{ color: 'var(--muted)' }}>Simulated packet drop:</span>
              <input
                type="range"
                min={0}
                max={60}
                step={10}
                value={simNet.dropRatePercent}
                onChange={(e) => onUpdateSimNet({ dropRatePercent: Number(e.target.value) })}
              />
              <span className="font-mono tabular-nums">{simNet.dropRatePercent}%</span>
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
