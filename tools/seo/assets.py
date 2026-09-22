"""Base64 preview images out of the HTML and into /assets/img/ (brief 1.4).

All 32 embedded blobs across the 16 industry pages turned out to be the same
image -- the 24 KB Orvix wordmark, inlined twice per page -- so this is about
1 MB of base64 that every industry page made a crawler read before it reached
any copy, for one file that could be cached once.

References are written relative rather than as a root-absolute /assets/img/
path, because the export has to keep opening from the filesystem (see
README.txt). Every page's disk depth and production URL depth agree, so
"../../assets/img/x.png" resolves to /assets/img/x.png in production and to the
right file locally. og:image, which cannot be relative, is emitted absolute by
head.py.
"""

from __future__ import annotations

import base64
import hashlib
import pathlib
import re

from . import urls

IMG_DIR = "assets/img"

# base64 payload -> filename it is written out as. Filled at run time; a blob
# already on disk under images/ keeps that name.
KNOWN = {
    "1899f183cce0a152285f78eb1538a8e6ab5624ef": "orvix-logo.png",
}

DATA_IMG = re.compile(
    r'(<img\b[^>]*?\bsrc=")(data:image/(png|jpeg|jpg|gif|webp|svg\+xml);base64,([A-Za-z0-9+/=]+))(")',
    re.I,
)


def extract(root: pathlib.Path, *, write: bool = True) -> dict:
    out_dir = root / IMG_DIR
    written: dict[str, int] = {}
    rewrites = 0
    files = 0

    for rel in urls.discover(root):
        p = root / rel
        s = p.read_text(encoding="utf-8")
        if "data:image" not in s:
            continue

        def sub(m: re.Match) -> str:
            nonlocal rewrites
            payload = m.group(4)
            raw = base64.b64decode(payload)
            sha = hashlib.sha1(raw).hexdigest()
            name = KNOWN.get(sha) or f"img-{sha[:12]}.{_ext(m.group(3))}"
            if write:
                out_dir.mkdir(parents=True, exist_ok=True)
                target = out_dir / name
                if not target.exists():
                    target.write_bytes(raw)
                written[name] = len(raw)
            rewrites += 1
            return m.group(1) + urls.rel_root(rel) + f"{IMG_DIR}/{name}" + m.group(5)

        s2 = DATA_IMG.sub(sub, s)
        if s2 != s:
            files += 1
            if write:
                p.write_text(s2, encoding="utf-8", newline="")

    return {"files": files, "references_rewritten": rewrites, "images": written}


def _ext(mime: str) -> str:
    return {"jpeg": "jpg", "svg+xml": "svg"}.get(mime.lower(), mime.lower())
