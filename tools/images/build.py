"""WebP copies of the photographs, and pages pointed at them.

    python -m tools.images          # convert new/changed JPEGs, update references
    python -m tools.images --check  # report JPEG references that should be WebP

images/*.jpg are the masters (see images/CREDITS.txt). Each gets a .webp
beside it at quality 80, about 40% smaller for no visible change, and every
page reference to a photo that has a WebP twin is switched to it. Drop a new
JPEG into images/, reference it by its .jpg name, run this, done.

The leadership portraits (images/leader-*.jpg) are looked up by name at run
time and may not exist yet, so data-photo attributes are left alone.
Needs Pillow (only to run this, not to serve the site).
"""

from __future__ import annotations

import pathlib
import re
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
IMAGES = ROOT / "images"
QUALITY = 80
REF = re.compile(r"""(?<!data-photo=")((?:\.\./)*|/)?images/([a-z0-9-]+)\.jpe?g""")


def convert() -> list[str]:
    made = []
    for jpg in sorted(IMAGES.glob("*.jp*g")):
        webp = jpg.with_suffix(".webp")
        if webp.exists() and webp.stat().st_mtime >= jpg.stat().st_mtime:
            continue
        with Image.open(jpg) as im:
            im.save(webp, "WEBP", quality=QUALITY, method=6)
        made.append(webp.name)
    return made


def pages() -> list[pathlib.Path]:
    return [p for p in sorted(ROOT.rglob("*.html"))
            if p.relative_to(ROOT).parts[0] not in ("tools", ".github", ".git")]


def rewrite(s: str) -> str:
    def repl(m):
        prefix, name = m.group(1) or "", m.group(2)
        if (IMAGES / f"{name}.webp").exists():
            return f"{prefix}images/{name}.webp"
        return m.group(0)
    return REF.sub(repl, s)


def main(argv: list[str]) -> int:
    check = "--check" in argv
    made = [] if check else convert()
    changed = []
    for p in pages():
        s = p.read_text(encoding="utf-8")
        s2 = rewrite(s)
        if s2 != s:
            changed.append(p.relative_to(ROOT).as_posix())
            if not check:
                p.write_text(s2, encoding="utf-8", newline="")
    jpg = sum(f.stat().st_size for f in IMAGES.glob("*.jp*g"))
    webp = sum(f.stat().st_size for f in IMAGES.glob("*.webp"))
    verb = "would change" if check else "rewritten"
    print(f"images   : {len(made)} WebP made; {len(changed)} pages {verb}; "
          f"JPEG {jpg // 1024} KB -> WebP {webp // 1024} KB")
    return 1 if (check and changed) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
