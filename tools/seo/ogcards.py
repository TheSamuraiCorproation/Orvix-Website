"""1200x630 og:image cards, one per page (SEO brief section 2).

head.py emits an og:image URL per page under /assets/img/og/. This builds the
sheet those cards are rendered from: one HTML file holding every card at exact
size, which render_og.mjs then screenshots with the real IBM Plex webfont.

Two steps rather than one because the card has to look like the site, and the
only honest way to get that is to render it in a browser with the same font and
the same ink. Regenerate after changing any title:

    python -m tools.seo ogcards
    node tools/seo/render_og.mjs
"""

from __future__ import annotations

import html
import pathlib

from . import head, urls
from .pages import for_path

SHEET = "tools/seo/_ogsheet.html"

# Which eyebrow each kind gets. Plain section names, no claims.
EYEBROW = {
    "home": "Orvix",
    "pillar": "What we do",
    "service": "What we do",
    "engagement": "Engagements",
    "industry": "Industries",
    "research": "Research",
    "research-item": "Research",
    "listing": "Research",
    "company": "Company",
}

CARD_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{background:#222;font-family:'IBM Plex Sans',system-ui,sans-serif}
.card{position:relative;width:1200px;height:630px;background:#03072C;overflow:hidden;
  padding:82px 90px;display:flex;flex-direction:column;justify-content:space-between}
.card::after{content:"";position:absolute;right:-160px;top:-160px;width:620px;height:620px;
  border:1px solid rgba(72,226,226,.16);transform:rotate(45deg)}
.card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:6px;background:#48E2E2}
.eyebrow{font-size:20px;letter-spacing:.18em;text-transform:uppercase;font-weight:600;
  color:#48E2E2;position:relative;z-index:2}
.t{font-size:62px;line-height:1.06;font-weight:600;letter-spacing:-.025em;color:#fff;
  max-width:17ch;position:relative;z-index:2}
.t.long{font-size:50px}
.foot{display:flex;align-items:flex-end;justify-content:space-between;position:relative;z-index:2}
.mark{height:38px;width:auto;display:block}
.url{font-family:'IBM Plex Mono',monospace;font-size:19px;color:#8A93A6}
[dir=rtl] .card{padding:82px 90px}
[dir=rtl] .card::before{left:auto;right:0}
[dir=rtl] .t{letter-spacing:normal}
"""


def _title_for_card(title: str) -> str:
    """The title without the ' | Orvix' suffix; the wordmark already says it."""
    return title.rsplit(" | Orvix", 1)[0].strip() or "Orvix"


def sheet(root: pathlib.Path) -> str:
    # relative to the sheet's own location, not an absolute file:// URI,
    # so the generated sheet is the same on every machine
    logo = "../../assets/img/orvix-logo.png"
    cards = []
    for rel in urls.discover(root):
        if rel.startswith("ar/"):
            continue  # Arabic cards wait for Arabic titles (section 7)
        page = for_path(rel)
        if page is None:
            continue
        name = pathlib.PurePosixPath(head.og_image_for(rel)).name
        t = _title_for_card(page["title"])
        cards.append(
            f'<div class="card" data-name="{html.escape(name)}">'
            f'<div class="eyebrow">{html.escape(EYEBROW.get(page["kind"], "Orvix"))}</div>'
            f'<div class="t{" long" if len(t) > 42 else ""}">{html.escape(t)}</div>'
            f'<div class="foot"><img class="mark" src="{logo}" alt="Orvix">'
            f'<div class="url">orvixnet.com</div></div>'
            f"</div>"
        )
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<link rel='preconnect' href='https://fonts.googleapis.com'>"
        "<link rel='preconnect' href='https://fonts.gstatic.com' crossorigin>"
        "<link href='https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500"
        "&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap' rel='stylesheet'>"
        f"<style>{CARD_CSS}</style></head><body>" + "".join(cards) + "</body></html>"
    )


def write(root: pathlib.Path) -> dict:
    p = root / SHEET
    p.parent.mkdir(parents=True, exist_ok=True)
    s = sheet(root)
    p.write_text(s, encoding="utf-8", newline="")
    return {"sheet": SHEET, "cards": s.count('class="card"')}
