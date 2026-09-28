"""The Boundary band on the 32 What we do pages (English and Arabic).

    * the selector script, which was pasted inline into each of the 32 pages,
      now lives once in assets/boundary.js; that version also steps through
      the three moves on its own (see the file for the rules)
    * the ORVIX watermark behind the band is set large and anchored to the
      bottom centre instead of floating small in the middle

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

CSS_BEGIN = "/* boundary:begin  tools/boundary */"
CSS_END = "/* boundary:end */"
R_CSS = re.compile(re.escape(CSS_BEGIN) + r".*?" + re.escape(CSS_END) + r"\n?", re.S)
CSS = """\
/* the watermark: large, bottom centre, cropped by the band's lower edge.
   position is restated because .sec.dark.bnd>* {position:relative} outranks
   the base .wm rule, which had left the mark in the flow at the top */
.wwd .sec.dark.bnd-sel .wm{position:absolute;z-index:0;left:50%;top:auto;bottom:0;transform:translate(-50%,21%);
font-size:clamp(170px,27vw,440px);color:rgba(255,255,255,.045)}
.wwd .sec.dark.bnd-sel .wm b{color:rgba(72,226,226,.085)}
/* auto-advance: a bar on the active tab runs down the time to the next move */
.wwd .btab{position:relative;overflow:hidden}
.wwd .btab .pg{position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--cyan);
transform:scaleX(0);transform-origin:left center;pointer-events:none}
[dir="rtl"] .wwd .btab .pg{transform-origin:right center}
.wwd .btab.alt .pg{background:var(--steel)}
.wwd .bauto .btab.on .pg{animation:bstep var(--bstep,5000ms) linear forwards}
.wwd .bpause .btab.on .pg{animation-play-state:paused}
@keyframes bstep{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@media(prefers-reduced-motion:reduce){.wwd .btab .pg{display:none}}"""


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


def ensure_css(s: str) -> str:
    blk = f"{CSS_BEGIN}\n{CSS}\n{CSS_END}\n"
    if R_CSS.search(s):
        return R_CSS.sub(lambda _: blk, s, count=1)
    head_end = s.lower().find("</head>")
    i = s.lower().rfind("</style>", 0, head_end)
    return s[:i] + blk + "\n" + s[i:]


def process(root: pathlib.Path, rel: str, check: bool) -> list[str]:
    p = root / rel
    s0 = p.read_text(encoding="utf-8")
    if not has_band(s0):
        return []
    s, did = s0, []
    for name, fn in (("script", lambda x: ensure_tag(R_INLINE.sub("", x), rel)),
                     ("css", ensure_css)):
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
