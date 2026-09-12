#!/usr/bin/env python3
"""Render layout.ts polygons over the board art for visual review.

Writes tools/overlay-<tag>.png: semi-transparent polygon fills, outline,
centroid dot, and territory id label for every territory in POLYS, plus
SEA_LANES as straight connectors between centroids.

Usage: python scripts/render-layout-overlay.py [tag]
"""
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LAYOUT_TS = ROOT / "packages/client/src/layout.ts"
BOARD = ROOT / "packages/client/public/assets/world-board-v2.jpg"

src = LAYOUT_TS.read_text(encoding="utf-8")

polys = {}
block = re.search(r"POLYS[^=]*=\s*\{(.*?)\n\};", src, re.S).group(1)
for m in re.finditer(r"(\w+):\s*\[((?:\d+,\s*)*\d+)\]", block):
    nums = [int(n) for n in m.group(2).split(",")]
    polys[m.group(1)] = [(nums[i], nums[i + 1]) for i in range(0, len(nums), 2)]

anchors = {}
am = re.search(r"ANCHORS[^=]*=\s*\{(.*?)\};", src, re.S)
if am:
    for m2 in re.finditer(r"(\w+):\s*\[(\d+),\s*(\d+)\]", am.group(1)):
        anchors[m2.group(1)] = (int(m2.group(2)), int(m2.group(3)))

lanes_block = re.search(r"SEA_LANES[^=]*=\s*\[(.*?)\];", src, re.S)
lanes = re.findall(r'\["(\w+)",\s*"(\w+)"\]', lanes_block.group(1)) if lanes_block else []

def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))

def anchor_of(tid, pts):
    return anchors.get(tid, centroid(pts))

tag = sys.argv[1] if len(sys.argv) > 1 else "review"
out = ROOT / "tools" / f"overlay-{tag}.png"
out.parent.mkdir(exist_ok=True)

img = Image.open(BOARD).convert("RGB")
lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
d = ImageDraw.Draw(lay)

try:
    font = ImageFont.truetype("arial.ttf", 11)
except OSError:
    font = ImageFont.load_default()

for tid, pts in polys.items():
    cx, cy = anchor_of(tid, pts)
    d.polygon(pts, fill=(255, 200, 80, 46))
    d.line(pts + [pts[0]], fill=(255, 220, 90, 230), width=2)
    r = 4
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 40, 40, 255))
    d.text((cx + 6, cy - 6), tid, fill=(255, 255, 255, 255), font=font,
           stroke_width=2, stroke_fill=(0, 0, 0, 255))

for a, b in lanes:
    if a in polys and b in polys:
        pa, pb = anchor_of(a, polys[a]), anchor_of(b, polys[b])
        d.line([pa, pb], fill=(80, 220, 255, 220), width=2)

img.paste(Image.alpha_composite(img.convert("RGBA"), lay).convert("RGB"), (0, 0))
img.save(out)
print(f"wrote {out} ({len(polys)} polys, {len(lanes)} lanes)")
