export const MAX_TEXT_MESSAGE_BYTES = 64 * 1024;
export const MAX_MEMBERS_PER_ROOM = 50;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export type AuthorId = string; // hex fingerprint of signing public key
export type RoomId = string; // 32-char hex (128-bit)
export type Epoch = number;
export type Sequence = number;

export interface HlcTimestamp {
  physicalMs: number;
  logical: number;
}

export type MessageKind =
  | { type: 'text' }
  | { type: 'code'; language: string }
  | { type: 'system_join'; memberName: string }
  | { type: 'system_removal'; removedName: string; newEpoch: Epoch }
  | { type: 'system_code_reset'; epoch: Epoch }
  | {
      type: 'file_offer';
      hash: string;
      name: string;
      rawName: string;
      size: number;
      state: 'offered' | 'fetching' | 'stored';
      blobUrl?: string;
    };

export interface Message {
  id: string; // `${authorId}:${sequence}`
  roomId: RoomId;
  epoch: Epoch;
  authorId: AuthorId;
  authorName: string;
  sequence: Sequence;
  hlc: HlcTimestamp;
  kind: MessageKind;
  body: string;
  ciphertextHex: string;
  signatureHex: string;
  verified: boolean;
  deliveredTo: number;
}

export type MemberRole = 'owner' | 'member';
export type PeerPresence = 'connected' | 'nearby' | 'offline';
export type SyncDotState = 'connected' | 'syncing' | 'offline' | 'error';

export interface Member {
  id: AuthorId;
  displayName: string;
  role: MemberRole;
  status: 'active' | 'removed';
  joinedEpoch: Epoch;
  removedEpoch?: Epoch;
  presence: PeerPresence;
  lanIp?: string;
  publicKeyJwk?: JsonWebKey;
}

export interface AuthorLogStateData {
  highestContiguous: Sequence;
  outOfOrder: Sequence[];
}

export interface WantRange {
  authorId: AuthorId;
  start: Sequence;
  end: Sequence;
}

export interface HaveSummary {
  roomId: RoomId;
  authors: Record<AuthorId, Sequence>;
}

export type DropReason =
  | 'duplicate'
  | 'wrong_room'
  | 'invalid_sequence'
  | 'oversized_body'
  | 'invalid_signature'
  | 'unknown_author'
  | 'removed_author'
  | 'stale_epoch';

export interface DiagnosticsCounters {
  droppedDuplicate: number;
  droppedInvalidSignature: number;
  droppedUnknownAuthor: number;
  droppedRemovedAuthor: number;
  droppedOversized: number;
  droppedOther: number;
}

export interface EpochKeyRecord {
  epoch: Epoch;
  keyBase64: string;
  createdAtMs: number;
}

export interface RoomData {
  roomId: RoomId;
  name: string;
  githubRepoUrl?: string;
  ownerId: AuthorId;
  currentEpoch: Epoch;
  joinCode: string;
  inviteActive: boolean;
  inviteExpiresAtMs: number | null;
  muted: boolean;
  createdAtMs: number;
  joinedAtMs: number;
  lastReadHlc: HlcTimestamp;
  unreadCount: number;
  keys: Record<Epoch, EpochKeyRecord>;
  members: Record<AuthorId, Member>;
  logs: Record<AuthorId, AuthorLogStateData>;
  messages: Record<string, Message>;
  clock: HlcTimestamp;
  localNextSeq: Sequence;
}

export interface LocalIdentity {
  authorId: AuthorId;
  displayName: string;
  createdAtMs: number;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  listenAddr: string;
}

export interface NetworkInterfaceCandidate {
  name: string;
  description: string;
  ipv4: string;
  isUp: boolean;
  isLoopback: boolean;
}

export type DiscoveryStage = 'mdns' | 'udp_broadcast' | 'manual';

export interface SimNetSettings {
  dropRatePercent: number;
  partitioned: boolean;
  autoReplyEnabled: boolean;
}

export interface AppScreenState {
  screen:
    | 'room'
    | 'first-run'
    | 'create'
    | 'join'
    | 'room-settings'
    | 'diagnostics'
    | 'settings';
}
