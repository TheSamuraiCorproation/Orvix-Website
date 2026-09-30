"""Pull the canonical nav markup out of the what-we-do template.

Nothing is hardcoded here: the markup is read from the donor page at run
time, so this stays in step with the template instead of drifting from a
copy pasted once. The nav CSS is not transplanted any more: it lives in
assets/css/ (see README.md, "Styles").

The English donor is what-we-do/ai-assurance/index.html and the Arabic donor is
its twin. Both sit at the same link depth as every engagement and industry page
(../../), which is why the extracted markup can be transplanted verbatim.
"""

from __future__ import annotations

import pathlib
import re

EN_DONOR = "what-we-do/ai-assurance/index.html"
AR_DONOR = "ar/what-we-do/ai-assurance/index.html"

# legacy: the toggle script lives in assets/nav.js now and tools/nav removes
# any transplanted inline copy. Kept so old markers can still be recognised.
JS_BEGIN = "<!-- nav:js:begin  tools/unify -->"
JS_END = "<!-- nav:js:end -->"


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


def _slice(s: str, pattern: str, tag: str) -> str:
    m = re.search(pattern, s)
    if not m:
        raise ValueError(f"donor is missing {pattern}")
    return s[m.start():match_element(s, m.start(), tag)]


class Donor:
    def __init__(self, root: pathlib.Path, lang: str):
        rel = AR_DONOR if lang == "ar" else EN_DONOR
        self.lang = lang
        self.rel = rel
        s = (root / rel).read_text(encoding="utf-8")

        body = s[s.lower().find("<body"):]
        self.nav = _slice(body, r'<nav id="nav">', "nav")
        self.mob = _slice(body, r'<div class="mob" id="mob">', "div")

    def nav_for(self, rel: str) -> str:
        """The nav with its language toggle pointed at this page's own twin."""
        page = rel[:-len("index.html")] if rel.endswith("index.html") else rel
        if self.lang == "en":
            href = "../../ar/" + page
        else:
            # an Arabic page links back to its English twin from inside ar/
            href = "../../../" + page[3:]
        return re.sub(r'(<a class="nav-ar" href=")[^"]*(")',
                      lambda m: m.group(1) + href + m.group(2), self.nav, count=1)
