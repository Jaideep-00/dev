import { createClock, tickLocal } from './clock';
import {
  encryptRoomPayload,
  generateIdentityKeypair,
  generateRoomKeyBase64,
  signPayload,
} from './crypto';
import { generateJoinCode } from './joinCode';
import { createEmptyLogState, recordSequence } from './sync';
import type {
  DiagnosticsCounters,
  LocalIdentity,
  Member,
  Message,
  MessageKind,
  RoomData,
} from './types';

export interface DiscoverableLanRoom {
  roomId: string;
  name: string;
  joinCode: string;
  hostName: string;
  hostAddr: string;
  memberCount: number;
  previewMessages: Array<{
    authorName: string;
    kind: MessageKind;
    body: string;
  }>;
}

export const DISCOVERABLE_LAN_ROOMS: DiscoverableLanRoom[] = [
  {
    roomId: 'c4e91f8a2b3d4e5f6a7b8c9d0e1f2a3b',
    name: 'release-qa',
    joinCode: '7K2P-9QXM-4TDA',
    hostName: 'Priya',
    hostAddr: '192.168.1.58:4000',
    memberCount: 3,
    previewMessages: [
      {
        authorName: 'Priya',
        kind: { type: 'text' },
        body: 'Clean install tested on Windows 10 22H2 and Windows 11 24H2. WebView2 bootstrapper ran without admin elevation.',
      },
      {
        authorName: 'Devon',
        kind: { type: 'code', language: 'powershell' },
        body: 'Get-FileHash .\\DevChat_0.1.0_x64-setup.exe -Algorithm SHA256\ncargo test --workspace --locked',
      },
    ],
  },
  {
    roomId: '9f8e7d6c5b4a39281716253443526170',
    name: 'windows-installer',
    joinCode: '4M8R-2VWN-9CKE',
    hostName: 'Maya',
    hostAddr: '192.168.1.37:4000',
    memberCount: 2,
    previewMessages: [
      {
        authorName: 'Maya',
        kind: { type: 'text' },
        body: 'NSIS per-user install writes SQLCipher DB to %LOCALAPPDATA%\\DevChat\\devchat.db and protects the key with DPAPI.',
      },
    ],
  },
];

export const INITIAL_DIAGNOSTICS: DiagnosticsCounters = {
  droppedDuplicate: 0,
  droppedInvalidSignature: 0,
  droppedUnknownAuthor: 0,
  droppedRemovedAuthor: 0,
  droppedOversized: 0,
  droppedOther: 0,
};

async function createSeedMessage(
  room: RoomData,
  author: Member,
  signerKey: JsonWebKey,
  kind: MessageKind,
  body: string,
  timestampMs: number,
  deliveredTo: number,
): Promise<Message> {
  const prevLog = room.logs[author.id] ?? createEmptyLogState();
  const nextSeq =
    Math.max(prevLog.highestContiguous, ...(prevLog.outOfOrder.length ? prevLog.outOfOrder : [0])) +
    1;
  const hlc = tickLocal(room.clock, timestampMs);
  room.clock = hlc;

  const aad = `${room.roomId}:${room.currentEpoch}:${author.id}:${nextSeq}`;
  const roomKey = room.keys[room.currentEpoch].keyBase64;
  const ciphertextHex = await encryptRoomPayload(roomKey, aad, body);
  const signatureHex = await signPayload(signerKey, `${aad}:${ciphertextHex}`);

  const msg: Message = {
    id: `${author.id}:${nextSeq}`,
    roomId: room.roomId,
    epoch: room.currentEpoch,
    authorId: author.id,
    authorName: author.displayName,
    sequence: nextSeq,
    hlc,
    kind,
    body,
    ciphertextHex,
    signatureHex,
    verified: true,
    deliveredTo,
  };

  const { next } = recordSequence(prevLog, nextSeq);
  room.logs[author.id] = next;
  room.messages[msg.id] = msg;
  return msg;
}

export async function createInitialWorkspace(displayName: string = 'Jaideep'): Promise<{
  identity: LocalIdentity;
  rooms: Record<string, RoomData>;
  activeRoomId: string;
}> {
  const identity = await generateIdentityKeypair(displayName, '192.168.1.42:4000');
  const mayaId = await generateIdentityKeypair('Maya', '192.168.1.37:4000');
  const devonId = await generateIdentityKeypair('Devon', '192.168.1.51:4000');
  const priyaId = await generateIdentityKeypair('Priya', '192.168.1.58:4000');

  const now = Date.now();
  const min = 60_000;

  const selfMember: Member = {
    id: identity.authorId,
    displayName: identity.displayName,
    role: 'owner',
    status: 'active',
    joinedEpoch: 1,
    presence: 'connected',
    lanIp: identity.listenAddr,
    publicKeyJwk: identity.publicKeyJwk,
  };

  const maya: Member = {
    id: mayaId.authorId,
    displayName: 'Maya',
    role: 'member',
    status: 'active',
    joinedEpoch: 1,
    presence: 'connected',
    lanIp: '192.168.1.37:4000',
    publicKeyJwk: mayaId.publicKeyJwk,
  };

  const devon: Member = {
    id: devonId.authorId,
    displayName: 'Devon',
    role: 'member',
    status: 'active',
    joinedEpoch: 1,
    presence: 'connected',
    lanIp: '192.168.1.51:4000',
    publicKeyJwk: devonId.publicKeyJwk,
  };

  const priya: Member = {
    id: priyaId.authorId,
    displayName: 'Priya',
    role: 'member',
    status: 'active',
    joinedEpoch: 1,
    presence: 'nearby',
    lanIp: '192.168.1.58:4000',
    publicKeyJwk: priyaId.publicKeyJwk,
  };

  // Room 1: hackathon-core (user is owner)
  const room1Id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const room1Key = generateRoomKeyBase64();
  const room1: RoomData = {
    roomId: room1Id,
    name: 'hackathon-core',
    ownerId: identity.authorId,
    currentEpoch: 1,
    joinCode: generateJoinCode(),
    inviteActive: false,
    inviteExpiresAtMs: null,
    muted: false,
    createdAtMs: now - 45 * min,
    joinedAtMs: now - 45 * min,
    lastReadHlc: createClock(now),
    unreadCount: 0,
    keys: {
      1: { epoch: 1, keyBase64: room1Key, createdAtMs: now - 45 * min },
    },
    members: {
      [selfMember.id]: selfMember,
      [maya.id]: maya,
      [devon.id]: devon,
      [priya.id]: priya,
    },
    logs: {},
    messages: {},
    clock: createClock(now - 30 * min),
    localNextSeq: 1,
  };

  await createSeedMessage(
    room1,
    maya,
    mayaId.privateKeyJwk,
    { type: 'text' },
    'mDNS picked up all three laptops on the hackathon WiFi after filtering out vEthernet (WSL) and Tailscale.',
    now - 24 * min,
    4,
  );
  await createSeedMessage(
    room1,
    devon,
    devonId.privateKeyJwk,
    { type: 'code', language: 'rust' },
    `pub fn compute_wants(
    local_logs: &BTreeMap<AuthorId, AuthorLogState>,
    remote_have: &HaveSummary,
    max_batch: u64,
) -> Vec<WantRange> {
    // Coalesce missing sequence ranges per author without duplicates
    let mut wants = Vec::new();
    wants
}`,
    now - 19 * min,
    4,
  );
  await createSeedMessage(
    room1,
    selfMember,
    identity.privateKeyJwk,
    { type: 'text' },
    'Nice — simnet 10-peer convergence test passed with 35% packet drop and split-brain partitions.',
    now - 14 * min,
    3,
  );
  room1.localNextSeq = 2;

  await createSeedMessage(
    room1,
    priya,
    priyaId.privateKeyJwk,
    {
      type: 'file_offer',
      hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      name: 'protocol-v1-wireshark.pcapng',
      rawName: 'protocol-v1-wireshark.pcapng',
      size: 284_160,
      state: 'offered',
    },
    'Shared QUIC handshake capture from two Windows 11 machines over 5GHz WiFi.',
    now - 8 * min,
    4,
  );
  await createSeedMessage(
    room1,
    maya,
    mayaId.privateKeyJwk,
    { type: 'text' },
    'Need another room for release testing? Open Join and try code 7K2P-9QXM-4TDA (hosted on Priya’s LAN node).',
    now - 3 * min,
    4,
  );

  // Room 2: protocol-spikes (Maya is owner)
  const room2Id = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';
  const room2Key = generateRoomKeyBase64();
  const room2: RoomData = {
    roomId: room2Id,
    name: 'protocol-spikes',
    ownerId: maya.id,
    currentEpoch: 1,
    joinCode: generateJoinCode(),
    inviteActive: false,
    inviteExpiresAtMs: null,
    muted: false,
    createdAtMs: now - 90 * min,
    joinedAtMs: now - 85 * min,
    lastReadHlc: createClock(now - 20 * min),
    unreadCount: 2,
    keys: {
      1: { epoch: 1, keyBase64: room2Key, createdAtMs: now - 90 * min },
    },
    members: {
      [maya.id]: { ...maya, role: 'owner' },
      [selfMember.id]: { ...selfMember, role: 'member' },
      [devon.id]: { ...devon, presence: 'offline' },
    },
    logs: {},
    messages: {},
    clock: createClock(now - 60 * min),
    localNextSeq: 1,
  };

  await createSeedMessage(
    room2,
    maya,
    mayaId.privateKeyJwk,
    { type: 'text' },
    'Comparing SPAKE2 vs CPace for the 12-character 60-bit join code exchange. Rate limit set to 5 failed tries per peer.',
    now - 42 * min,
    2,
  );
  await createSeedMessage(
    room2,
    maya,
    mayaId.privateKeyJwk,
    { type: 'code', language: 'sql' },
    `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    room_id_hex UNINDEXED,
    search_text,
    content='messages',
    content_rowid='rowid'
);`,
    now - 11 * min,
    2,
  );
  await createSeedMessage(
    room2,
    maya,
    mayaId.privateKeyJwk,
    { type: 'text' },
    'FTS5 trigger cleans index rows automatically when a user leaves a room and chooses "Erase local history".',
    now - 5 * min,
    2,
  );

  return {
    identity,
    rooms: {
      [room1Id]: room1,
      [room2Id]: room2,
    },
    activeRoomId: room1Id,
  };
}
