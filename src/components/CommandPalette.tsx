import { useEffect, useRef, useState } from 'react';
import { RoomSigil } from './RoomSigil';
import type { RoomData } from '../engine/types';

interface CommandPaletteProps {
  open: boolean;
  rooms: RoomData[];
  onSelectRoom: (roomId: string) => void;
  onNavigate: (screen: 'create' | 'join' | 'diagnostics' | 'settings') => void;
  onClose: () => void;
}

type PaletteEntry =
  | { kind: 'room'; room: RoomData }
  | { kind: 'action'; id: 'create' | 'join' | 'diagnostics' | 'settings'; label: string; hint: string };

export function CommandPalette({
  open,
  rooms,
  onSelectRoom,
  onNavigate,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const actions: Array<Extract<PaletteEntry, { kind: 'action' }>> = [
    { kind: 'action', id: 'create', label: 'Create new room', hint: 'Generate 60-bit code' },
    { kind: 'action', id: 'join', label: 'Join room with code', hint: 'PAKE LAN join' },
    { kind: 'action', id: 'diagnostics', label: 'Network diagnostics', hint: 'Adapters & SimNet' },
    { kind: 'action', id: 'settings', label: 'Settings & identity backup', hint: 'Theme, keys' },
  ];

  const entries: PaletteEntry[] = [
    ...rooms
      .filter((r) => r.name.toLowerCase().includes(q))
      .map((room): PaletteEntry => ({ kind: 'room', room })),
    ...actions.filter((a) => a.label.toLowerCase().includes(q) || a.hint.toLowerCase().includes(q)),
  ];

  const clampedIdx = entries.length > 0 ? Math.min(selectedIdx, entries.length - 1) : 0;

  function triggerEntry(entry: PaletteEntry) {
    if (entry.kind === 'room') {
      onSelectRoom(entry.room.roomId);
    } else {
      onNavigate(entry.id);
    }
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' && entries.length > 0) {
      e.preventDefault();
      setSelectedIdx((clampedIdx + 1) % entries.length);
    } else if (e.key === 'ArrowUp' && entries.length > 0) {
      e.preventDefault();
      setSelectedIdx((clampedIdx - 1 + entries.length) % entries.length);
    } else if (e.key === 'Enter' && entries[clampedIdx]) {
      e.preventDefault();
      triggerEntry(entries[clampedIdx]);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center pt-20 px-4 bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Switch room or run command"
        onKeyDown={handleKeyDown}
        className="w-full max-w-[440px] h-fit rounded-[6px] border p-3"
        style={{
          backgroundColor: 'var(--raised)',
          borderColor: 'var(--border)',
          boxShadow: 'var(--shadow-raised)',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIdx(0);
          }}
          placeholder="Jump to room or action…"
          className="w-full h-9 px-3 rounded-[4px] border text-sm mb-2"
          style={{
            backgroundColor: 'var(--bg)',
            borderColor: 'var(--border)',
            color: 'var(--text)',
          }}
        />
        <ul role="listbox" className="m-0 p-0 list-none max-h-[280px] overflow-y-auto space-y-0.5">
          {entries.length === 0 ? (
            <li className="px-2.5 py-2 text-xs" style={{ color: 'var(--muted)' }}>
              No matching rooms or actions
            </li>
          ) : (
            entries.map((entry, idx) => {
              const active = idx === clampedIdx;
              const key = entry.kind === 'room' ? entry.room.roomId : entry.id;
              return (
                <li key={key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    onClick={() => triggerEntry(entry)}
                    className="w-full min-h-[34px] px-2.5 py-1.5 rounded-[4px] flex items-center justify-between gap-3 text-left cursor-pointer"
                    style={{
                      backgroundColor: active ? 'var(--surface)' : 'transparent',
                      color: active ? 'var(--accent-text)' : 'var(--text)',
                    }}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {entry.kind === 'room' && <RoomSigil roomId={entry.room.roomId} />}
                      <span className="truncate font-medium">
                        {entry.kind === 'room' ? entry.room.name : entry.label}
                      </span>
                    </span>
                    <span
                      className="text-xs font-mono tabular-nums shrink-0"
                      style={{ color: 'var(--muted)' }}
                    >
                      {entry.kind === 'room'
                        ? entry.room.unreadCount > 0
                          ? `${entry.room.unreadCount} unread`
                          : `epoch ${entry.room.currentEpoch}`
                        : entry.hint}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
