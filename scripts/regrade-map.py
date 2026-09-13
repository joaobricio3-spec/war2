#!/usr/bin/env python3
"""Re-grade the painted board: parchment lands on a deep-teal sea.

The source relief is very dark/desaturated. This keeps the same geography
(and therefore the same LAYOUT polygons) but re-tones land toward warm
vellum and sea toward the UI's --sea/--ink palette, plus a soft vignette.

Usage: python scripts/regrade-map.py [in.jpg] [out.jpg]
"""

import sys

from PIL import Image, ImageChops, ImageFilter

SRC = sys.argv[1] if len(sys.argv) > 1 else "packages/client/public/assets/world-board-v2.jpg"
DST = sys.argv[2] if len(sys.argv) > 2 else "packages/client/public/assets/world-board-v3.jpg"


def gradient_lut(stops):
    """stops: [(pos0-255, (r,g,b)), ...] -> (lutR, lutG, lutB)."""
    luts = [[0] * 256 for _ in range(3)]
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        span = max(1, p1 - p0)
        for i in range(p0, p1 + 1):
            t = (i - p0) / span
            for ch in range(3):
                luts[ch][i] = round(c0[ch] + (c1[ch] - c0[ch]) * t)
    return luts


def main() -> None:
    img = Image.open(SRC).convert("RGB")
    w, h = img.size
    r, g, b = img.split()

    # Land reads warm (R > B), sea reads cool (B > R). diff = R - B is a
    # soft land mask; blur it so coastlines blend instead of banding.
    diff = ImageChops.subtract(r, b)  # clamped at 0 — sea collapses to 0
    mask = diff.point(lambda v: min(255, v * 6))  # gentle ramp
    mask = mask.filter(ImageFilter.GaussianBlur(3))

    # Luminance drives relief shading through the palettes.
    lum = img.convert("L")
    lum = lum.point(lambda v: min(255, int(v * 1.25)))  # lift the murk

    land_lut = gradient_lut(
        [
            (0, (38, 26, 16)),      # sombra carvalho
            (110, (128, 104, 72)),  # encosta
            (190, (196, 172, 128)), # planalto
            (255, (238, 224, 196)), # crista vellum
        ]
    )
    sea_lut = gradient_lut(
        [
            (0, (6, 14, 22)),       # profundo — quase --ink
            (140, (18, 44, 56)),    # mar médio
            (255, (30, 66, 78)),    # raso — perto de --sea
        ]
    )

    land_img = Image.merge(
        "RGB", [lum.point(land_lut[c]) for c in range(3)]
    )
    sea_img = Image.merge(
        "RGB", [lum.point(sea_lut[c]) for c in range(3)]
    )

    out = Image.composite(land_img, sea_img, mask)

    # Vignette suave — escurece as bordas ~22% sem tocar o centro.
    vig = Image.radial_gradient("L").resize((w, h))  # 0 centro → 255 borda
    vig = vig.point(lambda v: 255 - int(v * 0.22))
    out = ImageChops.multiply(out, Image.merge("RGB", [vig, vig, vig]))

    out.save(DST, quality=90)
    print(f"wrote {DST} ({w}x{h})")


if __name__ == "__main__":
    main()
