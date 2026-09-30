# tools/seo

Implements `Orvix_SEO_Backend_Brief.md` against this static export.

The brief was written for a generator (`build_industries_v3.py`,
`build_engagements_v3.py`, `build_company_pages.py`, the research builder).
None of those are in this repo — it is 108 self-contained HTML files with no
build step. So the shared head component the brief asks for lives here, and
runs over the exported files instead of being called while they are written.
If the real generator turns up, `head.py`, `schema.py` and `pages.py` port to
it as-is; only `apply.py` (which rewrites finished HTML) becomes unnecessary.

## Running it

```
python -m tools.seo build       # assets, apply, crawl, then validate
python -m tools.seo validate    # just the checks; exit 1 on any error
```

Individual steps: `assets`, `apply`, `ogcards`, `crawl`, `validate`.

`apply` is idempotent — running it twice writes zero files. `validate`'s exit
code is the build gate.

The og:image cards are the one step needing Node:

```
python -m tools.seo ogcards     # build tools/seo/_ogsheet.html
node tools/seo/render_og.mjs    # screenshot it to assets/img/og/
```

Skipping that does not fail the build; the og:image URLs are emitted either
way and 404 until the cards are rendered.

## Where to make changes

| You want to change | Edit |
|---|---|
| A title, description, robots value | `pages.py` |
| Which tags every page gets | `head.py` |
| JSON-LD nodes | `schema.py` |
| A URL, or the trailing-slash rule | `urls.py` |
| sitemap or robots.txt | `sitemap.py` |
| A build rule | `validate.py` |

Nothing SEO-related should be hand-edited in a page. `apply` owns everything
between the `seo:begin` / `seo:end` markers and deletes loose copies of the
tags it manages, so a hand edit is reverted on the next run.

## Two gates that are deliberately still shut

**`schema.SHIP_ORGANIZATION = False`** — brief 1.4. The `Organization` node is
written and testable but not emitted, because it is gated on the registered
address vs Dubai HQ decision. The Service graphs already reference
`#organization`, so those `@id`s dangle until this flips. That is also why 72
pages currently carry no JSON-LD at all: `Organization` is the site-wide graph.
Flip it once the address is settled and every page gets structured data.

**`pages.py` → `research/assurance-index` is `NOINDEX`** — the page has a
visible `[DATE — confirm]` slot for the first-edition date, and brief 6 fails
the build on a confirm slot on an indexable page. Set the date and change one
line back to `INDEX`.

## One place this contradicts the site

Brief 3 says never emit `areaServed` beyond the six GCC states, so
`apply` rewrote 32 graphs, dropping **Jordan** and the **United States**.

The site says otherwise. The homepage description says "US, Middle East and
North Africa", `/company/about/` carries a coverage map of five offices and
fifteen countries including a US office, and `README.md` describes the same
footprint. The structured data now under-claims the markets the copy claims.

If the rule was about not over-claiming a *local* presence, this is right. If
those markets are real, edit `GCC_STATES` in `schema.py` — one list, and the
validator check tracks it automatically.

## What is not done

Brief section 5 (definition pages, the glossary index, the PQC page and
engagement, the `/engagements/` index) and section 7 (Arabic). Section 5 was
held because engagement naming is supposed to be settled against
`Orvix_Keyword_Targets_v1.xlsx`, which is not in the repo. `schema.py` already
has `defined_term` and `defined_term_set` ready for the glossary.

## About the titles

Every English title and description in `pages.py` was derived from that page's
own H1 and body copy, because the keyword sheet was not available. They satisfy
the brief's shape and length rules and are unique, but the keyword placement is
inference. Check them against the sheet before treating them as final.

Arabic pages keep the title and description already in the file. Section 7
forbids machine-translating meta, so `apply` manages only their structural
fields. Their length violations are reported as warnings, not errors — turning
those into errors is what section 7 becomes when Arabic starts.
