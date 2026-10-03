"""Rewrite the managed parts of every page (SEO brief sections 1.2, 2, 3).

Everything here is idempotent: running it twice produces the same bytes. What
it touches, and nothing else:

  * the block between the seo:begin / seo:end markers in <head>
  * any legacy SEO tag left loose in <head> (removed, so there is one source)
  * areaServed in the hand-written graphs (section 3 caps it at six states)
  * the hero <h2> on the six company pages, promoted to <h1> (section 6 fails
    a page whose H1 count is not exactly 1, and those six had none)

Stylesheets, the BUILD NOTES comments, the existing Service /
FAQPage / BreadcrumbList graphs and all body copy are left alone.
"""

from __future__ import annotations

import html
import pathlib
import re

from . import head, schema, urls
from .pages import PAGES, for_path

# Loose tags in <head> that the managed block now owns. Removed wherever they
# sit outside the markers so a page cannot end up with two of anything.
LEGACY = [
    r"<title>.*?</title>",
    r'<meta\s+name="description"[^>]*>',
    r'<meta\s+name="robots"[^>]*>',
    r'<meta\s+name="theme-color"[^>]*>',
    r'<meta\s+name="referrer"[^>]*>',
    r'<link\s+rel="(?:icon|apple-touch-icon|manifest)"[^>]*>',
    r'<link\s+rel="canonical"[^>]*>',
    r'<link\s+rel="alternate"\s+hreflang[^>]*>',
    r'<meta\s+property="og:[^>]*>',
    r'<meta\s+name="twitter:[^>]*>',
]

# Company pages whose hero heading is an <h2> and which therefore ship no H1.
NEEDS_H1 = [k for k in PAGES if k.startswith("company/")]

# The rules that make the promoted h1 render like the h2 it replaced live in
# assets/css/company.css (".cmp .band h1").


def _split_head(s: str) -> tuple[int, int]:
    a = s.lower().find("<head")
    a = s.find(">", a) + 1
    b = s.lower().find("</head>")
    return a, b


def strip_legacy(s: str) -> str:
    """Drop loose SEO tags from <head>, leaving the managed block alone."""
    a, b = _split_head(s)
    inner = s[a:b]

    keep = []
    pos = 0
    for m in re.finditer(
        re.escape(head.SEO_BEGIN) + r".*?" + re.escape(head.SEO_END), inner, re.S
    ):
        keep.append((m.start(), m.end()))

    def protected(i: int) -> bool:
        return any(lo <= i < hi for lo, hi in keep)

    for pat in LEGACY:
        out, last = [], 0
        for m in re.finditer(pat, inner, re.S | re.I):
            if protected(m.start()):
                continue
            out.append(inner[last:m.start()])
            last = m.end()
        out.append(inner[last:])
        inner = "".join(out)
        keep = [
            (m.start(), m.end())
            for m in re.finditer(
                re.escape(head.SEO_BEGIN) + r".*?" + re.escape(head.SEO_END),
                inner, re.S,
            )
        ]

    inner = re.sub(r"\n{3,}", "\n\n", inner)
    return s[:a] + inner + s[b:]


def set_block(s: str, block: str) -> str:
    """Insert or replace the managed head block, just after <meta viewport>."""
    pat = re.escape(head.SEO_BEGIN) + r".*?" + re.escape(head.SEO_END)
    if re.search(pat, s, re.S):
        return re.sub(pat, lambda _: block, s, count=1, flags=re.S)

    m = re.search(r'<meta[^>]+name="viewport"[^>]*>', s, re.I)
    if not m:
        m = re.search(r"<meta[^>]+charset[^>]*>", s, re.I)
    i = m.end()
    return s[:i] + "\n" + block + s[i:]


# ---- section 3: areaServed capped at the six GCC states -------------------

def _balanced(s: str, i: int) -> int:
    """End index (exclusive) of the JSON array starting at s[i] == '['."""
    depth, in_str, esc = 0, False, False
    for j in range(i, len(s)):
        c = s[j]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c in "[{":
            depth += 1
        elif c in "]}":
            depth -= 1
            if depth == 0:
                return j + 1
    raise ValueError("unbalanced array")


def cap_area_served(s: str) -> tuple[str, int]:
    """Rewrite every areaServed array to the six GCC states. Surgical, so the
    surrounding hand-written JSON keeps its formatting and diffs stay small."""
    changed = 0
    while True:
        m = re.search(r'("areaServed"\s*:\s*)\[', s)
        start = None
        for m in re.finditer(r'("areaServed"\s*:\s*)\[', s):
            lo = m.end() - 1
            hi = _balanced(s, lo)
            body = s[lo:hi]
            ind = " " * (m.start() - s.rfind("\n", 0, m.start()) - 1)
            want = (
                "[\n"
                + ",\n".join(
                    f'{ind}  {{\n{ind}    "@type": "Country",\n'
                    f'{ind}    "name": "{c}"\n{ind}  }}'
                    for c in schema.GCC_STATES
                )
                + f"\n{ind}]"
            )
            if body != want:
                s = s[:lo] + want + s[hi:]
                changed += 1
                start = True
                break
        if not start:
            return s, changed


# ---- section 6: exactly one H1 -------------------------------------------

def promote_h1(s: str) -> str:
    """Promote the first body <h2> to <h1>, preserving its attributes."""
    if re.search(r"<h1\b", s):
        return s
    i = s.lower().find("<body")
    m = re.search(r"<h2(\b[^>]*)>(.*?)</h2>", s[i:], re.S)
    if not m:
        return s
    a, b = i + m.start(), i + m.end()
    return s[:a] + f"<h1{m.group(1)}>{m.group(2)}</h1>" + s[b:]


# ---- driver ---------------------------------------------------------------

def page_meta(rel: str, s: str, page: dict) -> tuple[str, str]:
    """Title and description for a page.

    Arabic keeps whatever is already in the file: section 7 says Arabic meta is
    not to be machine-translated, and the Arabic keyword forms are still being
    validated. Only the structural fields are managed on those pages.
    """
    if not page.get("inherited"):
        return page["title"], page["description"]
    t = re.search(r"<title>(.*?)</title>", s, re.S)
    d = re.search(r'<meta\s+name="description"\s+content="(.*?)"', s, re.S)
    # unescape on the way in: what is read back is already HTML-escaped, and
    # head.render escapes again. Without this an "&" grows an &amp; per run.
    return (html.unescape(t.group(1).strip()) if t else page["title"],
            html.unescape(d.group(1).strip()) if d else page["description"])


def process(root: pathlib.Path, rel: str) -> dict:
    p = root / rel
    s0 = p.read_text(encoding="utf-8")
    page = for_path(rel)
    if page is None:
        return {"path": rel, "skipped": "not in page table"}

    s = s0
    title, description = page_meta(rel, s, page)

    if rel in NEEDS_H1 or (rel.startswith("ar/") and rel[3:] in NEEDS_H1):
        s = promote_h1(s)

    s = strip_legacy(s)

    extra = leadership_nodes(rel) if rel.endswith("company/about/leadership/index.html") else None
    nodes = schema.graph_for(rel, page, title, description, extra=extra)
    block = head.render(
        rel, page, title=title, description=description,
        twin_exists=(root / urls.twin(rel)).exists(),
    )
    ld = schema.render(nodes)
    if ld:
        block = block.replace(head.SEO_END, ld + "\n" + head.SEO_END)

    s = set_block(s, block)
    s, area = cap_area_served(s)

    if s != s0:
        p.write_text(s, encoding="utf-8", newline="")
    return {"path": rel, "changed": s != s0, "area_served_capped": area}


# Person nodes for the leadership page (section 3). All four are named now.
#
# Job titles stay in English on both language editions. They are the titles the
# page itself prints, and section 7 forbids machine-translating copy; the
# Arabic titles come from the dictionary when Arabic is picked up.
LEADERSHIP = [
    ("Ziad Darras", "Vice President", "ziad-darras"),
    ("Daryl Simpson", "Chief Technology Officer", "daryl-simpson"),
    # Chief Marketing Officer: name not confirmed by Orvix yet; page shows "A. M.", no Person node.
    ("Marwan Jaffal", "Chief Financial Officer", "marwan-jaffal"),
]


def leadership_nodes(rel: str) -> list[dict]:
    """Nodes anchored to the page they are emitted on, not to the English one."""
    page_url = urls.to_url(rel)
    return [schema.person(n, t, page_url, a) for n, t, a in LEADERSHIP]


def run(root: pathlib.Path) -> list[dict]:
    return [process(root, rel) for rel in urls.discover(root)]
