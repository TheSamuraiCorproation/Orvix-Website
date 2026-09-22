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

Every fix here is structural. No page copy is touched: the nav is a shared
component, the breadcrumb is chrome, and the hero art is decoration.

    python -m tools.unify           # apply
    python -m tools.unify --check   # report what would change
"""

from __future__ import annotations

import pathlib
import re
import sys

from .donor import CSS_BEGIN, CSS_END, Donor, match_element
from ..nav import apply as _nav

ROOT = pathlib.Path(__file__).resolve().parents[2]

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500'
    '&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">'
)

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
    return rel.split("/")[0] == "engagement" or rel.startswith("ar/engagement/")


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
        s = s[:i] + d.mob + s[match_element(s, i, "div"):]
    else:
        i = s.find("</nav>") + len("</nav>")
        s = s[:i] + "\n" + d.mob + s[i:]
    return s


def ensure_nav_css(s: str, d: Donor) -> str:
    blk = d.css_block()
    pat = re.compile(re.escape(CSS_BEGIN) + r".*?" + re.escape(CSS_END), re.S)
    if pat.search(s):
        return pat.sub(lambda _: blk, s, count=1)
    if ".nav-l>li>button.has{" in s:
        return s  # page already carries the template's own nav CSS
    head_end = s.lower().find("</head>")
    i = s.lower().rfind("</style>", 0, head_end)
    if i < 0:
        return s
    return s[:i] + "\n" + blk + "\n" + s[i:]


def ensure_nav_js(s: str, rel: str) -> str:
    """The toggle script is shared (assets/nav.js). Drop any transplanted
    inline copy and make sure the page loads the shared file once."""
    return _nav.ensure_script(_nav.strip_old_js(s), rel)


def ensure_fonts(s: str) -> str:
    if "family=IBM+Plex+Sans:wght" in s:
        return s
    m = re.search(r'<link[^>]+fonts\.googleapis\.com[^>]*>', s)
    if m:
        return s[:m.start()] + FONTS + s[m.end():]
    i = s.lower().find("</head>")
    return s[:i] + FONTS + "\n" + s[i:]


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
    # guard on the markup, not the string: the accent CSS block injected below
    # also contains "label--accent" and would make this look already done
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


ACCENT_CSS_BEGIN = "/* accent:begin  tools/unify */"
ACCENT_CSS_END = "/* accent:end */"
ACCENT_CSS = """.hero .label--accent,.hero__copy .label--accent{color:var(--cyan,#48E2E2)}"""


def ensure_accent_css(s: str) -> str:
    blk = f"{ACCENT_CSS_BEGIN}\n{ACCENT_CSS}\n{ACCENT_CSS_END}"
    pat = re.compile(re.escape(ACCENT_CSS_BEGIN) + r".*?" + re.escape(ACCENT_CSS_END), re.S)
    if pat.search(s):
        return pat.sub(lambda _: blk, s, count=1)
    head_end = s.lower().find("</head>")
    i = s.lower().rfind("</style>", 0, head_end)
    if i < 0:
        return s
    return s[:i] + "\n" + blk + "\n" + s[i:]


# ---- hero photograph + geometry ------------------------------------------
# The engagement and industry templates both already have a --ph-hero slot;
# engagement's still pointed at the placeholder path from the design comp and
# industries' was never set. Filling the slot is the mechanism the export was
# built for (see README.txt, "PHOTOGRAPHY"), so these just supply a value.
#
# Only pages with a genuinely matching photograph are filled. Four industry
# pages have no asset in images/ and are left on the slot's "none", because
# putting a telecom photograph behind a healthcare page would misrepresent it.
# They are reported by --check so the gap is visible.
# Kept for reference only -- no longer applied, see HERO_CSS above.
HERO_PHOTO_UNUSED = {
    "engagement/AI_Estate_Inventory": "svc-data-organization.jpg",
    "engagement/API_Discovery_and_Governance": "svc-governance.jpg",
    "engagement/Assurance_Review": "svc-audit-readiness.jpg",
    "engagement/Data_Residency_Review": "svc-storage-and-resilience.jpg",
    "engagement/Human_Risk_and_Impersonation_Defense": "svc-human-risk.jpg",
    "engagement/Infrastructure_Design_Review": "svc-infrastructure-design.jpg",
    "engagement/Managed_Detection_and_Response": "svc-managed-detection-response.jpg",
    "engagement/Model_Evaluation_and_Red_Team": "svc-independent-evaluation.jpg",
    "industries/telecommunications": "hero-rsh-telecom.jpg",
    "industries/financial-services": "hero-rsh-financial.jpg",
    "industries/government-public-sector": "hero-rsh-government.jpg",
    "industries/energy-utilities": "hero-rsh-energy.jpg",
    # no asset yet: healthcare-life-sciences, industrial-manufacturing,
    # retail-hospitality-real-estate, transport-logistics
}

HERO_CSS_BEGIN = "/* hero:begin  geometry matched to the what-we-do template, tools/unify */"
HERO_CSS_END = "/* hero:end */"
# Geometry only. The engagement and industry heroes keep the plain ink
# background they have always had -- an earlier pass put a photograph behind
# them and that was not wanted, so --ph-hero is left unset and the template's
# own scrim element is left alone.
HERO_CSS = """.hero,.ehero{min-height:0;
padding:clamp(64px,8vw,116px) 0 clamp(44px,5vw,72px)}
@media(max-width:900px){.hero,.ehero{
padding:calc(67px + clamp(26px,6vw,44px)) 0 clamp(32px,5vw,52px)}}"""


def photo_key(rel: str) -> str:
    parts = (rel[3:] if rel.startswith("ar/") else rel).split("/")
    return "/".join(parts[:2]) if len(parts) >= 2 else ""


def hero_photo_decl(rel: str) -> str:
    """The --ph-hero declaration for a page, or "" when it has no photograph.

    Declared on .hero rather than in :root. The engagement template mentions
    --ph-hero inside a how-to comment, so rewriting the first match in the file
    edited that comment instead of the cascade; setting it on the element that
    reads it is unambiguous and keeps the change inside one managed block.
    """
    img = HERO_PHOTO_UNUSED.get(photo_key(rel))
    if not img:
        return ""
    up = "../../../" if rel.startswith("ar/") else "../../"
    return f"--ph-hero:url('{up}images/{img}');"


def ensure_hero_css(s: str, rel: str) -> str:
    css = HERO_CSS
    blk = f"{HERO_CSS_BEGIN}\n{css}\n{HERO_CSS_END}"
    pat = re.compile(re.escape(HERO_CSS_BEGIN) + r".*?" + re.escape(HERO_CSS_END), re.S)
    if pat.search(s):
        return pat.sub(lambda _: blk, s, count=1)
    head_end = s.lower().find("</head>")
    i = s.lower().rfind("</style>", 0, head_end)
    if i < 0:
        return s
    return s[:i] + "\n" + blk + "\n" + s[i:]


# ---- nav typography, pinned -----------------------------------------------
# The nav rule uses `font:inherit`, so the bar took its weight from whatever
# body the host page declared. Every template sets body to 300 except the
# engagement one, which sets 400 -- which is why the nav read heavier there.
# Pinning it makes the bar identical whatever page it is dropped into.
NAVFONT_BEGIN = "/* navfont:begin  tools/unify */"
NAVFONT_END = "/* navfont:end */"
NAVFONT_CSS = """#nav,#nav .nav-in,.nav-l>li>a,.nav-l>li>button.has,.nav-ar,.dd a,
.mob a,.mob h5{font-family:'IBM Plex Sans',system-ui,sans-serif}
.nav-l>li>a,.nav-l>li>button.has,.nav-ar,.dd a{font-weight:300}
.nav-cta{font-weight:500}
/* the engagement stylesheet never reset list padding, so the bar sat 40px
   further right than on every other template */
.nav-l,.mob ul{margin:0;padding:0;list-style:none}
.nav-l>li{list-style:none}"""


def ensure_navfont_css(s: str) -> str:
    blk = f"{NAVFONT_BEGIN}\n{NAVFONT_CSS}\n{NAVFONT_END}"
    pat = re.compile(re.escape(NAVFONT_BEGIN) + r".*?" + re.escape(NAVFONT_END), re.S)
    if pat.search(s):
        return pat.sub(lambda _: blk, s, count=1)
    head_end = s.lower().find("</head>")
    i = s.lower().rfind("</style>", 0, head_end)
    if i < 0:
        return s
    return s[:i] + "\n" + blk + "\n" + s[i:]


# ---- Leadership is reachable, but not advertised in the nav ---------------
# The page stays, keeps its URL and stays in the sitemap; the only way in is
# the "Read bio" card on the About page, which is what was asked for.
LEADERSHIP_HREF = "company/about/leadership/index.html"


def hide_leadership_nav(s: str) -> str:
    """Drop the Leadership link from the header nav, the drawer and the footer.

    The page itself is untouched: same URL, still in the sitemap, still linked
    from every "Read bio" card on the About page. Those cards point at a
    relative "leadership/index.html#name" and are deliberately not matched.
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

def process(root: pathlib.Path, rel: str, donors: dict[str, Donor]) -> list[str]:
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
        s = ensure_nav_css(s, d)
        if s != before:
            did.append("nav-css")
        before = s
        s = ensure_nav_js(s, rel)
        if s != before:
            did.append("nav-js")
        before = s
        s = ensure_fonts(s)
        if s != before:
            did.append("fonts")
        before = s
        s = ensure_navfont_css(s)
        if s != before:
            did.append("navfont")
        before = s
        s = drop_breadcrumb(s)
        if s != before:
            did.append("breadcrumb")

    if eng:
        before = s
        s = blue_eyebrow(s)
        s = ensure_accent_css(s)
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

    if eng or ind:
        before = s
        s = ensure_hero_css(s, rel)
        if s != before:
            did.append("hero-css")

    if s != s0:
        p.write_text(s, encoding="utf-8", newline="")
    return did


def run(root: pathlib.Path) -> dict:
    donors = {"en": Donor(root, "en"), "ar": Donor(root, "ar")}
    counts: dict[str, int] = {}
    touched = 0
    for rel in targets(root):
        did = process(root, rel, donors)
        if did:
            touched += 1
        for k in did:
            counts[k] = counts.get(k, 0) + 1
    return {"touched": touched, "counts": counts}


def main(argv: list[str]) -> int:
    r = run(ROOT)
    print(f"unify    : {r['touched']} pages changed")
    for k, n in sorted(r["counts"].items()):
        print(f"           {k:<12} {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
