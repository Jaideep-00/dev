import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CreateRoomModalProps {
  listenAddr: string;
  onCreate: (name: string) => Promise<{ roomId: string; joinCode: string }>;
  onCancel: () => void;
  onEnterRoom: (roomId: string) => void;
}

export function CreateRoomModal({
  listenAddr,
  onCreate,
  onCancel,
  onEnterRoom,
}: CreateRoomModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ roomId: string; joinCode: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Room name cannot be empty.');
      return;
    }
    setError('');
    const result = await onCreate(trimmed);
    setCreated(result);
  }

  async function copyCode() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="max-w-[480px] mx-auto my-10 p-6 rounded-[6px] border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
      {!created ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <h1 className="text-[20px] font-semibold m-0 mb-1">Create room</h1>
            <p className="text-sm m-0" style={{ color: 'var(--muted)' }}>
              Generates a random 256-bit AES-GCM room key and a 60-bit 12-character PAKE join code.
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className="block text-sm font-semibold">Room name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. team-backend"
              autoFocus
              className="w-full h-9 px-3 rounded-[4px] border text-sm"
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
              className="px-4 py-2 text-sm font-semibold rounded-[4px] cursor-pointer"
              style={{ backgroundColor: 'var(--accent-fill)', color: 'var(--accent-on-fill)' }}
            >
              Create room
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div>
            <h1 className="text-[20px] font-semibold m-0 mb-1">Room ready — {name}</h1>
            <p className="text-sm m-0" style={{ color: 'var(--muted)' }}>
              Invite mode is open for 5 minutes. Share this code aloud or in person on your local WiFi.
            </p>
          </div>

          <div
            className="p-4 rounded-[4px] border space-y-2"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              12-character join code (60-bit PAKE secret)
            </div>
            <div className="flex items-center justify-between gap-3">
              <span
                className="font-mono text-lg font-semibold tracking-wider"
                style={{ color: 'var(--accent-text)' }}
              >
                {created.joinCode}
              </span>
              <button
                type="button"
                onClick={copyCode}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy code'}</span>
              </button>
            </div>
            <div className="text-xs font-mono" style={{ color: 'var(--muted)' }}>
              Manual fallback address: {listenAddr}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onEnterRoom(created.roomId)}
              className="px-4 py-2 text-sm font-semibold rounded-[4px] cursor-pointer"
              style={{ backgroundColor: 'var(--accent-fill)', color: 'var(--accent-on-fill)' }}
            >
              Open room
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
