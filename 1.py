
from pathlib import Path
from datetime import datetime
import shutil

PROJECT = Path(r"D:\project\devchat")
APP_FILE = PROJECT / "src" / "App.tsx"

if not APP_FILE.exists():
    raise FileNotFoundError(f"App.tsx not found: {APP_FILE}")

content = APP_FILE.read_text(encoding="utf-8")

old_patterns = [
    "\n(\n    roomId: RoomId,",
    "\r\n(\r\n    roomId: RoomId,"
]

new_text = (
    "\n  }\n\n"
    "  async function deliverSimulatedPeerMessage(\n"
    "    roomId: RoomId,"
)

if "async function deliverSimulatedPeerMessage(" in content:
    print("Function declaration already exists. No changes needed.")

else:
    matched = next(
        (pattern for pattern in old_patterns if pattern in content),
        None
    )

    if matched is None:
        raise RuntimeError(
            "Expected broken function declaration was not found. "
            "No changes made."
        )

    backup_dir = PROJECT / "python_fix_backups"
    backup_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = backup_dir / f"App.tsx_before_repair_{timestamp}.bak"

    shutil.copy2(APP_FILE, backup_file)

    content = content.replace(matched, new_text, 1)
    APP_FILE.write_text(content, encoding="utf-8")

    print("Successfully repaired App.tsx.")
    print(f"Backup created: {backup_file}")

print("\nNext, run:")
print("cd D:\\project\\devchat")
print("npm run build")
