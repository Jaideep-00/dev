
from pathlib import Path
from datetime import datetime
import shutil
import sys

FILES = {
    "types": Path("src/engine/types.ts"),
    "modal": Path("src/components/CreateRoomModal.tsx"),
    "app": Path("src/App.tsx"),
}

for name, path in FILES.items():
    if not path.exists():
        sys.exit(f"ERROR: Missing file: {path}")

original = {
    name: path.read_text(encoding="utf-8")
    for name, path in FILES.items()
}

updated = dict(original)


def replace_once(name, old, new, description):
    count = updated[name].count(old)
    if count != 1:
        raise RuntimeError(
            f"{description}: expected one matching section, found {count}. "
            "No files have been modified."
        )
    updated[name] = updated[name].replace(old, new, 1)


# --------------------------------------------------
# 1. Add optional repository URL to RoomData
# --------------------------------------------------

replace_once(
    "types",
    "export interface RoomData {\n  roomId: RoomId;\n  name: string;\n",
    "export interface RoomData {\n"
    "  roomId: RoomId;\n"
    "  name: string;\n"
    "  githubRepoUrl?: string;\n",
    "RoomData repository property",
)


# --------------------------------------------------
# 2. Update CreateRoomModal props and state
# --------------------------------------------------

replace_once(
    "modal",
    "  onCreate: (name: string) => Promise<{ roomId: string; joinCode: string }>;",
    "  onCreate: (name: string, githubRepoUrl: string) => "
    "Promise<{ roomId: string; joinCode: string }>;",
    "CreateRoomModal onCreate signature",
)

replace_once(
    "modal",
    "  const [name, setName] = useState('');\n",
    "  const [name, setName] = useState('');\n"
    "  const [githubRepoUrl, setGithubRepoUrl] = useState('');\n",
    "CreateRoomModal repository state",
)

replace_once(
    "modal",
    "    const result = await onCreate(trimmed);\n",
    """    const repo = githubRepoUrl.trim();

    if (repo) {
      try {
        const parsed = new URL(repo);
        if (
          parsed.protocol !== 'https:' ||
          parsed.hostname.toLowerCase() !== 'github.com' ||
          !/^\\/[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+\\/?$/.test(parsed.pathname)
        ) {
          setError('Enter a valid GitHub repository URL, e.g. https://github.com/owner/repo.');
          return;
        }
      } catch {
        setError('Enter a valid GitHub repository URL.');
        return;
      }
    }

    const result = await onCreate(trimmed, repo);
""",
    "CreateRoomModal submit handler",
)

# Add repository input immediately after the room-name field.
replace_once(
    "modal",
    """          </label>

          <div className="flex items-center justify-end gap-2 pt-2">""",
    """          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-semibold">
              GitHub repository (optional)
            </span>
            <input
              type="url"
              value={githubRepoUrl}
              onChange={(e) => setGithubRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="w-full h-9 px-3 rounded-[4px] border text-sm"
              style={{
                backgroundColor: 'var(--bg)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            />
            <span className="block text-xs" style={{ color: 'var(--muted)' }}>
              This repository will be associated with this room and shared with its members.
            </span>
          </label>

          <div className="flex items-center justify-end gap-2 pt-2">""",
    "CreateRoomModal repository input",
)


# --------------------------------------------------
# 3. Update App room creation handler
# --------------------------------------------------

replace_once(
    "app",
    "  async function handleCreateRoom(name: string): Promise<{ roomId: string; joinCode: string }> {",
    "  async function handleCreateRoom(\n"
    "    name: string,\n"
    "    githubRepoUrl: string,\n"
    "  ): Promise<{ roomId: string; joinCode: string }> {",
    "handleCreateRoom signature",
)

replace_once(
    "app",
    "      roomId,\n      name,\n      ownerId: identity.authorId,",
    "      roomId,\n"
    "      name,\n"
    "      ...(githubRepoUrl ? { githubRepoUrl } : {}),\n"
    "      ownerId: identity.authorId,",
    "newRoom repository property",
)


# --------------------------------------------------
# 4. Connect the creation modal
# --------------------------------------------------

replace_once(
    "app",
    """            <CreateRoomModal
              listenAddr={identity.listenAddr}
              onCreate={handleCreateRoom}""",
    """            <CreateRoomModal
              listenAddr={identity.listenAddr}
              onCreate={handleCreateRoom}""",
    "CreateRoomModal connection",
)


# --------------------------------------------------
# 5. Display repository only inside an opened room
# --------------------------------------------------
# --------------------------------------------------
# 5. Display GitHub repository inside the active room
# --------------------------------------------------

import re

if "activeRoom.githubRepoUrl" in updated["app"]:
    raise RuntimeError(
        "GitHub shortcut already exists. No files have been modified."
    )

pattern = re.compile(
    r"(?m)^([ \t]*)<h1\b[^\n]*>\{activeRoom\.name\}</h1>[ \t]*$"
)

matches = list(pattern.finditer(updated["app"]))

if len(matches) != 1:
    raise RuntimeError(
        f"Could not uniquely locate active room title. "
        f"Found {len(matches)} matches. No files have been modified."
    )

match = matches[0]
indent = match.group(1)

github_button = f"""
{indent}{{activeRoom.githubRepoUrl && (
{indent}  <a
{indent}    href={{activeRoom.githubRepoUrl}}
{indent}    target="_blank"
{indent}    rel="noopener noreferrer"
{indent}    title="Open this room's GitHub repository"
{indent}    className="min-h-[28px] px-2.5 py-1 text-xs font-semibold rounded-[4px] border inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
{indent}    style={{{{
{indent}      borderColor: 'var(--border)',
{indent}      color: 'var(--accent-text)',
{indent}      textDecoration: 'none',
{indent}    }}}}
{indent}  >
{indent}    <span aria-hidden="true">↗</span>
{indent}    <span>GitHub</span>
{indent}  </a>
{indent})}}"""

updated["app"] = (
    updated["app"][:match.end()]
    + github_button
    + updated["app"][match.end():]
)


# --------------------------------------------------
# 6. Ensure all changes are ready before writing
# --------------------------------------------------

backup_dir = Path(".devchat-room-github-backups")
backup_dir.mkdir(exist_ok=True)

stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

for name, path in FILES.items():
    backup = backup_dir / f"{path.name}.{stamp}.bak"
    shutil.copy2(path, backup)

for name, path in FILES.items():
    path.write_text(updated[name], encoding="utf-8")

print("SUCCESS: Room-specific GitHub repository feature added.")
print()
print("Updated files:")
for path in FILES.values():
    print(f"  - {path}")

print(f"\nBackups: {backup_dir}")
print()
print("Next commands:")
print("  npm run lint")
print("  npm run build")
