"""python -m tools.seo <command>   (run from the site root)

    assets     base64 preview images -> assets/img/        (brief 1.3)
    ogcards    build the 1200x630 og:image sheet            (brief 2)
    apply      rewrite the managed <head> on every page    (brief 1.2, 2, 3)
    crawl      write sitemap.xml and robots.txt            (brief 4)
    validate   the fail-the-build checks                   (brief 6)
    build      assets, apply, crawl, then validate
"""

from __future__ import annotations

import pathlib
import sys

from . import apply as apply_mod
from . import assets, ogcards, sitemap, validate

ROOT = pathlib.Path(__file__).resolve().parents[2]


def cmd_assets() -> int:
    r = assets.extract(ROOT)
    print(f"assets   : {r['references_rewritten']} inline images -> "
          f"{len(r['images'])} file(s) in assets/img/, across {r['files']} pages")
    for name, size in sorted(r["images"].items()):
        print(f"           {name}  {size // 1024} KB")
    return 0


def cmd_ogcards() -> int:
    r = ogcards.write(ROOT)
    print(f"ogcards  : {r['cards']} cards in {r['sheet']}")
    print("           render with:  node tools/seo/render_og.mjs")
    return 0


def cmd_apply() -> int:
    rows = apply_mod.run(ROOT)
    changed = [x for x in rows if x.get("changed")]
    skipped = [x for x in rows if x.get("skipped")]
    capped = sum(x.get("area_served_capped", 0) for x in rows)
    print(f"apply    : {len(rows)} pages, {len(changed)} rewritten, "
          f"{capped} areaServed capped to the six GCC states")
    for x in skipped:
        print(f"           SKIPPED {x['path']}: {x['skipped']}")
    return 0


def cmd_crawl() -> int:
    r = sitemap.write(ROOT)
    print(f"crawl    : sitemap.xml {r['urls']} urls ({r['excluded']} excluded), robots.txt written")
    return 0


def cmd_validate() -> int:
    rep = validate.check(ROOT)
    print(rep.render())
    return 0 if rep.ok else 1


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "build"
    if cmd == "assets":
        return cmd_assets()
    if cmd == "ogcards":
        return cmd_ogcards()
    if cmd == "apply":
        return cmd_apply()
    if cmd == "crawl":
        return cmd_crawl()
    if cmd == "validate":
        return cmd_validate()
    if cmd == "build":
        cmd_assets(); cmd_apply(); cmd_crawl()
        print()
        return cmd_validate()
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
