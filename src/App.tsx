import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bell,
  BellOff,
  Check,
  Code2,
  Copy,
  FileUp,
  Keyboard,
  Plus,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { CommandPalette } from './components/CommandPalette';
import { CreateRoomModal } from './components/CreateRoomModal';
import { DiagnosticsScreen } from './components/DiagnosticsScreen';
import { FirstRunScreen } from './components/FirstRunScreen';
import { JoinRoomModal } from './components/JoinRoomModal';
import { MessageLine } from './components/MessageLine';
import { RoomSettingsScreen } from './components/RoomSettingsScreen';
import { RoomSigil } from './components/RoomSigil';
import { SettingsScreen } from './components/SettingsScreen';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { StatusDot } from './components/StatusDot';
import { createClock, tickLocal } from './engine/clock';
import {
  encryptRoomPayload,
  generateIdentityKeypair,
  generateRoomKeyBase64,
  randomRoomId,
  sha256Hex,
  signPayload,
  verifyPayload,
} from './engine/crypto';
import { generateJoinCode } from './engine/joinCode';
import { BrowserLanMesh, type LanWirePacket } from './engine/lanChannel';
import { nextDiscoveryStage, sanitizeWindowsFilename } from './engine/safety';
import {
  createInitialWorkspace,
  DISCOVERABLE_LAN_ROOMS,
  INITIAL_DIAGNOSTICS,
} from './engine/seed';
import {
  clearNativeWorkspace,
  indexNativeMessageFts,
  isTauriRuntime,
  loadNativeWorkspace,
  saveNativeWorkspace,
} from './engine/tauriBridge';
import {
  buildHaveSummary,
  computeWants,
  createEmptyLogState,
  getActiveMemberCount,
  getAuthorsWithGaps,
  getConnectedPeerCount,
  getOrderedMessages,
  highestSeen,
  ingestMessage,
  recordDrop,
  recordSequence,
} from './engine/sync';
import {
  MAX_FILE_BYTES,
  MAX_TEXT_MESSAGE_BYTES,
  type AuthorId,
  type DiagnosticsCounters,
  type DiscoveryStage,
  type LocalIdentity,
  type Member,
  type Message,
  type MessageKind,
  type RoomData,
  type RoomId,
  type SimNetSettings,
  type SyncDotState,
} from './engine/types';

type ScreenKind =
  | 'room'
  | 'first-run'
  | 'create'
  | 'join'
  | 'room-settings'
  | 'diagnostics'
  | 'settings';

const STORAGE_KEY = 'devchat-workspace-v1';

interface PersistedWorkspace {
  theme: 'dark' | 'light';
  identity: LocalIdentity;
  rooms: Record<RoomId, RoomData>;
  activeRoomId: RoomId | null;
  diagnostics: DiagnosticsCounters;
}

const CODE_LANGUAGES = ['rust', 'typescript', 'sql', 'powershell', 'bash', 'json', 'plaintext'];

const PEER_REPLIES = [
  'Confirmed on my side — HLC ordering matches and signature verified cleanly.',
  'Synced over LAN in under 15ms. Checking the local SQLCipher index now.',
  'Good catch. I will keep Invite Mode open for a few more minutes if anyone else is joining.',
  'Re-ran the convergence test with 30% drop rate; zero sequence gaps left after Have/Want.',
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [screen, setScreen] = useState<ScreenKind>('room');
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [rooms, setRooms] = useState<Record<RoomId, RoomData>>({});
  const [activeRoomId, setActiveRoomId] = useState<RoomId | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsCounters>(INITIAL_DIAGNOSTICS);
  const [discoveryStage, setDiscoveryStage] = useState<DiscoveryStage>('mdns');
  const [simNet, setSimNet] = useState<SimNetSettings>({
    dropRatePercent: 0,
    partitioned: false,
    autoReplyEnabled: true,
  });
  const [allPeersOffline, setAllPeersOffline] = useState(false);
  const [syncingRooms, setSyncingRooms] = useState<Record<RoomId, boolean>>({});

  // UI overlays & composer state
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [codeMode, setCodeMode] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState('rust');
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Missing messages held by simulated peers for gap healing demonstration
  const heldGapMessagesRef = useRef<Record<RoomId, Message[]>>({});
  const failedJoinAttemptsRef = useRef<number>(0);
  const pendingJoinResolversRef = useRef<
    Map<
      string,
      (res: { ok: true; roomId: string } | { ok: false; kind: 'wrong-code'; message: string }) => void
    >
  >(new Map());
  const meshRef = useRef<BrowserLanMesh | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Refs for fresh state inside BroadcastChannel callback
  const stateRef = useRef({ identity, rooms, activeRoomId, screen, diagnostics, allPeersOffline });
  stateRef.current = { identity, rooms, activeRoomId, screen, diagnostics, allPeersOffline };

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Responsive window tracking
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 1-second timer for Invite Mode countdown
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Load persisted workspace (Rust SQLite + Windows DPAPI in Tauri, or localStorage in browser)
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const raw = isTauriRuntime()
          ? (await loadNativeWorkspace()) ?? localStorage.getItem(STORAGE_KEY)
          : localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as PersistedWorkspace;
          if (parsed.identity && parsed.rooms) {
            if (!cancelled) {
              setTheme(parsed.theme ?? 'dark');
              setIdentity(parsed.identity);
              setRooms(parsed.rooms);
              setActiveRoomId(parsed.activeRoomId ?? Object.keys(parsed.rooms)[0] ?? null);
              setDiagnostics(parsed.diagnostics ?? INITIAL_DIAGNOSTICS);
              setReady(true);
            }
            return;
          }
        }
      } catch {
        // fall through to clean seed
      }

      const seeded = await createInitialWorkspace('Jaideep');
      if (!cancelled) {
        setIdentity(seeded.identity);
        setRooms(seeded.rooms);
        setActiveRoomId(seeded.activeRoomId);
        setDiagnostics(INITIAL_DIAGNOSTICS);
        setReady(true);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist workspace to Rust SQLite + DPAPI (Tauri) and localStorage
  useEffect(() => {
    if (!ready || !identity) return;
    try {
      const payload: PersistedWorkspace = {
        theme,
        identity,
        rooms,
        activeRoomId,
        diagnostics,
      };
      const serialized = JSON.stringify(payload);
      if (isTauriRuntime()) {
        void saveNativeWorkspace(serialized);
      }
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      // ignore storage quota issues
    }
  }, [ready, theme, identity, rooms, activeRoomId, diagnostics]);

  const pulseSync = useCallback((roomId: RoomId) => {
    setSyncingRooms((prev) => ({ ...prev, [roomId]: true }));
    window.setTimeout(() => {
      setSyncingRooms((prev) => ({ ...prev, [roomId]: false }));
    }, 900);
  }, []);

  // Real multi-tab LAN mesh over BroadcastChannel
  useEffect(() => {
    if (!ready) return;

    const mesh = new BrowserLanMesh((pkt: LanWirePacket) => {
      const { identity: me, rooms: currentRooms, activeRoomId: currentActive, screen: currentScreen } =
        stateRef.current;
      if (!me) return;
      if ('senderId' in pkt && pkt.senderId === me.authorId) return;

      if (pkt.type === 'join_request') {
        const matchingRoom = Object.values(currentRooms).find(
          (r) =>
            r.inviteActive &&
            r.joinCode.replace(/-/g, '').toUpperCase() === pkt.canonicalCode.toUpperCase(),
        );
        if (!matchingRoom) return;

        const newMember: Member = {
          id: pkt.senderId,
          displayName: pkt.displayName,
          role: 'member',
          status: 'active',
          joinedEpoch: matchingRoom.currentEpoch,
          presence: 'connected',
          lanIp: 'LAN Tab Peer',
          publicKeyJwk: pkt.publicKeyJwk,
        };

        const updatedRoom: RoomData = {
          ...matchingRoom,
          members: { ...matchingRoom.members, [newMember.id]: newMember },
        };

        setRooms((prev) => ({ ...prev, [updatedRoom.roomId]: updatedRoom }));
        mesh.send({
          type: 'join_accept',
          targetId: pkt.senderId,
          requestId: pkt.requestId,
          room: {
            ...updatedRoom,
            inviteActive: false,
            inviteExpiresAtMs: null,
            unreadCount: 0,
            localNextSeq: 1,
          },
        });
        return;
      }

      if (pkt.type === 'join_accept' && pkt.targetId === me.authorId) {
        const resolver = pendingJoinResolversRef.current.get(pkt.requestId);
        setRooms((prev) => ({ ...prev, [pkt.room.roomId]: pkt.room }));
        setActiveRoomId(pkt.room.roomId);
        setScreen('room');
        if (resolver) {
          resolver({ ok: true, roomId: pkt.room.roomId });
          pendingJoinResolversRef.current.delete(pkt.requestId);
        }
        return;
      }

      if (pkt.type === 'data') {
        const room = currentRooms[pkt.roomId];
        if (!room) return;
        const member = room.members[pkt.message.authorId];
        const aad = `${pkt.message.roomId}:${pkt.message.epoch}:${pkt.message.authorId}:${pkt.message.sequence}`;

        void (async () => {
          const sigValid = member?.publicKeyJwk
            ? await verifyPayload(
                member.publicKeyJwk,
                `${aad}:${pkt.message.ciphertextHex}`,
                pkt.message.signatureHex,
              )
            : true;
          const isViewing = currentScreen === 'room' && currentActive === pkt.roomId;
          setRooms((prev) => {
            const target = prev[pkt.roomId];
            if (!target) return prev;
            const res = ingestMessage(
              target,
              stateRef.current.diagnostics,
              pkt.message,
              sigValid,
              isViewing,
            );
            setDiagnostics(res.diagnostics);
            if (!res.accepted) return prev;
            return { ...prev, [pkt.roomId]: res.room };
          });
          pulseSync(pkt.roomId);
        })();
        return;
      }

      if (pkt.type === 'have') {
        const room = currentRooms[pkt.summary.roomId];
        if (!room) return;
        const wants = computeWants(room.logs, pkt.summary, 32);
        if (wants.length > 0) {
          mesh.send({
            type: 'want',
            senderId: me.authorId,
            targetId: pkt.senderId,
            roomId: room.roomId,
            wants,
          });
        }
        return;
      }

      if (pkt.type === 'want' && pkt.targetId === me.authorId) {
        const room = currentRooms[pkt.roomId];
        if (!room) return;
        for (const w of pkt.wants) {
          for (let seq = w.start; seq <= w.end; seq++) {
            const msg = room.messages[`${w.authorId}:${seq}`];
            if (msg) {
              mesh.send({
                type: 'data',
                senderId: me.authorId,
                roomId: room.roomId,
                message: msg,
              });
            }
          }
        }
      }
    });

    meshRef.current = mesh;
    return () => {
      mesh.close();
      meshRef.current = null;
    };
  }, [ready, pulseSync]);

  // Global keyboard shortcuts (Ctrl+K, Ctrl+/, Ctrl+F, Escape)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        if (screen === 'room' && activeRoomId) {
          e.preventDefault();
          setSearchOpen(true);
          setTimeout(() => searchInputRef.current?.focus(), 10);
        }
      } else if (e.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery('');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screen, activeRoomId, searchOpen]);

  const roomList = useMemo(
    () => Object.values(rooms).sort((a, b) => a.joinedAtMs - b.joinedAtMs),
    [rooms],
  );
  const activeRoom = activeRoomId ? rooms[activeRoomId] ?? null : null;
  const orderedMessages = useMemo(
    () => (activeRoom ? getOrderedMessages(activeRoom) : []),
    [activeRoom],
  );
  const filteredMessages = useMemo(() => {
    if (!searchOpen || !searchQuery.trim()) return orderedMessages;
    const q = searchQuery.trim().toLowerCase();
    return orderedMessages.filter(
      (m) =>
        m.body.toLowerCase().includes(q) ||
        m.authorName.toLowerCase().includes(q) ||
        (m.kind.type === 'file_offer' && m.kind.name.toLowerCase().includes(q)),
    );
  }, [orderedMessages, searchOpen, searchQuery]);

  // Scroll to bottom when active room messages grow
  useEffect(() => {
    if (screen === 'room' && !searchOpen) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [orderedMessages.length, activeRoomId, screen, searchOpen]);

  function getRoomSyncState(room: RoomData): SyncDotState {
    if (!identity) return 'offline';
    if (syncingRooms[room.roomId]) return 'syncing';
    if (allPeersOffline) return 'offline';
    const connected = getConnectedPeerCount(room, identity.authorId);
    const activeTotal = getActiveMemberCount(room);
    if (activeTotal <= 1) return 'connected';
    return connected > 0 ? 'connected' : 'offline';
  }

  function selectRoom(roomId: RoomId) {
    setActiveRoomId(roomId);
    setScreen('room');
    setSearchOpen(false);
    setSearchQuery('');
    setRooms((prev) => {
      const target = prev[roomId];
      if (!target || target.unreadCount === 0) return prev;
      return {
        ...prev,
        [roomId]: { ...target, unreadCount: 0, lastReadHlc: target.clock },
      };
    });
  }

  async function handleCreateRoom(name: string): Promise<{ roomId: string; joinCode: string }> {
    if (!identity) throw new Error('Identity not initialized');
    const roomId = randomRoomId();
    const joinCode = generateJoinCode();
    const roomKey = generateRoomKeyBase64();
    const now = Date.now();

    const ownerMember: Member = {
      id: identity.authorId,
      displayName: identity.displayName,
      role: 'owner',
      status: 'active',
      joinedEpoch: 1,
      presence: 'connected',
      lanIp: identity.listenAddr,
      publicKeyJwk: identity.publicKeyJwk,
    };

    const newRoom: RoomData = {
      roomId,
      name,
      ownerId: identity.authorId,
      currentEpoch: 1,
      joinCode,
      inviteActive: true,
      inviteExpiresAtMs: now + 5 * 60_000,
      muted: false,
      createdAtMs: now,
      joinedAtMs: now,
      lastReadHlc: createClock(now),
      unreadCount: 0,
      keys: {
        1: { epoch: 1, keyBase64: roomKey, createdAtMs: now },
      },
      members: { [ownerMember.id]: ownerMember },
      logs: {},
      messages: {},
      clock: createClock(now),
      localNextSeq: 1,
    };

    setRooms((prev) => ({ ...prev, [roomId]: newRoom }));
    return { roomId, joinCode };
  }

  async function handleJoinRoom(
    canonicalCode: string,
    manualAddr: string | null,
  ): Promise<
    | { ok: true; roomId: string }
    | { ok: false; kind: 'wrong-code' | 'not-found'; message: string; attemptsRemaining?: number }
  > {
    if (!identity) {
      return { ok: false, kind: 'not-found', message: 'Local identity is not initialized.' };
    }

    // 1. Check live multi-tab peers first via BroadcastChannel
    if (meshRef.current) {
      const requestId = `${identity.authorId}-${Date.now()}`;
      const tabResult = await new Promise<
        { ok: true; roomId: string } | { ok: false; kind: 'wrong-code'; message: string } | null
      >((resolve) => {
        const timeout = window.setTimeout(() => {
          pendingJoinResolversRef.current.delete(requestId);
          resolve(null);
        }, 350);

        pendingJoinResolversRef.current.set(requestId, (res) => {
          window.clearTimeout(timeout);
          resolve(res);
        });

        meshRef.current?.send({
          type: 'join_request',
          senderId: identity.authorId,
          displayName: identity.displayName,
          publicKeyJwk: identity.publicKeyJwk,
          canonicalCode,
          requestId,
        });
      });

      if (tabResult) return tabResult;
    }

    // 2. Check discoverable simulated LAN rooms
    const match = DISCOVERABLE_LAN_ROOMS.find(
      (r) => r.joinCode.replace(/-/g, '').toUpperCase() === canonicalCode.toUpperCase(),
    );

    if (match) {
      if (rooms[match.roomId]) {
        selectRoom(match.roomId);
        return { ok: true, roomId: match.roomId };
      }

      const hostKey = await generateIdentityKeypair(match.hostName, match.hostAddr);
      const roomKey = generateRoomKeyBase64();
      const now = Date.now();

      const hostMember: Member = {
        id: hostKey.authorId,
        displayName: match.hostName,
        role: 'owner',
        status: 'active',
        joinedEpoch: 1,
        presence: allPeersOffline ? 'offline' : 'connected',
        lanIp: manualAddr ?? match.hostAddr,
        publicKeyJwk: hostKey.publicKeyJwk,
      };
      const selfMember: Member = {
        id: identity.authorId,
        displayName: identity.displayName,
        role: 'member',
        status: 'active',
        joinedEpoch: 1,
        presence: 'connected',
        lanIp: identity.listenAddr,
        publicKeyJwk: identity.publicKeyJwk,
      };

      const joinedRoom: RoomData = {
        roomId: match.roomId,
        name: match.name,
        ownerId: hostMember.id,
        currentEpoch: 1,
        joinCode: match.joinCode,
        inviteActive: false,
        inviteExpiresAtMs: null,
        muted: false,
        createdAtMs: now - 15 * 60_000,
        joinedAtMs: now,
        lastReadHlc: createClock(now),
        unreadCount: 0,
        keys: { 1: { epoch: 1, keyBase64: roomKey, createdAtMs: now } },
        members: { [hostMember.id]: hostMember, [selfMember.id]: selfMember },
        logs: {},
        messages: {},
        clock: createClock(now - 5 * 60_000),
        localNextSeq: 1,
      };

      let seq = 1;
      for (const pm of match.previewMessages) {
        const hlc = tickLocal(joinedRoom.clock, now - (3 - seq) * 60_000);
        joinedRoom.clock = hlc;
        const aad = `${joinedRoom.roomId}:1:${hostMember.id}:${seq}`;
        const ct = await encryptRoomPayload(roomKey, aad, pm.body);
        const sig = await signPayload(hostKey.privateKeyJwk, `${aad}:${ct}`);
        const msg: Message = {
          id: `${hostMember.id}:${seq}`,
          roomId: joinedRoom.roomId,
          epoch: 1,
          authorId: hostMember.id,
          authorName: pm.authorName,
          sequence: seq,
          hlc,
          kind: pm.kind,
          body: pm.body,
          ciphertextHex: ct,
          signatureHex: sig,
          verified: true,
          deliveredTo: 2,
        };
        joinedRoom.messages[msg.id] = msg;
        const prevLog = joinedRoom.logs[hostMember.id] ?? createEmptyLogState();
        joinedRoom.logs[hostMember.id] = recordSequence(prevLog, seq).next;
        seq += 1;
      }

      // System join notice
      const joinHlc = tickLocal(joinedRoom.clock, now);
      joinedRoom.clock = joinHlc;
      const joinSeq = seq;
      const joinBody = `${identity.displayName} joined via PAKE handshake (${manualAddr ? `manual ${manualAddr}` : 'mDNS LAN'}).`;
      const aad = `${joinedRoom.roomId}:1:${hostMember.id}:${joinSeq}`;
      const ct = await encryptRoomPayload(roomKey, aad, joinBody);
      const sig = await signPayload(hostKey.privateKeyJwk, `${aad}:${ct}`);
      const joinMsg: Message = {
        id: `${hostMember.id}:${joinSeq}`,
        roomId: joinedRoom.roomId,
        epoch: 1,
        authorId: hostMember.id,
        authorName: 'system',
        sequence: joinSeq,
        hlc: joinHlc,
        kind: { type: 'system_join', memberName: identity.displayName },
        body: joinBody,
        ciphertextHex: ct,
        signatureHex: sig,
        verified: true,
        deliveredTo: 2,
      };
      joinedRoom.messages[joinMsg.id] = joinMsg;
      joinedRoom.logs[hostMember.id] = recordSequence(
        joinedRoom.logs[hostMember.id] ?? createEmptyLogState(),
        joinSeq,
      ).next;

      failedJoinAttemptsRef.current = 0;
      setRooms((prev) => ({ ...prev, [joinedRoom.roomId]: joinedRoom }));
      setActiveRoomId(joinedRoom.roomId);
      setScreen('room');
      pulseSync(joinedRoom.roomId);
      return { ok: true, roomId: joinedRoom.roomId };
    }

    failedJoinAttemptsRef.current += 1;
    const remaining = Math.max(0, 5 - failedJoinAttemptsRef.current);
    if (remaining === 0) {
      return {
        ok: false,
        kind: 'wrong-code',
        attemptsRemaining: 0,
        message: 'Rate limited: 5 failed PAKE attempts reached. Wait before retrying or confirm the code with your teammate.',
      };
    }

    if (manualAddr) {
      return {
        ok: false,
        kind: 'wrong-code',
        attemptsRemaining: remaining,
        message: `Wrong join code for ${manualAddr} (${remaining} tries remaining before rate limit).`,
      };
    }

    return {
      ok: false,
      kind: 'not-found',
      attemptsRemaining: remaining,
      message: `No LAN peer matched that code (${remaining} tries remaining). Ensure Invite Mode is open on the host machine or try one of the nearby invites listed below.`,
    };
  }

  async function appendLocalMessage(
    roomId: RoomId,
    kind: MessageKind,
    body: string,
  ): Promise<void> {
    if (!identity) return;
    const room = rooms[roomId];
    if (!room) return;

    const byteLen = new TextEncoder().encode(body).length;
    if (byteLen > MAX_TEXT_MESSAGE_BYTES) {
      setDiagnostics((d) => recordDrop(d, 'oversized_body'));
      setComposerNotice('Message exceeds the 64 KB text limit and was blocked.');
      return;
    }

    const seq = room.localNextSeq;
    const hlc = tickLocal(room.clock, Date.now());
    const aad = `${room.roomId}:${room.currentEpoch}:${identity.authorId}:${seq}`;
    const roomKey = room.keys[room.currentEpoch].keyBase64;
    const ciphertextHex = await encryptRoomPayload(roomKey, aad, body);
    const signatureHex = await signPayload(identity.privateKeyJwk, `${aad}:${ciphertextHex}`);

    const connectedPeers = allPeersOffline ? 0 : getConnectedPeerCount(room, identity.authorId);
    const msg: Message = {
      id: `${identity.authorId}:${seq}`,
      roomId: room.roomId,
      epoch: room.currentEpoch,
      authorId: identity.authorId,
      authorName: identity.displayName,
      sequence: seq,
      hlc,
      kind,
      body,
      ciphertextHex,
      signatureHex,
      verified: true,
      deliveredTo: 1 + connectedPeers,
    };

    const prevLog = room.logs[identity.authorId] ?? createEmptyLogState();
    const { next: nextLog } = recordSequence(prevLog, seq);

    const nextRoom: RoomData = {
      ...room,
      clock: hlc,
      localNextSeq: seq + 1,
      logs: { ...room.logs, [identity.authorId]: nextLog },
      messages: { ...room.messages, [msg.id]: msg },
    };

    setRooms((prev) => ({ ...prev, [roomId]: nextRoom }));
    setComposerNotice(null);

    if (isTauriRuntime()) {
      void indexNativeMessageFts(msg.id, msg.roomId, msg.authorName, msg.body);
    }

    // Broadcast to any live tabs or native LAN UDP peers
    meshRef.current?.send({
      type: 'data',
      senderId: identity.authorId,
      roomId,
      message: msg,
    });

    if (connectedPeers > 0) {
      pulseSync(roomId);
    }

    // Optional simulated LAN teammate reply
    if (simNet.autoReplyEnabled && !allPeersOffline && kind.type !== 'file_offer') {
      const remotePeers = Object.values(room.members).filter(
        (m) => m.id !== identity.authorId && m.status === 'active' && m.presence === 'connected',
      );
      if (remotePeers.length > 0 && Math.random() * 100 >= simNet.dropRatePercent) {
        const responder = remotePeers[seq % remotePeers.length];
        const replyText = PEER_REPLIES[(seq + Object.keys(room.messages).length) % PEER_REPLIES.length];
        window.setTimeout(() => {
          void deliverSimulatedPeerMessage(roomId, responder, { type: 'text' }, replyText);
        }, 1100);
      }
    }
  }

  async function deliverSimulatedPeerMessage(
    roomId: RoomId,
    peer: Member,
    kind: MessageKind,
    body: string,
    skipSequenceCount: number = 0,
  ) {
    const currentRoom = stateRef.current.rooms[roomId];
    const me = stateRef.current.identity;
    if (!currentRoom || !me || stateRef.current.allPeersOffline) return;

    const currentMember = currentRoom.members[peer.id];
    if (!currentMember || currentMember.status !== 'active') return;

    const prevLog = currentRoom.logs[peer.id] ?? createEmptyLogState();
    const baseSeq = highestSeen(prevLog) + 1;
    const roomKey = currentRoom.keys[currentRoom.currentEpoch].keyBase64;
    const activeCount = getActiveMemberCount(currentRoom);

    // If skipping sequences, build and hold missing messages for Have/Want recovery
    if (skipSequenceCount > 0) {
      const held: Message[] = heldGapMessagesRef.current[roomId] ?? [];
      for (let i = 0; i < skipSequenceCount; i++) {
        const missingSeq = baseSeq + i;
        const missingHlc = tickLocal(currentRoom.clock, Date.now() - 2000 + i * 200);
        const missingBody = `[Recovered via Want seq #${missingSeq}] Earlier message from ${peer.displayName} that arrived after WiFi reconnect.`;
        const aad = `${roomId}:${currentRoom.currentEpoch}:${peer.id}:${missingSeq}`;
        const ct = await encryptRoomPayload(roomKey, aad, missingBody);
        const sig = await signPayload(me.privateKeyJwk, `${aad}:${ct}`);
        held.push({
          id: `${peer.id}:${missingSeq}`,
          roomId,
          epoch: currentRoom.currentEpoch,
          authorId: peer.id,
          authorName: peer.displayName,
          sequence: missingSeq,
          hlc: missingHlc,
          kind: { type: 'text' },
          body: missingBody,
          ciphertextHex: ct,
          signatureHex: sig,
          verified: true,
          deliveredTo: activeCount,
        });
      }
      heldGapMessagesRef.current[roomId] = held;
    }

    const deliveredSeq = baseSeq + skipSequenceCount;
    const hlc = tickLocal(currentRoom.clock, Date.now());
    const aad = `${roomId}:${currentRoom.currentEpoch}:${peer.id}:${deliveredSeq}`;
    const ct = await encryptRoomPayload(roomKey, aad, body);
    const sig = await signPayload(me.privateKeyJwk, `${aad}:${ct}`);

    const msg: Message = {
      id: `${peer.id}:${deliveredSeq}`,
      roomId,
      epoch: currentRoom.currentEpoch,
      authorId: peer.id,
      authorName: peer.displayName,
      sequence: deliveredSeq,
      hlc,
      kind,
      body,
      ciphertextHex: ct,
      signatureHex: sig,
      verified: true,
      deliveredTo: activeCount,
    };

    const isViewing =
      stateRef.current.screen === 'room' && stateRef.current.activeRoomId === roomId;

    setRooms((prev) => {
      const latest = prev[roomId];
      if (!latest) return prev;
      const res = ingestMessage(latest, stateRef.current.diagnostics, msg, true, isViewing);
      setDiagnostics(res.diagnostics);
      if (!res.accepted) return prev;
      return { ...prev, [roomId]: res.room };
    });
    pulseSync(roomId);
  }

  async function handleSendComposer() {
    const trimmed = draft.trim();
    if (!trimmed || !activeRoom) return;
    const kind: MessageKind = codeMode
      ? { type: 'code', language: codeLanguage }
      : { type: 'text' };
    await appendLocalMessage(activeRoom.roomId, kind, draft);
    setDraft('');
    setCodeMode(false);
  }

  async function handleFileOffer(file: File) {
    if (!activeRoom) return;
    if (file.size > MAX_FILE_BYTES) {
      setComposerNotice(`"${file.name}" exceeds the 100 MB file attachment limit.`);
      return;
    }
    const safeName = sanitizeWindowsFilename(file.name);
    const buf = await file.arrayBuffer();
    const hash = await sha256Hex(buf);
    const blobUrl = URL.createObjectURL(file);

    await appendLocalMessage(
      activeRoom.roomId,
      {
        type: 'file_offer',
        hash,
        name: safeName,
        rawName: file.name,
        size: file.size,
        state: 'stored',
        blobUrl,
      },
      safeName !== file.name
        ? `Filename sanitized for Windows safety ("${file.name}" → "${safeName}").`
        : '',
    );
  }

  function handleFetchFile(msg: Message) {
    if (!activeRoom || msg.kind.type !== 'file_offer') return;
    const fileKind = msg.kind;

    if (fileKind.state === 'stored') {
      // Explicit user-initiated download — never auto-opened
      const url =
        fileKind.blobUrl ??
        URL.createObjectURL(
          new Blob(
            [
              `DevChat verified attachment\nFile: ${fileKind.name}\nSHA-256: ${fileKind.hash}\nSize: ${fileKind.size} bytes\n`,
            ],
            { type: 'text/plain' },
          ),
        );
      const a = document.createElement('a');
      a.href = url;
      a.download = fileKind.name;
      a.click();
      if (!fileKind.blobUrl) URL.revokeObjectURL(url);
      return;
    }

    // Transition offered -> fetching -> stored
    setRooms((prev) => {
      const r = prev[activeRoom.roomId];
      if (!r) return prev;
      const target = r.messages[msg.id];
      if (!target || target.kind.type !== 'file_offer') return prev;
      return {
        ...prev,
        [r.roomId]: {
          ...r,
          messages: {
            ...r.messages,
            [msg.id]: { ...target, kind: { ...target.kind, state: 'fetching' } },
          },
        },
      };
    });

    window.setTimeout(() => {
      setRooms((prev) => {
        const r = prev[activeRoom.roomId];
        if (!r) return prev;
        const target = r.messages[msg.id];
        if (!target || target.kind.type !== 'file_offer') return prev;
        return {
          ...prev,
          [r.roomId]: {
            ...r,
            messages: {
              ...r.messages,
              [msg.id]: { ...target, kind: { ...target.kind, state: 'stored' } },
            },
          },
        };
      });
    }, 650);
  }

  function handleToggleInvite(roomId: RoomId) {
    setRooms((prev) => {
      const r = prev[roomId];
      if (!r) return prev;
      const nextActive = !r.inviteActive;
      return {
        ...prev,
        [roomId]: {
          ...r,
          inviteActive: nextActive,
          inviteExpiresAtMs: nextActive ? Date.now() + 5 * 60_000 : null,
        },
      };
    });
  }

  async function handleResetJoinCode(roomId: RoomId) {
    if (!identity) return;
    const room = rooms[roomId];
    if (!room || room.ownerId !== identity.authorId) return;

    const newCode = generateJoinCode();
    const hlc = tickLocal(room.clock, Date.now());
    const seq = room.localNextSeq;
    const body = `Join code reset by room owner. Previous code is now invalid.`;
    const aad = `${room.roomId}:${room.currentEpoch}:${identity.authorId}:${seq}`;
    const ct = await encryptRoomPayload(room.keys[room.currentEpoch].keyBase64, aad, body);
    const sig = await signPayload(identity.privateKeyJwk, `${aad}:${ct}`);

    const sysMsg: Message = {
      id: `${identity.authorId}:${seq}`,
      roomId: room.roomId,
      epoch: room.currentEpoch,
      authorId: identity.authorId,
      authorName: 'system',
      sequence: seq,
      hlc,
      kind: { type: 'system_code_reset', epoch: room.currentEpoch },
      body,
      ciphertextHex: ct,
      signatureHex: sig,
      verified: true,
      deliveredTo: getActiveMemberCount(room),
    };

    const nextLog = recordSequence(room.logs[identity.authorId] ?? createEmptyLogState(), seq).next;

    setRooms((prev) => ({
      ...prev,
      [roomId]: {
        ...room,
        joinCode: newCode,
        inviteActive: true,
        inviteExpiresAtMs: Date.now() + 5 * 60_000,
        clock: hlc,
        localNextSeq: seq + 1,
        logs: { ...room.logs, [identity.authorId]: nextLog },
        messages: { ...room.messages, [sysMsg.id]: sysMsg },
      },
    }));
  }

  async function handleRemoveMember(roomId: RoomId, targetId: AuthorId) {
    if (!identity) return;
    const room = rooms[roomId];
    if (!room || room.ownerId !== identity.authorId) return;
    const target = room.members[targetId];
    if (!target || target.status === 'removed') return;

    const newEpoch = room.currentEpoch + 1;
    const newKey = generateRoomKeyBase64();
    const newCode = generateJoinCode();
    const now = Date.now();
    const hlc = tickLocal(room.clock, now);
    const seq = room.localNextSeq;
    const body = `${target.displayName} was removed by ${identity.displayName}. Room key rotated to Epoch ${newEpoch} and join code reset.`;
    const aad = `${room.roomId}:${newEpoch}:${identity.authorId}:${seq}`;
    const ct = await encryptRoomPayload(newKey, aad, body);
    const sig = await signPayload(identity.privateKeyJwk, `${aad}:${ct}`);

    const sysMsg: Message = {
      id: `${identity.authorId}:${seq}`,
      roomId: room.roomId,
      epoch: newEpoch,
      authorId: identity.authorId,
      authorName: 'system',
      sequence: seq,
      hlc,
      kind: { type: 'system_removal', removedName: target.displayName, newEpoch },
      body,
      ciphertextHex: ct,
      signatureHex: sig,
      verified: true,
      deliveredTo: Math.max(1, getActiveMemberCount(room) - 1),
    };

    const nextLog = recordSequence(room.logs[identity.authorId] ?? createEmptyLogState(), seq).next;

    setRooms((prev) => ({
      ...prev,
      [roomId]: {
        ...room,
        currentEpoch: newEpoch,
        joinCode: newCode,
        inviteActive: false,
        inviteExpiresAtMs: null,
        clock: hlc,
        localNextSeq: seq + 1,
        keys: {
          ...room.keys,
          [newEpoch]: { epoch: newEpoch, keyBase64: newKey, createdAtMs: now },
        },
        members: {
          ...room.members,
          [targetId]: {
            ...target,
            status: 'removed',
            removedEpoch: newEpoch,
            presence: 'offline',
          },
        },
        logs: { ...room.logs, [identity.authorId]: nextLog },
        messages: { ...room.messages, [sysMsg.id]: sysMsg },
      },
    }));
  }

  function handleLeaveRoom(roomId: RoomId, _eraseHistory: boolean) {
    setRooms((prev) => {
      const next = { ...prev };
      delete next[roomId];
      return next;
    });
    const remaining = Object.keys(rooms).filter((id) => id !== roomId);
    setActiveRoomId(remaining[0] ?? null);
    setScreen('room');
  }

  function handleToggleMute(roomId: RoomId) {
    setRooms((prev) => {
      const r = prev[roomId];
      if (!r) return prev;
      return { ...prev, [roomId]: { ...r, muted: !r.muted } };
    });
  }

  function handleInjectGap() {
    if (!activeRoom || !identity) return;
    const remote = Object.values(activeRoom.members).find(
      (m) => m.id !== identity.authorId && m.status === 'active',
    );
    if (!remote) return;
    void deliverSimulatedPeerMessage(
      activeRoom.roomId,
      remote,
      { type: 'text' },
      'Latest status update from LAN peer — an earlier packet was dropped over WiFi, creating a sequence gap.',
      1,
    );
  }

  function handleRunHaveWantSync() {
    if (!activeRoom || !identity) return;
    // Broadcast real Have summary to any open tabs
    meshRef.current?.send({
      type: 'have',
      senderId: identity.authorId,
      summary: buildHaveSummary(activeRoom),
    });

    // Heal any held simulated gap messages using computeWants
    const held = heldGapMessagesRef.current[activeRoom.roomId] ?? [];
    if (held.length > 0) {
      const remoteHave = {
        roomId: activeRoom.roomId,
        authors: {} as Record<AuthorId, number>,
      };
      for (const m of held) {
        remoteHave.authors[m.authorId] = Math.max(remoteHave.authors[m.authorId] ?? 0, m.sequence);
      }
      const wants = computeWants(activeRoom.logs, remoteHave, 32);
      const toDeliver = held.filter((m) =>
        wants.some((w) => w.authorId === m.authorId && m.sequence >= w.start && m.sequence <= w.end),
      );

      setRooms((prev) => {
        let updated = prev[activeRoom.roomId];
        if (!updated) return prev;
        let diag = stateRef.current.diagnostics;
        for (const msg of toDeliver) {
          const res = ingestMessage(updated, diag, msg, true, true);
          updated = res.room;
          diag = res.diagnostics;
        }
        setDiagnostics(diag);
        return { ...prev, [activeRoom.roomId]: updated };
      });
      heldGapMessagesRef.current[activeRoom.roomId] = [];
    }
    pulseSync(activeRoom.roomId);
  }

  function handleSimulateSecurityTest(
    kind: 'forged_sig' | 'duplicate_replay' | 'oversized' | 'removed_peer',
  ) {
    if (!activeRoom || !identity) return;
    if (kind === 'forged_sig') {
      const fakeMsg: Message = {
        id: `${identity.authorId}:99999`,
        roomId: activeRoom.roomId,
        epoch: activeRoom.currentEpoch,
        authorId: identity.authorId,
        authorName: identity.displayName,
        sequence: 99999,
        hlc: tickLocal(activeRoom.clock),
        kind: { type: 'text' },
        body: 'forged payload',
        ciphertextHex: 'deadbeef',
        signatureHex: '0000',
        verified: false,
        deliveredTo: 0,
      };
      const res = ingestMessage(activeRoom, diagnostics, fakeMsg, false, true);
      setDiagnostics(res.diagnostics);
      return;
    }

    if (kind === 'duplicate_replay') {
      const existing = Object.values(activeRoom.messages)[0];
      if (existing) {
        const res = ingestMessage(activeRoom, diagnostics, existing, true, true);
        setDiagnostics(res.diagnostics);
      } else {
        setDiagnostics((d) => recordDrop(d, 'duplicate'));
      }
      return;
    }

    if (kind === 'oversized') {
      const bigMsg: Message = {
        id: `${identity.authorId}:88888`,
        roomId: activeRoom.roomId,
        epoch: activeRoom.currentEpoch,
        authorId: identity.authorId,
        authorName: identity.displayName,
        sequence: 88888,
        hlc: tickLocal(activeRoom.clock),
        kind: { type: 'text' },
        body: 'X'.repeat(MAX_TEXT_MESSAGE_BYTES + 128),
        ciphertextHex: '',
        signatureHex: '',
        verified: false,
        deliveredTo: 0,
      };
      const res = ingestMessage(activeRoom, diagnostics, bigMsg, true, true);
      setDiagnostics(res.diagnostics);
      return;
    }

    if (kind === 'removed_peer') {
      const removed = Object.values(activeRoom.members).find((m) => m.status === 'removed');
      if (removed) {
        const bannedMsg: Message = {
          id: `${removed.id}:77777`,
          roomId: activeRoom.roomId,
          epoch: activeRoom.currentEpoch,
          authorId: removed.id,
          authorName: removed.displayName,
          sequence: 77777,
          hlc: tickLocal(activeRoom.clock),
          kind: { type: 'text' },
          body: 'post-removal message attempt',
          ciphertextHex: '',
          signatureHex: '',
          verified: false,
          deliveredTo: 0,
        };
        const res = ingestMessage(activeRoom, diagnostics, bannedMsg, true, true);
        setDiagnostics(res.diagnostics);
      } else {
        setDiagnostics((d) => recordDrop(d, 'removed_author'));
      }
    }
  }

  function handleUpdateDisplayName(newName: string) {
    if (!identity) return;
    setIdentity({ ...identity, displayName: newName });
    setRooms((prev) => {
      const next: Record<RoomId, RoomData> = {};
      for (const [id, r] of Object.entries(prev)) {
        const selfMember = r.members[identity.authorId];
        next[id] = selfMember
          ? {
              ...r,
              members: {
                ...r.members,
                [identity.authorId]: { ...selfMember, displayName: newName },
              },
            }
          : r;
      }
      return next;
    });
  }

  async function handleFirstRunComplete(newName: string) {
    const fresh = await createInitialWorkspace(newName);
    setIdentity(fresh.identity);
    setRooms(fresh.rooms);
    setActiveRoomId(fresh.activeRoomId);
    setDiagnostics(INITIAL_DIAGNOSTICS);
    setScreen('room');
  }

  async function handleResetWorkspace() {
    localStorage.removeItem(STORAGE_KEY);
    if (isTauriRuntime()) {
      await clearNativeWorkspace();
    }
    heldGapMessagesRef.current = {};
    failedJoinAttemptsRef.current = 0;
    const seeded = await createInitialWorkspace('Jaideep');
    setIdentity(seeded.identity);
    setRooms(seeded.rooms);
    setActiveRoomId(seeded.activeRoomId);
    setDiagnostics(INITIAL_DIAGNOSTICS);
    setAllPeersOffline(false);
    setScreen('room');
  }

  if (!ready || !identity) {
    return (
      <div className="h-full flex items-center justify-center text-sm" style={{ color: 'var(--muted)' }}>
        Initializing local cryptographic workspace…
      </div>
    );
  }

  const showRightPanel = rightPanelOpen && windowWidth >= 960 && screen === 'room' && activeRoom !== null;
  const activeMembers = activeRoom ? Object.values(activeRoom.members) : [];
  const activeCount = activeRoom ? getActiveMemberCount(activeRoom) : 0;
  const connectedPeers = activeRoom
    ? allPeersOffline
      ? 0
      : getConnectedPeerCount(activeRoom, identity.authorId)
    : 0;
  const isAllOfflineInRoom = activeRoom !== null && activeCount > 1 && connectedPeers === 0;
  const gapAuthors = activeRoom ? getAuthorsWithGaps(activeRoom) : [];
  const lastSelfMessageId = [...orderedMessages]
    .reverse()
    .find((m) => m.authorId === identity.authorId)?.id;

  const inviteSecondsRemaining =
    activeRoom?.inviteActive && activeRoom.inviteExpiresAtMs
      ? Math.max(0, Math.floor((activeRoom.inviteExpiresAtMs - nowTick) / 1000))
      : 0;
  const inviteMin = String(Math.floor(inviteSecondsRemaining / 60)).padStart(2, '0');
  const inviteSec = String(inviteSecondsRemaining % 60).padStart(2, '0');

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      {/* Left Rail (240px) */}
      <aside
        aria-label="Rooms and navigation"
        className="w-[240px] shrink-0 flex flex-col border-r p-3 gap-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between gap-2 px-1">
          <button
            type="button"
            onClick={() => setScreen('room')}
            className="text-[20px] font-semibold tracking-tight bg-transparent border-0 p-0 cursor-pointer text-left whitespace-nowrap"
            style={{ color: 'var(--text)' }}
          >
            DevChat
          </button>
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            title="Switch room (Ctrl+K)"
            className="font-mono text-[11px] px-1.5 py-0.5 rounded-[4px] border cursor-pointer whitespace-nowrap shrink-0"
            style={{
              backgroundColor: 'var(--bg)',
              borderColor: 'var(--border)',
              color: 'var(--muted)',
            }}
          >
            Ctrl+K
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setScreen('create')}
            className="min-h-[32px] px-2.5 py-1.5 text-xs font-semibold rounded-[4px] inline-flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
            style={{ backgroundColor: 'var(--accent-fill)', color: 'var(--accent-on-fill)' }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create</span>
          </button>
          <button
            type="button"
            onClick={() => setScreen('join')}
            className="min-h-[32px] px-2.5 py-1.5 text-xs font-semibold rounded-[4px] border inline-flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Join</span>
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-1 mb-1.5 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
            Joined rooms
          </div>
          <ul role="listbox" aria-label="Joined rooms" className="m-0 p-0 list-none space-y-1 overflow-y-auto flex-1">
            {roomList.map((room) => {
              const selected = screen === 'room' && room.roomId === activeRoomId;
              const syncState = getRoomSyncState(room);
              return (
                <li key={room.roomId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => selectRoom(room.roomId)}
                    className="w-full min-h-[34px] px-2 py-1.5 rounded-[4px] border flex items-center gap-2 text-left cursor-pointer transition-colors duration-100"
                    style={{
                      backgroundColor: selected ? 'var(--raised)' : 'transparent',
                      borderColor: selected ? 'var(--border)' : 'transparent',
                      color: 'var(--text)',
                    }}
                  >
                    <RoomSigil roomId={room.roomId} />
                    <span className="flex-1 truncate text-sm font-medium">{room.name}</span>
                    {room.muted && (
                      <BellOff
                        className="w-3 h-3 shrink-0"
                        style={{ color: 'var(--muted)' }}
                        aria-label="Muted"
                      />
                    )}
                    {room.unreadCount > 0 && (
                      <span
                        className="text-xs font-semibold font-mono tabular-nums shrink-0"
                        style={{ color: 'var(--accent-text)' }}
                      >
                        {room.unreadCount}
                      </span>
                    )}
                    <StatusDot state={syncState} />
                  </button>
                </li>
              );
            })}
            {roomList.length === 0 && (
              <li className="px-2 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                No rooms joined yet. Create a room or join with a 12-character code.
              </li>
            )}
          </ul>
        </div>

        {/* Bottom rail utility links */}
        <div className="pt-3 border-t space-y-1" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={() => setScreen('diagnostics')}
            className="w-full min-h-[32px] px-2 py-1.5 rounded-[4px] flex items-center justify-between gap-2 text-xs font-semibold cursor-pointer hover:bg-[var(--raised)]"
            style={{
              backgroundColor: screen === 'diagnostics' ? 'var(--raised)' : 'transparent',
              color: screen === 'diagnostics' ? 'var(--accent-text)' : 'var(--text)',
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Activity className="w-3.5 h-3.5" />
              <span>Network diagnostics</span>
            </span>
            {diagnostics.droppedInvalidSignature + diagnostics.droppedRemovedAuthor > 0 && (
              <span className="font-mono tabular-nums" style={{ color: 'var(--warning)' }}>
                {diagnostics.droppedInvalidSignature + diagnostics.droppedRemovedAuthor}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setScreen('settings')}
            className="w-full min-h-[32px] px-2 py-1.5 rounded-[4px] flex items-center justify-between gap-2 text-xs font-semibold cursor-pointer hover:bg-[var(--raised)]"
            style={{
              backgroundColor: screen === 'settings' ? 'var(--raised)' : 'transparent',
              color: screen === 'settings' ? 'var(--accent-text)' : 'var(--text)',
            }}
          >
            <span className="inline-flex items-center gap-2 min-w-0">
              <Settings className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{identity.displayName}</span>
            </span>
            <span className="font-mono text-[11px] shrink-0" style={{ color: 'var(--muted)' }}>
              {identity.authorId.slice(0, 6)}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="w-full min-h-[30px] px-2 py-1 rounded-[4px] flex items-center justify-between gap-2 text-xs cursor-pointer hover:bg-[var(--raised)]"
            style={{ color: 'var(--muted)' }}
          >
            <span className="inline-flex items-center gap-2">
              <Keyboard className="w-3.5 h-3.5" />
              <span>Keyboard shortcuts</span>
            </span>
            <span className="font-mono text-[11px]">Ctrl+/</span>
          </button>
        </div>
      </aside>

      {/* Main Content Pane */}
      <main
        className="flex-1 min-w-0 flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--bg)' }}
        onDragOver={(e) => {
          if (screen === 'room' && activeRoom) {
            e.preventDefault();
            setDragActive(true);
          }
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const file = e.dataTransfer.files?.[0];
          if (file && screen === 'room' && activeRoom) {
            void handleFileOffer(file);
          }
        }}
      >
        {screen === 'first-run' && (
          <div className="flex-1 overflow-y-auto px-4">
            <FirstRunScreen
              initialName={identity.displayName}
              onComplete={handleFirstRunComplete}
              onCancel={() => setScreen('room')}
            />
          </div>
        )}

        {screen === 'create' && (
          <div className="flex-1 overflow-y-auto px-4">
            <CreateRoomModal
              listenAddr={identity.listenAddr}
              onCreate={handleCreateRoom}
              onCancel={() => setScreen('room')}
              onEnterRoom={(roomId) => selectRoom(roomId)}
            />
          </div>
        )}

        {screen === 'join' && (
          <div className="flex-1 overflow-y-auto px-4">
            <JoinRoomModal
              existingRoomIds={Object.keys(rooms)}
              onJoin={handleJoinRoom}
              onCancel={() => setScreen('room')}
            />
          </div>
        )}

        {screen === 'room-settings' && activeRoom && (
          <div className="flex-1 overflow-y-auto">
            <RoomSettingsScreen
              room={activeRoom}
              selfId={identity.authorId}
              onBack={() => setScreen('room')}
              onToggleInvite={() => handleToggleInvite(activeRoom.roomId)}
              onResetJoinCode={() => void handleResetJoinCode(activeRoom.roomId)}
              onRemoveMember={(id) => void handleRemoveMember(activeRoom.roomId, id)}
              onToggleMute={() => handleToggleMute(activeRoom.roomId)}
              onLeaveRoom={(erase) => handleLeaveRoom(activeRoom.roomId, erase)}
            />
          </div>
        )}

        {screen === 'diagnostics' && (
          <div className="flex-1 overflow-y-auto">
            <DiagnosticsScreen
              rooms={roomList}
              activeRoom={activeRoom}
              diagnostics={diagnostics}
              discoveryStage={discoveryStage}
              simNet={simNet}
              allPeersOffline={allPeersOffline}
              onBack={() => setScreen('room')}
              onCycleDiscoveryStage={() =>
                setDiscoveryStage((curr) =>
                  curr === 'manual' ? 'mdns' : nextDiscoveryStage(curr, 10, 0),
                )
              }
              onToggleAllPeersOffline={() => setAllPeersOffline((v) => !v)}
              onUpdateSimNet={(patch) => setSimNet((prev) => ({ ...prev, ...patch }))}
              onInjectGap={handleInjectGap}
              onRunHaveWantSync={handleRunHaveWantSync}
              onSimulateSecurityTest={handleSimulateSecurityTest}
            />
          </div>
        )}

        {screen === 'settings' && (
          <div className="flex-1 overflow-y-auto">
            <SettingsScreen
              identity={identity}
              theme={theme}
              onBack={() => setScreen('room')}
              onUpdateDisplayName={handleUpdateDisplayName}
              onChangeTheme={setTheme}
              onRestoreIdentity={(restored) => setIdentity(restored)}
              onOpenFirstRun={() => setScreen('first-run')}
              onResetWorkspace={() => void handleResetWorkspace()}
            />
          </div>
        )}

        {screen === 'room' && activeRoom && (
          <>
            {/* Room Header */}
            <header
              className="px-4 py-3 border-b flex items-center justify-between gap-4 shrink-0"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)' }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <RoomSigil roomId={activeRoom.roomId} />
                <h1 className="text-[20px] font-semibold m-0 truncate">{activeRoom.name}</h1>
                <StatusDot
                  state={getRoomSyncState(activeRoom)}
                  showLabel
                  labelOverride={
                    syncingRooms[activeRoom.roomId]
                      ? 'Syncing'
                      : isAllOfflineInRoom
                        ? 'Offline (local queue)'
                        : `${connectedPeers} peer${connectedPeers === 1 ? '' : 's'} connected · Epoch ${activeRoom.currentEpoch}`
                  }
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen((v) => !v);
                    if (!searchOpen) setTimeout(() => searchInputRef.current?.focus(), 10);
                    else setSearchQuery('');
                  }}
                  title="Search room history (Ctrl+F)"
                  className="min-h-[30px] px-2.5 py-1 text-xs font-semibold rounded-[4px] border inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  style={{
                    borderColor: searchOpen ? 'var(--accent-fill)' : 'var(--border)',
                    color: searchOpen ? 'var(--accent-text)' : 'var(--text)',
                  }}
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Search</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleToggleMute(activeRoom.roomId)}
                  title={activeRoom.muted ? 'Unmute room' : 'Mute room notifications'}
                  className="min-h-[30px] px-2.5 py-1 text-xs font-semibold rounded-[4px] border inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  {activeRoom.muted ? (
                    <BellOff className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
                  ) : (
                    <Bell className="w-3.5 h-3.5" />
                  )}
                  <span className="hidden sm:inline">{activeRoom.muted ? 'Muted' : 'Notify'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setScreen('room-settings')}
                  className="min-h-[30px] px-2.5 py-1 text-xs font-semibold rounded-[4px] border inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Room settings</span>
                </button>

                <button
                  type="button"
                  onClick={() => setRightPanelOpen((v) => !v)}
                  className="min-h-[30px] px-2.5 py-1 text-xs font-semibold rounded-[4px] border inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  style={{
                    borderColor: showRightPanel ? 'var(--accent-fill)' : 'var(--border)',
                    color: showRightPanel ? 'var(--accent-text)' : 'var(--text)',
                  }}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span className="tabular-nums">Members ({activeCount})</span>
                </button>
              </div>
            </header>

            {/* Offline Banner */}
            {isAllOfflineInRoom && (
              <div
                role="status"
                className="px-4 py-2 border-b text-xs flex items-center justify-between gap-3 shrink-0"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--warning)',
                }}
              >
                <span>
                  You are not connected to any peer in this room. Messages are signed and queued locally until a peer returns.
                </span>
                <button
                  type="button"
                  onClick={() => setAllPeersOffline(false)}
                  className="px-2.5 py-1 text-xs font-semibold rounded-[4px] border cursor-pointer shrink-0"
                  style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
                >
                  Reconnect LAN
                </button>
              </div>
            )}

            {/* Gap Reconciliation Banner */}
            {gapAuthors.length > 0 && (
              <div
                role="status"
                className="px-4 py-2 border-b text-xs flex items-center justify-between gap-3 shrink-0"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--warning)',
                }}
              >
                <span>
                  Sequence gap detected for {gapAuthors.length} author
                  {gapAuthors.length === 1 ? '' : 's'}. Missing earlier messages will fill automatically on next sync.
                </span>
                <button
                  type="button"
                  onClick={handleRunHaveWantSync}
                  className="px-2.5 py-1 text-xs font-semibold rounded-[4px] border cursor-pointer shrink-0"
                  style={{ borderColor: 'var(--accent-fill)', color: 'var(--accent-text)' }}
                >
                  Sync missing ranges now
                </button>
              </div>
            )}

            {/* Inline FTS5-style Search Bar */}
            {searchOpen && (
              <div
                className="px-4 py-2 border-b flex items-center gap-3 shrink-0"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--muted)' }} />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search messages and code in ${activeRoom.name}…`}
                  className="flex-1 h-8 px-2.5 rounded-[4px] border text-sm"
                  style={{
                    backgroundColor: 'var(--bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)',
                  }}
                />
                <span className="text-xs font-mono tabular-nums shrink-0" style={{ color: 'var(--muted)' }}>
                  {filteredMessages.length} match{filteredMessages.length === 1 ? '' : 'es'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen(false);
                    setSearchQuery('');
                  }}
                  aria-label="Close search"
                  className="p-1 rounded-[4px] hover:bg-[var(--raised)] cursor-pointer"
                  style={{ color: 'var(--muted)' }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Message Log */}
            <section
              aria-label="Message history"
              aria-live="polite"
              className="flex-1 overflow-y-auto py-2 relative"
            >
              {dragActive && (
                <div
                  className="absolute inset-3 z-20 rounded-[6px] border-2 border-dashed flex items-center justify-center text-sm font-semibold pointer-events-none"
                  style={{
                    backgroundColor: 'rgba(18, 17, 16, 0.85)',
                    borderColor: 'var(--accent-fill)',
                    color: 'var(--accent-text)',
                  }}
                >
                  Drop file to offer encrypted LAN transfer (up to 100 MB, filename auto-sanitized)
                </div>
              )}

              {filteredMessages.length === 0 ? (
                <div className="px-6 py-10 text-sm" style={{ color: 'var(--muted)' }}>
                  {searchOpen && searchQuery.trim()
                    ? `No messages in ${activeRoom.name} matched "${searchQuery}".`
                    : 'No messages yet. Type below, press Ctrl+Shift+V for a code block, or drop a file here.'}
                </div>
              ) : (
                filteredMessages.map((msg) => {
                  const authorLog = activeRoom.logs[msg.authorId];
                  const hasGapBefore =
                    authorLog !== undefined &&
                    authorLog.outOfOrder.length > 0 &&
                    authorLog.outOfOrder[0] === msg.sequence;
                  return (
                    <MessageLine
                      key={msg.id}
                      msg={msg}
                      isSelf={msg.authorId === identity.authorId}
                      showDelivery={msg.id === lastSelfMessageId}
                      totalActive={activeCount}
                      hasGapBefore={hasGapBefore}
                      highlightQuery={searchOpen ? searchQuery : undefined}
                      onFetchFile={handleFetchFile}
                    />
                  );
                })
              )}
              <div ref={logEndRef} />
            </section>

            {/* Composer */}
            <footer
              className="px-4 py-3 border-t shrink-0 space-y-2"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              {composerNotice && (
                <div className="text-xs flex items-center justify-between gap-2" style={{ color: 'var(--warning)' }}>
                  <span>{composerNotice}</span>
                  <button
                    type="button"
                    onClick={() => setComposerNotice(null)}
                    className="underline cursor-pointer bg-transparent border-0"
                    style={{ color: 'var(--muted)' }}
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCodeMode((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] border font-semibold cursor-pointer"
                    style={{
                      backgroundColor: codeMode ? 'var(--raised)' : 'transparent',
                      borderColor: codeMode ? 'var(--accent-fill)' : 'var(--border)',
                      color: codeMode ? 'var(--accent-text)' : 'var(--muted)',
                    }}
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    <span>{codeMode ? 'Code block mode' : 'Code block'}</span>
                  </button>

                  {codeMode && (
                    <select
                      aria-label="Code language"
                      value={codeLanguage}
                      onChange={(e) => setCodeLanguage(e.target.value)}
                      className="h-7 px-2 rounded-[4px] border font-mono text-xs"
                      style={{
                        backgroundColor: 'var(--bg)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                    >
                      {CODE_LANGUAGES.map((lang) => (
                        <option key={lang} value={lang}>
                          {lang}
                        </option>
                      ))}
                    </select>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFileOffer(file);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] border font-semibold cursor-pointer"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    <span>Attach file</span>
                  </button>
                </div>

                <span className="font-mono text-[11px] hidden sm:inline" style={{ color: 'var(--muted)' }}>
                  Enter sends · Shift+Enter newline · Click any timestamp to inspect crypto
                </span>
              </div>

              <div className="flex items-end gap-2">
                <textarea
                  rows={codeMode ? 4 : 2}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendComposer();
                    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
                      setCodeMode(true);
                    }
                  }}
                  placeholder={
                    codeMode
                      ? `Paste or type ${codeLanguage} code…`
                      : `Message #${activeRoom.name} (encrypted with Epoch ${activeRoom.currentEpoch} key)`
                  }
                  className={`flex-1 resize-none p-2.5 rounded-[4px] border text-sm leading-5 ${
                    codeMode ? 'font-mono text-[13px]' : ''
                  }`}
                  style={{
                    backgroundColor: 'var(--bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleSendComposer()}
                  disabled={!draft.trim()}
                  className="h-9 px-4 text-sm font-semibold rounded-[4px] inline-flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-45"
                  style={{ backgroundColor: 'var(--accent-fill)', color: 'var(--accent-on-fill)' }}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send</span>
                </button>
              </div>
            </footer>
          </>
        )}

        {screen === 'room' && !activeRoom && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
            <h1 className="text-[20px] font-semibold m-0">No room selected</h1>
            <p className="text-sm max-w-[380px] m-0" style={{ color: 'var(--muted)' }}>
              Create a new encrypted LAN room or join a teammate using a 12-character code. Press Ctrl+K anytime to switch.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setScreen('create')}
                className="px-4 py-2 text-sm font-semibold rounded-[4px] cursor-pointer"
                style={{ backgroundColor: 'var(--accent-fill)', color: 'var(--accent-on-fill)' }}
              >
                Create room
              </button>
              <button
                type="button"
                onClick={() => setScreen('join')}
                className="px-4 py-2 text-sm font-semibold rounded-[4px] border cursor-pointer"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                Join with code
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Collapsible Right Panel (260px; auto-closes below 960px wide) */}
      {showRightPanel && activeRoom && (
        <aside
          aria-label="Members and Invite"
          className="w-[260px] shrink-0 border-l p-4 flex flex-col gap-6 overflow-y-auto"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold m-0" style={{ color: 'var(--muted)' }}>
                Members ({activeCount})
              </h2>
              <button
                type="button"
                onClick={() => setScreen('room-settings')}
                className="text-xs underline bg-transparent border-0 p-0 cursor-pointer"
                style={{ color: 'var(--muted)' }}
              >
                Manage
              </button>
            </div>

            <ul className="m-0 p-0 list-none space-y-2">
              {activeMembers.map((member) => {
                const effectivePresence =
                  member.status === 'removed'
                    ? 'removed'
                    : member.id === identity.authorId
                      ? 'you'
                      : allPeersOffline
                        ? 'offline'
                        : member.presence;
                return (
                  <li key={member.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0 truncate">
                      <span
                        className={member.status === 'removed' ? 'line-through' : 'font-medium'}
                        style={{
                          color:
                            member.status === 'removed'
                              ? 'var(--muted)'
                              : member.id === identity.authorId
                                ? 'var(--accent-text)'
                                : 'var(--text)',
                        }}
                      >
                        {member.displayName}
                      </span>
                      {member.role === 'owner' && (
                        <span className="text-[11px] ml-1.5" style={{ color: 'var(--muted)' }}>
                          owner
                        </span>
                      )}
                    </div>
                    <span
                      className="text-xs font-mono shrink-0"
                      style={{
                        color:
                          effectivePresence === 'connected' || effectivePresence === 'you'
                            ? 'var(--success)'
                            : effectivePresence === 'nearby'
                              ? 'var(--info)'
                              : effectivePresence === 'removed'
                                ? 'var(--danger)'
                                : 'var(--muted)',
                      }}
                    >
                      {effectivePresence}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="pt-4 border-t space-y-2.5" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-xs font-semibold m-0" style={{ color: 'var(--muted)' }}>
              Invite to room
            </h2>

            {activeRoom.inviteActive && inviteSecondsRemaining > 0 ? (
              <div
                className="p-3 rounded-[4px] border space-y-2"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <div
                  className="font-mono text-base font-semibold tracking-wider"
                  style={{ color: 'var(--accent-text)' }}
                >
                  {activeRoom.joinCode}
                </div>
                <div className="text-xs font-mono tabular-nums" style={{ color: 'var(--muted)' }}>
                  {identity.listenAddr}
                </div>
                <div className="text-xs font-mono tabular-nums" style={{ color: 'var(--success)' }}>
                  Open · {inviteMin}:{inviteSec} remaining
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(activeRoom.joinCode);
                        setCopiedInvite(true);
                        setTimeout(() => setCopiedInvite(false), 1400);
                      } catch {
                        // ignore
                      }
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-xs font-semibold rounded-[4px] border cursor-pointer"
                    style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                  >
                    {copiedInvite ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedInvite ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleInvite(activeRoom.roomId)}
                    className="px-2 py-1 text-xs font-semibold rounded-[4px] border cursor-pointer"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs m-0" style={{ color: 'var(--muted)' }}>
                  Invite mode is closed. Open a 5-minute window to let a teammate join over LAN or in another browser tab.
                </p>
                <button
                  type="button"
                  onClick={() => handleToggleInvite(activeRoom.roomId)}
                  className="w-full py-1.5 px-3 text-xs font-semibold rounded-[4px] border cursor-pointer"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  Open invite mode
                </button>
              </div>
            )}
          </section>

          <section className="pt-4 border-t space-y-1.5 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            <div className="font-semibold" style={{ color: 'var(--text)' }}>
              Room security
            </div>
            <div>Encryption: AES-256-GCM (Epoch {activeRoom.currentEpoch})</div>
            <div>Signing: ECDSA P-256 per message</div>
            <div>Ordering: Hybrid Logical Clock</div>
          </section>
        </aside>
      )}

      {/* Global Dialogs */}
      <CommandPalette
        open={commandPaletteOpen}
        rooms={roomList}
        onSelectRoom={selectRoom}
        onNavigate={(target) => setScreen(target)}
        onClose={() => setCommandPaletteOpen(false)}
      />

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
