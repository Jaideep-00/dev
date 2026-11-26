import { useState } from 'react';
import { ArrowLeft, Download, KeyRound, RefreshCw, UserMinus } from 'lucide-react';
import { getOrderedMessages } from '../engine/sync';
import type { AuthorId, RoomData } from '../engine/types';

interface RoomSettingsScreenProps {
  room: RoomData;
  selfId: AuthorId;
  onBack: () => void;
  onToggleInvite: () => void;
  onResetJoinCode: () => void;
  onRemoveMember: (memberId: AuthorId) => void;
  onToggleMute: () => void;
  onLeaveRoom: (eraseHistory: boolean) => void;
}

export function RoomSettingsScreen({
  room,
  selfId,
  onBack,
  onToggleInvite,
  onResetJoinCode,
  onRemoveMember,
  onToggleMute,
  onLeaveRoom,
}: RoomSettingsScreenProps) {
  const [confirmRemoveId, setConfirmRemoveId] = useState<AuthorId | null>(null);
  const [eraseOnLeave, setEraseOnLeave] = useState(false);

  const isOwner = room.ownerId === selfId;
  const members = Object.values(room.members);
  const epochs = Object.values(room.keys).sort((a, b) => b.epoch - a.epoch);

  function handleExportArchive() {
    const ordered = getOrderedMessages(room);
    const payload = {
      format: 'devchat-room-archive-v1',
      exportedAt: new Date().toISOString(),
      roomId: room.roomId,
      roomName: room.name,
      ownerId: room.ownerId,
      currentEpoch: room.currentEpoch,
      memberCount: members.length,
      messages: ordered.map((m) => ({
        id: m.id,
        epoch: m.epoch,
        authorId: m.authorId,
        authorName: m.authorName,
        sequence: m.sequence,
        hlc: m.hlc,
        kind: m.kind,
        body: m.body,
        signatureHex: m.signatureHex,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${room.name}-archive.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-[660px] mx-auto my-6 px-4 pb-10">
      <div
        className="p-6 rounded-[6px] border space-y-6"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold m-0 truncate">Room settings — {room.name}</h1>
            <p className="text-xs font-mono m-0 mt-1" style={{ color: 'var(--muted)' }}>
              Room ID {room.roomId.slice(0, 12)} · Current Epoch {room.currentEpoch} ·{' '}
              {isOwner ? 'Owner authority' : 'Member'}
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[4px] border shrink-0 cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to room</span>
          </button>
        </div>

        {/* Invite & Join Code */}
        <section className="pt-5 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-base font-semibold m-0">Invite & join code</h2>
          <div
            className="p-3.5 rounded-[4px] border flex flex-wrap items-center justify-between gap-3"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <div>
              <div className="font-mono text-base font-semibold" style={{ color: 'var(--accent-text)' }}>
                {room.joinCode}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                {room.inviteActive
                  ? 'Invite mode open — peers on your LAN can join via PAKE'
                  : 'Invite mode closed — code is not currently advertised'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onToggleInvite}
                className="px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                {room.inviteActive ? 'Close invite mode' : 'Open invite mode'}
              </button>
              {isOwner && (
                <button
                  type="button"
                  onClick={onResetJoinCode}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reset join code</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Members */}
        <section className="pt-5 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-base font-semibold m-0">Members ({members.length})</h2>
          <ul className="m-0 p-0 list-none divide-y" style={{ borderColor: 'var(--border)' }}>
            {members.map((m) => (
              <li
                key={m.id}
                className="py-2.5 flex flex-wrap items-center justify-between gap-3 border-b last:border-b-0"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{m.displayName}</span>
                    <span className="text-xs font-mono" style={{ color: 'var(--muted)' }}>
                      {m.role} · joined epoch {m.joinedEpoch}
                      {m.status === 'removed' && m.removedEpoch
                        ? ` · removed at epoch ${m.removedEpoch}`
                        : ` · ${m.presence}`}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono" style={{ color: 'var(--muted)' }}>
                    key {m.id.slice(0, 16)} {m.lanIp ? `· ${m.lanIp}` : ''}
                  </div>
                </div>

                {isOwner && m.id !== selfId && m.status === 'active' && (
                  <div className="shrink-0">
                    {confirmRemoveId === m.id ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onRemoveMember(m.id);
                            setConfirmRemoveId(null);
                          }}
                          className="px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
                          style={{
                            borderColor: 'var(--danger)',
                            color: 'var(--danger)',
                            backgroundColor: 'var(--bg)',
                          }}
                        >
                          Confirm remove & rotate key
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          className="px-2.5 py-1.5 text-xs rounded-[4px] cursor-pointer"
                          style={{ color: 'var(--muted)' }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(m.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
                        style={{ borderColor: 'var(--border)', color: 'var(--danger)' }}
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Key Epochs & Export */}
        <section className="pt-5 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-base font-semibold m-0">Key epochs & export</h2>
          <div className="space-y-1.5">
            {epochs.map((ep) => (
              <div
                key={ep.epoch}
                className="flex items-center justify-between text-xs font-mono px-3 py-2 rounded-[4px] border"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <span className="inline-flex items-center gap-2">
                  <KeyRound className="w-3.5 h-3.5" style={{ color: 'var(--accent-text)' }} />
                  <span>Epoch {ep.epoch}</span>
                </span>
                <span style={{ color: 'var(--muted)' }}>
                  {ep.epoch === room.currentEpoch
                    ? 'Active AES-256-GCM key'
                    : 'Retained for pre-rotation history'}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleExportArchive}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export signed room archive</span>
            </button>
            <button
              type="button"
              onClick={onToggleMute}
              className="px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              {room.muted ? 'Unmute room notifications' : 'Mute room notifications'}
            </button>
          </div>
        </section>

        {/* Leave Room */}
        <section className="pt-5 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-base font-semibold m-0">Leave room</h2>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={eraseOnLeave}
              onChange={(e) => setEraseOnLeave(e.target.checked)}
            />
            <span>Erase local room history and FTS5 index entries from this device</span>
          </label>
          <button
            type="button"
            onClick={() => onLeaveRoom(eraseOnLeave)}
            className="px-4 py-2 text-xs font-semibold rounded-[4px] border cursor-pointer"
            style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
          >
            Leave {room.name}
          </button>
        </section>
      </div>
    </div>
  );
}
