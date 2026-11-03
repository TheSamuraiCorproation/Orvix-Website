"""Shared page parts: one nav, one phone drawer and one footer per language.

The markup lives once, in tools/partials/html/:

    nav.en.html     nav.ar.html       <nav id="nav"> ... </nav>
    drawer.en.html  drawer.ar.html    <div class="mob" id="mob"> ... </div>
    footer.en.html  footer.ar.html    <footer class="site-foot"> ... </footer>

and is stamped into every page at build time. Edit the partial, run this, and
all ~107 pages change together. Pages stay plain static HTML: no client-side
includes, nothing fetched at run time, the crawlers see the full markup.

Four slots are filled per page, because links are relative (README.md, "URLs
and links") and an Arabic page links inside ar/ for pages but out to the site
root for images:

    {{root}}   prefix to this language's home folder   ../../  (or empty)
    {{site}}   prefix to the site root (images)        ../../../ on ar/x/y/
    {{home}}   link to this language's home page       ../../  (or ./)
    {{twin}}   the same page in the other language, or its nearest parent
               that exists (an English article with no Arabic version links
               to the Arabic listing)

The footer has its own stylesheet, assets/css/footer.css, so it looks the same
on the main, industry and engagement templates; this adds the link to any page
that lacks it.

    python -m tools.partials            # stamp every page
    python -m tools.partials --check    # fail if any page differs from the partials
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
HTML = pathlib.Path(__file__).resolve().parent / "html"

# (partial, where it starts on a page, the element that closes it)
PARTS = [
    ("nav", r'<nav id="nav">', "nav"),
    ("drawer", r'<div class="mob" id="mob">', "div"),
    ("footer", r'<footer\b[^>]*>', "footer"),
]

FOOTER_CSS = "assets/css/footer.css"


def match_element(s: str, start: int, tag: str) -> int:
    """End index (exclusive) of the element opening at `start`, nesting-aware."""
    open_re = re.compile(rf"<{tag}\b", re.I)
    close_re = re.compile(rf"</{tag}\s*>", re.I)
    depth = 0
    i = start
    while i < len(s):
        o = open_re.search(s, i)
        c = close_re.search(s, i)
        if c is None:
            raise ValueError(f"unclosed <{tag}>")
        if o is not None and o.start() < c.start():
            depth += 1
            i = o.end()
        else:
            depth -= 1
            i = c.end()
            if depth == 0:
                return i
    raise ValueError(f"unbalanced <{tag}>")


def targets(root: pathlib.Path) -> list[str]:
    """Every page that carries the site nav (not 404, admin or the email templates)."""
    out = []
    for p in sorted(root.rglob("index.html")):
        rel = p.relative_to(root).as_posix()
        if rel.startswith(("tools/", "admin/", "email/", "node_modules/", ".git/")):
            continue
        if '<nav id="nav">' in p.read_text(encoding="utf-8"):
            out.append(rel)
    return out


def slots(root: pathlib.Path, rel: str) -> dict[str, str]:
    lang = "ar" if rel.startswith("ar/") else "en"
    folder = rel[: -len("index.html")]                    # "ar/company/about/"
    inner = folder[3:] if lang == "ar" else folder          # "company/about/"
    up = "../" * inner.count("/")
    site = "../" * folder.count("/")

    # the other language's page, falling back to the nearest parent that exists
    parts = [x for x in inner.split("/") if x]
    other = "" if lang == "ar" else "ar/"
    while parts and not (root / other / "/".join(parts) / "index.html").is_file():
        parts.pop()
    twin = site + other + "".join(x + "/" for x in parts)

    return {"root": up, "site": site, "home": up or "./", "twin": twin or "./"}


def render(name: str, lang: str, values: dict[str, str]) -> str:
    t = (HTML / f"{name}.{lang}.html").read_text(encoding="utf-8").rstrip("\n")
    return re.sub(r"\{\{(\w+)\}\}", lambda m: values[m.group(1)], t)


def ensure_footer_css(s: str, site: str) -> str:
    if FOOTER_CSS in s:
        return s
    link = f'<link rel="stylesheet" href="{site}{FOOTER_CSS}">'
    # ahead of mobile.css, so the phone rules still come last
    m = re.search(r'<link rel="stylesheet" href="[./]*assets/css/mobile\.css">', s)
    if m:
        return s[:m.start()] + link + "\n" + s[m.start():]
    i = s.lower().find("</head>")
    return s[:i] + link + "\n" + s[i:]


def stamp(root: pathlib.Path, rel: str) -> tuple[str, str, list[str]]:
    p = root / rel
    s0 = p.read_text(encoding="utf-8")
    s = s0
    lang = "ar" if rel.startswith("ar/") else "en"
    values = slots(root, rel)
    did = []
    for name, start, tag in PARTS:
        m = re.search(start, s)
        if not m:
            raise ValueError(f"{rel}: no {name} to replace")
        new = render(name, lang, values)
        end = match_element(s, m.start(), tag)
        if s[m.start():end] != new:
            s = s[:m.start()] + new + s[end:]
            did.append(name)
    before = s
    s = ensure_footer_css(s, values["site"])
    if s != before:
        did.append("footer-css")
    return s0, s, did


def run(root: pathlib.Path, check: bool = False) -> dict:
    counts: dict[str, int] = {}
    changed = []
    for rel in targets(root):
        s0, s, did = stamp(root, rel)
        if s != s0:
            changed.append(rel)
            if not check:
                (root / rel).write_text(s, encoding="utf-8", newline="")
        for k in did:
            counts[k] = counts.get(k, 0) + 1
    return {"pages": len(targets(root)), "changed": changed, "counts": counts}


def main(argv: list[str]) -> int:
    check = "--check" in argv
    r = run(ROOT, check=check)
    verb = "differ from the partials" if check else "stamped"
    print(f"partials : {len(r['changed'])} of {r['pages']} pages {verb}")
    for k, n in sorted(r["counts"].items()):
        print(f"           {k:<12} {n}")
    if check and r["changed"]:
        for rel in r["changed"][:10]:
            print(f"           - {rel}")
        print("           run: python -m tools.partials")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
