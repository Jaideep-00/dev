import { useEffect } from 'react';
import { X } from 'lucide-react';

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: 'Ctrl + K', desc: 'Open room & command switcher' },
  { keys: 'Ctrl + /', desc: 'Toggle keyboard shortcuts help' },
  { keys: 'Ctrl + F', desc: 'Search message history in current room' },
  { keys: 'Enter', desc: 'Send message' },
  { keys: 'Shift + Enter', desc: 'Insert newline in composer' },
  { keys: 'Ctrl + Shift + V', desc: 'Toggle code block mode in composer' },
  { keys: 'Escape', desc: 'Close active dialog or search bar' },
];

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="w-full max-w-[420px] rounded-[6px] border p-5"
        style={{
          backgroundColor: 'var(--raised)',
          borderColor: 'var(--border)',
          boxShadow: 'var(--shadow-raised)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="shortcuts-title" className="text-base font-semibold m-0">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="p-1 rounded-[4px] hover:bg-[var(--surface)] cursor-pointer"
            style={{ color: 'var(--muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <dl className="m-0 space-y-2.5">
          {SHORTCUTS.map((s) => (
            <div
              key={s.keys}
              className="flex items-center justify-between gap-4 pb-2 border-b last:border-b-0 last:pb-0"
              style={{ borderColor: 'var(--border)' }}
            >
              <dt className="text-sm">{s.desc}</dt>
              <dd
                className="m-0 font-mono text-xs px-2 py-0.5 rounded-[4px] border shrink-0"
                style={{
                  backgroundColor: 'var(--bg)',
                  borderColor: 'var(--border)',
                  color: 'var(--accent-text)',
                }}
              >
                {s.keys}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
