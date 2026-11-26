import type { AuthorId, Epoch, HaveSummary, Member, Message, RoomData, RoomId, WantRange } from './types';
import {
  broadcastNativeLanPacket,
  isTauriRuntime,
  subscribeNativeLanPackets,
} from './tauriBridge';

export type LanWirePacket =
  | {
      type: 'hello';
      senderId: AuthorId;
      displayName: string;
      roomIds: RoomId[];
      publicKeyJwk: JsonWebKey;
    }
  | {
      type: 'join_request';
      senderId: AuthorId;
      displayName: string;
      publicKeyJwk: JsonWebKey;
      canonicalCode: string;
      requestId: string;
    }
  | {
      type: 'join_accept';
      targetId: AuthorId;
      requestId: string;
      room: RoomData;
    }
  | {
      type: 'join_reject';
      targetId: AuthorId;
      requestId: string;
      reason: string;
      attemptsRemaining: number;
    }
  | {
      type: 'have';
      senderId: AuthorId;
      summary: HaveSummary;
    }
  | {
      type: 'want';
      senderId: AuthorId;
      targetId: AuthorId;
      roomId: RoomId;
      wants: WantRange[];
    }
  | {
      type: 'data';
      senderId: AuthorId;
      roomId: RoomId;
      message: Message;
    }
  | {
      type: 'key_rotate';
      senderId: AuthorId;
      roomId: RoomId;
      removedMemberId: AuthorId;
      newEpoch: Epoch;
      newKeyBase64: string;
      newJoinCode: string;
    }
  | {
      type: 'member_joined';
      senderId: AuthorId;
      roomId: RoomId;
      member: Member;
    };

const CHANNEL_NAME = 'devchat-lan-v1';

export class BrowserLanMesh {
  private channel: BroadcastChannel | null = null;
  private nativeUnlisten: (() => void) | null = null;
  private closed = false;

  constructor(private onPacket: (pkt: LanWirePacket) => void) {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (event) => {
        if (event.data && typeof event.data === 'object' && 'type' in event.data) {
          this.onPacket(event.data as LanWirePacket);
        }
      };
    }

    if (isTauriRuntime()) {
      void subscribeNativeLanPackets((parsed) => {
        if (this.closed) return;
        if (parsed && typeof parsed === 'object' && 'type' in parsed) {
          this.onPacket(parsed as LanWirePacket);
        }
      }).then((unlisten) => {
        if (this.closed) {
          unlisten?.();
        } else {
          this.nativeUnlisten = unlisten;
        }
      });
    }
  }

  send(pkt: LanWirePacket): void {
    this.channel?.postMessage(pkt);
    if (isTauriRuntime()) {
      void broadcastNativeLanPacket(pkt);
    }
  }

  close(): void {
    this.closed = true;
    this.channel?.close();
    this.channel = null;
    this.nativeUnlisten?.();
    this.nativeUnlisten = null;
  }
}
