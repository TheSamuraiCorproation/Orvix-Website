"""Site-wide navigation fix and clean-up.

What was wrong, and why it only showed on the live site:

  * 74 pages still carried a click interceptor from the first export, which
    swallowed any href beginning with "/" and showed "page not in this
    export". Locally every link is relative, so it never fired. Netlify's
    Pretty URLs post-processing rewrites every link to a root-absolute path,
    so on the live site it caught every navigation click on those pages.
  * The menus opened on :hover and :focus-within only. A click on a menu
    button did nothing, and after a click the button kept focus, so its
    panel stayed pinned open under whatever panel was hovered next - the two
    overlapped. On a touch device wider than 1120px there was no way to open
    a menu at all.
  * The burger script was pasted into every page, in two dialects, and the
    homepage carried both.

What this does, idempotently, to every page:

  1. replaces the :hover/:focus-within rule with a .open state (set by
     assets/nav.js on click and, for mouse users, on hover), scopes hover to
     devices that have one, and gives the open panel a z-index
  2. loads assets/nav.js once, with defer, and removes the pasted burger
     scripts, the nav:js transplant blocks and the click interceptor
  3. removes the #nyi notice element and its rules
  4. points the two "How we operate" footer links, which went to a page that
     does not exist, at the "How we operate" section of the home page
  5. archives the identical BUILD NOTES comment into BUILD_NOTES.txt once and
     strips it, and strips the "ADD YOUR PHOTOGRAPHS HERE" how-to comment,
     both of which shipped on every page
  6. gives the engagement pages the mega-menu rules they never had, and lets
     every panel scroll inside itself on a short screen

    python -m tools.nav            # apply
    python -m tools.nav --check    # report what would change, write nothing
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
NOTES = ROOT / "BUILD_NOTES.txt"

# ---- 1. css ---------------------------------------------------------------

OLD_HOVER = (".nav-l>li:hover .dd,.nav-l>li:focus-within .dd"
             "{opacity:1;visibility:visible;transform:none}")
NEW_HOVER = (
    "/* menus: .open is set by assets/nav.js on click, and on hover where a\n"
    "   pointer exists; one panel at a time, the open one on top */\n"
    ".nav-l>li.open .dd{opacity:1;visibility:visible;transform:none}\n"
    "@media(hover:hover) and (pointer:fine){"
    ".nav-l>li:hover .dd{opacity:1;visibility:visible;transform:none}}\n"
    ".dd{z-index:1}.nav-l>li.open{z-index:2}\n"
    ".nav-l>li.open>button.has{color:var(--cyan)}"
)
OLD_CURSOR = "height:66px;cursor:default;text-align:left"
NEW_CURSOR = "height:66px;cursor:pointer;text-align:left"

# ---- 2. script ------------------------------------------------------------

SCRIPT_RE = re.compile(r'<script src="(?:\.\./)*assets/nav\.js" defer></script>\n?')

R_IIFE = re.compile(
    r"\(function\(\)\{\s*var bg=document\.getElementById\('bg'\),\s*"
    r"mob=document\.getElementById\('mob'\);.*?\}\)\(\);[ \t]*\n?", re.S)
R_ES6 = re.compile(
    r"const bg=document\.getElementById\('bg'\),\s*mob=document\.getElementById\('mob'\);"
    r"\s*bg\.onclick=.*?document\.body\.style\.overflow='';\}\);[ \t]*\n?", re.S)
R_NYI_JS = re.compile(
    r"(?:/\* internal links to pages not in this export \*/\n)?"
    r"document\.addEventListener\('click',function\(e\)\{\s*(?:var|const|let) a=e\.target\.closest\('a\[href\]'\);"
    r".*?getElementById\('nyi'\).*?\n\}\);[ \t]*\n?", re.S)
R_NAVJS_BLOCK = re.compile(r"<!-- nav:js:begin.*?<!-- nav:js:end -->\n?", re.S)
R_EMPTY_SCRIPT = re.compile(r"<script>\s*</script>\n?")

# ---- 3. notice ------------------------------------------------------------

R_NYI_DIV = re.compile(r'[ \t]*<div id="nyi"></div>[ \t]*\n?')
R_NYI_CSS = re.compile(r"(?m)^[ \t]*#nyi(?:\.on)?\{[^}]*\}[ \t]*\n?")

# ---- 4. dead link ---------------------------------------------------------

R_OPERATE = re.compile(r'href="/company/(?:about/)?how-we-operate/"')

# ---- 5. comments ----------------------------------------------------------

R_BUILD_NOTES = re.compile(r"<!--\s*=+\s*\n\s*ORVIX.*?BUILD NOTES.*?-->\n?", re.S)
R_PHOTO_HOWTO = re.compile(r"/\* =+ ADD YOUR PHOTOGRAPHS HERE =+.*?\*/\n?", re.S)


def pages(root: pathlib.Path) -> list[str]:
    out = []
    for p in sorted(root.rglob("*.html")):
        rel = p.relative_to(root).as_posix()
        if rel.startswith("tools/") or rel == "404.html":
            continue
        out.append(rel)
    return out


def up(rel: str) -> str:
    """Relative prefix from this page back to the site root."""
    return "../" * rel.count("/")


def script_tag(rel: str) -> str:
    return f'<script src="{up(rel)}assets/nav.js" defer></script>'


def ensure_script(s: str, rel: str) -> str:
    """Exactly one nav.js tag in <head>. A correct tag is left where it is, so
    this never reorders against other tools that also add to <head>."""
    tag = script_tag(rel)
    found = SCRIPT_RE.findall(s)
    head_end = s.lower().rfind("</head>")
    if len(found) == 1 and found[0].strip() == tag and s.find(tag) < head_end:
        return s
    s = SCRIPT_RE.sub("", s)
    i = s.lower().rfind("</head>")
    if i < 0:
        return s
    return s[:i] + tag + "\n" + s[i:]


def strip_old_js(s: str) -> str:
    for r in (R_NAVJS_BLOCK, R_IIFE, R_ES6, R_NYI_JS):
        s = r.sub("", s)
    return R_EMPTY_SCRIPT.sub("", s)


def fix_css(s: str) -> str:
    return s.replace(OLD_HOVER, NEW_HOVER).replace(OLD_CURSOR, NEW_CURSOR)


def drop_notice(s: str) -> str:
    return R_NYI_CSS.sub("", R_NYI_DIV.sub("", s))


def fix_operate(s: str, rel: str) -> str:
    home = up(rel) + ("ar/" if rel.startswith("ar/") else "") + "index.html#operate"
    return R_OPERATE.sub(f'href="{home}"', s)


def strip_comments(s: str, archive: bool) -> str:
    m = R_BUILD_NOTES.search(s)
    if m and archive and not NOTES.exists():
        body = m.group(0)
        body = re.sub(r"^<!--\s*", "", body)
        body = re.sub(r"\s*-->\s*$", "", body)
        NOTES.write_text(
            "ORVIX - BUILD NOTES\n"
            "===================\n"
            "This block was carried as a comment at the top of 64 pages. It is\n"
            "kept here once, out of the shipped HTML, by tools/nav.\n\n"
            + body + "\n", encoding="utf-8")
    s = R_BUILD_NOTES.sub("", s)
    return R_PHOTO_HOWTO.sub("", s)


# ---- 6. mega-menu css -------------------------------------------------------
# The engagement template was given the nav CSS by tools/unify but never the
# mega-menu rules, so on those 16 pages "What we do" and "Research" rendered
# as a 262px stacked list instead of the full-width panel - and on a laptop
# screen the last links ran off the bottom where they could not be reached.
# The rules are read from the homepage at run time, never copied by hand.

MEGA_DONOR = "index.html"
MEGA_FROM = "/* ===== mega menu ===== */"
MEGA_TO = "@media(max-width:1120px){.dd.mega{display:none}}"
R_GROUPLBL = re.compile(r"\.mcol \.head\.grouplbl(?::hover)?\{[^}]*\}")
MEGA_BEGIN = "/* mega:begin  mega-menu rules from index.html, tools/nav */"
MEGA_END = "/* mega:end */"
R_MEGA_BLOCK = re.compile(re.escape(MEGA_BEGIN) + r".*?" + re.escape(MEGA_END) + r"\n?", re.S)

# Every panel scrolls inside itself when the window is shorter than it is.
PANEL_BEGIN = "/* navpanel:begin  tools/nav */"
PANEL_END = "/* navpanel:end */"
PANEL_CSS = (".dd{max-height:calc(100vh - 66px);max-height:calc(100dvh - 66px);"
             "overflow-y:auto;overscroll-behavior:contain}")
R_PANEL_BLOCK = re.compile(re.escape(PANEL_BEGIN) + r".*?" + re.escape(PANEL_END) + r"\n?", re.S)

_mega_cache: dict[str, str] = {}


def mega_css(root: pathlib.Path) -> str:
    if "css" not in _mega_cache:
        s = (root / MEGA_DONOR).read_text(encoding="utf-8")
        a, b = s.find(MEGA_FROM), s.find(MEGA_TO)
        if a < 0 or b < 0:
            raise ValueError(f"{MEGA_DONOR}: mega-menu markers not found")
        rules = s[a + len(MEGA_FROM):b + len(MEGA_TO)].strip()
        rules += "\n" + "\n".join(dict.fromkeys(R_GROUPLBL.findall(s)))
        _mega_cache["css"] = rules
    return _mega_cache["css"]


def _before_head_style_end(s: str, blk: str) -> str:
    head_end = s.lower().find("</head>")
    i = s.lower().rfind("</style>", 0, head_end)
    if i < 0:
        return s
    return s[:i] + blk + "\n" + s[i:]


def ensure_mega_css(s: str, root: pathlib.Path) -> str:
    blk = f"{MEGA_BEGIN}\n{mega_css(root)}\n{MEGA_END}\n"
    if R_MEGA_BLOCK.search(s):
        return R_MEGA_BLOCK.sub(lambda _: blk, s, count=1)
    if ".dd.mega{" in s:
        return s  # the page carries the rules natively
    return _before_head_style_end(s, blk)


def ensure_panel_css(s: str) -> str:
    blk = f"{PANEL_BEGIN}\n{PANEL_CSS}\n{PANEL_END}\n"
    if R_PANEL_BLOCK.search(s):
        return R_PANEL_BLOCK.sub(lambda _: blk, s, count=1)
    return _before_head_style_end(s, blk)


def process(root: pathlib.Path, rel: str, check: bool) -> list[str]:
    p = root / rel
    s0 = p.read_text(encoding="utf-8")
    s = s0
    did = []

    steps = [
        ("css",       lambda x: fix_css(x)),
        ("mega",      lambda x: ensure_mega_css(x, root)),
        ("panel",     lambda x: ensure_panel_css(x)),
        ("script",    lambda x: ensure_script(strip_old_js(x), rel)),
        ("notice",    lambda x: drop_notice(x)),
        ("operate",   lambda x: fix_operate(x, rel)),
        ("comments",  lambda x: strip_comments(x, archive=not check)),
    ]
    for name, fn in steps:
        before = s
        s = fn(s)
        if s != before:
            did.append(name)

    if s != s0 and not check:
        p.write_text(s, encoding="utf-8", newline="")
    return did


def run(root: pathlib.Path, check: bool = False) -> dict:
    counts: dict[str, int] = {}
    touched = []
    for rel in pages(root):
        did = process(root, rel, check)
        if did:
            touched.append(rel)
        for k in did:
            counts[k] = counts.get(k, 0) + 1
    return {"pages": len(pages(root)), "touched": touched, "counts": counts}


def main(argv: list[str]) -> int:
    check = "--check" in argv
    r = run(ROOT, check=check)
    verb = "would change" if check else "changed"
    print(f"nav      : {r['pages']} pages, {len(r['touched'])} {verb}")
    for k, n in sorted(r["counts"].items()):
        print(f"           {k:<10} {n}")
    return 1 if (check and r["touched"]) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
