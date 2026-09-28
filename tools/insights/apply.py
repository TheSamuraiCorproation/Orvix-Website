"""Render the Insights listings (Perspectives, Sector briefings, Technology
evaluations) from tools/insights/articles.py, English and Arabic.

A row whose piece has an address becomes a link that reads "Read now"; a row
without one reads "Coming soon". Nothing on these pages is called a draft.
The section headings that described the list as unpublished drafts are
reworded so they hold whether none, some or all of the pieces are out.

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
    "Latest": "الأحدث",
    "Four pieces, one idea each.": "أربع مقالات، لكلٍّ منها فكرة واحدة.",
    "Titles and arguments are settled. Each piece opens here the moment it has been reviewed.":
        "العناوين والحجج مستقرة. وتُتاح كل مقالة هنا فور مراجعتها.",
}

# Section copy that described the list as unpublished drafts: (old, new) in
# English. The Arabic pair is looked up from the dictionary, so both languages
# move together. Matched between tags only, and a no-op once replaced.
REWORD = [
    ("In preparation", "Latest"),
    ("Planned", "Latest"),
    ("Four drafts, none published yet.", "Four pieces, one idea each."),
    ("Titles and arguments are settled. Nothing goes up until it has been reviewed, "
     "so this list is what is coming rather than what is available.",
     "Titles and arguments are settled. Each piece opens here the moment it has been reviewed."),
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


LABEL = {
    "en": {"read": "READ NOW &#8594;", "soon": "COMING SOON"},
    "ar": {"read": NEW_AR["READ NOW"] + " &#8592;", "soon": NEW_AR["COMING SOON"]},
}

R_ROW = re.compile(
    r'<(?P<tag>div|a) class="row"(?: href="[^"]*")?>(?P<body>.*?)'
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
        # a page inside this site: make it relative so it works off disk too
        v = "../" * rel.count("/") + v.lstrip("/")
        if v.endswith("/"):
            v += "index.html"
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
            row = f'<div class="row">{body}<div{d} class="go soon">{LABEL[lang]["soon"]}</div></div>'
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
            if rel == en:
                published += sum(1 for t in titles if href_for(t, "en", rel))
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
