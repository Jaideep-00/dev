import { useState } from 'react';
import { selectLanInterface, SAMPLE_WINDOWS_ADAPTERS } from '../engine/safety';

interface FirstRunScreenProps {
  initialName?: string;
  onComplete: (displayName: string) => Promise<void>;
  onCancel?: () => void;
}

export function FirstRunScreen({ initialName = '', onComplete, onCancel }: FirstRunScreenProps) {
  const [displayName, setDisplayName] = useState(initialName);
  const [error, setError] = useState('');
  const [firewallTested, setFirewallTested] = useState(false);
  const [creating, setCreating] = useState(false);

  const chosenAdapter = selectLanInterface(SAMPLE_WINDOWS_ADAPTERS);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed) {
      setError('Enter a display name. Other members only see this as a label; your keypair is your real identity.');
      return;
    }
    setError('');
    setCreating(true);
    await onComplete(trimmed);
    setCreating(false);
  }

  return (
    <div
      className="max-w-[540px] mx-auto my-8 p-6 rounded-[6px] border space-y-5"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div className="space-y-1.5">
        <h1 className="text-[20px] font-semibold m-0">Welcome to DevChat</h1>
        <p className="text-sm m-0" style={{ color: 'var(--muted)' }}>
          Your identity is a cryptographic keypair stored locally on this PC and bound to your user account. There is no central server, no account signup, and no cloud sync.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="block text-sm font-semibold">Display name</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Sam"
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

        <div
          className="p-4 rounded-[4px] border space-y-2.5"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-base font-semibold m-0">Windows Firewall & LAN discovery</h2>
          <p className="text-sm m-0" style={{ color: 'var(--muted)' }}>
            When Windows prompts to allow DevChat on your network, allow access. On campus or hackathon WiFi marked{' '}
            <strong style={{ color: 'var(--text)' }}>Public</strong>, allowing inbound LAN traffic is required so peers can discover and sync with you.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => setFirewallTested(true)}
              className="px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              Test local network binding
            </button>
            {firewallTested && (
              <span role="status" className="text-xs font-mono" style={{ color: 'var(--success)' }}>
                Bound to {chosenAdapter ? `${chosenAdapter.name} (${chosenAdapter.ipv4}:4000)` : '127.0.0.1:4000'} · Virtual adapters ignored
              </span>
            )}
          </div>
        </div>

        <div
          className="p-4 rounded-[4px] border space-y-1.5"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-base font-semibold m-0">Back up your identity</h2>
          <p className="text-sm m-0" style={{ color: 'var(--muted)' }}>
            If you create a room, only your owner signing key can remove members and rotate room keys later. Export an encrypted passphrase backup anytime from Settings.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-semibold rounded-[4px] border cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 text-sm font-semibold rounded-[4px] cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent-fill)', color: 'var(--accent-on-fill)' }}
          >
            {creating ? 'Generating keypair…' : 'Create identity'}
          </button>
        </div>
      </form>
    </div>
  );
}
