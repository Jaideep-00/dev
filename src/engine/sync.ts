import { compareMessages, tickReceive } from './clock';
import {
  MAX_TEXT_MESSAGE_BYTES,
  type AuthorId,
  type AuthorLogStateData,
  type DiagnosticsCounters,
  type DropReason,
  type HaveSummary,
  type Message,
  type RoomData,
  type Sequence,
  type WantRange,
} from './types';

export function createEmptyLogState(): AuthorLogStateData {
  return { highestContiguous: 0, outOfOrder: [] };
}

export function highestSeen(log: AuthorLogStateData): Sequence {
  if (log.outOfOrder.length === 0) return log.highestContiguous;
  return log.outOfOrder[log.outOfOrder.length - 1];
}

export function logContains(log: AuthorLogStateData, seq: Sequence): boolean {
  if (seq <= 0) return false;
  return seq <= log.highestContiguous || log.outOfOrder.includes(seq);
}

/** Record a sequence number with contiguous advancement and out-of-order gap tracking. */
export function recordSequence(
  log: AuthorLogStateData,
  seq: Sequence,
): { recorded: boolean; next: AuthorLogStateData } {
  if (seq <= 0 || logContains(log, seq)) {
    return { recorded: false, next: log };
  }

  let highest = log.highestContiguous;
  const ooo = new Set(log.outOfOrder);

  if (seq === highest + 1) {
    highest = seq;
    while (ooo.has(highest + 1)) {
      ooo.delete(highest + 1);
      highest += 1;
    }
  } else {
    ooo.add(seq);
  }

  return {
    recorded: true,
    next: {
      highestContiguous: highest,
      outOfOrder: Array.from(ooo).sort((a, b) => a - b),
    },
  };
}

export function missingRangesUpTo(
  log: AuthorLogStateData,
  remoteHighest: Sequence,
  batchBudget: number,
): Array<[Sequence, Sequence]> {
  if (remoteHighest <= log.highestContiguous || batchBudget <= 0) return [];

  const ooo = new Set(log.outOfOrder);
  const ranges: Array<[Sequence, Sequence]> = [];
  let remaining = batchBudget;
  let cursor = log.highestContiguous + 1;
  let openStart: Sequence | null = null;

  while (cursor <= remoteHighest && remaining > 0) {
    if (ooo.has(cursor)) {
      if (openStart !== null) {
        ranges.push([openStart, cursor - 1]);
        openStart = null;
      }
    } else {
      if (openStart === null) openStart = cursor;
      remaining -= 1;
    }
    cursor += 1;
  }

  if (openStart !== null) {
    ranges.push([openStart, cursor - 1]);
  }
  return ranges;
}

export function computeWants(
  localLogs: Record<AuthorId, AuthorLogStateData>,
  remoteHave: HaveSummary,
  maxMessagesPerBatch: number = 32,
): WantRange[] {
  const wants: WantRange[] = [];
  let budget = maxMessagesPerBatch;

  for (const [authorId, remoteHighest] of Object.entries(remoteHave.authors)) {
    if (budget <= 0) break;
    const state = localLogs[authorId] ?? createEmptyLogState();
    for (const [start, end] of missingRangesUpTo(state, remoteHighest, budget)) {
      budget -= end - start + 1;
      wants.push({ authorId, start, end });
    }
  }
  return wants;
}

export function buildHaveSummary(room: RoomData): HaveSummary {
  const authors: Record<AuthorId, Sequence> = {};
  for (const [authorId, log] of Object.entries(room.logs)) {
    authors[authorId] = highestSeen(log);
  }
  return { roomId: room.roomId, authors };
}

export function getAuthorsWithGaps(room: RoomData): AuthorId[] {
  return Object.entries(room.logs)
    .filter(([, log]) => log.outOfOrder.length > 0)
    .map(([authorId]) => authorId);
}

export function getOrderedMessages(room: RoomData): Message[] {
  return Object.values(room.messages).sort(compareMessages);
}

export function recordDrop(
  diag: DiagnosticsCounters,
  reason: DropReason,
): DiagnosticsCounters {
  const next = { ...diag };
  switch (reason) {
    case 'duplicate':
      next.droppedDuplicate += 1;
      break;
    case 'invalid_signature':
      next.droppedInvalidSignature += 1;
      break;
    case 'unknown_author':
      next.droppedUnknownAuthor += 1;
      break;
    case 'removed_author':
    case 'stale_epoch':
      next.droppedRemovedAuthor += 1;
      break;
    case 'oversized_body':
      next.droppedOversized += 1;
      break;
    default:
      next.droppedOther += 1;
      break;
  }
  return next;
}

export interface IngestResult {
  accepted: boolean;
  dropReason?: DropReason;
  room: RoomData;
  diagnostics: DiagnosticsCounters;
}

/** Pure message ingestion enforcing room ID, size ceiling, signature, membership, epoch ban, and deduplication. */
export function ingestMessage(
  room: RoomData,
  diagnostics: DiagnosticsCounters,
  msg: Message,
  signatureValid: boolean,
  isViewingRoom: boolean,
  nowMs: number = Date.now(),
): IngestResult {
  const drop = (reason: DropReason): IngestResult => ({
    accepted: false,
    dropReason: reason,
    room,
    diagnostics: recordDrop(diagnostics, reason),
  });

  if (msg.roomId !== room.roomId) return drop('wrong_room');
  if (msg.sequence <= 0) return drop('invalid_sequence');
  if (new TextEncoder().encode(msg.body).length > MAX_TEXT_MESSAGE_BYTES) {
    return drop('oversized_body');
  }
  if (!signatureValid) return drop('invalid_signature');

  const member = room.members[msg.authorId];
  if (!member) return drop('unknown_author');

  if (member.status === 'removed') {
    if (member.removedEpoch !== undefined && msg.epoch >= member.removedEpoch) {
      return drop('removed_author');
    }
  }

  const prevLog = room.logs[msg.authorId] ?? createEmptyLogState();
  const { recorded, next: nextLog } = recordSequence(prevLog, msg.sequence);
  if (!recorded) return drop('duplicate');

  const nextClock = tickReceive(room.clock, msg.hlc, nowMs);
  const nextRoom: RoomData = {
    ...room,
    clock: nextClock,
    unreadCount: isViewingRoom ? 0 : room.unreadCount + 1,
    logs: { ...room.logs, [msg.authorId]: nextLog },
    messages: { ...room.messages, [msg.id]: { ...msg, verified: true } },
  };

  return { accepted: true, room: nextRoom, diagnostics };
}

export function getActiveMemberCount(room: RoomData): number {
  return Object.values(room.members).filter((m) => m.status === 'active').length;
}

export function getConnectedPeerCount(room: RoomData, selfId: AuthorId): number {
  return Object.values(room.members).filter(
    (m) => m.id !== selfId && m.status === 'active' && m.presence === 'connected',
  ).length;
}
