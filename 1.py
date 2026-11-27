
from pathlib import Path
from datetime import datetime
import shutil

README = Path("README.md")

START = "<!-- DEVCHAT_FEATURES_START -->"
END = "<!-- DEVCHAT_FEATURES_END -->"

FEATURES = """
## Latest Features

### Chat and Messaging
- Real-time peer-to-peer messaging over LAN.
- Message history with chronological ordering.
- Search messages and code within conversations.
- Copy code messages directly.
- Export conversations as TXT or JSON.

### Pinning and Organization
- Pin important conversations for quick access.
- Pin important messages with a WhatsApp-style banner.
- Navigate between multiple pinned messages.
- Click a pinned message preview to jump to its original location.
- Unpin messages whenever they are no longer important.
- Pin important messages as project tasks.

### GitHub Integration
- Quick GitHub repository shortcut from the application.
- Open the connected project repository directly.

### Connectivity and Reliability
- Offline message queueing.
- Automatic synchronization when peers reconnect.
- Message integrity and cryptographic signature verification.
- Hybrid Logical Clock (HLC) ordering.
- Sequence-gap detection and synchronization.

### Local Preferences
- Pinned rooms, messages, and tasks are stored locally.
- User interface preferences are maintained across sessions.
"""

section = f"{START}\n{FEATURES.strip()}\n{END}"

if not README.exists():
    raise SystemExit("README.md not found. Run this script from D:\\project\\devchat.")

original = README.read_text(encoding="utf-8")

if START in original and END in original:
    start_index = original.index(START)
    end_index = original.index(END) + len(END)

    if end_index < start_index:
        raise SystemExit("README feature markers are in the wrong order.")

    updated = original[:start_index] + section + original[end_index:]
else:
    updated = original.rstrip() + "\n\n" + section + "\n"

if updated == original:
    print("[INFO] README is already up to date.")
    raise SystemExit(0)

backup = README.with_name(
    f"README.backup-{datetime.now():%Y%m%d-%H%M%S}.md"
)

shutil.copy2(README, backup)
README.write_text(updated, encoding="utf-8")

print("[SUCCESS] README.md updated.")
print(f"[BACKUP] {backup}")
