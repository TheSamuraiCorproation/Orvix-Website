"""JSON-LD emitted alongside the graphs already hand-written into the pages
(SEO brief section 3).

The engagement and industry pages already carry a good Service / FAQPage /
BreadcrumbList graph. Those are left alone. This module adds the nodes the
brief asks for that are not there yet, in a second ld+json script, which is
valid and is how consumers merge multiple graphs.

Two rules from the brief are enforced here rather than trusted to reviewers:

  * SHIP_ORGANIZATION is False. The Organization node is built and testable,
    but section 1.4 gates shipping it on the registered-address decision. The
    existing graphs already reference #organization, so flipping this to True
    is what resolves those dangling references.

  * areaServed never exceeds the six GCC states. See GCC_STATES below -- this
    contradicts what the site says elsewhere about its markets, which is
    called out in tools/seo/README.md.

Never emitted, per section 3: Review, AggregateRating, Certification.
"""

from __future__ import annotations

import json

from . import urls

# ---- section 3: "any areaServed beyond the six GCC states" is forbidden ----
GCC_STATES = [
    "United Arab Emirates",
    "Saudi Arabia",
    "Qatar",
    "Kuwait",
    "Bahrain",
    "Oman",
]

FORBIDDEN_TYPES = {"Review", "AggregateRating", "Certification"}

# Section 1.4 blocker. Do not flip until the registered address is confirmed.
SHIP_ORGANIZATION = False

ORG_ID = f"{urls.ORIGIN}/#organization"
SITE_ID = f"{urls.ORIGIN}/#website"


def organization() -> dict:
    """Site-wide Organization node. Gated by SHIP_ORGANIZATION (section 1.4).

    address is deliberately absent: the registered-address vs Dubai-HQ question
    is the blocker. Adding a PostalAddress here before that is settled is the
    exact thing section 1.4 is holding back.
    """
    return {
        "@type": "Organization",
        "@id": ORG_ID,
        "name": "Orvix",
        "url": urls.ORIGIN + "/",
        "logo": {
            "@type": "ImageObject",
            "url": f"{urls.ORIGIN}/assets/img/orvix-logo.png",
            "width": 440,
            "height": 125,
        },
        "description": (
            "An engineering-led technology company working on advanced "
            "infrastructure, applied AI and data, AI cybersecurity, and AI "
            "assurance for regulated organizations."
        ),
        "areaServed": [{"@type": "Country", "name": c} for c in GCC_STATES],
        "contactPoint": [{
            "@type": "ContactPoint",
            "contactType": "sales",
            "url": f"{urls.ORIGIN}/company/contact/",
            "availableLanguage": ["en", "ar"],
        }],
        # sameAs stays empty until the profiles are confirmed; a guessed URL
        # here is worse than no node at all.
        "sameAs": [],
    }


def website() -> dict:
    """WebSite node, homepage only (section 3)."""
    return {
        "@type": "WebSite",
        "@id": SITE_ID,
        "url": urls.ORIGIN + "/",
        "name": "Orvix",
        "publisher": {"@id": ORG_ID},
        "inLanguage": ["en", "ar"],
    }


def article(rel: str, page: dict, title: str, description: str) -> dict | None:
    """Article node for a research piece (section 3).

    Returns None when the page has no published date. schema.org allows an
    Article without datePublished, but the brief asks for the date explicitly
    and none of the research pages carry one yet, so it is reported as a gap by
    validate.py rather than filled with a guess.
    """
    published = page.get("published")
    if not published:
        return None
    url = urls.to_url(rel)
    node = {
        "@type": "Article",
        "@id": url + "#article",
        "headline": title,
        "description": description,
        "url": url,
        "datePublished": published,
        "dateModified": page.get("modified", published),
        "author": {"@id": ORG_ID},
        "publisher": {"@id": ORG_ID},
        "inLanguage": urls.lang_of(rel),
    }
    return node


def person(name: str, job_title: str, page_url: str, anchor: str) -> dict:
    """Person node for a leadership entry (section 3)."""
    return {
        "@type": "Person",
        "@id": f"{page_url}#{anchor}",
        "name": name,
        "jobTitle": job_title,
        "worksFor": {"@id": ORG_ID},
        "url": page_url + f"#{anchor}",
    }


def defined_term(term: str, description: str, set_id: str, url: str) -> dict:
    """DefinedTerm node for a glossary entry (section 3, feeds section 5)."""
    return {
        "@type": "DefinedTerm",
        "@id": url + "#term",
        "name": term,
        "description": description,
        "inDefinedTermSet": {"@id": set_id},
        "url": url,
    }


def defined_term_set(name: str, url: str) -> dict:
    return {
        "@type": "DefinedTermSet",
        "@id": url + "#termset",
        "name": name,
        "url": url,
        "publisher": {"@id": ORG_ID},
    }


def graph_for(rel: str, page: dict, title: str, description: str,
              extra: list[dict] | None = None) -> list[dict]:
    """Every managed node for one page, in emit order."""
    nodes: list[dict] = []

    if SHIP_ORGANIZATION:
        nodes.append(organization())

    if page["kind"] == "home":
        nodes.append(website())

    if page["kind"] == "research-item":
        a = article(rel, page, title, description)
        if a:
            nodes.append(a)

    if extra:
        nodes.extend(extra)

    return nodes


def render(nodes: list[dict]) -> str | None:
    """Serialize to a script tag, or None when there is nothing to emit."""
    if not nodes:
        return None
    for n in nodes:
        if n.get("@type") in FORBIDDEN_TYPES:
            raise ValueError(f"section 3 forbids @type {n['@type']}")
    payload = {"@context": "https://schema.org", "@graph": nodes}
    body = json.dumps(payload, indent=1, ensure_ascii=False)
    # JSON is valid with these escaped; a title like "</script>" can then never
    # close the block and run as script on the page
    body = body.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return '<script type="application/ld+json">\n' + body + "\n</script>"
