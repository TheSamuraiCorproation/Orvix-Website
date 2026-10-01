"""Render the Insights listings (Perspectives, Sector briefings, Technology
evaluations) from tools/insights/articles.py, English and Arabic.

A row whose piece has an address becomes a link that reads "Read now"; a row
without one reads "Notify me" and links to the home page newsletter sign-up.
Nothing on these pages is called a draft.

The list heading (the <h2 data-insights="heading"> above each list) is set
from how many of that page's pieces are out: "Coming up" when none is,
"Latest" when all are, and a mix of the two in between. The Arabic heading
follows from HEADING below, so neither language ever counts pieces that are
not published.

    python -m tools.insights            # apply
    python -m tools.insights --check    # report what would change
"""

from __future__ import annotations

import html
import json
import pathlib
import re
import sys

from .articles import ARTICLES

ROOT = pathlib.Path(__file__).resolve().parents[2]
DICTIONARY = ROOT / "assets" / "ar-dictionary.json"

LISTINGS = [
    "research/perspectives/index.html",
    "research/sector-briefings/index.html",
    "research/technology-evaluations/index.html",
]

# New English strings and their Arabic. Registered in assets/ar-dictionary.json
# on each run so the dictionary stays the single source for the Arabic site.
NEW_AR = {
    "READ NOW": "اقرأ الآن",
    "COMING SOON": "قريبًا",
}

# The list heading, by how many of the page's pieces are published.
HEADING = {
    "en": {"none": "Coming up", "some": "Latest, and what is coming", "all": "Latest"},
    "ar": {"none": "ما سيصدر قريبًا", "some": "الأحدث، وما سيصدر قريبًا", "all": "الأحدث"},
}
R_HEADING = re.compile(r'(<h2[^>]*data-insights="heading"[^>]*>)(.*?)(</h2>)', re.S)

# Older section copy that counted unpublished pieces or described the review
# process: (old, new) in English. The Arabic pair is looked up from the
# dictionary when it holds one. Matched between tags only, and a no-op once
# replaced.
REWORD = [
    ("In preparation", "The series"),
    ("Planned", "The series"),
    ("Titles and arguments are settled. Nothing goes up until it has been reviewed, "
     "so this list is what is coming rather than what is available.",
     "One idea per piece, about 800 words, never behind a form. Select Notify me to hear when one is out."),
    ("Titles and arguments are settled. Each piece opens here the moment it has been reviewed.",
     "One idea per piece, about 800 words, never behind a form. Select Notify me to hear when one is out."),
]


def ent(s: str) -> str:
    """Numeric-reference form of s. Most Arabic pages hold literal UTF-8, but
    some strings were written as references, so both forms are matched."""
    return "".join(c if ord(c) < 128 else f"&#{ord(c)};" for c in s)


def load_dictionary() -> dict:
    return json.loads(DICTIONARY.read_text(encoding="utf-8"))


def register_strings(check: bool) -> int:
    d = load_dictionary()
    missing = {k: v for k, v in NEW_AR.items() if d.get(k) != v}
    if missing and not check:
        d.update(missing)
        # keep the file's own format (2-space indent, CRLF, no final newline)
        # so a new entry is a one-line diff
        DICTIONARY.write_bytes(
            json.dumps(d, ensure_ascii=False, indent=2).replace("\n", "\r\n").encode("utf-8"))
    return len(missing)


def copy_pairs(lang: str, d: dict) -> list[tuple[str, str]]:
    if lang == "en":
        return [(html.escape(o, quote=False), html.escape(n, quote=False)) for o, n in REWORD]
    out = []
    for o, n in REWORD:
        ao, an = d.get(o), NEW_AR.get(n) or d.get(n)
        if ao and an:
            out += [(ao, an), (ent(ao), an)]
    return out


def reword(s: str, pairs: list[tuple[str, str]]) -> str:
    for old, new in pairs:
        s = s.replace(">" + old + "<", ">" + new + "<")
    return s


def set_heading(s: str, lang: str, published: int, total: int) -> str:
    state = "none" if not published else "all" if published >= total else "some"
    text = html.escape(HEADING[lang][state], quote=False)
    return R_HEADING.sub(lambda m: m.group(1) + text + m.group(3), s)


LABEL = {
    "en": {"read": "READ NOW &#8594;", "soon": "COMING SOON", "notify": "NOTIFY ME &#8594;"},
    "ar": {"read": NEW_AR["READ NOW"] + " &#8592;", "soon": NEW_AR["COMING SOON"], "notify": "أبلغني عند النشر &#8592;"},
}

R_ROW = re.compile(
    r'<(?P<tag>div|a) class="row(?: notify)?"(?: href="[^"]*")?>(?P<body>.*?)'
    r'<div(?P<dir> dir="auto")? class="go[^"]*">[^<]*</div></(?P=tag)>', re.S)
R_TITLE = re.compile(r"<h3[^>]*>(.*?)</h3>", re.S)


def lang_of(rel: str) -> str:
    return "ar" if rel.startswith("ar/") else "en"


def href_for(title: str, lang: str, rel: str) -> str:
    v = ARTICLES.get(title, "")
    if isinstance(v, dict):
        v = v.get(lang) or v.get("en", "")
    v = (v or "").strip()
    if v.startswith("/"):
        # a page inside this site: relative, and in directory form like
        # every other internal link (the canonical URL, never .../index.html)
        v = "../" * rel.count("/") + v.lstrip("/") or "./"
    return v


def render_rows(s: str, rel: str, en_titles: list[str]) -> tuple[str, int]:
    lang = lang_of(rel)
    i = 0
    out = []
    last = 0
    for m in R_ROW.finditer(s):
        title = en_titles[i] if i < len(en_titles) else ""
        i += 1
        href = href_for(title, lang, rel)
        d = m.group("dir") or ""
        body = m.group("body")
        if href:
            attrs = f' href="{html.escape(href, quote=True)}"'
            row = f'<a class="row"{attrs}>{body}<div{d} class="go">{LABEL[lang]["read"]}</div></a>'
        else:
            # not published yet: the row asks to be told when it is (the home page sign-up)
            home = "../" * rel.count("/") + ("ar/" if lang == "ar" else "")
            row = (f'<a class="row notify" href="{home}#subscribe">{body}'
                   f'<div{d} class="go">{LABEL[lang]["notify"]}</div></a>')
        out.append(s[last:m.start()])
        out.append(row)
        last = m.end()
    out.append(s[last:])
    return "".join(out), i


def en_titles_of(root: pathlib.Path, rel: str) -> list[str]:
    en = rel[3:] if rel.startswith("ar/") else rel
    s = (root / en).read_text(encoding="utf-8")
    return [html.unescape(R_TITLE.search(m.group("body")).group(1)).strip()
            for m in R_ROW.finditer(s)]


def run(root: pathlib.Path, check: bool) -> tuple[list[str], list[str], int]:
    changed, unknown, published = [], [], 0
    d = load_dictionary()
    pairs = {lang: copy_pairs(lang, d) for lang in ("en", "ar")}
    for en in LISTINGS:
        titles = en_titles_of(root, en)
        unknown += [t for t in titles if t not in ARTICLES]
        for rel in (en, "ar/" + en):
            p = root / rel
            s0 = p.read_text(encoding="utf-8")
            s, _ = render_rows(s0, rel, titles)
            s = reword(s, pairs[lang_of(rel)])
            out = sum(1 for t in titles if href_for(t, lang_of(rel), rel))
            s = set_heading(s, lang_of(rel), out, len(titles))
            if rel == en:
                published += out
            if s != s0:
                changed.append(rel)
                if not check:
                    p.write_text(s, encoding="utf-8", newline="")
    return changed, unknown, published


def main(argv: list[str]) -> int:
    check = "--check" in argv
    added = register_strings(check)
    changed, unknown, published = run(ROOT, check)
    total = len(ARTICLES)
    print(f"insights : {published} of {total} pieces published, "
          f"{len(changed)} pages {'would change' if check else 'changed'}")
    if added:
        print(f"           {added} string(s) {'missing from' if check else 'added to'} assets/ar-dictionary.json")
    for t in unknown:
        print(f"           NOT IN articles.py: {t!r}")
    return 1 if (check and (changed or added)) or unknown else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
