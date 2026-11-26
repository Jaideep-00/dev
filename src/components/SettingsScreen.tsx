import { useRef, useState } from 'react';
import { ArrowLeft, Download, Moon, RotateCcw, Sun, Upload } from 'lucide-react';
import {
  exportEncryptedIdentityBackup,
  importEncryptedIdentityBackup,
  type EncryptedIdentityBackup,
} from '../engine/crypto';
import type { LocalIdentity } from '../engine/types';

interface SettingsScreenProps {
  identity: LocalIdentity;
  theme: 'dark' | 'light';
  onBack: () => void;
  onUpdateDisplayName: (name: string) => void;
  onChangeTheme: (theme: 'dark' | 'light') => void;
  onRestoreIdentity: (identity: LocalIdentity) => void;
  onOpenFirstRun: () => void;
  onResetWorkspace: () => void;
}

export function SettingsScreen({
  identity,
  theme,
  onBack,
  onUpdateDisplayName,
  onChangeTheme,
  onRestoreIdentity,
  onOpenFirstRun,
  onResetWorkspace,
}: SettingsScreenProps) {
  const [nameInput, setNameInput] = useState(identity.displayName);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [importPassphrase, setImportPassphrase] = useState('');
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setStatusMsg({ kind: 'err', text: 'Display name cannot be empty.' });
      return;
    }
    onUpdateDisplayName(trimmed);
    setStatusMsg({ kind: 'ok', text: `Display name updated to "${trimmed}".` });
  }

  async function handleExportBackup() {
    if (exportPassphrase.length < 6) {
      setStatusMsg({
        kind: 'err',
        text: 'Use a backup passphrase of at least 6 characters (PBKDF2-SHA256 + AES-256-GCM).',
      });
      return;
    }
    const backup = await exportEncryptedIdentityBackup(identity, exportPassphrase);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `devchat-identity-${identity.authorId.slice(0, 8)}.devchat-key.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportPassphrase('');
    setStatusMsg({
      kind: 'ok',
      text: 'Encrypted identity backup downloaded. Keep your passphrase safe.',
    });
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!importPassphrase) {
      setStatusMsg({ kind: 'err', text: 'Enter the backup passphrase before selecting a file.' });
      e.target.value = '';
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as EncryptedIdentityBackup;
      const restored = await importEncryptedIdentityBackup(parsed, importPassphrase);
      onRestoreIdentity(restored);
      setNameInput(restored.displayName);
      setImportPassphrase('');
      setStatusMsg({
        kind: 'ok',
        text: `Restored identity "${restored.displayName}" (${restored.authorId.slice(0, 12)}).`,
      });
    } catch {
      setStatusMsg({
        kind: 'err',
        text: 'Could not decrypt backup. Verify the passphrase and file format.',
      });
    } finally {
      e.target.value = '';
    }
  }

  return (
    <div className="max-w-[600px] mx-auto my-6 px-4 pb-10">
      <div
        className="p-6 rounded-[6px] border space-y-6"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold m-0">Settings</h1>
            <p className="text-xs font-mono m-0 mt-1" style={{ color: 'var(--muted)' }}>
              Identity key {identity.authorId} · {identity.listenAddr}
            </p>
          </div>
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

        {statusMsg && (
          <div
            role="status"
            className="px-3 py-2 rounded-[4px] border text-xs"
            style={{
              backgroundColor: 'var(--bg)',
              borderColor: statusMsg.kind === 'ok' ? 'var(--success)' : 'var(--danger)',
              color: statusMsg.kind === 'ok' ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {statusMsg.text}
          </div>
        )}

        {/* Display name */}
        <form onSubmit={handleSaveName} className="space-y-2">
          <label className="block text-sm font-semibold">Display name</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="flex-1 h-9 px-3 rounded-[4px] border text-sm"
              style={{
                backgroundColor: 'var(--bg)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            />
            <button
              type="submit"
              className="px-4 h-9 text-xs font-semibold rounded-[4px] border cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              Save
            </button>
          </div>
        </form>

        {/* Theme */}
        <section className="pt-5 border-t space-y-2.5" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold m-0">Appearance</h2>
          <div className="inline-flex p-1 rounded-[4px] border gap-1" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
            <button
              type="button"
              onClick={() => onChangeTheme('dark')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[4px] cursor-pointer"
              style={{
                backgroundColor: theme === 'dark' ? 'var(--raised)' : 'transparent',
                color: theme === 'dark' ? 'var(--accent-text)' : 'var(--muted)',
              }}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>Warm Dark</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeTheme('light')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[4px] cursor-pointer"
              style={{
                backgroundColor: theme === 'light' ? 'var(--raised)' : 'transparent',
                color: theme === 'light' ? 'var(--accent-text)' : 'var(--muted)',
              }}
            >
              <Sun className="w-3.5 h-3.5" />
              <span>Warm Light</span>
            </button>
          </div>
        </section>

        {/* Identity Backup & Restore */}
        <section className="pt-5 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-sm font-semibold m-0">Identity backup (PBKDF2 + AES-256-GCM)</h2>
            <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--muted)' }}>
              Exports your signing keypair and owner authority encrypted with your passphrase.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={exportPassphrase}
              onChange={(e) => setExportPassphrase(e.target.value)}
              placeholder="New backup passphrase"
              className="flex-1 min-w-[200px] h-9 px-3 rounded-[4px] border text-sm"
              style={{
                backgroundColor: 'var(--bg)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            />
            <button
              type="button"
              onClick={handleExportBackup}
              className="inline-flex items-center gap-1.5 px-4 h-9 text-xs font-semibold rounded-[4px] cursor-pointer"
              style={{ backgroundColor: 'var(--accent-fill)', color: 'var(--accent-on-fill)' }}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export backup</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input
              type="password"
              value={importPassphrase}
              onChange={(e) => setImportPassphrase(e.target.value)}
              placeholder="Passphrase for backup file"
              className="flex-1 min-w-[200px] h-9 px-3 rounded-[4px] border text-sm"
              style={{
                backgroundColor: 'var(--bg)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            />
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              onChange={handleImportFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-4 h-9 text-xs font-semibold rounded-[4px] border cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Restore backup</span>
            </button>
          </div>
        </section>

        {/* Identity Setup Wizard & Reset */}
        <section className="pt-5 border-t flex flex-wrap items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={onOpenFirstRun}
            className="px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            Run first-time identity setup
          </button>
          <button
            type="button"
            onClick={onResetWorkspace}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[4px] border cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--danger)' }}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset local workspace</span>
          </button>
        </section>
      </div>
    </div>
  );
}
