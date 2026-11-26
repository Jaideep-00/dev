import type { HlcTimestamp, Message } from './types';

export function createClock(initialMs: number = Date.now()): HlcTimestamp {
  return { physicalMs: initialMs, logical: 0 };
}

/** Advance HLC for a locally authored message (Kulkarni et al.). */
export function tickLocal(state: HlcTimestamp, wallMs: number = Date.now()): HlcTimestamp {
  if (wallMs > state.physicalMs) {
    return { physicalMs: wallMs, logical: 0 };
  }
  return { physicalMs: state.physicalMs, logical: state.logical + 1 };
}

/** Advance HLC upon receiving a message from a remote peer. */
export function tickReceive(
  state: HlcTimestamp,
  remote: HlcTimestamp,
  wallMs: number = Date.now(),
): HlcTimestamp {
  const maxPhys = Math.max(state.physicalMs, remote.physicalMs, wallMs);
  let nextLogical = 0;

  if (maxPhys === state.physicalMs && maxPhys === remote.physicalMs) {
    nextLogical = Math.max(state.logical, remote.logical) + 1;
  } else if (maxPhys === state.physicalMs) {
    nextLogical = state.logical + 1;
  } else if (maxPhys === remote.physicalMs) {
    nextLogical = remote.logical + 1;
  }

  return { physicalMs: maxPhys, logical: nextLogical };
}

export function compareHlc(a: HlcTimestamp, b: HlcTimestamp): number {
  if (a.physicalMs !== b.physicalMs) return a.physicalMs - b.physicalMs;
  return a.logical - b.logical;
}

/** Deterministic total display order across all peers: (HLC, authorId, sequence). */
export function compareMessages(a: Message, b: Message): number {
  const hlcDiff = compareHlc(a.hlc, b.hlc);
  if (hlcDiff !== 0) return hlcDiff;
  if (a.authorId !== b.authorId) return a.authorId < b.authorId ? -1 : 1;
  return a.sequence - b.sequence;
}

export function formatHlcTime(hlc: HlcTimestamp): string {
  const d = new Date(hlc.physicalMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
