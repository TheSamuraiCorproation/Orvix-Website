ORVIX WEBSITE - static export
============================

16 pages, one file each, in the production folder shape.
The "What we do", "Engagements", "Industries" and "Research" top-level nav
items are menus with no landing page of their own. They open on click or tap,
and on hover for mouse users. See NAVIGATION below.

    index.html                                            Home
    what-we-do/<pillar>/index.html                        Pillar landing   (x4)
    what-we-do/<pillar>/<service>/index.html              Service page     (x12)
    research/maturity-model/                              The Trust Maturity Model
    research/assurance-index/                             The GCC Assurance Index
    research/readiness-assessment/                        Readiness self-assessment
    research/case-studies/                                Index + 3 case studies
    research/perspectives/ sector-briefings/
      technology-evaluations/ subscribe/                  Listing pages
    research/industry/<sector>/                           Research by sector (x4)

RESEARCH — WHAT IS REAL AND WHAT IS A SLOT
    Real and ready: the Trust Maturity Model (five levels, written out in full), the
    readiness self-assessment (ten statements, scored in the browser, nothing sent),
    the Assurance Index method, and all page structure and copy.

    Marked as slots, shown on the page in a dashed box: every client name, figure,
    quotation and date in the three case studies; the Index publication date; the
    subscribe form endpoint. Nothing invented. Search the files for  class="slot"
    to find all 20.

    Perspectives, briefings and evaluations are listed as DRAFT / PLANNED rather than
    linked, because the pieces do not exist yet.

HOW TO VIEW
    Open index.html in a browser and click through. Links between the 18 pages are
    relative, so this works straight off the filesystem and from any static host as
    long as the folder shape is preserved.

LINKS
    Every link between pages is relative, so the site works straight off the
    filesystem and from any static host as long as the folder shape is kept.
    Netlify's "Pretty URLs" post-processing rewrites them to root-absolute
    clean URLs on deploy (and lower-cases the engagement paths); both forms
    resolve. The click interceptor that the first export used to show
    "page not in this export" for absolute links is gone - on the live site
    it was swallowing every navigation click on 74 pages.

BEFORE PUBLISHING
    See BUILD_NOTES.txt (the comment that used to sit at the top of every
    file, kept once instead of 64 times). Five blockers, all open:
    fee bands, vendor names, SA regulatory review, the homepage MDR/XDR conflict,
    and photography.

PHOTOGRAPHY
    Every page declares its photo slots as CSS variables in :root and every
    slot is filled from images/. Provenance and licence for each file is in
    images/CREDITS.txt; the set was re-shot for the region on 8 Sept 2026.


NAVIGATION - assets/nav.js and tools/nav/
    One shared script, loaded with defer by every page, owns all header
    behaviour. There is no inline copy of it anywhere any more.

        header menus   the four menu buttons open on click or tap and, for
                       mouse users, on hover. One panel at a time; Escape,
                       a click outside the bar, or tabbing away closes it.
                       aria-expanded is kept in step.
        drawer         below 1120px the burger toggles the drawer; Escape
                       closes it; it closes itself if the window grows past
                       the breakpoint.
        photo slots    a slot that has a picture gets .filled so its
                       placeholder brief hides.

    The CSS side is a .open state on the <li>, with :hover kept only inside
    @media (hover:hover) and (pointer:fine) so a touch device never gets a
    panel it cannot dismiss. The old :focus-within rule was the cause of two
    panels showing at once after a click.

        python -m tools.nav            # apply to every page
        python -m tools.nav --check    # report drift, write nothing

    tools/nav is idempotent and is also what strips the old inline scripts,
    the "page not in this export" interceptor and the two comment blocks
    that used to ship on every page. tools/unify now calls it for the script
    tag rather than transplanting an inline copy.

HOSTING AND SECURITY - Netlify
    The live site is Netlify behind Cloudflare. Three files in the site root
    are read by Netlify on every deploy (drag-and-drop included):

        _headers      Content-Security-Policy, X-Frame-Options DENY,
                      nosniff, Referrer-Policy, Permissions-Policy, HSTS,
                      COOP. The CSP allows only this origin plus Google
                      Fonts; inline style and script are permitted because
                      that is how the export is built.
        _redirects    /tools/*, README.txt, BUILD_NOTES.txt and
                      images/CREDITS.txt answer 404. They are in the publish
                      folder and were being served to anyone who asked.
        404.html      Netlify serves it for any missing path.

    Every page also carries <meta name="referrer"> from tools/seo, so the
    referrer policy holds on a host that ignores _headers.

    Netlify's "Pretty URLs" asset optimisation (Site settings > Build &
    deploy > Post processing) is what rewrites the links on deploy. It is
    harmless, but it can be switched off: the links are already correct.

ARABIC MIRROR - ar/
    ar/ holds a full Arabic copy of every page, in the same folder shape, so
    ar/company/about/index.html is the twin of company/about/index.html.
    Page-to-page links inside ar/ are unchanged and stay inside ar/; shared
    assets (images/, assets/) resolve one level up.

    Every page carries a language link in the header. English pages point at
    their Arabic twin, Arabic pages point back. There is no JavaScript in the
    switch and no cookie: it is a plain link, which is also what the existing
    hreflang tags declare.

    WHAT IS TRANSLATED
        Everything. 2543 dictionary entries, applied 11,667 times across the 54
        Arabic pages. That covers page copy, navigation, footers, form labels,
        regulatory tables, FAQ answers, and the copy that lives inside the
        interactive components (the maturity ladder, the twelve connectivity
        questions, the eight-copy storage stack, the attack paths, the autonomy
        rungs and the evidence ledger), which is held in JavaScript data
        rather than in markup.

        98% of the visible strings on an Arabic page are Arabic. What is left
        in Latin is what should be: standard identifiers (ISO/IEC 42001, NIST
        AI RMF, OWASP API Security Top 10), regulator acronyms shown alongside
        their Arabic names, partner names (Graphiant, Expel), SWIFT, and the
        contact address.

        Register: Modern Standard Arabic, corporate/technical. Terminology is
        held consistent across the site - estate = المنظومة, assurance =
        الضمان, evidence = الأدلة, control = الضابط, residency = موطن البيانات.

        THIS TRANSLATION HAS NOT BEEN REVIEWED BY A NATIVE SPEAKER. It should
        be read by someone who knows the regulatory vocabulary before the
        Arabic site is published, particularly the regulator and instrument
        names in the obligation tables.

    HOW TO CHANGE IT
        assets/ar-dictionary.json is the single source: "English source
        string": "Arabic". Matching is on normalised whitespace, so one entry
        covers every page the string appears on. Edit it and rebuild ar/.

    assets/rtl.css carries every right-to-left rule, scoped to [dir="rtl"];
    it does not affect the English pages. Arabic blocks and untranslated
    blocks each resolve their own direction via dir="auto", so mixed content
    never gets re-ordered by the bidi algorithm.


SEO BACKEND - tools/seo/
    The head, schema, crawl surface and build validation described in
    Orvix_SEO_Backend_Brief.md are generated, not hand-written per page.

        python -m tools.seo build      assets, apply, crawl, then validate
        python -m tools.seo validate   just the checks; exit 1 gates a release

    Titles, descriptions and robots values live in tools/seo/pages.py. Every
    page's SEO head sits between  seo:begin / seo:end  markers and is
    overwritten on each run, so edit pages.py, never the page.

    Two blockers are still shut on purpose: the Organization JSON-LD node
    (waiting on the registered address) and research/assurance-index, which is
    noindex until the first-edition date replaces its [DATE - confirm] slot.
    See tools/seo/README.md.

    The industry pages no longer inline the logo as base64. It is one file at
    assets/img/orvix-logo.png, which took about 1 MB off the sixteen of them.


TEMPLATE UNIFICATION - tools/unify/
    The export had grown three page templates. what-we-do and the homepage
    shared one; engagement pages used a second, industries a third. That is
    why the engagement pages had no working menu on a phone (hover-only
    dropdowns, a "Menu" button wired to nothing, no burger, no drawer), drew
    the wordmark as text because they never loaded IBM Plex Sans, and why the
    industry nav was missing Research and relabelled half its links.

        python -m tools.unify

    It transplants the nav, drawer, nav CSS and toggle script from
    what-we-do/ai-assurance (and its Arabic twin) onto the engagement and
    industry pages, drops the breadcrumbs those two carried, strips the hero
    line-art from every template so the hero is photograph plus scrim only,
    fills the --ph-hero slot, and matches hero spacing to what-we-do.

    Nothing is hardcoded: the markup is read from the donor page each run, so
    editing the what-we-do nav and re-running updates all 32 pages.

    Four industry pages still have no hero photograph, because images/ has no
    matching asset: healthcare-life-sciences, industrial-manufacturing,
    retail-hospitality-real-estate, transport-logistics. Drop a file in and add
    it to HERO_PHOTO in tools/unify/apply.py.

    Also handled by tools/unify, site-wide rather than per template:
      * nav typography is pinned. The bar's rule uses `font:inherit`, and the
        engagement stylesheet sets body to weight 400 where every other
        template sets 300, so the nav read heavier there. It also never reset
        list padding, which pushed the bar 40px right.
      * Leadership is removed from the header nav, the mobile drawer and the
        footer. The page itself is untouched -- same URL, still in the sitemap,
        reached from the "Read bio" card on each leadership portrait.
      * the engagement and industry heroes keep their plain ink background and
        their animated wireframe artwork. An earlier pass stripped that art and
        put a photograph behind them instead; both were reverted. HERO_ART in
        tools/unify/apply.py now lists only the two templates whose hero is a
        photograph (what-we-do and the homepage), where a line-art overlay on
        top of the picture was what had to go.


MOBILE - tools/mobile/
        node tools/mobile/audit.mjs 390 en    measure; writes _audit-390.json
        python -m tools.mobile                inject tools/mobile/mobile.css

    Every rule in mobile.css came from measuring all 108 pages at 320/360/390/
    430px, not from guesswork. It fixes type down to 9.5px, controls down to
    30px (the menu button was 34), contact fields at 15px that made iOS zoom on
    focus, and a handful of rows that overflowed a narrow column.

    Everything except one text-size-adjust line sits inside a max-width query,
    so desktop rendering is untouched. Edit mobile.css and re-run; never edit
    the copy inside a page.

    Current state, both languages, 320-430px: no page scrolls sideways, nothing
    reaches past the viewport edge, no text under 12px, no control under 44px.
    The audit still reports "silently clipped" for the .wm watermark, .field
    and .sheen layers - those are empty decorative elements bleeding out of an
    overflow:hidden parent by design, and are meant to.
