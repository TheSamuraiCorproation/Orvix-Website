"""Where each Insights piece is published.

To publish a piece, paste its address next to its title and run

    python -m tools.insights

The row on the listing page turns into a link reading "Read now", and the
list heading moves from "Coming up" to "Latest". Leave the address empty and
the row reads "Notify me", linking to the newsletter sign-up. The Arabic listing follows the
English one automatically; give a piece an "ar" address only if it has a
separate Arabic article.

An address can be a WordPress post (https://...), or a page inside this site
written from the site root ("/research/perspectives/replication/").

    "Replication is not a backup": "https://blog.orvixnet.com/replication/",
    "Replication is not a backup": {"en": "https://...", "ar": "https://..."},
"""

ARTICLES = {
    # research/perspectives
    "Replication is not a backup": "",
    "Approval latency is the control": "",
    "Nobody should audit their own estate": "",
    "The inventory is always partial": "",

    # research/sector-briefings
    "Financial services": "",
    "Government & public sector": "",
    "Energy & utilities": "",
    "Telecommunications": "",

    # research/technology-evaluations
    "Synthetic media detection": "",
    "Immutability and retention lock": "",
    "Agent frameworks and the stop": "",
}
