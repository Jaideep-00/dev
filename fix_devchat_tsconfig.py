from pathlib import Path
from datetime import datetime
import shutil
import re

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / "tsconfig.json"
BACKUP_DIR = ROOT / ".config-backups"

EXCLUDES = ["node_modules", "dist", "target", "src-tauri/target"]


def find_matching(text: str, start: int, opening: str, closing: str) -> int:
    """Find matching bracket while ignoring strings and JSONC comments."""
    depth = 0
    in_string = False
    escaped = False
    line_comment = False
    block_comment = False
    i = start

    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""

        if line_comment:
            if ch == "\n":
                line_comment = False
            i += 1
            continue

        if block_comment:
            if ch == "*" and nxt == "/":
                block_comment = False
                i += 2
            else:
                i += 1
            continue

        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            i += 1
            continue

        if ch == "/" and nxt == "/":
            line_comment = True
            i += 2
            continue
        if ch == "/" and nxt == "*":
            block_comment = True
            i += 2
            continue
        if ch == '"':
            in_string = True
        elif ch == opening:
            depth += 1
        elif ch == closing:
            depth -= 1
            if depth == 0:
                return i
        i += 1

    raise ValueError(f"Could not find matching {closing!r}.")


def main() -> None:
    if not CONFIG.exists():
        raise SystemExit("[ERROR] tsconfig.json not found. Run this script from the DevChat repository root.")

    original = CONFIG.read_text(encoding="utf-8")
    updated = original

    # Locate the root JSON object.
    root_start = updated.find("{")
    if root_start < 0:
        raise SystemExit("[ERROR] tsconfig.json does not look like a JSON/JSONC object.")
    root_end = find_matching(updated, root_start, "{", "}")

    # Find the root-level "exclude" property.
    match = re.search(r'"exclude"\s*:', updated[root_start:root_end])
    if match:
        value_start = root_start + match.end()
        while value_start < root_end and updated[value_start].isspace():
            value_start += 1

        if value_start >= root_end or updated[value_start] != "[":
            raise SystemExit('[ERROR] "exclude" exists but is not an array. No changes made.')

        array_end = find_matching(updated, value_start, "[", "]")
        array_text = updated[value_start + 1:array_end]
        missing = [item for item in EXCLUDES if not re.search(
            r'"' + re.escape(item) + r'"', array_text
        )]

        if not missing:
            print("[OK] All required exclusions already exist in tsconfig.json. No changes needed.")
            return

        # Preserve the existing array and append only missing entries.
        content = array_text.rstrip()
        if content.strip() and not content.rstrip().endswith(","):
            content += ","
        if content.strip():
            content += "\n    "
        content += ",\n    ".join(f'"{item}"' for item in missing)
        if array_text.endswith("\n"):
            content += "\n  "
        updated = updated[:value_start + 1] + content + updated[array_end:]
    else:
        # Add an exclude property at the root level.
        indent_match = re.search(r"\n([ \t]*)[^ \t\r\n]", updated[root_start + 1:root_end])
        indent = indent_match.group(1) if indent_match else "  "
        before = updated[:root_end].rstrip()
        if before.endswith("{"):
            separator = "\n"
        elif before.endswith(","):
            separator = "\n"
        else:
            separator = ",\n"
        addition = (
            separator + indent + '"exclude": [\n'
            + indent + '  "node_modules",\n'
            + indent + '  "dist",\n'
            + indent + '  "target",\n'
            + indent + '  "src-tauri/target"\n'
            + indent + "]\n"
        )
        updated = before + addition + updated[root_end:]

    if updated == original:
        print("[OK] No changes required.")
        return

    BACKUP_DIR.mkdir(exist_ok=True)
    backup = BACKUP_DIR / f"tsconfig.json.{datetime.now():%Y%m%d-%H%M%S}.bak"
    shutil.copy2(CONFIG, backup)
    CONFIG.write_text(updated, encoding="utf-8", newline="\n")

    print("[OK] Updated tsconfig.json.")
    print(f"[BACKUP] {backup.relative_to(ROOT)}")
    print("\nExcluded generated/build folders:")
    for item in EXCLUDES:
        print(f"  - {item}")
    print("\nNow run:")
    print("  npm run lint")
    print("  npm run build")


if __name__ == "__main__":
    main()
