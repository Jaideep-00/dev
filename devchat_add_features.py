from __future__ import annotations

import re
import shutil
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP = ROOT / "src" / "App.tsx"
BACKUP_DIR = ROOT / ".devchat-feature-backups"

def fail(message: str) -> None:
    raise SystemExit(f"\n[STOP] {message}")

def backup(path: Path) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = BACKUP_DIR / f"{path.name}.{stamp}.bak"
    shutil.copy2(path, target)
    return target

def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        fail(f"Expected exactly one insertion point for {label}; found {count}. No files changed.")
    return source.replace(old, new, 1)

def main() -> None:
    if not APP.exists():
        fail("Run this script from the DevChat repository root. src/App.tsx was not found.")

    source = APP.read_text(encoding="utf-8")

    # Do not apply twice.
    if "DEVCHAT_LOCAL_FEATURES_V1" in source:
        print("[INFO] These local tools are already installed. No changes made.")
        return

    required = [
        "const [rooms, setRooms] = useState<Record<RoomId, RoomData>>({});",
        "const roomList = useMemo(",
        "{/* Bottom rail utility links */}",
        "  return (\n    <div className=\"flex h-full w-full overflow-hidden\"",
    ]
    for marker in required:
        if marker not in source:
            fail(f"Repository source does not match the inspected version (missing: {marker[:70]}).")

    # Add local pin state. This is UI-only metadata and does not alter encrypted message packets.
    source = replace_once(
        source,
        "  const [rooms, setRooms] = useState<Record<RoomId, RoomData>>({});",
        """  const [rooms, setRooms] = useState<Record<RoomId, RoomData>>({});
  // DEVCHAT_LOCAL_FEATURES_V1: local-only pinned room IDs and repository shortcut.
  const [pinnedRoomIds, setPinnedRoomIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('devchat-pinned-rooms-v1') || '[]'); }
    catch { return []; }
  });
  const [repoShortcut, setRepoShortcut] = useState(() =>
    localStorage.getItem('devchat-repository-url-v1') || 'https://github.com/Jaideep-00/dev'
  );
  const [repoEditorOpen, setRepoEditorOpen] = useState(false);
""",
        "pinned-room state",
    )

    # Persist pins and repository URL independently of workspace JSON.
    source = replace_once(
        source,
        "  // Apply theme to document root",
        """  // DEVCHAT_LOCAL_FEATURES_V1: persist local-only sidebar preferences.
  useEffect(() => {
    localStorage.setItem('devchat-pinned-rooms-v1', JSON.stringify(pinnedRoomIds));
  }, [pinnedRoomIds]);

  // Apply theme to document root""",
        "preference persistence",
    )

    # Insert helper functions immediately before the room creation handler.
    source = replace_once(
        source,
        "  async function handleCreateRoom(name: string)",
        """  // DEVCHAT_LOCAL_FEATURES_V1
  function togglePinnedRoom(roomId: string) {
    setPinnedRoomIds((current) =>
      current.includes(roomId) ? current.filter((id) => id !== roomId) : [...current, roomId]
    );
  }

  function saveRepositoryShortcut() {
    const value = repoShortcut.trim();
    if (!/^https:\\/\\/github\\.com\\/[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+\\/?$/.test(value)) {
      setComposerNotice('Enter a valid GitHub repository URL (https://github.com/owner/repository).');
      return;
    }
    const normalized = value.replace(/\\/$/, '');
    setRepoShortcut(normalized);
    localStorage.setItem('devchat-repository-url-v1', normalized);
    setRepoEditorOpen(false);
    setComposerNotice('GitHub repository shortcut saved.');
  }

  function exportActiveRoom(format: 'json' | 'txt') {
    if (!activeRoom) return;
    const messages = getOrderedMessages(activeRoom);
    const payload = format === 'json'
      ? JSON.stringify({
          app: 'DevChat',
          room: { id: activeRoom.roomId, name: activeRoom.name },
          exportedAt: new Date().toISOString(),
          messages: messages.map((m) => ({
            id: m.id, author: m.authorName, authorId: m.authorId,
            time: new Date(m.hlc.physicalMs).toISOString(),
            kind: m.kind.type, body: m.body,
          })),
        }, null, 2)
      : messages.map((m) =>
          `[${new Date(m.hlc.physicalMs).toLocaleString()}] ${m.authorName}: ${m.body || (m.kind.type === 'file_offer' ? `[File: ${m.kind.name}]` : `[${m.kind.type}]`)}`
        ).join('\\n');
    const blob = new Blob([payload], { type: format === 'json' ? 'application/json' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `devchat-${sanitizeWindowsFilename(activeRoom.name)}-${Date.now()}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleCreateRoom(name: string)""",
        "local tools handlers",
    )

    # Add pin toggle to each room row.
    source = replace_once(
        source,
        """                    {room.muted && (
                      <BellOff""",
        """                    <span
                      role="button"
                      tabIndex={0}
                      title={pinnedRoomIds.includes(room.roomId) ? 'Unpin room' : 'Pin room'}
                      aria-label={pinnedRoomIds.includes(room.roomId) ? 'Unpin room' : 'Pin room'}
                      onClick={(event) => { event.stopPropagation(); togglePinnedRoom(room.roomId); }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault(); event.stopPropagation(); togglePinnedRoom(room.roomId);
                        }
                      }}
                      className="text-xs px-1 cursor-pointer"
                      style={{ color: pinnedRoomIds.includes(room.roomId) ? 'var(--accent-text)' : 'var(--muted)' }}
                    >{pinnedRoomIds.includes(room.roomId) ? '★' : '☆'}</span>
                    {room.muted && (
                      <BellOff""",
        "room pin control",
    )

    # Add a dedicated pinned section and GitHub shortcut in the sidebar.
    source = replace_once(
        source,
        "        {/* Bottom rail utility links */}",
        """        {/* DEVCHAT_LOCAL_FEATURES_V1: pinned rooms and repository shortcut */}
        <section className="shrink-0 border-t pt-2 space-y-1" style={{ borderColor: 'var(--border)' }}>
          <div className="px-1 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
            Pinned rooms
          </div>
          {pinnedRoomIds.map((id) => {
            const pinned = rooms[id];
            if (!pinned) return null;
            return (
              <button key={id} type="button" onClick={() => selectRoom(id)}
                className="w-full text-left px-2 py-1 rounded text-xs hover:bg-[var(--raised)] truncate"
                style={{ color: 'var(--text)' }}>
                ★ {pinned.name}
              </button>
            );
          })}
          {pinnedRoomIds.length === 0 && (
            <div className="px-2 py-1 text-xs" style={{ color: 'var(--muted)' }}>Pin a room with ☆</div>
          )}
          <div className="flex items-center gap-1 pt-1">
            <button type="button" onClick={() => window.open(repoShortcut, '_blank', 'noopener,noreferrer')}
              className="flex-1 text-left px-2 py-1 rounded text-xs hover:bg-[var(--raised)]"
              style={{ color: 'var(--accent-text)' }}>↗ GitHub repository</button>
            <button type="button" title="Change repository URL" onClick={() => setRepoEditorOpen((v) => !v)}
              className="px-2 py-1 rounded text-xs hover:bg-[var(--raised)]"
              style={{ color: 'var(--muted)' }}>Edit</button>
          </div>
          {repoEditorOpen && (
            <div className="space-y-1 px-1">
              <input value={repoShortcut} onChange={(e) => setRepoShortcut(e.target.value)}
                aria-label="GitHub repository URL" placeholder="https://github.com/owner/repo"
                className="w-full min-w-0 px-2 py-1 rounded border text-xs"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }} />
              <button type="button" onClick={saveRepositoryShortcut}
                className="px-2 py-1 rounded text-xs font-semibold"
                style={{ background: 'var(--accent-fill)', color: 'var(--accent-on-fill)' }}>Save URL</button>
            </div>
          )}
        </section>

        {/* Bottom rail utility links */}""",
        "pinned section and GitHub shortcut",
    )

    # Add chat export actions to the existing room header utility area using a stable header anchor.
    source = replace_once(
        source,
        """              <div className="flex items-center gap-3 min-w-0">
                <RoomSigil roomId={activeRoom.roomId} />""",
        """              <div className="flex items-center gap-3 min-w-0">
                <RoomSigil roomId={activeRoom.roomId} />""",
        "room header verification",
    )

    # Put export buttons in the header after the room title.
    source = replace_once(
        source,
        """                <h1 className="text-[20px] font-semibold m-0 truncate">{activeRoom.name}</h1>
                <StatusDot""",
        """                <h1 className="text-[20px] font-semibold m-0 truncate">{activeRoom.name}</h1>
                <StatusDot""",
        "header anchor verification",
    )

    # Use the existing search control cluster's header button area by inserting export controls
    # before the first room header closing section marker.
    header_anchor = """            {/* Room Header */}
            <header"""
    if header_anchor not in source:
        fail("Could not locate room header. No files changed.")

    # Insert exports next to the room heading, in the same flex row.
    source = replace_once(
        source,
        """                <h1 className="text-[20px] font-semibold m-0 truncate">{activeRoom.name}</h1>""",
        """                <h1 className="text-[20px] font-semibold m-0 truncate">{activeRoom.name}</h1>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => exportActiveRoom('txt')} title="Export chat as TXT"
                    className="px-2 py-1 rounded border text-[11px]"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>TXT</button>
                  <button type="button" onClick={() => exportActiveRoom('json')} title="Export chat as JSON"
                    className="px-2 py-1 rounded border text-[11px]"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>JSON</button>
                </div>""",
        "chat export buttons",
    )

    backup_path = backup(APP)
    APP.write_text(source, encoding="utf-8", newline="\n")
    print("[OK] Added local pinned-room section, editable GitHub repository shortcut, and TXT/JSON chat export.")
    print(f"[BACKUP] {backup_path.relative_to(ROOT)}")
    print("\nExisting repository features detected in the inspected source:")
    print("  - Message search and SQLite FTS indexing")
    print("  - Unread counts and muted-room state")
    print("  - Peer presence and LAN delivery counters")
    print("  - Drag-and-drop file attachment")
    print("  - Code-block message mode")
    print("\nNot auto-added by this script:")
    print("  - Message replies, typing indicators, recipient-confirmed read receipts,")
    print("    clipboard image paste/preview, custom room colors, and date separators.")
    print("These require coordinated message-schema/protocol/UI changes; this script avoids")
    print("inventing delivery or read confirmations and does not modify encrypted packet formats.")
    print("\nNext: run `npm run build` and `npm run lint` from this repository.")

if __name__ == "__main__":
    main()
