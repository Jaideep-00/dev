import type { SyncDotState } from '../engine/types';

interface StatusDotProps {
  state: SyncDotState;
  showLabel?: boolean;
  labelOverride?: string;
}

const DEFAULT_LABELS: Record<SyncDotState, string> = {
  connected: 'Connected',
  syncing: 'Syncing',
  offline: 'Offline',
  error: 'Connection issue',
};

const COLOR_MAP: Record<SyncDotState, string> = {
  connected: 'var(--success)',
  syncing: 'var(--accent-fill)',
  offline: 'var(--muted)',
  error: 'var(--danger)',
};

export function StatusDot({ state, showLabel = false, labelOverride }: StatusDotProps) {
  const label = labelOverride ?? DEFAULT_LABELS[state];
  return (
    <span
      className="inline-flex items-center gap-1.5 shrink-0"
      title={label}
      aria-label={label}
    >
      <span
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${
          state === 'syncing' ? 'animate-sync-pulse' : ''
        }`}
        style={{ backgroundColor: COLOR_MAP[state] }}
        aria-hidden="true"
      />
      {showLabel && (
        <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--muted)' }}>
          {label}
        </span>
      )}
    </span>
  );
}
