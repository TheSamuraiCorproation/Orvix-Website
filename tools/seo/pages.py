"""The per-page dict the shared head component consumes (SEO brief section 2).

English only. Arabic pages inherit structure (kind, robots, og:type, hreflang
pairing) from their English twin but keep their own existing title and
description, because section 7 says Arabic meta is not to be machine-translated
and the Arabic keyword forms are still being validated elsewhere.

Titles were derived from each page's existing H1 and body copy, following the
section 2 templates, because Orvix_Keyword_Targets_v1.xlsx was not in the repo.
Every title here is a placement to check against the sheet, not a result from
it. Descriptions are written to the 140-160 rule; lengths are asserted by
validate.py, so an edit that breaks the range fails the build rather than
shipping.

robots: NOINDEX is set per the section 2 rule -- case study not cleared,
research item DRAFT/PLANNED, a visible [... confirm] slot, or a bare form page.
Each one carries the reason so it is obvious what has to change to lift it.
"""

from __future__ import annotations

INDEX = "index, follow, max-image-preview:large"
NOINDEX = "noindex, follow"

# kind -> how the page is treated by schema.py and sitemap.py
# home | pillar | service | engagement | industry | research | research-item
# | company | listing


def _p(kind, title, description, robots=INDEX, og_type="website", **kw):
    d = dict(kind=kind, title=title, description=description,
             robots=robots, og_type=og_type)
    d.update(kw)
    return d


PAGES: dict[str, dict] = {

    # ---- home ---------------------------------------------------------
    "index.html": _p(
        "home",
        "AI Assurance and Cybersecurity in the GCC | Orvix",
        "Independent AI assurance, cybersecurity and infrastructure engineering "
        "for banks, government bodies and operators across the GCC and wider MENA.",
    ),

    # ---- pillars ------------------------------------------------------
    "what-we-do/ai-cybersecurity/index.html": _p(
        "pillar",
        "AI Cybersecurity for Regulated Enterprises | Orvix",
        "Detection, response and human-risk defence for estates that now include "
        "AI models, operated by Orvix and measured on dwell time, not promises.",
    ),
    "what-we-do/applied-ai-and-data/index.html": _p(
        "pillar",
        "Applied AI and Data for GCC Enterprises | Orvix",
        "AI put to work on processes that carry real cost and risk, with a named "
        "owner at every gate and an independent check on what the system does.",
    ),
    "what-we-do/advanced-infrastructure/index.html": _p(
        "pillar",
        "AI-Ready and Sovereign Infrastructure | Orvix",
        "Network, storage and identity assessed as one architecture, with data "
        "residency, recovery and exit treated as requirements from the first day.",
    ),
    "what-we-do/ai-assurance/index.html": _p(
        "pillar",
        "AI Assurance and Governance in the GCC | Orvix",
        "Governance that produces evidence, independent evaluation against stated "
        "purpose, and an audit record assembled before a regulator asks for it.",
    ),

    # ---- services -----------------------------------------------------
    "what-we-do/ai-cybersecurity/managed-detection-response/index.html": _p(
        "service",
        "Managed Detection and Response | AI Cybersecurity | Orvix",
        "Detection and response run as a service for GCC estates, with dwell time "
        "measured and reported, and the detections tested by an outside red team.",
    ),
    "what-we-do/ai-cybersecurity/human-risk/index.html": _p(
        "service",
        "Human Risk Defence | AI Cybersecurity | Orvix",
        "Defence against attacks that arrive as a convincing person rather than a "
        "file, addressed by changing the approval path, not by training harder.",
    ),
    "what-we-do/ai-cybersecurity/ot-security/index.html": _p(
        "service",
        "OT Security | AI Cybersecurity | Orvix",
        "Security for estates where availability outranks confidentiality, "
        "covering the corporate-to-operational crossing, patch windows and safe change.",
    ),
    "what-we-do/applied-ai-and-data/agentic-ai/index.html": _p(
        "service",
        "Agentic AI | Applied AI and Data | Orvix",
        "Agent systems built to the rung of autonomy your controls can support, "
        "with a named person accountable for every action an agent takes alone.",
    ),
    "what-we-do/applied-ai-and-data/ai-control/index.html": _p(
        "service",
        "AI Control | Applied AI and Data | Orvix",
        "The limits, logs and stop conditions that keep autonomy reversible, built "
        "into the system and exercised on a schedule rather than merely written.",
    ),
    "what-we-do/applied-ai-and-data/data-organization/index.html": _p(
        "service",
        "Data Organization | Applied AI and Data | Orvix",
        "The inventory, lineage and quality your models stand on, assessed and "
        "repaired before autonomy amplifies whatever is already wrong inside them.",
    ),
    "what-we-do/advanced-infrastructure/infrastructure-design/index.html": _p(
        "service",
        "Infrastructure Design | Advanced Infrastructure | Orvix",
        "Network, storage and identity reviewed as one design, with residency and "
        "resilience assessed as requirements instead of split across contracts.",
    ),
    "what-we-do/advanced-infrastructure/network-as-a-service/index.html": _p(
        "service",
        "Network as a Service | Advanced Infrastructure | Orvix",
        "We establish what your connectivity layer has to do, then tell you "
        "whether what you already have does it. Assessment first, procurement after.",
    ),
    "what-we-do/advanced-infrastructure/storage-and-resilience/index.html": _p(
        "service",
        "Storage and Resilience | Advanced Infrastructure | Orvix",
        "What you could actually restore, how far back, and how many copies would "
        "survive one failure. Tested against your objectives, not the brochure.",
    ),
    "what-we-do/ai-assurance/governance/index.html": _p(
        "service",
        "AI Governance | AI Assurance | Orvix",
        "Governance run as an operating capability that produces evidence on a "
        "schedule, rather than a policy document describing a stated intention.",
    ),
    "what-we-do/ai-assurance/independent-evaluation/index.html": _p(
        "service",
        "Independent AI Evaluation | AI Assurance | Orvix",
        "Testing a model against what it was claimed to do, on your own data and "
        "your own thresholds, with results a third party can reproduce exactly.",
    ),
    "what-we-do/ai-assurance/audit-readiness/index.html": _p(
        "service",
        "AI Audit Readiness | AI Assurance | Orvix",
        "The record assembled before somebody asks: inventory, decision history, "
        "control evidence and a reporting pack a board will accept as it stands.",
    ),

    # ---- engagements --------------------------------------------------
    # Descriptions here are the existing ones: all eight already sat inside
    # 140-160 and read better than anything a template would produce.
    "engagements/ai-estate-inventory/index.html": _p(
        "engagement",
        "AI Estate Inventory: Find Every AI System | Orvix",
        "A 3–5 week engagement that finds, classifies and risk-ranks every AI "
        "system you run, including the undeclared ones, and leaves a live register.",
    ),
    "engagements/api-discovery-and-governance/index.html": _p(
        "engagement",
        "API Discovery and Governance: Full Inventory | Orvix",
        "A 4–6 week engagement that finds the APIs actually running, classifies "
        "them by data sensitivity and assesses them against the OWASP API Top 10.",
    ),
    "engagements/assurance-review/index.html": _p(
        "engagement",
        "AI Assurance Review: ISO 42001 Evidence | Orvix",
        "A 6-week independent control assessment against ISO/IEC 42001 and NIST AI "
        "RMF, producing an evidence ledger and a date-sequenced closure plan.",
    ),
    "engagements/data-residency-review/index.html": _p(
        "engagement",
        "Data Residency Review: Where Your Data Goes | Orvix",
        "A 3–4 week engagement that maps where regulated data is stored, "
        "processed, supported and backed up, against what your own regulator expects.",
    ),
    "engagements/human-risk-and-impersonation-defense/index.html": _p(
        "engagement",
        "Impersonation Defence: Deepfake Review | Orvix",
        "A 4-week engagement that maps the approvals relying on recognizing a "
        "person, tests them under controlled conditions, and documents the result.",
    ),
    "engagements/infrastructure-design-review/index.html": _p(
        "engagement",
        "Infrastructure Design Review: Test It Early | Orvix",
        "A 4–6 week review of a design against residency, resilience, AI-readiness "
        "and cryptographic posture, layer by layer, with a migration sequence.",
    ),
    "engagements/managed-detection-and-response/index.html": _p(
        "engagement",
        "Managed Detection and Response: 24/7 MDR | Orvix",
        "24/7 detection and response, with a residency track matched to each "
        "workload, detection engineering, and an agreed authority to contain a threat.",
    ),
    "engagements/model-evaluation-and-red-team/index.html": _p(
        "engagement",
        "Model Evaluation and AI Red Team | Orvix",
        "A 4–6 week engagement that measures an AI system against its stated "
        "purpose, then attacks the application around it. Results are reproducible.",
    ),

    # ---- industries ---------------------------------------------------
    # Five of these eight shipped the same 172-char description. All rewritten
    # to be unique and inside the range.
    "industries/financial-services/index.html": _p(
        "industry",
        "AI and Cryptographic Assurance for GCC Banks | Orvix",
        "Independent assurance for GCC banks: cryptographic discovery, AI "
        "governance and identity control reviews against dated CBUAE obligations now.",
    ),
    "industries/telecommunications/index.html": _p(
        "industry",
        "Network and AI Assurance for GCC Telecom | Orvix",
        "Independent assurance for GCC telecom operators: network trust, change "
        "evidence, supply-chain accreditation and AI governance, against dates.",
    ),
    "industries/government-public-sector/index.html": _p(
        "industry",
        "Independent Assurance for GCC Government | Orvix",
        "Independent assurance for UAE and GCC public-sector programmes: AI "
        "governance, cryptographic readiness, and what a supplier can be asked to show.",
    ),
    "industries/energy-utilities/index.html": _p(
        "industry",
        "AI and OT Assurance for Energy and Utilities | Orvix",
        "Independent assurance for energy and utility operators: the corporate to "
        "operational boundary, OT visibility, and evidence a regulator accepts.",
    ),
    "industries/healthcare-life-sciences/index.html": _p(
        "industry",
        "AI Assurance for GCC Healthcare | Orvix",
        "Independent assurance for GCC healthcare providers: which models touch a "
        "clinical decision, what the record shows, and how data residency holds.",
    ),
    "industries/industrial-manufacturing/index.html": _p(
        "industry",
        "OT and AI Assurance for Manufacturing | Orvix",
        "Independent assurance for manufacturers: every path into the production "
        "systems, the change record behind it, and what an outage would cost.",
    ),
    "industries/retail-hospitality-real-estate/index.html": _p(
        "industry",
        "AI and Data Assurance for Retail and Hospitality | Orvix",
        "Independent assurance for retail, hospitality and real estate: where each "
        "copy of a customer record lives, who reaches it, and what evidence says.",
    ),
    "industries/transport-logistics/index.html": _p(
        "industry",
        "AI and OT Assurance for Transport and Logistics | Orvix",
        "Independent assurance for transport and logistics operators: whether the "
        "fallback works, who authorised the last change, and what the record has.",
    ),

    # ---- research -----------------------------------------------------
    "research/maturity-model/index.html": _p(
        "research-item",
        "AI Trust Maturity Model: Five Levels | Orvix",
        "Five levels, from asserted to held. What exists at each level, how to "
        "tell which one you are standing on, and the single move that lifts you.",
        og_type="article",
    ),
    "research/assurance-index/index.html": _p(
        "research-item",
        "GCC Assurance Index: Published Method | Orvix",
        "What the region can actually evidence, measured the same way each year. "
        "The method is published in advance; the first edition is in preparation.",
        og_type="article",
        robots=NOINDEX,
        # Visible [DATE - confirm] slot in the body. Section 6 fails the build on
        # a confirm slot on an indexable page. Set the first-edition date and
        # flip this back to INDEX -- nothing else about the page has to change.
        noindex_reason="visible [DATE - confirm] slot: first-edition date unset",
    ),
    "research/readiness-assessment/index.html": _p(
        "research",
        "AI Readiness Self-Assessment | Orvix",
        "Ten statements. Answer honestly and see which level of the Trust Maturity "
        "Model you are standing on. Nothing is submitted and nothing is stored.",
    ),
    "research/case-studies/index.html": _p(
        "listing",
        "AI Assurance Case Studies | Orvix",
        "What we found, what changed, and what each client agreed we could say. "
        "Published with consent or not published at all. Three written up here.",
    ),
    "research/case-studies/energy/index.html": _p(
        "research-item",
        "OT Network Visibility Case Study | Orvix",
        "An operational estate where the independence of the corporate and "
        "operational networks had been asserted for years and had never once been tested.",
        og_type="article",
        robots=NOINDEX,
        noindex_reason="case study not cleared: client, sector and duration unconfirmed",
    ),
    "research/case-studies/financial-services/index.html": _p(
        "research-item",
        "AI Register Case Study: DIFC Institution | Orvix",
        "A DIFC-licensed institution establishing what it was actually running on "
        "personal data, and what it could evidence about each system it found.",
        og_type="article",
        robots=NOINDEX,
        noindex_reason="case study not cleared: client, sector and duration unconfirmed",
    ),
    "research/case-studies/telecom/index.html": _p(
        "research-item",
        "Cross-Border Data Residency Case Study | Orvix",
        "A carrier estate where residency was written as a storage clause and "
        "quietly undone by a network re-route that nobody had ever thought to log.",
        og_type="article",
        robots=NOINDEX,
        noindex_reason="case study not cleared: client, sector and duration unconfirmed",
    ),
    "research/industry/financial-services/index.html": _p(
        "listing",
        "Financial Services AI Research | Orvix",
        "Research for financial services: what we are watching, the briefings that "
        "apply, and where the sector typically sits on the Trust Maturity Model.",
    ),
    "research/industry/telecom/index.html": _p(
        "listing",
        "Telecom AI and Security Research | Orvix",
        "Research for telecommunications: what we are watching, the briefings that "
        "apply, and where the sector typically sits on the Trust Maturity Model.",
    ),
    "research/industry/government/index.html": _p(
        "listing",
        "Government AI Assurance Research | Orvix",
        "Research for government and public sector: what we are watching, which "
        "briefings apply, and where the sector sits on the Trust Maturity Model.",
    ),
    "research/industry/energy-utilities/index.html": _p(
        "listing",
        "Energy and Utilities Security Research | Orvix",
        "Research for energy and utilities: what we are watching, the briefings "
        "that apply, and where the sector sits on the Trust Maturity Model now.",
    ),
    "research/perspectives/index.html": _p(
        "listing",
        "Perspectives on AI Assurance | Orvix",
        "Short arguments about how assurance actually fails in practice, and what "
        "to do instead. Eight hundred words at a time, with no form to fill in.",
        robots=NOINDEX,
        noindex_reason="every item DRAFT/PLANNED: no piece published yet",
    ),
    "research/sector-briefings/index.html": _p(
        "listing",
        "GCC Regulatory Sector Briefings | Orvix",
        "What a specific obligation asks a specific sector to be able to show, and "
        "which of those artefacts most firms are found not to hold when asked.",
        robots=NOINDEX,
        noindex_reason="every item DRAFT/PLANNED: no briefing published yet",
    ),
    "research/technology-evaluations/index.html": _p(
        "listing",
        "Independent Technology Evaluations | Orvix",
        "Scope and method published before the test is run, and results published "
        "whichever way they go. Independent of what Orvix may also happen to sell.",
        robots=NOINDEX,
        noindex_reason="every item DRAFT/PLANNED: no evaluation published yet",
    ),
    "research/subscribe/index.html": _p(
        "listing",
        "Subscribe to Orvix Research | Orvix",
        "An occasional email when something is published. One address, no "
        "tracking, one-click unsubscribe, and nothing else is done with the address.",
        robots=NOINDEX,
        noindex_reason="bare form page, and the form endpoint is not connected",
    ),

    # ---- company ------------------------------------------------------
    "company/about/index.html": _p(
        "company",
        "About Us: Engineering-Led Assurance | Orvix",
        "An engineering company that happens to sell technology. Who Orvix is, who "
        "is accountable for what, and the four pillars all of the work runs on.",
    ),
    "company/about/leadership/index.html": _p(
        "company",
        "Leadership and Accountability | Orvix",
        "The people accountable for the work at Orvix: who owns which decisions, "
        "what each is responsible for, and the record that sits behind each of them.",
    ),
    "company/careers/index.html": _p(
        "company",
        "Careers in AI Assurance and Security | Orvix",
        "Engineering and assurance roles at Orvix, for people who would rather "
        "build what matters and protect what matters than describe it in a deck.",
    ),
    "company/contact/index.html": _p(
        "company",
        "Contact Us: Start a Conversation | Orvix",
        "Start a conversation with Orvix. Tell us what you are trying to change "
        "and who needs convincing, and we will say whether we can help with it.",
        # Deliberately left indexable. Section 2 lists "form/thank-you page" as a
        # noindex trigger; this reads as the thin thank-you confirmation, not a
        # primary contact page carrying an address and real copy. One-line change
        # to robots=NOINDEX if that reading is wrong.
    ),
    "company/events/index.html": _p(
        "company",
        "Events, Roundtables and Briefings | Orvix",
        "Roundtables, executive briefings and recordings from Orvix across the GCC "
        "and wider MENA, for the people who have to answer for what a system does.",
    ),
    "company/partners/index.html": _p(
        "company",
        "Technology Partners and Vendor Gates | Orvix",
        "The technologies and firms Orvix builds with, and the gates a vendor has "
        "to pass before it enters the portfolio we are willing to put our name on.",
    ),
}


def for_path(rel: str) -> dict | None:
    """Page dict for an export path; Arabic inherits its English twin's shape."""
    if rel in PAGES:
        return PAGES[rel]
    if rel.startswith("ar/"):
        base = PAGES.get(rel[3:])
        if base is None:
            return None
        d = dict(base)
        d["inherited"] = True  # title/description come from the file, not here
        return d
    return None
