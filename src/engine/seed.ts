import { generateIdentityKeypair } from './crypto';
import type {
  DiagnosticsCounters,
  LocalIdentity,
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
    kind: import('./types').MessageKind;
    body: string;
  }>;
}

// No hardcoded demo rooms or fake LAN invitations.
export const DISCOVERABLE_LAN_ROOMS: DiscoverableLanRoom[] = [];

export const INITIAL_DIAGNOSTICS: DiagnosticsCounters = {
  droppedDuplicate: 0,
  droppedInvalidSignature: 0,
  droppedUnknownAuthor: 0,
  droppedRemovedAuthor: 0,
  droppedOversized: 0,
  droppedOther: 0,
};

export async function createInitialWorkspace(
  displayName: string
): Promise<{
  identity: LocalIdentity;
  rooms: Record<string, RoomData>;
  activeRoomId: string | null;
}> {
  const cleanName = displayName.trim();

  if (!cleanName) {
    throw new Error('A display name is required.');
  }

  // Generate only this computer's identity.
  // No demo rooms, users, or messages are created.
  const identity = await generateIdentityKeypair(
    cleanName,
    '0.0.0.0:4000'
  );

  return {
    identity,
    rooms: {},
    activeRoomId: null,
  };
}
