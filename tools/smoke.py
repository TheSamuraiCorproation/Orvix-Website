"""Post-deploy smoke test: run it against a live address and read the verdict.

    python -m tools.smoke https://something.netlify.app
    python -m tools.smoke https://orvixnet.com

It checks that the pages people land on answer, that the clean-URL redirects
and the forced 404s work, that the security headers are on, that the admin and
the API are reachable but locked, and that the public subscribe endpoint has
its guards up. It never signs in, never posts, never subscribes anybody.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

PAGES = [
    "/", "/ar/", "/what-we-do/ai-assurance/", "/ar/what-we-do/ai-assurance/",
    "/engagements/assurance-review/", "/industries/financial-services/",
    "/research/perspectives/", "/research/subscribe/", "/company/contact/",
    "/ar/company/contact/", "/admin/", "/sitemap.xml", "/robots.txt",
]
REDIRECTS = {  # old address -> where it must land
    "/research/assurance-index/": "/research/maturity-model/",
    "/research/case-studies/telecom/": "/research/case-studies/",
    "/industries/financial-services/financial-services.html": "/industries/financial-services/",
}
GONE = ["/content/posts/", "/netlify/functions/blog.mjs", "/.env.local", "/.env", "/no-such-page/"]


def get(base: str, path: str, method: str = "GET", body: bytes | None = None, headers: dict | None = None):
    req = urllib.request.Request(base + path, data=body, method=method, headers=headers or {})
    req.add_header("User-Agent", "orvix-smoke/1.0")

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=20) as r:
            return r.status, dict(r.headers), r.read(200_000)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(200_000)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    base = argv[1].rstrip("/")
    ok = True

    def check(label: str, cond: bool, detail: str = ""):
        nonlocal ok
        ok &= cond
        print(f"  {'PASS' if cond else 'FAIL'}  {label}{(': ' + detail) if detail else ''}")

    print(f"smoke test against {base}\n")
    print("pages")
    for p in PAGES:
        st, h, body = get(base, p)
        check(p, st == 200, f"status {st}")
        if p == "/":
            check("home has the newsletter form", b'data-subscribe' in body)
            check("home carries CSP", "Content-Security-Policy" in h)
            if not base.startswith("http://localhost") and not base.startswith("http://127."):
                check("home carries HSTS", "Strict-Transport-Security" in h)
            check("home blocks framing", h.get("X-Frame-Options", "").upper() == "DENY")
        if p == "/admin/":
            csp = h.get("Content-Security-Policy", "")
            script = next((d.strip() for d in csp.split(";") if d.strip().startswith("script-src")), "")
            check("admin CSP allows no inline scripts", script == "script-src 'self'", script or "no script-src")
            check("admin is no-store", "no-store" in h.get("Cache-Control", ""))
            check("admin is noindex", "noindex" in h.get("X-Robots-Tag", ""))

    print("\nredirects")
    for src, dst in REDIRECTS.items():
        st, h, _ = get(base, src)
        loc = h.get("Location", "")
        check(f"{src} -> {dst}", st in (301, 302, 308) and loc.endswith(dst), f"status {st}, Location {loc or '-'}")

    print("\nforced 404s")
    for p in GONE:
        st, _, _ = get(base, p)
        check(p, st == 404, f"status {st}")

    print("\napi")
    st, h, body = get(base, "/api/me")
    check("/api/me without a session is 401", st == 401, f"status {st}")
    check("/api/* is no-store", "no-store" in h.get("Cache-Control", ""))
    st, _, body = get(base, "/api/posts")
    check("/api/posts without a session is 401", st == 401, f"status {st}")
    st, _, body = get(base, "/api/subscribe", "POST", b'{"email":"a@b.co"}', {"Content-Type": "application/json"})
    check("subscribe without the form header is refused", st == 403, f"status {st}")
    st, _, body = get(base, "/api/subscribe", "POST", b'{"email":"a@b.co"}',
                      {"Content-Type": "application/json", "X-Orvix-Form": "1", "Origin": "https://evil.example"})
    check("subscribe from another site is refused", st == 403, f"status {st}")
    st, _, body = get(base, "/api/subscribe", "POST", b'{"email":"bot@x.co","company":"spam"}',
                      {"Content-Type": "application/json", "X-Orvix-Form": "1", "Origin": base})
    check("honeypot swallows bots quietly (200, nothing sent)", st == 200, f"status {st}")
    st, _, body = get(base, "/api/login", "POST", b'{"email":"nobody@example.com"}',
                      {"Content-Type": "application/json", "X-Orvix-Admin": "1", "Origin": base})
    try:
        same = json.loads(body or b"{}") == {"ok": True}
    except ValueError:
        same = False
    check("login gives the same answer for an unknown email (no enumeration)", st == 200 and same, f"status {st}")

    print("\nRESULT:", "all good" if ok else "something failed, see above")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
