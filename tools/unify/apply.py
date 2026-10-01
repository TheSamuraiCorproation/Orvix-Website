"""Bring the engagement and industry pages onto the what-we-do template.

The export grew three different page templates. The what-we-do pages and the
homepage share one; the engagement pages were built from a second one and the
industry pages from a third. That is why, before this ran:

  * engagement pages had no working menu on a phone -- their header carried
    hover-only dropdowns and a "Menu" button wired to nothing, with no burger
    and no drawer at all
  * engagement pages drew the wordmark as text in whatever font resolved,
    because they loaded only IBM Plex Sans Arabic and never Plex Sans or Mono
  * industry pages were missing Research from the nav entirely
  * industry pages relabelled half the nav ("Sovereign cloud & landing zones"
    for the page titled "Network as a Service")
  * both carried a breadcrumb the what-we-do pages do not have

The CSS that went with these fixes (nav, accent eyebrow, hero geometry, nav
typography) was injected inline by earlier runs; it now lives in
assets/css/engagement-nav.css and assets/css/industry-nav.css, so this only
manages markup.

Every fix here is structural. No page copy is touched: the nav is a shared
component, the breadcrumb is chrome, and the hero art is decoration.

    python -m tools.unify           # apply
    python -m tools.unify --check   # report what would change
"""

from __future__ import annotations

import pathlib
import re
import sys

from .donor import Donor, match_element
from ..nav import apply as _nav

ROOT = pathlib.Path(__file__).resolve().parents[2]

# The fonts are self-hosted (tools/fonts): the page needs assets/css/fonts.css.
# The engagement template never loaded IBM Plex Sans at all, which is why its
# wordmark drew in whatever font resolved.
def fonts_link(rel: str) -> str:
    return f'<link rel="stylesheet" href="{"../" * rel.count("/")}assets/css/fonts.css">'

# Hero decoration. Stripped only where the hero carries a photograph, so the
# picture is not read through a layer of line art.
#
# The engagement and industry heroes are NOT in this list. They have no
# photograph -- their hero is the animated wireframe, and removing it left them
# blank. That art is theirs and stays.
HERO_ART = [
    (r'<svg class="netline"', "svg"),      # what-we-do  (photo hero)
    (r'<div class="hero-art"', "div"),     # homepage    (photo hero)
]

# The company pages layer a diagonal texture into every band. Only the one in
# the hero is removed; the rest of the page keeps its texture.
COMPANY_PLANE = r'<div class="plane"><div class="lay cut-tone"></div><div class="lay cut-tex"></div></div>'


def targets(root: pathlib.Path) -> list[str]:
    out = []
    for p in sorted(root.rglob("*.html")):
        rel = p.relative_to(root).as_posix()
        if rel.startswith("tools/"):
            continue
        out.append(rel)
    return out


def is_engagement(rel: str) -> bool:
    return rel.split("/")[0] == "engagements" or rel.startswith("ar/engagements/")


def is_industry(rel: str) -> bool:
    return rel.split("/")[0] == "industries" or rel.startswith("ar/industries/")


def lang_of(rel: str) -> str:
    return "ar" if rel.startswith("ar/") else "en"


# ---- nav ------------------------------------------------------------------

def swap_nav(s: str, rel: str, d: Donor) -> str:
    """Put the canonical nav and drawer in, whatever was there before."""
    nav = d.nav_for(rel)

    if '<nav id="nav">' in s:
        i = s.find('<nav id="nav">')
        s = s[:i] + nav + s[match_element(s, i, "nav"):]
    else:
        # the engagement template: <header class="nav"> ... </header>
        m = re.search(r'<header class="nav">', s)
        if not m:
            return s
        s = s[:m.start()] + nav + s[match_element(s, m.start(), "header"):]

    if '<div class="mob" id="mob">' in s:
        i = s.find('<div class="mob" id="mob">')
        s = s[:i] + d.mob_for(rel) + s[match_element(s, i, "div"):]
    else:
        i = s.find("</nav>") + len("</nav>")
        s = s[:i] + "\n" + d.mob_for(rel) + s[i:]
    return s


def ensure_nav_js(s: str, rel: str) -> str:
    """The toggle script is shared (assets/nav.js). Drop any transplanted
    inline copy and make sure the page loads the shared file once."""
    return _nav.ensure_script(_nav.strip_old_js(s), rel)


def ensure_fonts(s: str, rel: str) -> str:
    if "assets/css/fonts.css" in s:
        return s
    i = s.lower().find("</head>")
    return s[:i] + fonts_link(rel) + "\n" + s[i:]


# ---- chrome ---------------------------------------------------------------

def drop_breadcrumb(s: str) -> str:
    """Remove the breadcrumb trail. what-we-do does not have one."""
    for pat in (r'<(nav|div|p|ol)[^>]*class="crumb[^"]*"[^>]*>',
                r'<(nav|div|p|ol)[^>]*aria-label="Breadcrumb"[^>]*>'):
        while True:
            m = re.search(pat, s)
            if not m:
                break
            s = s[:m.start()] + s[match_element(s, m.start(), m.group(1)):]
    return s


def drop_hero_art(s: str, rel: str) -> str:
    """Strip the line-art layer so the hero is photograph plus scrim only."""
    for pat, tag in HERO_ART:
        while True:
            m = re.search(pat, s)
            if not m:
                break
            s = s[:m.start()] + s[match_element(s, m.start(), tag):]
    # company pages: only the hero's texture plane, not every band's
    if "/company/" in "/" + rel:
        i = s.find(COMPANY_PLANE)
        if i >= 0:
            s = s[:i] + s[i + len(COMPANY_PLANE):]
    return s


def blue_eyebrow(s: str) -> str:
    """The engagement kicker ("Engagement 08 - AI Assurance & Governance") was
    grey on a dark hero. what-we-do sets its equivalent in the brand accent.

    Scoped to the one inside .hero__copy: the same class is used further down
    the page for section kickers, which stay as they are.
    """
    # guard on the markup: the rule that colours it lives in
    # assets/css/engagement-nav.css
    if 'class="label label--accent"' in s:
        return s
    m = re.search(r'<div[^>]*class="hero__copy"[^>]*>', s)
    if not m:
        return s
    # the Arabic twin writes <p dir="auto" class="label">, so match on the
    # attribute rather than the exact tag text
    lab = re.compile(r'<p([^>]*)\sclass="label"([^>]*)>')
    mm = lab.search(s, m.end())
    if not mm:
        return s
    repl = f'<p{mm.group(1)} class="label label--accent"{mm.group(2)}>'
    return s[:mm.start()] + repl + s[mm.end():]


# ---- Leadership is reachable, but not advertised in the nav ---------------
# The page stays, keeps its URL and stays in the sitemap; the only way in is
# the "Read bio" card on the About page, which is what was asked for.
LEADERSHIP_HREF = "company/about/leadership/"


def hide_leadership_nav(s: str) -> str:
    """Drop the Leadership link from the header nav, the drawer and the footer.

    The page itself is untouched: same URL, still in the sitemap, still linked
    from every "Read bio" card on the About page. Those cards point at a
    relative "leadership/#name" and are deliberately not matched.
    """
    href = re.escape(LEADERSHIP_HREF)
    # the footer wraps its links in <li>; the nav dropdown and the drawer do
    # not. Take the <li> where there is one so no empty bullet is left behind.
    for pat in (
        r'<li[^>]*>\s*<a[^>]*href="[^"]*' + href + r'"[^>]*>.*?</a>\s*</li>',
        r'<a[^>]*href="[^"]*' + href + r'"[^>]*>.*?</a>',
    ):
        s = re.sub(pat, "", s, flags=re.S)
    return s

# ---- driver ---------------------------------------------------------------

def process(root: pathlib.Path, rel: str, donors: dict[str, Donor], check: bool) -> list[str]:
    p = root / rel
    s0 = p.read_text(encoding="utf-8")
    s = s0
    did = []
    eng, ind = is_engagement(rel), is_industry(rel)
    d = donors[lang_of(rel)]

    if eng or ind:
        before = s
        s = swap_nav(s, rel, d)
        if s != before:
            did.append("nav")
        before = s
        s = ensure_nav_js(s, rel)
        if s != before:
            did.append("nav-js")
        before = s
        s = ensure_fonts(s, rel)
        if s != before:
            did.append("fonts")
        before = s
        s = drop_breadcrumb(s)
        if s != before:
            did.append("breadcrumb")

    if eng:
        before = s
        s = blue_eyebrow(s)
        if s != before:
            did.append("accent")

    before = s
    s = hide_leadership_nav(s)
    if s != before:
        did.append("hide-leadership")

    before = s
    s = drop_hero_art(s, rel)
    if s != before:
        did.append("hero-art")

    if s != s0 and not check:
        p.write_text(s, encoding="utf-8", newline="")
    return did


def run(root: pathlib.Path, check: bool = False) -> dict:
    donors = {"en": Donor(root, "en"), "ar": Donor(root, "ar")}
    counts: dict[str, int] = {}
    touched = 0
    for rel in targets(root):
        did = process(root, rel, donors, check)
        if did:
            touched += 1
        for k in did:
            counts[k] = counts.get(k, 0) + 1
    return {"touched": touched, "counts": counts}


def main(argv: list[str]) -> int:
    check = "--check" in argv
    r = run(ROOT, check=check)
    print(f"unify    : {r['touched']} pages {'would change' if check else 'changed'}")
    for k, n in sorted(r["counts"].items()):
        print(f"           {k:<12} {n}")
    return 1 if (check and r["touched"]) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
