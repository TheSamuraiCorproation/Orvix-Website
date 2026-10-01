"""The markdown subset articles are written in, rendered to safe HTML.

The admin preview (admin/admin.js, renderMarkdown) implements the same rules,
so what an editor previews is what gets published. Change both together.

Everything is HTML-escaped first, so there is no raw HTML: a post cannot
inject a script, an iframe or a style. On top of the escaped text:

    ## Heading          -> <h2>        ### Heading -> <h3>
    - item / * item     -> <ul><li>    1. item     -> <ol><li>
    > quoted line       -> <blockquote><p>
    anything else       -> <p>, single newlines become <br>
    **bold**  *italic* or _italic_  [text](https://… | http://… | /path)

Links to other sites open in a new tab with rel="noopener noreferrer"; a link
to anything other than http(s) or a site path stays plain text.
"""

from __future__ import annotations

import re

_ESC = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}
_LINK = re.compile(r"\[([^\]\n]+)\]\(([^)\s]+)\)")
_BOTH = re.compile(r"\*\*\*(?!\s)(.+?)\*\*\*")
_BOLD = re.compile(r"\*\*(.+?)\*\*")
# re.ASCII: only Latin letters and digits block italics, so snake_case_words stay
# as typed while an Arabic prefix like "و*مائل*" still italicises, exactly as
# the admin preview does (JavaScript's \w is ASCII-only).
_ITAL = re.compile(r"(?<![*\w])\*(?!\s)([^*\n]+?)\*(?![*\w])|(?<![_\w])_(?!\s)([^_\n]+?)_(?![_\w])", re.ASCII)
_OL = re.compile(r"^\d+\. ")


def escape(s: str) -> str:
    return "".join(_ESC.get(c, c) for c in s)


def _link(m: re.Match) -> str:
    text, url = m.group(1), m.group(2)
    if url.startswith(("https://", "http://")):
        return f'<a href="{url}" target="_blank" rel="noopener noreferrer">{text}</a>'
    if url.startswith("/"):
        return f'<a href="{url}">{text}</a>'
    return m.group(0)


def _emphasis(s: str) -> str:
    s = _BOTH.sub(r"<strong><em>\1</em></strong>", s)  # ***x*** first, so it nests properly
    s = _BOLD.sub(r"<strong>\1</strong>", s)
    return _ITAL.sub(lambda m: f"<em>{m.group(1) or m.group(2)}</em>", s)


def inline(s: str) -> str:
    """Inline rules on already-escaped text.

    Valid links are swapped out for placeholders first, so bold/italic never
    reach inside a URL (an address like /a_b_c/ must not grow <em> tags);
    the link text itself still gets bold/italic when the link is put back.
    """
    links = []

    def hold(m: re.Match) -> str:
        if _link(m) == m.group(0):
            return m.group(0)  # not a link we render: leave it as text
        links.append(m)
        return f"\x00{len(links) - 1}\x00"

    s = _emphasis(_LINK.sub(hold, s))

    def put(m: re.Match) -> str:
        lm = links[int(m.group(1))]
        text, url = _emphasis(lm.group(1)), lm.group(2)
        if url.startswith(("https://", "http://")):
            return f'<a href="{url}" target="_blank" rel="noopener noreferrer">{text}</a>'
        return f'<a href="{url}">{text}</a>'

    return re.sub(r"\x00(\d+)\x00", put, s)


def render(src: str) -> str:
    raw = (src or "").replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    text = escape(raw)
    out = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = [ln.rstrip() for ln in block.split("\n") if ln.strip()]
        if not lines:
            continue
        first = lines[0]
        if first.startswith("### "):
            out.append(f"<h3>{inline(' '.join([first[4:]] + lines[1:]))}</h3>")
        elif first.startswith("## "):
            out.append(f"<h2>{inline(' '.join([first[3:]] + lines[1:]))}</h2>")
        elif all(ln.startswith(("- ", "* ")) for ln in lines):
            out.append("<ul>" + "".join(f"<li>{inline(ln[2:])}</li>" for ln in lines) + "</ul>")
        elif all(_OL.match(ln) for ln in lines):
            out.append("<ol>" + "".join(f"<li>{inline(_OL.sub('', ln))}</li>" for ln in lines) + "</ol>")
        elif all(ln.startswith("&gt; ") or ln == "&gt;" for ln in lines):
            body = "<br>".join(inline(ln[5:]) for ln in lines)
            out.append(f"<blockquote><p>{body}</p></blockquote>")
        else:
            out.append("<p>" + "<br>".join(inline(ln) for ln in lines) + "</p>")
    return "\n".join(out)


def plain_words(src: str) -> int:
    """Word count of the visible text, for the reading-time estimate."""
    return len(re.findall(r"[\w؀-ۿ]+", re.sub(r"\]\([^)]*\)", "]", src or "")))
