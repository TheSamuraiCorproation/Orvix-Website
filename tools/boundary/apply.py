"""The Boundary band on the 32 What we do pages (English and Arabic).

    * the selector script, which was pasted inline into each of the 32 pages,
      now lives once in assets/boundary.js; that version also steps through
      the three moves on its own (see the file for the rules)
    * the band's styles (the large bottom-centre ORVIX watermark and the
      auto-advance progress bar) live in assets/css/boundary.css; this makes
      sure each band page links it once

Idempotent, like the other tools.

    python -m tools.boundary            # apply
    python -m tools.boundary --check    # report what would change
"""

from __future__ import annotations

import pathlib
import re
import sys

from ..nav.apply import pages, up

ROOT = pathlib.Path(__file__).resolve().parents[2]

R_INLINE = re.compile(
    r"<script>\s*/\* boundary selector: build the buttons from the steps already on the page \*/"
    r".*?</script>\n?", re.S)
R_TAG = re.compile(r'<script src="(?:\.\./)*assets/boundary\.js" defer></script>\n?')

R_CSS_LINK = re.compile(r'\n?<link rel="stylesheet" href="(?:\.\./)*assets/css/boundary\.css">')


def has_band(s: str) -> bool:
    return "data-bsel" in s


def ensure_tag(s: str, rel: str) -> str:
    """Exactly one boundary.js tag in <head>; a correct one is left in place."""
    tag = f'<script src="{up(rel)}assets/boundary.js" defer></script>'
    found = R_TAG.findall(s)
    if len(found) == 1 and found[0].strip() == tag and s.find(tag) < s.lower().rfind("</head>"):
        return s
    s = R_TAG.sub("", s)
    i = s.lower().rfind("</head>")
    return s[:i] + tag + "\n" + s[i:]


def ensure_css_link(s: str, rel: str) -> str:
    """Exactly one boundary.css link, right after nav-panel.css: the place its
    rules held when they were inline, so the cascade is unchanged."""
    tag = f'<link rel="stylesheet" href="{up(rel)}assets/css/boundary.css">'
    anchor = f'<link rel="stylesheet" href="{up(rel)}assets/css/nav-panel.css">'
    if s.count("assets/css/boundary.css") == 1 and anchor + "\n" + tag in s:
        return s
    s = R_CSS_LINK.sub("", s)
    i = s.find(anchor)
    if i < 0:
        raise ValueError(f"{rel}: no nav-panel.css link to place boundary.css after")
    i += len(anchor)
    return s[:i] + "\n" + tag + s[i:]


def process(root: pathlib.Path, rel: str, check: bool) -> list[str]:
    p = root / rel
    s0 = p.read_text(encoding="utf-8")
    if not has_band(s0):
        return []
    s, did = s0, []
    for name, fn in (("script", lambda x: ensure_tag(R_INLINE.sub("", x), rel)),
                     ("css", lambda x: ensure_css_link(x, rel))):
        before = s
        s = fn(s)
        if s != before:
            did.append(name)
    if s != s0 and not check:
        p.write_text(s, encoding="utf-8", newline="")
    return did


def main(argv: list[str]) -> int:
    check = "--check" in argv
    counts: dict[str, int] = {}
    touched = 0
    for rel in pages(ROOT):
        did = process(ROOT, rel, check)
        touched += bool(did)
        for k in did:
            counts[k] = counts.get(k, 0) + 1
    print(f"boundary : {touched} pages {'would change' if check else 'changed'}")
    for k, n in sorted(counts.items()):
        print(f"           {k:<10} {n}")
    return 1 if (check and touched) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
