#!/usr/bin/env python3
"""Crop a region of the board with layout overlay, upscaled 2x for review.

Usage: python scripts/render-crop.py x0 y0 x1 y1 tag
"""
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LAYOUT_TS = ROOT / "packages/client/src/layout.ts"
BOARD = ROOT / "packages/client/public/assets/world-board-v2.jpg"

x0, y0, x1, y1, tag = (
    int(sys.argv[1]),
    int(sys.argv[2]),
    int(sys.argv[3]),
    int(sys.argv[4]),
    sys.argv[5],
)

src = LAYOUT_TS.read_text(encoding="utf-8")
polys = {}
for m in re.finditer(r"(\w+):\s*\[((?:\d+,\s*)*\d+)\]", src):
    nums = [int(n) for n in m.group(2).split(",")]
    polys[m.group(1)] = [(nums[i], nums[i + 1]) for i in range(0, len(nums), 2)]

img = Image.open(BOARD).convert("RGB").crop((x0, y0, x1, y1))
scale = 2
img = img.resize((img.width * scale, img.height * scale), Image.LANCZOS)
lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
d = ImageDraw.Draw(lay)
try:
    font = ImageFont.truetype("arial.ttf", 13)
except OSError:
    font = ImageFont.load_default()

for tid, pts in polys.items():
    pts = [((px - x0) * scale, (py - y0) * scale) for px, py in pts]
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    if not (-200 < cx < img.width + 200 and -200 < cy < img.height + 200):
        continue
    d.polygon(pts, fill=(255, 200, 80, 40))
    d.line(pts + [pts[0]], fill=(255, 220, 90, 235), width=2)
    r = 5
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 40, 40, 255))
    d.text((cx + 7, cy - 7), tid, fill=(255, 255, 255, 255), font=font,
           stroke_width=2, stroke_fill=(0, 0, 0, 255))

out = ROOT / "tools" / f"crop-{tag}.png"
out.parent.mkdir(exist_ok=True)
Image.alpha_composite(img.convert("RGBA"), lay).convert("RGB").save(out)
print(f"wrote {out}")
