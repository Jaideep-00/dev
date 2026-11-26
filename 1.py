
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent

FILES = [
    ROOT / "crates" / "devchat-net" / "Cargo.toml",
    ROOT / "crates" / "devchat-store" / "Cargo.toml",
]

ENTRY = "serde_json.workspace = true"

for file in FILES:
    if not file.exists():
        print(f"[SKIP] Not found: {file}")
        continue

    content = file.read_text(encoding="utf-8")
    lines = content.splitlines(keepends=True)

    updated_lines = [
        line for line in lines
        if line.strip() != ENTRY
    ]

    if len(updated_lines) == len(lines):
        print(f"[SKIP] Entry not found: {file.name}")
        continue

    backup = file.with_suffix(".toml.backup")

    if not backup.exists():
        shutil.copy2(file, backup)

    file.write_text(
        "".join(updated_lines),
        encoding="utf-8"
    )

    print(f"[FIXED] {file.relative_to(ROOT)}")

print("\nDone. Verify with:")
print("cargo test --workspace")
