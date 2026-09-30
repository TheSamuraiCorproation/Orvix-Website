ORVIX WEBSITE - static export
============================

108 pages (54 English, 54 Arabic under ar/), one HTML file each, styled by
shared stylesheets in assets/css/ (see STYLESHEETS). No build step: the repo
root is the site.
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
    engagements/<slug>/index.html                         Engagement page  (x8)
    industries/<sector>/index.html                        Industry page    (x8)
    company/<page>/index.html                             About, Leadership, Careers,
                                                          Contact, Events, Partners

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

HOW TO VIEW (LOCALHOST)
    From the repo root:

        python -m http.server 8080          then open http://localhost:8080

    Use a server, not a double-click. Links are directory URLs (../about/,
    not ../about/index.html) and the photo variables are root-relative
    (/images/...); a server resolves both, a file:// window resolves
    neither. The photo rule is a browser one: a relative url() inside a CSS
    variable resolves from the stylesheet that uses it (assets/css/), not
    from the page.

    A plain local server ignores _headers and _redirects, so the security
    headers and the 301s from the old addresses only apply on Netlify. For a
    Netlify-exact preview:

        npx netlify-cli dev --dir .

CHECKS BEFORE A RELEASE
        python -m tools.seo validate        exit 1 = do not ship
        python -m tools.nav --check
        python -m tools.boundary --check
        python -m tools.insights --check
        python -m tools.unify --check
        python -m tools.images --check      every photo reference uses the .webp
        python -m tools.linkcheck           every internal link, asset, #anchor

    .github/workflows/checks.yml runs the same seven on every push and pull
    request to main. Needs Python 3.10+, standard library only.

LINKS
    One address per page. Every page is <folder>/index.html, served at its
    directory URL, and every internal link is relative and in that same
    directory form - exactly the URL the canonical, sitemap and hreflang tags
    declare. Never link to .../index.html: it works, but it is a second
    address for the same page. Netlify post-processing is switched off in
    netlify.toml, so what is in the repo is exactly what is served.

    Engagement and industry pages used to sit at
    engagement/<Folder>/<Folder>.html and industries/<x>/<x>.html. _redirects
    sends those old addresses to the new ones with a 301, so old bookmarks,
    search results and external links keep working. If a page is ever moved
    again, add its old address there the same way.

    The click interceptor that the first export used to show
    "page not in this export" for absolute links is gone - on the live site
    it was swallowing every navigation click on 74 pages.

BEFORE PUBLISHING
    See BUILD_NOTES.txt (the comment that used to sit at the top of every
    file, kept once instead of 64 times). Five blockers, all open:
    fee bands, vendor names, SA regulatory review, the homepage MDR/XDR conflict,
    and photography.

PHOTOGRAPHY
    Every page declares its photo slots as CSS variables (--ph-*, --pg-*) in
    the small :root block in its own <head>, and every slot is filled from
    images/. The same goes for the per-element style="--img:url(...)" on
    cards. Write every one root-relative, url('/images/x.jpg'): see HOW TO
    VIEW for why a relative path breaks.

    Pages with a hero photograph carry a <link rel="preload" as="image">
    for it, right above the :root block, so the browser fetches the hero
    first (phone LCP roughly halved). Change the hero variable and the
    preload together; tools/linkcheck fails the build if they disagree.

    Photos further down the page wait until the visitor scrolls, taps or
    types, or 2.5s after load (see "photo deferral" in assets/css/main.css
    and the one-line script in each page's head). With JavaScript off they
    load as normal.

    Pages reference .webp copies. images/*.jpg are the masters: drop a new
    JPEG in, reference it by its .jpg name, then run

        python -m tools.images         # make the .webp, switch references

PERFORMANCE AND MOTION
    fonts     IBM Plex is self-hosted in assets/fonts/ with assets/css/fonts.css
              (python -m tools.fonts regenerates both). Each family has a
              size-matched local fallback, so text does not jump when the web
              font arrives. English pages never load the Arabic font or
              assets/rtl.css; Arabic pages load both.
    reveal    Blocks with class="rv" fade up the first time they scroll into
              view (assets/reveal.js). The hidden state only applies once
              <html> has class "js", set by a one-line script in the head, so
              with JavaScript off everything is visible; prefers-reduced-motion
              gets no movement.
    headings  Each hero's small label sits inside its <h1> as a <span>, so the
              heading carries the page topic for search while looking the same. Provenance and licence for each file is in images/CREDITS.txt;
    the set was re-shot for the region on 8 Sept 2026.

STYLESHEETS - assets/css/
    Every page links the shared stylesheets for its template. The only CSS
    left inside a page is its photo variables and, on a few pages, a handful
    of rules no other page uses. To change the look of the site, edit the
    file here; never paste CSS into a page.

        main.css            home, What we do, Research, Company (76 pages):
                            brand tokens, layout, components
        company.css         Company pages, after main.css
        glow.css            the glow ring on the "Talk to our team" button
        engagement.css      engagement pages (16)
        industry.css        industry pages (16)
        mobile.css          phone refinements, every page
        engagement-nav.css  nav, hero geometry and nav type that match the
        industry-nav.css      engagement / industry pages to What we do
        nav-panel.css       menu panels scroll inside a short window
        boundary.css        the Boundary band on the What we do pages

    Order matters and is the order the rules had when they were inline:
    template stylesheet(s), the page's own <style>, then mobile.css, the
    *-nav.css file, nav-panel.css and boundary.css. assets/rtl.css comes
    after all of them on every page.

    The nav rules exist in main.css and again in engagement-nav.css and
    industry-nav.css. A change to the nav bar goes in all three.


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

    The menu CSS lives in assets/css/: main.css, plus engagement-nav.css
    (which includes the mega-menu rules the engagement pages once lacked -
    without them "What we do" and "Research" ran off the bottom of a laptop
    screen) and nav-panel.css, which lets every panel scroll inside itself
    when the window is shorter than the panel.

THE BOUNDARY BAND - assets/boundary.js and tools/boundary/
    The three-move selector on the 32 What we do pages. It steps through
    01 -> 02 -> 03 on its own every 5 seconds, with a bar on the active tab
    counting down. It advances only while the band is on screen, pauses under
    the pointer or keyboard focus, restarts the count when a move is picked,
    and stays still for prefers-reduced-motion. The ORVIX mark behind it is
    large and anchored bottom centre. Styles: assets/css/boundary.css.

        python -m tools.boundary [--check]   script tag and stylesheet link

INSIGHTS LISTINGS - tools/insights/
    Perspectives, Sector briefings and Technology evaluations are rendered
    from one file, tools/insights/articles.py. Put a piece's address next to
    its title - a WordPress post or a page in this site - and run

        python -m tools.insights [--check]

    That row becomes a link reading "Read now"; rows without an address read
    "Coming soon". The Arabic listings follow automatically, and new strings
    are registered in assets/ar-dictionary.json.

    The three listing pages are still noindex (tools/seo/pages.py) because
    nothing is published. When the first piece goes live, change their robots
    value there and run python -m tools.seo build.

HOSTING AND SECURITY - Netlify
    Hosting is Netlify; the domain (orvixnet.com) is registered and its DNS
    is managed at Namecheap. See DEPLOYMENT below. These files in the site
    root are read by Netlify on every deploy (drag-and-drop included):

        _headers      Content-Security-Policy, X-Frame-Options DENY,
                      nosniff, Referrer-Policy, Permissions-Policy, HSTS,
                      COOP. The CSP allows only this origin plus Google
                      Fonts; inline style and script are permitted because
                      that is how the export is built.
        _redirects    /tools/*, README.txt, BUILD_NOTES.txt,
                      images/CREDITS.txt, assets/ar-dictionary.json,
                      netlify.toml and /.github/* answer 404. The rules are
                      forced (404!): unforced, Netlify serves a file that
                      exists in preference to the rule, which is what was
                      happening. Also the 301s from the old page addresses (see LINKS).
                      Caching: images keep a browser copy for a week; HTML,
                      CSS and JS revalidate on every visit so a page and its
                      stylesheets always match.
        netlify.toml  publish folder = repo root, no build command,
                      post-processing off.
        404.html      Netlify serves it for any missing path.

    Every page also carries <meta name="referrer"> from tools/seo, so the
    referrer policy holds on a host that ignores _headers.

DEPLOYMENT - Netlify + Namecheap DNS
    1. Netlify > Add new site > Import from Git > this GitHub repo, branch
       main. netlify.toml supplies the settings (publish ".", no build), so
       leave the build fields empty. Every push to main then deploys, and
       every pull request gets a preview URL. (Drag-and-drop of the folder
       also works, but then nothing redeploys on push.)
    2. Netlify > Domain management > Add domain: orvixnet.com, and let it
       add www.orvixnet.com. Keep orvixnet.com (no www) as primary: every
       canonical URL uses it.
    3. DNS, pick one:
         a. Keep DNS at Namecheap (Advanced DNS tab):
              A      @    75.2.60.5
              CNAME  www  <site-name>.netlify.app.
            Delete Namecheap's default parking CNAME / URL-redirect records
            for @ and www first.
         b. Or move DNS to Netlify: Netlify > Domains > Set up Netlify DNS,
            then Namecheap > Domain > Nameservers > Custom DNS and paste the
            four dns*.p0*.nsone.net names Netlify shows. Recreate any mail
            (MX/TXT) records in Netlify first or email to info@orvixnet.com
            stops.
       Check the IP and records against what Netlify's domain screen shows
       at the time; it is the authority.
    4. Netlify > Domain management > HTTPS: wait for the Let's Encrypt
       certificate (minutes to a few hours after DNS resolves), then leave
       "Force HTTPS" on. _headers sends HSTS, so do not serve the site on
       plain http once it is live.
    5. Smoke-test live: /, /ar/, /engagements/assurance-review/,
       /README.txt (must 404), and the response headers (securityheaders.com).

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

        python -m tools.unify           # apply
        python -m tools.unify --check   # report drift, write nothing

    It transplants the nav, drawer and toggle script from
    what-we-do/ai-assurance (and its Arabic twin) onto the engagement and
    industry pages, drops the breadcrumbs those two carried, and strips the
    hero line-art from the photo-hero templates so the hero is photograph
    plus scrim only.

    Nothing is hardcoded: the markup is read from the donor page each run, so
    editing the what-we-do nav and re-running updates all 32 pages. The CSS
    that goes with it (nav, hero spacing matched to what-we-do, pinned nav
    typography) is in assets/css/engagement-nav.css and industry-nav.css.

    Also handled by tools/unify, site-wide rather than per template:
      * nav typography is pinned (in the *-nav.css files). The bar's rule
        uses `font:inherit`, and the engagement stylesheet sets body to weight
        400 where every other template sets 300, so the nav read heavier
        there. It also never reset list padding, which pushed the bar 40px
        right.
      * Leadership is removed from the header nav, the mobile drawer and the
        footer. The page itself is untouched -- same URL, still in the sitemap,
        reached from the "Read bio" card on each leadership portrait.
      * the engagement and industry heroes keep their plain ink background and
        their animated wireframe artwork. An earlier pass stripped that art and
        put a photograph behind them instead; both were reverted. HERO_ART in
        tools/unify/apply.py now lists only the two templates whose hero is a
        photograph (what-we-do and the homepage), where a line-art overlay on
        top of the picture was what had to go.


MOBILE - assets/css/mobile.css, measured with tools/mobile/
        node tools/mobile/audit.mjs 390 en    measure; writes _audit-390.json

    Every rule in mobile.css came from measuring all 108 pages at 320/360/390/
    430px, not from guesswork. It fixes type down to 9.5px, controls down to
    30px (the menu button was 34), contact fields at 15px that made iOS zoom on
    focus, and a handful of rows that overflowed a narrow column.

    Everything except one text-size-adjust line sits inside a max-width query,
    so desktop rendering is untouched. Every page links the one file; edit it
    there.

    Current state, both languages, 320-430px: no page scrolls sideways, nothing
    reaches past the viewport edge, no text under 12px, no control under 44px.
    The audit still reports "silently clipped" for the .wm watermark, .field
    and .sheen layers - those are empty decorative elements bleeding out of an
    overflow:hidden parent by design, and are meant to.
