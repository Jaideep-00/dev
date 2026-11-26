import { useState } from 'react';
import { parseJoinCode } from '../engine/joinCode';
import { DISCOVERABLE_LAN_ROOMS } from '../engine/seed';

interface JoinRoomModalProps {
  existingRoomIds: string[];
  onJoin: (
    canonicalCode: string,
    manualAddr: string | null,
  ) => Promise<
    | { ok: true; roomId: string }
    | { ok: false; kind: 'wrong-code' | 'not-found'; message: string; attemptsRemaining?: number }
  >;
  onCancel: () => void;
}

export function JoinRoomModal({ existingRoomIds, onJoin, onCancel }: JoinRoomModalProps) {
  const [code, setCode] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [manualAddr, setManualAddr] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnDetail, setWarnDetail] = useState<string | null>(null);

  const availableHints = DISCOVERABLE_LAN_ROOMS.filter(
    (r) => !existingRoomIds.includes(r.roomId),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWarnDetail(null);

    const parsed = parseJoinCode(code);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    if (showManual && manualAddr.trim() && !manualAddr.includes(':')) {
      setError('Enter host IP and port, e.g. 192.168.1.58:4000.');
      return;
    }

    setSearching(true);
    const res = await onJoin(parsed.canonical, showManual && manualAddr.trim() ? manualAddr.trim() : null);
    setSearching(false);

    if (!res.ok) {
      if (res.kind === 'wrong-code') {
        setError(res.message);
      } else {
        setWarnDetail(res.message);
      }
    }
  }

  return (
    <div
      className="max-w-[500px] mx-auto my-10 p-6 rounded-[6px] border"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <h1 className="text-[20px] font-semibold m-0 mb-1">Join room</h1>
          <p className="text-sm m-0" style={{ color: 'var(--muted)' }}>
            Enter a 12-character code from a teammate with Invite Mode open, or open DevChat in a second browser tab to test live multi-tab PAKE joining.
          </p>
        </div>

        <label className="block space-y-1.5">
          <span className="block text-sm font-semibold">Join code</span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="7K2P-9QXM-4TDA"
            autoFocus
            className="w-full h-9 px-3 rounded-[4px] border font-mono text-sm uppercase tracking-wider"
            style={{
              backgroundColor: 'var(--bg)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          />
          {error && (
            <span role="alert" className="block text-xs" style={{ color: 'var(--danger)' }}>
              {error}
            </span>
          )}
        </label>

        {searching && (
          <p role="status" className="text-xs m-0" style={{ color: 'var(--info)' }}>
            Searching local WiFi via mDNS and BroadcastChannel for an open PAKE invite…
          </p>
        )}

        {warnDetail && (
          <div
            role="alert"
            className="p-3 rounded-[4px] border text-xs space-y-1"
            style={{
              backgroundColor: 'var(--bg)',
              borderColor: 'var(--warning)',
              color: 'var(--text)',
            }}
          >
            <div className="font-semibold" style={{ color: 'var(--warning)' }}>
              No matching invite found on local network
            </div>
            <p className="m-0" style={{ color: 'var(--muted)' }}>
              {warnDetail}
            </p>
          </div>
        )}

        {availableHints.length > 0 && (
          <div
            className="p-3 rounded-[4px] border space-y-2"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
              Nearby peers advertising open invites on 192.168.1.0/24
            </div>
            <div className="space-y-1.5">
              {availableHints.map((room) => (
                <div
                  key={room.roomId}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0 truncate">
                    <span className="font-semibold">{room.name}</span>
                    <span style={{ color: 'var(--muted)' }}>
                      {' '}
                      · hosted by {room.hostName} ({room.hostAddr})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCode(room.joinCode)}
                    className="font-mono px-2 py-1 rounded-[4px] border shrink-0 cursor-pointer hover:bg-[var(--surface)]"
                    style={{ borderColor: 'var(--border)', color: 'var(--accent-text)' }}
                  >
                    {room.joinCode}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => setShowManual((v) => !v)}
            className="text-xs underline cursor-pointer bg-transparent border-0 p-0"
            style={{ color: 'var(--muted)' }}
          >
            {showManual
              ? 'Hide manual host address'
              : 'WiFi blocking mDNS discovery? Enter host ip:port manually'}
          </button>
        </div>

        {showManual && (
          <label className="block space-y-1.5">
            <span className="block text-sm font-semibold">Host IP and port</span>
            <input
              type="text"
              value={manualAddr}
              onChange={(e) => setManualAddr(e.target.value)}
              placeholder="192.168.1.58:4000"
              className="w-full h-9 px-3 rounded-[4px] border font-mono text-sm"
              style={{
                backgroundColor: 'var(--bg)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            />
          </label>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-semibold rounded-[4px] border cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={searching}
            className="px-4 py-2 text-sm font-semibold rounded-[4px] cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent-fill)', color: 'var(--accent-on-fill)' }}
          >
            {searching ? 'Joining…' : 'Join room'}
          </button>
        </div>
      </form>
    </div>
  );
}
