# Orvix website

The marketing site for Orvix: 54 English pages plus their Arabic twins under `ar/`, served at **orvixnet.com**.

It's plain HTML, CSS and JavaScript. There's no framework and no build step: the repository root *is* the site, and Netlify serves it as is.

> **Status (30 Sept 2026):** the technical cleanup is done (shared styles, clean URLs, SEO, speed, Arabic RTL, all screen sizes). The visual redesign hasn't started. The live domain still points at the previous vendor's hosting until access is handed over. See [What's still open](#whats-still-open).

---

## Quick start

```bash
python -m tools.serve             # from the repo root, then open http://localhost:8080
```

`tools/serve.py` behaves like Netlify for what this site uses. A missing address shows `404.html`, the 301s and forced 404s in `_redirects` apply, and the headers in `_headers` (including the security policy) are sent. It needs only the standard library.

Use a server, not a double-click. Links are directory URLs (`../about/`) and photo paths are root-relative (`/images/…`). A server resolves both; `file://` resolves neither. The plain `python -m http.server` also works, but it shows Python's own error page for missing addresses and ignores `_redirects` and `_headers`.

## Checks before every release

GitHub Actions runs all of these on every push and pull request to `main` (`.github/workflows/checks.yml`). They need Python 3.10+ and nothing else.

| Command | Fails when |
|---|---|
| `python -m tools.seo validate` | a title, description, canonical, hreflang, schema or robots rule is broken |
| `python -m tools.linkcheck` | an internal link, asset or `#anchor` is missing, or a hero preload doesn't match the hero photo |
| `python -m tools.images --check` | a page references a `.jpg` that has a `.webp` copy |
| `python -m tools.nav --check` | nav markup or the `nav.js` tag has drifted |
| `python -m tools.boundary --check` | the Boundary band's script or stylesheet link has drifted |
| `python -m tools.insights --check` | the Perspectives / Briefings / Evaluations listings are out of date |
| `python -m tools.unify --check` | engagement or industry nav markup differs from the What-we-do template |

Each tool without `--check` applies its fix. They are all idempotent: running one twice changes nothing.

---

## Site map

| Path | Pages |
|---|---|
| `index.html` | Home |
| `what-we-do/<pillar>/` | 4 pillar pages |
| `what-we-do/<pillar>/<service>/` | 12 service pages |
| `engagements/<slug>/` | 8 fixed-scope engagements |
| `industries/<sector>/` | 8 industry pages |
| `research/…` | Maturity model, readiness self-assessment, Assurance Index, case studies (index + 3), research by sector (4), listings (perspectives, sector briefings, technology evaluations, subscribe) |
| `company/…` | About, Leadership, Careers, Contact, Events, Partners |
| `ar/…` | The Arabic twin of every page above, in the same folder shape |
| `404.html` | Served by Netlify for any missing path |

"What we do", "Engagements", "Industries" and "Research" in the nav are menus with no landing page of their own.

## URLs and links

- **One address per page.** Every page is `<folder>/index.html`, served at its directory URL (`/engagements/assurance-review/`).
- **Internal links** are relative and in the same directory form, exactly the URL the canonical, sitemap and hreflang tags declare. Never link to `…/index.html`: it works, but it gives the page a second address.
- **Old addresses.** Engagement and industry pages used to live at `engagement/<Folder>/<Folder>.html` and `industries/<x>/<x>.html`. `_redirects` sends those to the new URLs with a 301. If a page ever moves again, add its old address there.

## Styles: `assets/css/`

Every page links the shared stylesheets for its template. The only CSS left inside a page is its photo variables and, on a handful of pages, a few rules no other page uses. **To change the look, edit these files, never a page.**

| File | Used by |
|---|---|
| `main.css` | Home, What we do, Research, Company: brand tokens, layout, components |
| `company.css` | Company pages (after `main.css`) |
| `engagement.css` / `industry.css` | Engagement pages / industry pages |
| `engagement-nav.css` / `industry-nav.css` | Nav and hero geometry that match those templates to What we do |
| `glow.css` | The glow ring on the "Talk to our team" button |
| `mobile.css` | Phone refinements, every page |
| `nav-panel.css` | Menu panels scroll inside a short window |
| `boundary.css` | The Boundary band on What we do pages |
| `fonts.css` | Self-hosted IBM Plex (generated, see [Fonts](#fonts)) |
| `../rtl.css` | Every right-to-left rule; Arabic pages only |

**Order matters.** It's the order the rules had when they were inline: fonts, then the template stylesheet(s), then the page's own `<style>`, then `mobile.css`, the `*-nav.css` file, `nav-panel.css`, `boundary.css`, and on Arabic pages `rtl.css` last.

The nav rules exist three times: in `main.css`, `engagement-nav.css` and `industry-nav.css`. A change to the nav bar goes in all three.

## Photos

- **Where they're set.** Each page sets its photos as CSS variables (`--ph-*`, `--pg-*`) in a small `:root` block in its `<head>`. Cards use `style="--img:url(…)"`.
- **Always root-relative:** `url('/images/x.webp')`. A relative `url()` inside a CSS variable resolves from the stylesheet that uses it (`assets/css/`), not from the page, so a relative path silently breaks.
- **`images/*.jpg` are the masters.** Pages use the `.webp` copies, which are about 25% smaller. To add a photo, drop the JPEG in, reference it by its `.jpg` name, then run `python -m tools.images` to make the `.webp` and switch references. This needs `pip install pillow`.
- **Hero first.** Pages with a hero photo carry a `<link rel="preload" as="image">` for it. Change the hero and the preload together; `tools.linkcheck` fails if they disagree.
- **Lower photos wait** for the first scroll, tap or key press, or 2.5 s after load. See "photo deferral" in `main.css`. With JavaScript off, they load normally.
- **Leadership portraits** load `images/leader-<name>.jpg` if it exists, and show a "to commission" placeholder if not. They were removed at the client's request; saving the new portraits under those names brings them back with no code change.
- Provenance and licences: `images/CREDITS.txt`.

## Fonts

IBM Plex (SIL Open Font License) is self-hosted in `assets/fonts/`, and `assets/css/fonts.css` is generated by `python -m tools.fonts` (needs `pip install fonttools brotli`). Each family has a size-matched local fallback, so text doesn't jump when the web font arrives. English pages never load the Arabic font.

## JavaScript

| File | What it does |
|---|---|
| `assets/nav.js` | Menus open on click or tap, and on hover for mouse users; the burger drawer below 1120px; Escape and click-outside close them; marks photo slots that have a picture so their placeholder hides |
| `assets/reveal.js` | Blocks with `class="rv"` fade up the first time they scroll into view. Hidden only once `<html>` has `.js`, so everything is visible without JavaScript; no movement under `prefers-reduced-motion` |
| `assets/boundary.js` | The three-move Boundary selector on What we do pages: steps every 5 s while on screen, pauses on hover or focus |

Pages also carry small inline scripts for their own interactive pieces (maturity stepper, readiness self-assessment, engagement self-checks).

---

## Blog: Perspectives articles and the admin

Staff write articles at **`/admin/`**. Each published post becomes a page at `/research/perspectives/<slug>/`, with an Arabic twin at `/ar/research/perspectives/<slug>/` when it has Arabic, and a row at the top of the Perspectives list.

| Piece | Where |
|---|---|
| Dashboard (list, editor, cover upload, live preview, draft / publish) | `admin/` (static; no inline scripts, never cached or indexed) |
| API, production | `netlify/functions/blog.mjs`, behind `/api/*`. Signs editors in by emailed link, checks the session and the email against `ADMIN_EMAILS` on every request, then commits the post to GitHub |
| Posts | `content/posts/<slug>.json`, covers in `images/posts/<slug>.webp`. Never served as files (forced 404 in `_redirects`, drafts included) |
| Pages | Generated on every deploy by `python -m tools.blog`, then `python -m tools.seo build` adds the SEO head, Article schema and sitemap entry. Generated pages are not committed (`.gitignore`) |
| Text format | A small, safe markdown subset (`tools/blog/markdown.py`; the admin preview mirrors it). Everything is escaped, so a post cannot contain HTML or scripts |

**Security layers:**

1. **Sign-in by emailed link.** An editor types their email. If it's in `ADMIN_EMAILS`, they get a link (sent through Brevo) that works for 15 minutes. The response is identical for any email, so nobody can test which addresses are editors.
2. **Session cookie.** The link sets an 8-hour signed session (HS256 with `SESSION_SECRET`) in an `HttpOnly; Secure; SameSite=Strict` cookie that page scripts can't read and other sites can't send.
3. **Checked on every request.** Every API call re-checks the session and that the email is still on the list. Removing someone and redeploying locks them out at once, and the function fails closed if anything isn't configured.
4. **Saves are protected** against cross-site forgery (a custom header, plus an origin check).
5. **Uploads are size-checked** and must be real WebP files.
6. **The GitHub token** can only write this repository's contents.

**Try it locally.** Sign-in links print in the terminal instead of being emailed. Posts are written to `content/posts/`, and the pages rebuild on save:

```bash
python -m tools.serve --admin you@example.com,colleague@example.com   # then open http://localhost:8080/admin/
python -m tools.blog clean                                             # remove generated pages before committing by hand
```

**Production setup** (once, after hosting is on Orvix's own Netlify):

1. **Brevo:** create an API key, and verify the sending domain by adding Brevo's SPF and DKIM records in Namecheap, so sign-in emails don't land in spam.
2. **Set the Netlify environment variables:**
   - `SESSION_SECRET`: 32+ random characters. Generate it with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Rotating it signs everyone out.
   - `ADMIN_EMAILS`: the editors, comma-separated, any domain
   - `SITE_URL`: `https://orvixnet.com`
   - `BREVO_API_KEY` and `MAIL_FROM_EMAIL` (a verified sender), plus optionally `MAIL_FROM_NAME`
   - `GITHUB_TOKEN` (fine-grained: this repo, Contents read and write) and `GITHUB_REPO`
   - optionally `GITHUB_BRANCH` and `BLOG_COMMIT_EMAIL`

Function tests: `node --test "netlify/functions/*.test.mjs"`.

## Arabic (`ar/`)

- **Structure.** Each Arabic page is the twin of its English page, and the language link in the header points between them. `<html lang="ar" dir="rtl">` on every Arabic page.
- **Translation source:** `assets/ar-dictionary.json` maps each English string to its Arabic, with matching on normalised whitespace. Terminology is held consistent: estate = المنظومة, assurance = الضمان, evidence = الأدلة, control = الضابط.
- **Right-to-left:** `assets/rtl.css`. Every box lays out right to left. Each run of text works out its own reading direction (`unicode-bidi: plaintext`), so an English phrase keeps its punctuation, and it takes its alignment from its column. Mirrored components (scrims, FAQ markers, accent bars, arrows, steppers) are listed in the file. The coverage map on About stays left to right on purpose.
- ⚠️ **The Arabic has not been reviewed by a native speaker.** It needs a read by someone who knows the regulatory vocabulary before launch.

## SEO: `tools/seo/`

- **Titles, descriptions and robots** live in `tools/seo/pages.py`. Each page's SEO head sits between `seo:begin` / `seo:end` markers and is regenerated by `python -m tools.seo build`, so edit `pages.py`, never the page.
- **Headings.** Each hero's small label sits inside its `<h1>`, so the heading carries the page topic for search while looking the same.
- **Held back on purpose:** the Organization schema (waiting on the registered address), and noindex on the Assurance Index, the unreleased case studies and the empty listing pages. Each reason is in `pages.py`. Details: `tools/seo/README.md`.

## Other tools

| Tool | Purpose |
|---|---|
| `tools/nav` | Keeps nav markup, the `nav.js` tag and footer links consistent across pages |
| `tools/unify` | Copies the nav and drawer markup from What we do onto engagement and industry pages |
| `tools/insights` | Renders the Perspectives / Briefings / Evaluations listings from `tools/insights/articles.py`. Add a piece's URL next to its title and the row becomes a link |
| `tools/boundary` | Keeps the Boundary band's script tag and stylesheet link on its 32 pages |
| `tools/serve.py` | Local preview server that behaves like Netlify (404 page, redirects, headers) |
| `tools/mobile/*.mjs` | Measurement scripts (Playwright) behind the rules in `mobile.css` |

---

## Hosting and deployment (Netlify + Namecheap)

Netlify reads these files from the repo root on every deploy:

| File | Role |
|---|---|
| `netlify.toml` | Publish folder is the repo root, no build command, post-processing off |
| `_headers` | Security headers (CSP, HSTS, frame, referrer, permissions) and caching. The CSP allows this origin plus the Calendly embed on Contact. Images are cached for a week; HTML, CSS and JS revalidate on every visit so pages and stylesheets always match |
| `_redirects` | 301s from old page addresses; forced 404 for internal files (`/tools/*`, `README.md`, `BUILD_NOTES.txt`, `images/CREDITS.txt`, `assets/ar-dictionary.json`, `netlify.toml`, `/.github/*`) |

**To deploy:**

1. **Connect the repo.** Netlify → Add new site → Import from Git → this repository, branch `main`. Leave the build fields empty. Every push to `main` then deploys, and every pull request gets a preview URL.
2. **Add the domain.** Netlify → Domain management → add `orvixnet.com` (and `www`). Keep `orvixnet.com` without www as primary, since every canonical URL uses it.
3. **Point DNS** at Netlify, either way:
   - **Keep DNS at Namecheap** (Advanced DNS): `A @ 75.2.60.5` and `CNAME www <site>.netlify.app.`. Remove Namecheap's parking records first.
   - **Or move DNS to Netlify** and set Namecheap's nameservers to the four Netlify shows. Recreate MX/TXT records first, or email to `@orvixnet.com` stops.

   Netlify's domain screen is the authority for the exact values.
4. **Turn on HTTPS.** Wait for the certificate, then keep **Force HTTPS** on. `_headers` sends HSTS.
5. **Smoke-test** `/`, `/ar/`, `/engagements/assurance-review/`, an old URL (it should 301), and `/README.md` (it should 404).

---

## What's still open

**Access (from the previous vendor):** a working Namecheap login, hosting, the Git repository and the Supabase project.

**Sign-off and content:**

- Fee bands on 16 service pages (`[FEE BAND — pending sign-off]`)
- Permission for the Graphiant and Expel names and logos on Partners
- Saudi regulatory review
- Four leadership portraits
- Careers and Events (still sample content)
- Case-study approvals and the Assurance Index date
- The LinkedIn URL
- The Calendly event link
- A mailing provider for Subscribe (and a CSP update for it, unless it's Netlify Forms)

`BUILD_NOTES.txt` has the original pre-publishing notes.

**Planned:** the visual phase (starting with the 404 page, large-screen layout, sharper photos, photos for engagement pages) and a secure rebuild of the articles dashboard. The previous vendor's version had open sign-up and was never production-ready, so it wasn't merged.
