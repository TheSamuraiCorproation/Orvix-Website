"""Blog posts on disk: content/posts/<slug>.json, cover at images/posts/<slug>.webp.

The admin API (netlify/functions/blog.mjs in production, tools/serve.py --admin
locally) writes these files; tools/blog/build.py turns them into pages. The
field rules here are the same ones the API enforces.
"""

from __future__ import annotations

import datetime
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
POSTS = ROOT / "content" / "posts"
COVERS = ROOT / "images" / "posts"

SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
LIMITS = {"title": 120, "summary": 300, "body": 50000, "cover_alt": 200, "author": 80}
LANGS = ("en", "ar")


class PostError(ValueError):
    """A message an editor can act on."""


def valid_slug(slug: str) -> bool:
    return bool(slug) and len(slug) <= 80 and bool(SLUG.match(slug))


def _text(v, limit: int, field: str) -> str:
    s = (v if isinstance(v, str) else "").strip()
    if len(s) > limit:
        raise PostError(f"{field} is too long ({len(s)} characters, the limit is {limit}).")
    return s


def clean(raw: dict, slug: str, existing: dict | None = None) -> dict:
    """Allowlisted, trimmed, size-checked post. Server-owned fields are set here."""
    if not valid_slug(slug):
        raise PostError("The web address (slug) may use only lowercase letters, numbers and single hyphens.")
    if raw.get("slug", slug) != slug:
        raise PostError("The web address in the post does not match the one being saved.")
    status = raw.get("status")
    if status not in ("draft", "published"):
        raise PostError("Status must be draft or published.")

    def pair(field: str) -> dict:
        src = raw.get(field) if isinstance(raw.get(field), dict) else {}
        return {lang: _text(src.get(lang), LIMITS[field], f"{field.replace('_', ' ').capitalize()} ({lang})")
                for lang in LANGS}

    post = {
        "slug": slug,
        "status": status,
        "published": (existing or {}).get("published"),
        "updated": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "author": _text(raw.get("author"), LIMITS["author"], "Author") or "Orvix",
        "title": pair("title"),
        "summary": pair("summary"),
        "body": pair("body"),
        # kept from the stored post; never a client-chosen path. cover: "" from
        # the admin means the editor removed it (a new upload overrides later).
        "cover": "" if raw.get("cover") == "" else (existing or {}).get("cover", ""),
        "cover_alt": pair("cover_alt"),
    }
    if not post["title"]["en"]:
        raise PostError("Add an English title first.")
    if status == "published":
        missing = [f for f in ("title", "summary", "body") if not post[f]["en"]]
        if missing:
            raise PostError("To publish, the English " + ", ".join(missing) + " must be filled in.")
        if not post["published"]:
            post["published"] = datetime.date.today().isoformat()
    return post


def load(slug: str) -> dict | None:
    f = POSTS / f"{slug}.json"
    if not valid_slug(slug) or not f.is_file():
        return None
    return json.loads(f.read_text(encoding="utf-8"))


def all_posts() -> list[dict]:
    out = []
    if POSTS.is_dir():
        for f in sorted(POSTS.glob("*.json")):
            try:
                p = json.loads(f.read_text(encoding="utf-8"))
            except ValueError:
                continue
            if isinstance(p, dict) and p.get("slug") == f.stem and valid_slug(f.stem):
                out.append(p)
    return out


def published() -> list[dict]:
    """Published posts, newest first."""
    ps = [p for p in all_posts() if p.get("status") == "published" and p.get("published")]
    return sorted(ps, key=lambda p: (p["published"], p.get("updated", "")), reverse=True)


def save(post: dict) -> None:
    POSTS.mkdir(parents=True, exist_ok=True)
    (POSTS / f"{post['slug']}.json").write_text(
        json.dumps(post, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def is_webp(data: bytes) -> bool:
    return len(data) > 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
