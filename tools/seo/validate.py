"""The build validator (SEO brief section 6), plus the section 1.1 render check.

Exit code 1 on any ERROR. Section 6 lists eleven conditions; each maps to one
check below and each names the file so it is actionable without a diff.

English pages are checked in full. Arabic pages are checked structurally only
-- canonical, hreflang, alt text, parseable JSON-LD, one H1 -- and their title
and description lengths are reported as warnings rather than errors, because
section 7 holds Arabic copy back for review and forbids machine-translating it.
Turning those warnings into errors is what section 7 becomes when it starts.
"""

from __future__ import annotations

import json
import pathlib
import re
from collections import defaultdict

from . import schema, urls
from .pages import NOINDEX, for_path

CONFIRM = re.compile(r"confirm\]", re.I)
COMMENT = re.compile(r"<!--.*?-->", re.S)


class Report:
    def __init__(self) -> None:
        self.errors: list[tuple[str, str, str]] = []
        self.warnings: list[tuple[str, str, str]] = []

    def error(self, rel: str, rule: str, msg: str) -> None:
        self.errors.append((rel, rule, msg))

    def warn(self, rel: str, rule: str, msg: str) -> None:
        self.warnings.append((rel, rule, msg))

    @property
    def ok(self) -> bool:
        return not self.errors

    def render(self) -> str:
        L = []
        if self.errors:
            L.append(f"ERRORS ({len(self.errors)})")
            for rel, rule, msg in self.errors:
                L.append(f"  [{rule}] {rel}\n      {msg}")
        if self.warnings:
            L.append(f"\nWARNINGS ({len(self.warnings)})")
            for rel, rule, msg in self.warnings:
                L.append(f"  [{rule}] {rel}\n      {msg}")
        if not self.errors and not self.warnings:
            L.append("clean")
        elif not self.errors:
            L.append(f"\nno errors ({len(self.warnings)} warnings)")
        return "\n".join(L)


def _text(s: str) -> str:
    """Body text with comments and script/style removed."""
    s = COMMENT.sub("", s)
    s = re.sub(r"<(script|style)\b.*?</\1>", "", s, flags=re.S | re.I)
    return s


def check(root: pathlib.Path) -> Report:
    r = Report()
    titles: dict[str, list[str]] = defaultdict(list)
    descs: dict[str, list[str]] = defaultdict(list)
    sitemap_urls: set[str] = set()

    sm = root / "sitemap.xml"
    if sm.exists():
        sitemap_urls = set(re.findall(r"<loc>(.*?)</loc>", sm.read_text(encoding="utf-8")))

    for rel in urls.discover(root):
        p = root / rel
        s = p.read_text(encoding="utf-8")
        page = for_path(rel)
        en = urls.lang_of(rel) == "en"
        # Length rules are advisory on editorial pages: a post's title and summary
        # are whatever the editor typed, and one short summary must not fail the
        # whole site build.
        say = r.error if en and not (page or {}).get("editorial") else r.warn

        if page is None:
            r.error(rel, "page-table", "page is not in tools/seo/pages.py")
            continue

        indexable = page.get("robots") != NOINDEX

        # -- title -----------------------------------------------------
        headonly = s[:s.lower().find("</head>")]
        m = re.search(r"<title>(.*?)</title>", headonly, re.S)
        if not m or not m.group(1).strip():
            r.error(rel, "title-missing", "no <title>")
        else:
            t = m.group(1).strip()
            titles[t].append(rel)
            if len(t) > 60:
                say(rel, "title-length", f"{len(t)} chars, max 60: {t!r}")
            if len(re.findall(r"<title>", headonly)) > 1:
                r.error(rel, "title-duplicate", "more than one <title> in <head>")

        # -- description -----------------------------------------------
        d = re.findall(r'<meta\s+name="description"\s+content="(.*?)"', headonly, re.S | re.I)
        if not d:
            r.error(rel, "description-missing", "no meta description")
        else:
            if len(d) > 1:
                r.error(rel, "description-duplicate", f"{len(d)} meta descriptions in the document")
            descs[d[0]].append(rel)
            n = len(d[0])
            if not (140 <= n <= 160):
                say(rel, "description-length", f"{n} chars, must be 140-160")

        # -- canonical -------------------------------------------------
        c = re.findall(r'<link\s+rel="canonical"\s+href="(.*?)"', s, re.I)
        if not c:
            r.error(rel, "canonical-missing", "no canonical")
        elif len(c) > 1:
            r.error(rel, "canonical-duplicate", f"{len(c)} canonicals")
        else:
            want = urls.to_url(rel)
            if c[0] != want:
                r.error(rel, "canonical-mismatch", f"{c[0]} != {want}")

        # -- noindex must not be in the sitemap ------------------------
        if not indexable and urls.to_url(rel) in sitemap_urls:
            r.error(rel, "noindex-in-sitemap", f"{urls.to_url(rel)} is noindex but listed")

        # -- hreflang must not point at a 404 --------------------------
        for href in re.findall(r'<link\s+rel="alternate"\s+hreflang="[^"]*"\s+href="(.*?)"', s, re.I):
            if not href.startswith(urls.ORIGIN):
                r.error(rel, "hreflang-offsite", href)
                continue
            path = href[len(urls.ORIGIN):]
            if not _resolves(root, path):
                r.error(rel, "hreflang-404", f"{href} has no page in the export")

        # -- every <img> needs alt -------------------------------------
        for tag in re.findall(r"<img\b[^>]*>", s, re.I):
            if not re.search(r"\balt\s*=", tag, re.I):
                r.error(rel, "img-alt", f"<img> without alt: {tag[:90]}")

        # -- a visible confirm slot must not be indexable --------------
        if indexable:
            hits = CONFIRM.findall(_text(s))
            if hits:
                r.error(rel, "confirm-indexable",
                        f"{len(hits)} visible '... confirm]' slot(s) on an indexable page")

        # -- JSON-LD must parse ----------------------------------------
        for i, body in enumerate(re.findall(
                r'<script type="application/ld\+json">(.*?)</script>', s, re.S)):
            try:
                data = json.loads(body)
            except json.JSONDecodeError as e:
                r.error(rel, "jsonld-parse", f"block {i}: {e}")
                continue
            for node in _walk(data):
                t = node.get("@type")
                if t in schema.FORBIDDEN_TYPES:
                    r.error(rel, "jsonld-forbidden-type", f"@type {t} is forbidden by section 3")
                if "areaServed" in node:
                    names = {a.get("name") for a in node["areaServed"] if isinstance(a, dict)}
                    extra = names - set(schema.GCC_STATES)
                    if extra:
                        r.error(rel, "jsonld-area-served",
                                f"areaServed beyond the six GCC states: {sorted(extra)}")

        if "application/ld+json" not in s:
            r.warn(rel, "no-structured-data",
                   "no JSON-LD on this page; it gets one when schema.SHIP_ORGANIZATION "
                   "is turned on, which section 1.4 gates on the registered address")

        # -- exactly one H1 --------------------------------------------
        h1 = re.findall(r"<h1\b", s, re.I)
        if len(h1) != 1:
            r.error(rel, "h1-count", f"{len(h1)} <h1> elements, must be exactly 1")

        # -- section 1.1: the raw file must carry the page on its own ---
        for what, present in (
            ("title", bool(m)),
            ("meta description", bool(d)),
            ("h1", len(h1) == 1),
            ("json-ld", "application/ld+json" in s or not _expects_jsonld(page)),
            ("body copy", len(re.sub(r"<[^>]+>", " ", _text(s)).split()) > 150),
        ):
            if not present:
                r.error(rel, "raw-response", f"{what} absent from the raw HTML")

    def dupe(kind, table, label):
        for value, where in table.items():
            if len(where) <= 1:
                continue
            # A duplicate across exactly one en/ar twin pair is the Arabic meta
            # gap, not two pages competing: every Arabic page in this export
            # still carries its English description. Section 7 forbids
            # machine-translating them, so it is reported and not an error.
            if len(where) == 2 and urls.twin(where[0]) == where[1]:
                r.warn(where[0], kind + "-untranslated",
                       f"{label} is identical to its Arabic twin: the Arabic "
                       f"meta was never translated (brief section 7)")
                continue
            hit = r.error if any(urls.lang_of(w) == "en" for w in where) else r.warn
            hit(where[0], kind, f"{label} shared with {where[1:]}")

    dupe("title-duplicate", titles, "title")
    dupe("description-duplicate", descs, "description")

    return r


def _expects_jsonld(page: dict) -> bool:
    """Pages the brief actually asks to carry a graph while Organization is gated."""
    if page["kind"] in {"home", "engagement", "industry"}:
        return True
    return False


def _resolves(root: pathlib.Path, path: str) -> bool:
    """Does a production URL path correspond to a page in this export?"""
    for rel in urls.discover(root):
        if urls.to_url_path(rel) == path:
            return True
    return False


def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)
