"""Check every internal link, asset reference and #anchor on every page.

    python -m tools.linkcheck           # report; exit 1 if anything is broken

Resolves each href/src the way a browser on the live site would: relative to
the page's production URL (a directory URL for every page), with /x/ served
from x/index.html and _redirects rewrites honoured. External links are listed,
not fetched.
"""

from __future__ import annotations

import html
import pathlib
import posixpath
import re
import sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]

ATTR = re.compile(r"""\b(href|src)\s*=\s*(["'])(.*?)\2""", re.I | re.S)
SRCSET = re.compile(r"""\bsrcset\s*=\s*(["'])(.*?)\1""", re.I | re.S)
CSS_URL = re.compile(r"""url\(\s*(['"]?)([^'")]+)\1\s*\)""")
ID = re.compile(r"""\b(?:id|name)\s*=\s*(["'])(.*?)\1""", re.I)
SKIP = ("mailto:", "tel:", "javascript:", "data:", "#")


def pages() -> list[str]:
    out = []
    for p in sorted(ROOT.rglob("*.html")):
        rel = p.relative_to(ROOT).as_posix()
        if rel.startswith(("tools/", ".github/", "node_modules/", "admin/", "email/")):
            continue
        out.append(rel)
    return out


def rewrites() -> dict[str, str]:
    """200 rewrites and 301/302 redirects from _redirects, as path -> target."""
    out = {}
    f = ROOT / "_redirects"
    if not f.exists():
        return out
    for line in f.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) >= 3 and not line.lstrip().startswith("#") and "*" not in parts[0]:
            if parts[2].rstrip("!") in ("200", "301", "302"):
                out[parts[0]] = parts[1]
    return out


def serve(path: str, rw: dict[str, str]) -> str | None:
    """Site path (starting with /) -> file on disk, or None."""
    for _ in range(3):
        if path in rw:
            path = rw[path]
            continue
        break
    p = path.lstrip("/")
    cand = [p] if p and not p.endswith("/") else []
    cand.append(posixpath.join(p, "index.html") if p else "index.html")
    for c in cand:
        f = ROOT / c
        if f.is_file():
            return c
    return None


def page_url(rel: str) -> str:
    """The directory URL a page is served at (a page at x/y.html is x/y.html)."""
    return "/" + rel[:-len("index.html")] if rel.endswith("index.html") else "/" + rel


def main(argv: list[str]) -> int:
    rw = rewrites()
    ids: dict[str, set[str]] = {}
    broken = defaultdict(list)
    anchors = defaultdict(list)
    external = defaultdict(set)
    n = 0
    for rel in pages():
        s = (ROOT / rel).read_text(encoding="utf-8")
        refs = [m.group(3) for m in ATTR.finditer(s)]
        refs += [u.split()[0] for m in SRCSET.finditer(s) for u in m.group(2).split(",") if u.strip()]
        refs += [m.group(2) for m in CSS_URL.finditer(s)]
        base = page_url(rel)
        for raw in refs:
            u = html.unescape(raw.strip())
            if not u or u.startswith(SKIP) or "${" in u or "' +" in u:
                continue
            if re.match(r"^(https?:)?//", u):
                external[u.split("#")[0]].add(rel)
                continue
            n += 1
            path, _, frag = u.partition("#")
            path = path.split("?")[0]
            target = path if path.startswith("/") else posixpath.normpath(
                posixpath.join(posixpath.dirname(base) if not base.endswith("/") else base, path))
            if path.endswith("/") and not target.endswith("/"):
                target += "/"
            if not target.startswith("/"):
                target = "/" + target
            f = serve(target, rw)
            if f is None:
                broken[rel].append(u)
                continue
            if frag and f.endswith(".html"):
                if f not in ids:
                    t = (ROOT / f).read_text(encoding="utf-8")
                    ids[f] = {m.group(2) for m in ID.finditer(t)}
                if frag not in ids[f]:
                    anchors[rel].append(u)

    # the hero preload must name the photo the page actually shows, or the
    # browser downloads one picture early and then another one late
    for rel in pages():
        s = (ROOT / rel).read_text(encoding="utf-8")
        head = s[:s.lower().find("</head>")]
        pre = re.findall(r'<link rel="preload" as="image" href="([^"]+)"', head)
        hero = re.findall(r"--p[hg]-hero:url\('([^']+)'\)", head)
        if pre and hero and pre[0] not in hero:  # only pages with a hero photo; articles preload their cover
            broken[rel].append(f"preload {pre[0]} is not the hero photo {hero or 'none'}")

    nb = sum(len(v) for v in broken.values())
    na = sum(len(v) for v in anchors.values())
    print(f"linkcheck: {len(pages())} pages, {n} internal references, "
          f"{nb} broken, {na} missing anchors, {len(external)} external URLs")
    for rel, us in sorted(broken.items()):
        print(f"  BROKEN  {rel}")
        for u in sorted(set(us)):
            print(f"            {u}")
    for rel, us in sorted(anchors.items()):
        print(f"  ANCHOR  {rel}: {', '.join(sorted(set(us)))}")
    if "--external" in argv:
        for u, where in sorted(external.items()):
            print(f"  EXTERNAL {u}  ({len(where)} pages)")
    return 1 if (nb or na) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
