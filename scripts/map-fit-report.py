#!/usr/bin/env python3
"""Score how well each territory polygon sits on painted land.

Classifies pixels as land/sea via nearest-centroid in Lab space, trained on
hand-picked samples of world-board-v2.jpg. For every poly in layout.ts:
  sea%   = fraction of in-poly sample points classified sea
  ctr    = is the centroid (label/disc anchor) on land?
  ring   = fraction of sea in a small disc around the centroid
Prints a table worst-first. Exit 0 always; this is a report, not a gate.

Usage: python scripts/map-fit-report.py [--json]
"""
import json
import os
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
LAYOUT_TS = ROOT / "packages/client/src/layout.ts"
BOARD = ROOT / os.environ.get(
    "WAR2_BOARD", "packages/client/public/assets/world-board-v2.jpg"
)

# Hand-picked (x, y) on the 1536×1024 art.
LAND = [
    (200, 300), (300, 150), (170, 380),   # N. America
    (400, 750), (350, 860), (430, 640),   # S. America
    (750, 650), (700, 530), (800, 700),   # Africa
    (750, 300), (700, 250),               # Europe
    (1100, 200), (1200, 150), (1100, 450), (1000, 400), (1250, 300),  # Asia
    (1330, 800), (1380, 850),             # Australia
    (900, 800),                           # Madagascar
    (470, 230), (430, 330), (520, 350),   # Labrador / Ungava dark plateau
    (706, 205),                           # Iceland islet
    (650, 300), (700, 320),               # gray Europe land
    (560, 290),                           # painted Britain isle
    (1250, 850), (1330, 830), (1400, 880), (1320, 760),  # Australia teal
    (1428, 735),                          # New Guinea teal island
    (500, 105), (450, 90),                # Greenland white mass
    (490, 275), (530, 250),               # Labrador rocky peninsula
    (740, 290), (700, 295), (650, 322),   # dark Alps/Europe stripe
    (820, 200), (790, 180),               # Scandinavia gray mass
    (1390, 410), (1410, 385),             # Japan chain
    (1240, 640), (1210, 620),             # Sumatra island
    (1330, 525),                          # Borneo chain
]
SEA = [
    (150, 600), (60, 700), (60, 500),     # Pacific W of S. America
    (1050, 750), (1150, 850),             # Indian ocean
    (1100, 30), (900, 40),                # Arctic / N of Siberia
    (1300, 990), (700, 960),              # S of Australia / S Atlantic
    (560, 600), (600, 520),               # mid-Atlantic
    (1480, 400), (1450, 550),             # Pacific E of Japan
    (300, 480), (250, 500),               # Gulf of Mexico / Caribbean
    (640, 170),                           # Greenland Sea
]


def lab_samples(img, pts):
    lab = img.convert("LAB")
    px = lab.load()
    return [px[x, y] for x, y in pts]


def dist2(a, b):
    return sum((a[i] - b[i]) ** 2 for i in range(3))


def main():
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

    img = Image.open(BOARD).convert("RGB")
    W, H = img.size
    lab_img = img.convert("LAB")
    lab_px = lab_img.load()

    land_ref = lab_samples(img, LAND)
    sea_ref = lab_samples(img, SEA)

    def is_land(x, y):
        p = lab_px[int(x), int(y)]
        dl = min(dist2(p, s) for s in land_ref)
        ds = min(dist2(p, s) for s in sea_ref)
        return dl < ds

    mask = Image.new("L", (W, H), 0)
    md = ImageDraw.Draw(mask)

    rows = []
    for tid, pts in polys.items():
        mask.paste(Image.new("L", (W, H), 0), (0, 0))
        md.polygon(pts, fill=255)
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        minx, maxx = max(0, int(min(xs))), min(W - 1, int(max(xs)))
        miny, maxy = max(0, int(min(ys))), min(H - 1, int(max(ys)))
        cx, cy = anchors.get(tid, (sum(xs) / len(xs), sum(ys) / len(ys)))
        mpx = mask.load()
        inside = land = 0
        step = 6
        for y in range(miny, maxy + 1, step):
            for x in range(minx, maxx + 1, step):
                if mpx[x, y]:
                    inside += 1
                    if is_land(x, y):
                        land += 1
        sea_frac = 1 - land / inside if inside else 1.0
        ctr_land = is_land(cx, cy)
        ring = r = 0
        rr = 14
        for dy in range(-rr, rr + 1, 3):
            for dx in range(-rr, rr + 1, 3):
                if dx * dx + dy * dy > rr * rr:
                    continue
                x, y = int(cx + dx), int(cy + dy)
                if 0 <= x < W and 0 <= y < H:
                    r += 1
                    ring += 0 if is_land(x, y) else 1
        ring_frac = ring / r if r else 1.0
        rows.append((tid, sea_frac, ctr_land, ring_frac))

    rows.sort(key=lambda t: -(t[1] + (0 if t[2] else 0.5) + t[3] * 0.5))
    if "--json" in sys.argv:
        print(json.dumps(rows))
        return
    print(f"{'territory':<16} {'sea%':>6} {'ctr':>4} {'ring%':>6}")
    for tid, sea, ctr, ring in rows:
        flag = "  <-- BAD" if sea > 0.35 or not ctr or ring > 0.5 else ""
        print(f"{tid:<16} {sea*100:>5.1f}% {'yes' if ctr else 'NO':>4} {ring*100:>5.1f}%{flag}")


if __name__ == "__main__":
    main()
