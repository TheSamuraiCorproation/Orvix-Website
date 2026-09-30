"""Local preview server that behaves like Netlify for the things this site uses.

    python -m tools.serve            # http://localhost:8080
    python -m tools.serve 9000       # another port

What it adds over `python -m http.server`:
  * a missing path returns 404.html (with status 404), as Netlify does
  * the simple rules in _redirects apply: 301s from old addresses, and the
    forced 404s that hide internal files (README.md, /tools/*, ...)
  * the response headers from _headers are sent, so the Content-Security-Policy
    is exercised locally too

Splat and placeholder rules are not interpreted beyond a trailing /*.
Standard library only.
"""

from __future__ import annotations

import http.server
import pathlib
import sys
from functools import partial

ROOT = pathlib.Path(__file__).resolve().parents[1]


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
    return path == pattern


class Handler(http.server.SimpleHTTPRequestHandler):
    redirects = load_redirects()
    headers_rules = load_headers()

    def end_headers(self):
        path = self.path.split("?", 1)[0]
        for pattern, pairs in self.headers_rules:
            if matches(pattern, path):
                for k, v in pairs:
                    if k.lower() == "strict-transport-security":
                        continue  # never pin HSTS on localhost
                    if k.lower() == "content-security-policy":
                        v = v.replace("upgrade-insecure-requests", "").strip("; ")
                    self.send_header(k, v)
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
        if not self.route():
            super().do_GET()

    def do_HEAD(self):
        if not self.route():
            super().do_HEAD()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s  %s\n" % (self.log_date_time_string(), fmt % args))


def main(argv: list[str]) -> int:
    port = int(argv[1]) if len(argv) > 1 else 8080
    handler = partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as srv:
        print(f"serving {ROOT} at http://localhost:{port}  (Ctrl+C to stop)")
        srv.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
