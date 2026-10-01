"""Export path <-> production URL.

Every page is <folder>/index.html and is served at the directory URL, so the
path on disk and the URL are the same shape. (Engagement and industry pages
used to be <section>/<Folder>/<Folder>.html behind rewrites; they were moved
to engagements/<slug>/ and industries/<sector>/, and _redirects sends the old
addresses there with a 301.)

One convention site-wide (SEO brief section 1.2):
    absolute, https, no www, directory URLs, one trailing slash, no .html
"""

from __future__ import annotations

import pathlib

ORIGIN = "https://orvixnet.com"


def to_url_path(rel: str) -> str:
    """Export-relative posix path -> absolute production path, with trailing slash.

    >>> to_url_path("index.html")
    '/'
    >>> to_url_path("what-we-do/ai-assurance/index.html")
    '/what-we-do/ai-assurance/'
    >>> to_url_path("ar/engagements/ai-estate-inventory/index.html")
    '/ar/engagements/ai-estate-inventory/'
    """
    if rel != "index.html" and not rel.endswith("/index.html"):
        raise ValueError(f"no URL rule for export path: {rel} (pages are <folder>/index.html)")
    return "/" + rel[:-len("index.html")]


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
        if rel.startswith(("tools/", "admin/", "email/")) or rel == "404.html":  # admin/ is the blog dashboard, email/ newsletter templates
            # 404.html is served by Netlify for any missing path; it has no
            # URL of its own and is not a page in the table
            continue
        out.append(rel)
    return out
