"""Site icons from the Orvix X mark.

The only logo source is images/orvix-logo.png (440x125, the X about 90 px
tall), too small to scale, so the X is redrawn here as geometry traced from
that raster: two upper blocks (the left one cyan), a chevron below them,
all on a navy rounded square so the mark reads on light and dark tabs.

    python -m tools.icons        writes favicon.svg, favicon.ico,
                                 apple-touch-icon.png, icon-512.png,
                                 site.webmanifest at the site root

Coordinates are pixels of the logo crop (x from 308), kept as traced.
"""

from __future__ import annotations

import json
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent

NAVY = "#03072C"
CYAN = "#48E2E2"
WHITE = "#FFFFFF"

# Glyph pieces in crop pixels (bounds x 6..92, y 28..106).
CYAN_BLOCK = [(6, 28), (26, 28), (36, 38), (36, 58), (18, 58), (6, 46)]
RIGHT_BLOCK = [(64, 40), (76, 28), (92, 28), (92, 46), (80, 58), (64, 58)]
CHEVRON = [(34, 58), (64, 58), (92, 86), (92, 106), (79, 106), (49, 76),
           (19, 106), (6, 106), (6, 86)]
GLYPH = (6, 28, 92, 106)  # x0 y0 x1 y1

# Mark on a 100x100 tile: glyph scaled to 64 wide and centred.
TILE = 100
SCALE = 64 / (GLYPH[2] - GLYPH[0])
GW, GH = (GLYPH[2] - GLYPH[0]) * SCALE, (GLYPH[3] - GLYPH[1]) * SCALE
OX, OY = (TILE - GW) / 2, (TILE - GH) / 2
RADIUS = 22


def tile_pt(p):
    return (OX + (p[0] - GLYPH[0]) * SCALE, OY + (p[1] - GLYPH[1]) * SCALE)


def _pts(poly):
    return " ".join(f"{x:.2f},{y:.2f}" for x, y in map(tile_pt, poly))


def svg() -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {TILE} {TILE}">'
        f'<rect width="{TILE}" height="{TILE}" rx="{RADIUS}" fill="{NAVY}"/>'
        f'<polygon points="{_pts(CHEVRON)}" fill="{WHITE}"/>'
        f'<polygon points="{_pts(RIGHT_BLOCK)}" fill="{WHITE}"/>'
        f'<polygon points="{_pts(CYAN_BLOCK)}" fill="{CYAN}"/>'
        "</svg>\n"
    )


def raster(size: int, rounded: bool = True) -> Image.Image:
    """Render the tile at `size` px, supersampled 4x for clean edges."""
    ss = 4
    n = size * ss
    k = n / TILE
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=RADIUS * k, fill=NAVY)
    else:
        d.rectangle([0, 0, n - 1, n - 1], fill=NAVY)
    for poly, col in ((CHEVRON, WHITE), (RIGHT_BLOCK, WHITE), (CYAN_BLOCK, CYAN)):
        d.polygon([(x * k, y * k) for x, y in map(tile_pt, poly)], fill=col)
    return im.resize((size, size), Image.LANCZOS)


def main() -> int:
    (ROOT / "favicon.svg").write_text(svg(), encoding="utf-8", newline="\n")
    # Tab icons: square (browsers round nothing at 16 px, a rounded tile looks chipped).
    raster(48, rounded=False).save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    # Home-screen icons: rounded tile; iOS masks it again, Android keeps it.
    raster(180).save(ROOT / "apple-touch-icon.png", optimize=True)
    raster(512).save(ROOT / "icon-512.png", optimize=True)
    manifest = {
        "name": "Orvix",
        "short_name": "Orvix",
        "icons": [{"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"}],
        "theme_color": NAVY,
        "background_color": NAVY,
        "display": "browser",
    }
    (ROOT / "site.webmanifest").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("icons    : favicon.svg, favicon.ico (16/32/48), apple-touch-icon.png, icon-512.png, site.webmanifest")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
