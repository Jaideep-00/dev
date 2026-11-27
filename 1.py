
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "src"

KEYWORDS = [
    "overflow",
    "overflow-y",
    "overflow-anchor",
    "min-height",
    "max-height",
    "height:",
    "flex:",
    "flex-direction",
    "justify-content",
    "align-items",
    "position:",
    "scroll",
]

EXTENSIONS = {".css", ".tsx", ".ts"}

def main():
    print("DEVCHAT UI LAYOUT INSPECTION")
    print("=" * 60)

    if not SOURCE.exists():
        print("ERROR: src folder not found.")
        return

    found = False

    for path in SOURCE.rglob("*"):
        if not path.is_file() or path.suffix not in EXTENSIONS:
            continue

        if any(part in {"node_modules", "dist", "build"}
               for part in path.parts):
            continue

        try:
            lines = path.read_text(
                encoding="utf-8",
                errors="replace"
            ).splitlines()
        except OSError:
            continue

        matches = [
            (i, line.strip())
            for i, line in enumerate(lines, 1)
            if any(word in line.lower() for word in KEYWORDS)
        ]

        if matches:
            found = True
            print(f"\nFILE: {path.relative_to(ROOT)}")

            for number, line in matches:
                print(f"  {number}: {line}")

    if not found:
        print("No matching layout styles found.")

    print("\nInspection completed.")

if __name__ == "__main__":
    main()
