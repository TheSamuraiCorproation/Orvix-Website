"""Local preview server that behaves like Netlify for the things this site uses.

    python -m tools.serve                              # http://localhost:8080
    python -m tools.serve 9000                         # another port
    python -m tools.serve --admin you@example.com      # also run the blog admin locally

What it adds over `python -m http.server`:
  * a missing path returns 404.html (with status 404), as Netlify does
  * the simple rules in _redirects apply: 301s from old addresses, and the
    forced 404s that hide internal files (README.md, /tools/*, ...)
  * the response headers from _headers are sent, so the Content-Security-Policy
    is exercised locally too

Splat and placeholder rules are not interpreted beyond a trailing /*.
Standard library only.

--admin <email>[,<email>...] runs the blog admin API (/api/...) against the
files on disk, with the same contract and checks as netlify/functions/blog.mjs:
the given emails are the approved list, and sign-in works by link exactly as in
production. The link is emailed through Brevo when .env.local (repo root, never
committed) holds BREVO_API_KEY and MAIL_FROM_EMAIL (optionally MAIL_FROM_NAME);
otherwise it is printed in this terminal. Sessions are signed with a key made fresh each run, so restarting the
server signs everyone out. It only ever listens on 127.0.0.1. Saving a post
writes content/posts/<slug>.json (and images/posts/<slug>.webp), then rebuilds
the article pages so you can open them straight away. Without --admin, /api/
answers 401, as production does for anyone not signed in.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import http.server
import json
import pathlib
import re
import secrets
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlparse
from functools import partial

ROOT = pathlib.Path(__file__).resolve().parents[1]
# the Subscribe page's sector choices (same list as netlify/functions/blog.mjs)
SECTORS = ("Financial services", "Government & public sector", "Energy & utilities",
           "Telecommunications", "Healthcare", "Other")


def local_env() -> dict:
    """KEY=value lines from .env.local (gitignored). Secrets stay on this machine."""
    out = {}
    f = ROOT / ".env.local"
    for line in f.read_text(encoding="utf-8").splitlines() if f.exists() else []:
        k, sep, v = line.partition("=")
        if sep and k.strip() and not k.lstrip().startswith("#"):
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def fill_template(html: str, values: dict) -> str:
    """The email template with its {{ params.X }} slots filled (escaped); the optional
    "also new" block removed; Brevo's own {{ unsubscribe }} / {{ mirror }} left alone."""
    import html as h
    html = re.sub(r"\{%\s*if params\.ALSO_TITLE\s*%\}.*?\{%\s*endif\s*%\}", "", html, flags=re.S)
    # notes in the template that mention {{ }} / {% %} would confuse Brevo; Outlook's <!--[if mso]> stay
    html = re.sub(r"<!--(?!\[if|<!\[endif)(?:(?!-->).)*?(?:\{\{|\{%)(?:(?!-->).)*?-->", "", html, flags=re.S)
    return re.sub(r"\{\{\s*params\.(\w+)\s*\}\}", lambda m: h.escape(str(values.get(m.group(1), ""))), html)


def newsletter_drafts(post: dict) -> dict:
    """Create the newsletter as DRAFT campaigns in Brevo (English and Arabic lists), as
    netlify/functions/blog.mjs does on a first publish. Marketing reviews and sends."""
    env = local_env()
    key, sender, site = env.get("BREVO_API_KEY"), env.get("NEWSLETTER_FROM_EMAIL"), (env.get("SITE_URL") or "").rstrip("/")
    out = {"created": [], "skipped": [], "errors": []}
    lists = {"en": env.get("BREVO_LIST_ID", ""), "ar": env.get("BREVO_LIST_ID_AR", "")}
    for lang, file in (("en", "perspectives-newsletter.html"), ("ar", "perspectives-newsletter-ar.html")):
        title = (post.get("title") or {}).get(lang) or ""
        if not (key and sender and site):
            out["skipped"].append({"lang": lang, "reason": "not configured"}); continue
        if not title or not (post.get("body") or {}).get(lang) or not lists[lang].isdigit():
            out["skipped"].append({"lang": lang, "reason": "no text in this language or no list"}); continue
        summary = (post.get("summary") or {}).get(lang) or (post.get("summary") or {}).get("en") or ""
        cover = post.get("cover") or ""
        values = {"ARTICLE_TITLE": title, "ARTICLE_SUMMARY": summary, "PREHEADER": summary,
                  "ARTICLE_URL": f"{site}{'/ar' if lang == 'ar' else ''}/research/perspectives/{post['slug']}/",
                  "COVER_URL": site + cover if cover.startswith("/") else f"{site}/images/hero-perspectives.jpg",
                  "INTRO": "A new piece from Orvix Perspectives." if lang == "en" else "مقال جديد من وجهات نظر Orvix."}
        html = fill_template((ROOT / "email" / file).read_text(encoding="utf-8"), values)
        body = {"name": f"Perspectives · {title} ({lang.upper()}) · {time.strftime('%Y-%m-%d')}", "subject": title,
                "previewText": summary[:150], "sender": {"name": env.get("NEWSLETTER_FROM_NAME") or "Orvix", "email": sender},
                "replyTo": sender, "htmlContent": html, "recipients": {"listIds": [int(lists[lang])]}, "mirrorActive": True}
        def post_campaign(payload):
            req = urllib.request.Request("https://api.brevo.com/v3/emailCampaigns", data=json.dumps(payload).encode(),
                                         method="POST", headers={"api-key": key, "Content-Type": "application/json",
                                                                 "Accept": "application/json", "User-Agent": "orvix-site/1.0"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read() or b"{}").get("id")
        try:
            try:
                out["created"].append({"lang": lang, "id": post_campaign(body), "list": True})
            except urllib.error.HTTPError as e:
                msg = e.read()[:300].decode("utf-8", "replace")
                if not (e.code == 400 and "no contacts associated" in msg):
                    raise RuntimeError(msg[:200])
                # Brevo won't attach a list it counts as empty: draft it anyway, list picked before sending
                body.pop("recipients")
                out["created"].append({"lang": lang, "id": post_campaign(body), "list": False})
        except urllib.error.HTTPError as e:
            out["errors"].append({"lang": lang, "message": e.read()[:200].decode("utf-8", "replace")})
        except (OSError, RuntimeError) as e:
            out["errors"].append({"lang": lang, "message": str(e)[:200]})
    print(f"  newsletter drafts: {out}", flush=True)
    return out


def login_email_html(site: str, link: str) -> str:
    """The sign-in email as netlify/functions/blog.mjs sends it (loginEmailHtml)."""
    logo = f"{site.rstrip('/')}/images/orvix-logo.png"
    return (
        '<!doctype html><html><body style="margin:0;background:#F2F4F8;font-family:IBM Plex Sans,Arial,Helvetica,sans-serif;color:#03072C">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F2F4F8"><tr><td align="center" style="padding:32px 16px">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden">'
        f'<tr><td style="background:#03072C;padding:22px 28px"><img src="{logo}" width="96" alt="Orvix" style="display:block;width:96px;height:auto;border:0"></td></tr>'
        '<tr><td style="padding:30px 28px 8px"><p style="margin:0 0 6px;font:600 11px/1 IBM Plex Mono,Consolas,monospace;letter-spacing:.14em;color:#064BEE">PERSPECTIVES ADMIN</p>'
        '<h1 style="margin:0 0 14px;font-size:22px;line-height:1.2;font-weight:600">Your sign-in link</h1>'
        '<p style="margin:0 0 22px;font-size:15px;line-height:24px;color:#4A5468">Click the button to open the Orvix Perspectives admin. The link works for 15 minutes and only in this browser session.</p>'
        f'<a href="{link}" style="display:inline-block;background:#48E2E2;color:#03072C;font-weight:600;font-size:15px;text-decoration:none;padding:13px 22px;border-radius:10px">Sign in to the admin</a>'
        f'<p style="margin:22px 0 0;font-size:12px;line-height:19px;color:#8A93A6;word-break:break-all">Or paste this address into your browser:<br><a href="{link}" style="color:#064BEE">{link}</a></p></td></tr>'
        "<tr><td style=\"padding:18px 28px 26px;font-size:12px;line-height:19px;color:#8A93A6;border-top:1px solid #E6EAF2\">If you didn't ask for this, ignore this email. Nobody can sign in without the link.</td></tr>"
        "</table></td></tr></table></body></html>"
    )


def send_signin_email(to: str, link: str) -> bool:
    """Send the sign-in link with Brevo, as production does. False if not configured or it failed."""
    env = local_env()
    key, sender = env.get("BREVO_API_KEY"), env.get("MAIL_FROM_EMAIL")
    if not key or not sender:
        return False
    text = (f"Sign in to the Orvix Perspectives admin: {link}\n\nThis link works for 15 minutes. "
            "If you didn't ask for it, ignore this email.")
    body = {
        "sender": {"email": sender, "name": env.get("MAIL_FROM_NAME") or "Orvix"},
        "to": [{"email": to}],
        "subject": "Your Orvix admin sign-in link",
        "textContent": text,
        "htmlContent": login_email_html(env.get("SITE_URL") or "https://orvixnet.com", link),
    }
    req = urllib.request.Request("https://api.brevo.com/v3/smtp/email", data=json.dumps(body).encode(),
                                 headers={"api-key": key, "Content-Type": "application/json",
                                          "Accept": "application/json", "User-Agent": "orvix-site/1.0"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return 200 <= r.status < 300
    except Exception as e:  # report, never crash the server
        print(f"  Brevo send failed: {getattr(e, 'code', '')} {e}", flush=True)
        return False


def load_redirects() -> list[tuple[str, str, int]]:
    rules = []
    f = ROOT / "_redirects"
    for line in f.read_text(encoding="utf-8").splitlines() if f.exists() else []:
        parts = line.split("#", 1)[0].split()
        if len(parts) >= 3 and parts[2].rstrip("!").isdigit():
            rules.append((parts[0], parts[1], int(parts[2].rstrip("!"))))
    return rules


def load_headers() -> list[tuple[str, list[tuple[str, str]]]]:
    blocks, cur = [], None
    f = ROOT / "_headers"
    for line in f.read_text(encoding="utf-8").splitlines() if f.exists() else []:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line[0].isspace():
            cur = (line.strip(), [])
            blocks.append(cur)
        elif cur and ":" in line:
            k, v = line.strip().split(":", 1)
            cur[1].append((k.strip(), v.strip()))
    return blocks


def matches(pattern: str, path: str) -> bool:
    if pattern.endswith("/*"):
        return path.startswith(pattern[:-1]) or path == pattern[:-2]
    if pattern.endswith("*"):  # e.g. /.env*
        return path.startswith(pattern[:-1])
    return path == pattern


class Handler(http.server.SimpleHTTPRequestHandler):
    redirects = load_redirects()
    headers_rules = load_headers()
    admin_emails: set[str] = set()  # set by --admin; "@domain" entries allow the whole domain

    @classmethod
    def is_admin(cls, email: str) -> bool:
        return "@" in email and (email in cls.admin_emails or email[email.rfind("@"):] in cls.admin_emails)
    secret = secrets.token_bytes(32)  # signs local login links and sessions
    COOKIE = "orvix_admin"  # production uses __Host-orvix_admin (needs https)

    # ---- tokens: same shape as production (HS256, typ login | session) -------

    @classmethod
    def sign(cls, payload: dict) -> str:
        b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
        head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        body = b64(json.dumps(payload).encode())
        sig = b64(hmac.new(cls.secret, f"{head}.{body}".encode(), hashlib.sha256).digest())
        return f"{head}.{body}.{sig}"

    @classmethod
    def claims(cls, token: str) -> dict | None:
        try:
            body = token.split(".")[1]
            return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        except Exception:
            return None

    @classmethod
    def verify(cls, token: str, typ: str) -> str | None:
        try:
            head, body, sig = token.split(".")
            want = base64.urlsafe_b64encode(
                hmac.new(cls.secret, f"{head}.{body}".encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
            if not hmac.compare_digest(want, sig):
                return None
            pad = lambda x: x + "=" * (-len(x) % 4)
            if json.loads(base64.urlsafe_b64decode(pad(head))).get("alg") != "HS256":
                return None
            data = json.loads(base64.urlsafe_b64decode(pad(body)))
        except (ValueError, TypeError):
            return None
        email = (data.get("email") or "").lower()
        if data.get("typ") != typ or data.get("exp", 0) < time.time() or not cls.is_admin(email):
            return None
        return email

    def session_email(self) -> str | None:
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == self.COOKIE and v:
                return self.verify(v, "session")
        return None

    def redirect(self, location: str, cookie: str | None = None) -> bool:
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Length", "0")
        self.end_headers()
        return True

    # ---- blog admin API (local) -------------------------------------------

    def api_reply(self, code: int, obj: dict, cookie: str | None = None) -> bool:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return True

    def api(self) -> bool:
        path = self.path.split("?", 1)[0]
        if not (path == "/api" or path.startswith("/api/")):
            return False
        if path == "/api/subscribe":
            return self.subscribe()
        if not self.admin_emails:
            return self.api_reply(401, {"error": "Not signed in"})
        from tools.blog import posts
        parts = [x for x in path.split("/")[2:] if x]
        method = self.command
        if method in ("POST", "PUT", "DELETE"):  # same CSRF rules as production
            ctype = self.headers.get("Content-Type", "")
            origin = self.headers.get("Origin")
            host = "http://" + self.headers.get("Host", "")
            if (self.headers.get("X-Orvix-Admin") != "1" or not ctype.startswith("application/json")
                    or (origin and origin != host)):
                return self.api_reply(403, {"error": "Request refused"})

        # sign-in by link: the link is printed here instead of emailed
        if parts == ["login"] and method == "POST":
            length = min(int(self.headers.get("Content-Length") or 0), 10_000)
            try:
                email = (json.loads(self.rfile.read(length) or b"{}").get("email") or "").strip().lower()
            except ValueError:
                email = ""
            # the link only works in the browser that asked (same rule as production)
            bind = secrets.token_urlsafe(16)
            if self.is_admin(email):
                token = self.sign({"typ": "login", "email": email, "iat": int(time.time()),
                                   "exp": int(time.time()) + 15 * 60, "nonce": secrets.token_urlsafe(16),
                                   "bind": hashlib.sha256(bind.encode()).hexdigest()})
                link = f"http://{self.headers.get('Host', '127.0.0.1')}/api/login/verify?token={token}"
                sent = send_signin_email(email, link)
                # locally the link is always printed too, so a held or slow email never locks you out
                note = " - also emailed via Brevo" if sent else ""
                print(f"\n  sign-in link for {email} (valid 15 minutes){note}:\n  {link}\n", flush=True)
            return self.api_reply(200, {"ok": True}, f"orvix_login={bind}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900")
        if parts == ["login", "verify"] and method == "GET":
            token = parse_qs(urlparse(self.path).query).get("token", [""])[0]
            email = self.verify(token, "login")
            if not email:
                return self.redirect("/admin/?signin=expired")
            cookies = dict(p.strip().split("=", 1) for p in self.headers.get("Cookie", "").split(";") if "=" in p)
            want = (self.claims(token) or {}).get("bind", "")
            have = hashlib.sha256(cookies.get("orvix_login", "").encode()).hexdigest()
            if not want or not hmac.compare_digest(want, have):
                return self.redirect("/admin/?signin=browser")
            session = self.sign({"typ": "session", "email": email, "iat": int(time.time()),
                                 "exp": int(time.time()) + 8 * 3600})
            return self.redirect("/admin/", f"{self.COOKIE}={session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800")
        if parts == ["logout"] and method == "POST":
            self.send_response(200)
            body = b'{"ok": true}'
            self.send_header("Content-Type", "application/json")
            self.send_header("Set-Cookie", f"{self.COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return True

        editor = self.session_email()
        if not editor:
            return self.api_reply(401, {"error": "Not signed in"})
        if parts == ["me"] and method == "GET":
            return self.api_reply(200, {"email": editor})
        if not parts or parts[0] != "posts" or len(parts) > 2:
            return self.api_reply(404, {"error": "Not found"})
        if len(parts) == 1:
            if method != "GET":
                return self.api_reply(405, {"error": "Method not allowed"})
            items = sorted(posts.all_posts(), key=lambda p: p.get("updated", ""), reverse=True)
            keys = ("slug", "status", "published", "updated", "title", "summary", "cover")
            return self.api_reply(200, {"posts": [{k: p.get(k) for k in keys} for p in items]})
        slug = parts[1]
        if not posts.valid_slug(slug):
            return self.api_reply(400, {"error": "That web address is not valid."})
        existing = posts.load(slug)
        if method == "GET":
            return self.api_reply(200, existing) if existing else self.api_reply(404, {"error": "Not found"})
        if method == "DELETE":
            if not existing:
                return self.api_reply(404, {"error": "Not found"})
            (posts.POSTS / f"{slug}.json").unlink()
            cover = posts.COVERS / f"{slug}.webp"
            if cover.exists():
                cover.unlink()
            self.rebuild()
            return self.api_reply(200, {"ok": True})
        if method != "PUT":
            return self.api_reply(405, {"error": "Method not allowed"})
        length = int(self.headers.get("Content-Length") or 0)
        if length > 6 * 1024 * 1024:
            return self.api_reply(413, {"error": "That upload is too large."})
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            post = posts.clean(payload.get("post") or {}, slug, existing)
            up = payload.get("cover_upload")
            if up:
                data = base64.b64decode(up.get("data") or "", validate=True)
                if up.get("type") != "image/webp" or not posts.is_webp(data) or len(data) > 3 * 1024 * 1024:
                    raise posts.PostError("The cover must be a WebP image under 3 MB.")
                posts.COVERS.mkdir(parents=True, exist_ok=True)
                (posts.COVERS / f"{slug}.webp").write_bytes(data)
                post["cover"] = f"/images/posts/{slug}.webp"
        except posts.PostError as e:
            return self.api_reply(400, {"error": str(e)})
        except (ValueError, TypeError):
            return self.api_reply(400, {"error": "The request could not be read."})
        posts.save(post)
        self.rebuild()
        reply = {"ok": True, "post": post, "url": f"/research/perspectives/{slug}/"}
        if post.get("status") == "published" and (not existing or existing.get("status") != "published"):
            reply["newsletter"] = newsletter_drafts(post)  # first publish: drafts in Brevo, never sent
        return self.api_reply(200, reply)

    def subscribe(self) -> bool:
        """The public newsletter form, as netlify/functions/blog.mjs handles it (no throttle locally).

        Adds the address to the Brevo list in .env.local (BREVO_LIST_ID), so a local
        test signs up for real; use your own address.
        """
        if self.command != "POST":
            return self.api_reply(405, {"error": "Method not allowed"})
        origin = self.headers.get("Origin")
        if (self.headers.get("X-Orvix-Form") != "1"
                or not self.headers.get("Content-Type", "").startswith("application/json")
                or (origin and origin != "http://" + self.headers.get("Host", ""))):
            return self.api_reply(403, {"error": "Request refused"})
        env = local_env()
        key, list_id, doi = env.get("BREVO_API_KEY"), env.get("BREVO_LIST_ID", ""), env.get("BREVO_DOI_TEMPLATE_ID", "")
        if not key or not list_id.isdigit():
            return self.api_reply(503, {"error": "Subscriptions are not available right now."})
        try:
            b = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 10_000)) or b"{}")
        except ValueError:
            b = {}
        if not isinstance(b, dict):
            b = {}
        if str(b.get("company") or "").strip():
            return self.api_reply(200, {"ok": True})  # honeypot
        email = str(b.get("email") or "").strip().lower()
        if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]{2,}", email):
            return self.api_reply(400, {"error": "Please enter a valid email address."})
        lang = "ar" if b.get("lang") == "ar" else "en"
        if lang == "ar" and env.get("BREVO_LIST_ID_AR", "").isdigit():
            list_id = env["BREVO_LIST_ID_AR"]  # Arabic subscribers get the Arabic emails
        attrs = {"LANGUAGE": lang}
        if b.get("sector") in SECTORS:
            attrs["SECTOR"] = b["sector"]
        if doi.isdigit():
            url = "https://api.brevo.com/v3/contacts/doubleOptinConfirmation"
            host = "http://" + self.headers.get("Host", "127.0.0.1")
            payload = {"email": email, "includeListIds": [int(list_id)], "templateId": int(doi), "attributes": attrs,
                       "redirectionUrl": f"{host}{'/ar' if lang == 'ar' else ''}/research/subscribe/?confirmed=1"}
        else:
            url = "https://api.brevo.com/v3/contacts"
            payload = {"email": email, "listIds": [int(list_id)], "updateEnabled": True, "attributes": attrs}
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST", headers={
            "api-key": key, "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "orvix-site/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=15):
                pass
        except urllib.error.HTTPError as e:
            detail = e.read()[:300].decode("utf-8", "replace")
            if not doi.isdigit() and e.code == 400 and '"duplicate_parameter"' in detail:  # already on file
                return self.api_reply(200, {"ok": True, "confirm": False})
            print(f"  Brevo subscribe failed ({e.code}): {detail}", flush=True)
            return self.api_reply(502, {"error": "We could not add you right now. Please try again later."})
        except OSError as e:
            print(f"  Brevo subscribe failed: {e}", flush=True)
            return self.api_reply(502, {"error": "We could not add you right now. Please try again later."})
        print(f"  newsletter: {email} added to Brevo list {list_id}", flush=True)
        return self.api_reply(200, {"ok": True, "confirm": doi.isdigit()})

    def rebuild(self):
        """Regenerate article pages and give them their SEO head, as a deploy would."""
        from tools.blog import build as blog
        from tools.seo import apply as seo_apply, pages as seo_pages
        blog.build()
        seo_pages._add_posts()
        for lang in ("en", "ar"):
            seo_apply.process(ROOT, blog.LISTING[lang])
        for d in blog.generated_dirs():
            seo_apply.process(ROOT, (d / "index.html").relative_to(ROOT).as_posix())

    def end_headers(self):
        path = self.path.split("?", 1)[0]
        cached = path.startswith("/api/")
        for pattern, pairs in self.headers_rules:
            if matches(pattern, path):
                for k, v in pairs:
                    cached = cached or k.lower() == "cache-control"
                    if k.lower() == "strict-transport-security":
                        continue  # never pin HSTS on localhost
                    if k.lower() == "content-security-policy":
                        v = v.replace("upgrade-insecure-requests", "").strip("; ")
                    self.send_header(k, v)
        if not cached:
            # local preview: always re-check files, so an edit shows on the next reload
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_404_page(self):
        body = (ROOT / "404.html").read_bytes()
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def route(self) -> bool:
        path = self.path.split("?", 1)[0]
        for src, dst, code in self.redirects:
            if matches(src, path):
                if code == 404:
                    self.send_404_page()
                    return True
                if code in (301, 302):
                    self.send_response(code)
                    self.send_header("Location", dst)
                    self.end_headers()
                    return True
        fs = pathlib.Path(self.translate_path(path))
        if fs.is_dir() and not path.endswith("/"):
            return False  # let the base class add the trailing slash
        if not (fs.is_file() or (fs.is_dir() and (fs / "index.html").is_file())):
            self.send_404_page()
            return True
        return False

    def do_GET(self):
        if not self.api() and not self.route():
            super().do_GET()

    def do_HEAD(self):
        if not self.api() and not self.route():
            super().do_HEAD()

    def do_PUT(self):
        if not self.api():
            self.send_404_page()

    def do_POST(self):
        if not self.api():
            self.send_404_page()

    def do_DELETE(self):
        if not self.api():
            self.send_404_page()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s  %s\n" % (self.log_date_time_string(), fmt % args))


def main(argv: list[str]) -> int:
    args = argv[1:]
    if "--admin" in args:
        i = args.index("--admin")
        emails = {e.strip().lower() for e in (args[i + 1] if i + 1 < len(args) else "").split(",") if e.strip()}
        if not emails or any("@" not in e for e in emails):
            print("--admin needs the editors' emails, e.g. --admin you@example.com,colleague@example.com")
            return 2
        Handler.admin_emails = emails
        del args[i:i + 2]
        sys.path.insert(0, str(ROOT))
    port = int(args[0]) if args else 8080
    handler = partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as srv:
        print(f"serving {ROOT} at http://localhost:{port}  (Ctrl+C to stop)")
        if Handler.admin_emails:
            print(f"blog admin at http://localhost:{port}/admin/  (approved: {', '.join(sorted(Handler.admin_emails))};"
                  " sign-in links print here)")
        srv.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
