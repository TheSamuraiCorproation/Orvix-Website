"""Export path <-> production URL.

The export on disk is not shaped like the live site. Engagement and industry
pages sit in a folder named after themselves; in production they are served as
directory URLs. The canonicals already written into the engagement pages assume
that mapping, so it is made explicit here rather than inferred per page.

One convention site-wide (SEO brief section 1.2):
    absolute, https, no www, directory URLs, one trailing slash, no .html
"""

from __future__ import annotations

import pathlib
import re

ORIGIN = "https://orvixnet.com"

# Folders whose page file is named after the folder rather than index.html,
# and the URL segment that folder is published under.
NAMED_FILE_SECTIONS = {
    "engagement": "engagements",  # /engagement/X/X.html  -> /engagements/<slug>/
    "industries": "industries",   # /industries/X/X.html  -> /industries/X/
}


def slugify(name: str) -> str:
    """AI_Estate_Inventory -> ai-estate-inventory."""
    s = name.replace("_", "-").replace(" ", "-")
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "-", s)
    s = re.sub(r"-+", "-", s)
    return s.lower().strip("-")


def to_url_path(rel: str) -> str:
    """Export-relative posix path -> absolute production path, with trailing slash.

    >>> to_url_path("index.html")
    '/'
    >>> to_url_path("what-we-do/ai-assurance/index.html")
    '/what-we-do/ai-assurance/'
    >>> to_url_path("engagement/AI_Estate_Inventory/AI_Estate_Inventory.html")
    '/engagements/ai-estate-inventory/'
    >>> to_url_path("ar/industries/telecommunications/telecommunications.html")
    '/ar/industries/telecommunications/'
    """
    parts = rel.split("/")
    prefix = ""
    if parts[0] == "ar":
        prefix = "/ar"
        parts = parts[1:]

    if parts[-1] == "index.html":
        parts = parts[:-1]
        return (prefix + "/" + "/".join(parts)).replace("//", "/").rstrip("/") + "/"

    # <section>/<Folder>/<Folder>.html
    if len(parts) == 3 and parts[0] in NAMED_FILE_SECTIONS:
        section = NAMED_FILE_SECTIONS[parts[0]]
        return f"{prefix}/{section}/{slugify(parts[1])}/"

    raise ValueError(f"no URL rule for export path: {rel}")


def to_url(rel: str) -> str:
    """Export-relative path -> absolute canonical URL."""
    return ORIGIN + to_url_path(rel)


def twin(rel: str) -> str:
    """The other language's export path for the same page."""
    return rel[3:] if rel.startswith("ar/") else "ar/" + rel


def lang_of(rel: str) -> str:
    return "ar" if rel.startswith("ar/") else "en"


def depth(rel: str) -> int:
    """How many '../' it takes to get from this page's URL to the site root.

    Computed from the *production* URL, not the disk path, because that is where
    a relative asset reference has to resolve. The two happen to agree for every
    page in this export, which is what keeps the folder openable from disk.
    """
    return len([p for p in to_url_path(rel).strip("/").split("/") if p])


def rel_root(rel: str) -> str:
    """Relative prefix from a page to the site root, e.g. '../../'."""
    return "../" * depth(rel) or "./"


def discover(root: pathlib.Path) -> list[str]:
    """Every page in the export, as sorted export-relative posix paths."""
    out = []
    for p in sorted(root.rglob("*.html")):
        rel = p.relative_to(root).as_posix()
        if rel.startswith("tools/") or rel == "404.html":
            # 404.html is served by Netlify for any missing path; it has no
            # URL of its own and is not a page in the table
            continue
        out.append(rel)
    return out
