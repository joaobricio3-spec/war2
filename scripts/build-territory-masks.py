#!/usr/bin/env python3
"""Build per-territory alpha masks clipped to the painted land.

region = Voronoi(anchors) ∩ landmask(board art): every painted-land pixel
belongs to the nearest territory anchor (within a distance cap), so the
colored areas tile the whole landmass and follow the painted coastline.
The board draws each territory as a sprite of its region PNG (white+alpha,
tintable to owner color).

Outputs:
  packages/client/public/assets/masks/<id>.png    region alpha, board-sized
  packages/client/public/assets/territory-lines.png  region outlines overlay
  packages/client/public/assets/regions-index.png    R channel = territory
      index (LAYOUT order), 0 = sea/unclaimed — the client hit-tests clicks
      against it so clicks match the visible regions exactly.
  tools/arcade-masked-preview.png                 quick composite check

Usage: python scripts/build-territory-masks.py
"""
import os
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
LAYOUT_TS = ROOT / "packages/client/src/layout.ts"
BOARD = ROOT / os.environ.get(
    "WAR2_BOARD", "packages/client/public/assets/world-board-v3.jpg"
)
MASK_DIR = ROOT / "packages/client/public/assets/masks"
LINES_PNG = ROOT / "packages/client/public/assets/territory-lines.png"

# Same hand-picked land/sea sample points as map-fit-report.py (geographic
# anchors — valid on any regrade of the same art).
LAND = [
    (200, 300), (300, 150), (170, 380),
    (400, 750), (350, 860), (430, 640),
    (750, 650), (700, 530), (800, 700),
    (750, 300), (700, 250),
    (1100, 200), (1200, 150), (1100, 450), (1000, 400), (1250, 300),
    (1330, 800), (1380, 850),
    (900, 800),
    (470, 230), (430, 330), (520, 350),
    (706, 205),
    (650, 300), (700, 320),
    (560, 290),
    (1250, 850), (1330, 830), (1400, 880), (1320, 760),
    (1428, 735),
    (500, 105), (450, 90),
    (490, 275), (530, 250),
    (740, 290), (700, 295), (650, 322),
    (820, 200), (790, 180),
    (1390, 410), (1410, 385),
    (1240, 640), (1210, 620),
    (1330, 525),
]
SEA = [
    (150, 600), (60, 700), (60, 500),
    (1050, 750), (1150, 850),
    (1100, 30), (900, 40),
    (1300, 990), (700, 960),
    (560, 600), (600, 520),
    (1480, 400), (1450, 550),
    (300, 480), (250, 500),
    (640, 170),
]


def load_polys():
    src = LAYOUT_TS.read_text(encoding="utf-8")
    block = re.search(r"POLYS[^=]*=\s*\{(.*?)\n\};", src, re.S).group(1)
    polys = {}
    for m in re.finditer(r"(\w+):\s*\[((?:\d+,\s*)*\d+)\]", block):
        nums = [int(n) for n in m.group(2).split(",")]
        polys[m.group(1)] = [(nums[i], nums[i + 1]) for i in range(0, len(nums), 2)]
    anchors = {}
    am = re.search(r"ANCHORS[^=]*=\s*\{(.*?)\};", src, re.S)
    if am:
        for m2 in re.finditer(r"(\w+):\s*\[(\d+),\s*(\d+)\]", am.group(1)):
            anchors[m2.group(1)] = (int(m2.group(2)), int(m2.group(3)))
    return polys, anchors


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def classify_land(img):
    """Per-pixel land/sea via nearest sample centroid in LAB space."""
    lab = np.asarray(img.convert("LAB"), dtype=np.float32)
    land_ref = np.asarray([lab[y, x] for x, y in LAND])
    sea_ref = np.asarray([lab[y, x] for x, y in SEA])
    flat = lab.reshape(-1, 3)
    out = np.empty(flat.shape[0], dtype=bool)
    chunk = 200_000
    for i in range(0, flat.shape[0], chunk):
        f = flat[i : i + chunk]
        dl = ((f[:, None, :] - land_ref[None]) ** 2).sum(-1).min(1)
        ds = ((f[:, None, :] - sea_ref[None]) ** 2).sum(-1).min(1)
        out[i : i + chunk] = dl < ds
    return out.reshape(lab.shape[:2])


def to_img(mask):
    return Image.fromarray((mask * 255).astype(np.uint8), "L")


def to_arr(img):
    return np.asarray(img) > 127


def make_poly(W, H, pts):
    pm = Image.new("L", (W, H), 0)
    ImageDraw.Draw(pm).polygon(pts, fill=255)
    return pm


def main():
    polys, anchors = load_polys()
    img = Image.open(BOARD).convert("RGB")
    W, H = img.size

    land = classify_land(img)
    # Denoise: median kills speckles, then close/open smooth coast edges.
    lm = to_img(land).filter(ImageFilter.MedianFilter(7))
    lm = lm.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    lm = lm.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    land = to_arr(lm)
    # Sea is only what is connected to the image border — interior "sea"
    # specks (classifier noise inside continents) become land.
    from collections import deque

    sea = ~land
    seen = np.zeros((H, W), dtype=bool)
    q = deque()
    for x in range(W):
        for y in (0, H - 1):
            if sea[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((x, y))
    for y in range(H):
        for x in (0, W - 1):
            if sea[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < W and 0 <= ny < H and sea[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((nx, ny))
    land = ~seen
    (ROOT / "tools").mkdir(exist_ok=True)
    to_img(land).save(ROOT / "tools/landmask.png")

    # Sea dilated: edges touching it are coastlines (drawn subtler).
    sea_d = to_arr(to_img(~land).filter(ImageFilter.MaxFilter(5)))

    MASK_DIR.mkdir(parents=True, exist_ok=True)
    inner_lines = np.zeros((H, W), dtype=bool)
    coast_lines = np.zeros((H, W), dtype=bool)

    # Region = Voronoi between anchors, clipped to painted land. Every land
    # pixel goes to its nearest territory anchor (within CAP px — farther
    # land stays neutral parchment art). No overlaps, no unclaimed gaps
    # inside continents; polys only place anchors, the coast draws itself.
    tids = list(polys)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    best = np.full((H, W), -1, np.int16)
    bestd = np.full((H, W), np.inf, np.float32)
    for i, t in enumerate(tids):
        cx, cy = anchors.get(t, centroid(polys[t]))
        d = (xx - cx) ** 2 + (yy - cy) ** 2
        upd = d < bestd
        best[upd] = i
        bestd[upd] = d[upd]

    CAP = 340.0
    claimed = land & (bestd < CAP * CAP)

    # Index map for client hit-testing: R = territory index + 1, 0 = none.
    idx = np.zeros((H, W), dtype=np.uint8)
    areas = []
    for i, tid in enumerate(tids):
        region = claimed & (best == i)
        idx[region] = i + 1
        # Soft edge so the runtime fill isn't jagged.
        rimg = to_img(region).filter(ImageFilter.GaussianBlur(1.4))
        r = np.asarray(rimg) > 90

        er = to_arr(to_img(r).filter(ImageFilter.MinFilter(5)))
        edge = r & ~er
        inner_lines |= edge & ~sea_d
        coast_lines |= edge & sea_d

        rgba = np.zeros((H, W, 4), dtype=np.uint8)
        rgba[..., :3] = 255
        rgba[..., 3] = np.asarray(rimg)
        Image.fromarray(rgba, "RGBA").save(MASK_DIR / f"{tid}.png", optimize=True)
        areas.append((tid, int(r.sum())))

    lines = np.zeros((H, W, 4), dtype=np.uint8)
    lines[..., 0], lines[..., 1], lines[..., 2] = 24, 18, 10
    lines[..., 3] = np.where(coast_lines, 110, 0)
    lines[..., 3] = np.where(inner_lines, 215, lines[..., 3])
    Image.fromarray(lines, "RGBA").save(LINES_PNG, optimize=True)

    idx_rgba = np.zeros((H, W, 4), dtype=np.uint8)
    idx_rgba[..., 0] = idx
    idx_rgba[..., 3] = 255
    Image.fromarray(idx_rgba, "RGBA").save(
        ROOT / "packages/client/public/assets/regions-index.png", optimize=True
    )

    # Composite preview: continent palette through the region masks.
    mapsrc = (ROOT / "packages/engine/src/map/classic.ts").read_text(encoding="utf-8")
    cblock = re.search(r"CONTINENT_OF[^=]*=\s*\{(.*?)\};", mapsrc, re.S).group(1)
    cont = dict(re.findall(r'(\w+):\s*"(\w+)"', cblock))
    LANDC = {
        "north_america": 0xC9A24A, "south_america": 0x3F8A48, "europe": 0x3D6AA0,
        "africa": 0xB86A3A, "asia": 0x7A8F3A, "oceania": 0x2F7A72,
    }
    prev = img.convert("RGBA")
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for tid, pts in polys.items():
        m = np.asarray(Image.open(MASK_DIR / f"{tid}.png"))[..., 3]
        c = LANDC.get(cont.get(tid, ""), 0x888888)
        tint = np.zeros((H, W, 4), dtype=np.uint8)
        tint[..., 0], tint[..., 1], tint[..., 2] = c >> 16 & 255, c >> 8 & 255, c & 255
        tint[..., 3] = (m.astype(np.float32) * 0.66).astype(np.uint8)
        lay = Image.alpha_composite(lay, Image.fromarray(tint, "RGBA"))
    prev = Image.alpha_composite(prev, lay)
    prev = Image.alpha_composite(prev, Image.fromarray(lines, "RGBA"))
    prev.convert("RGB").save(ROOT / "tools/arcade-masked-preview.png")

    areas.sort(key=lambda t: t[1])
    print(f"land coverage: {land.mean() * 100:.1f}%  masks: {len(areas)}")
    print("smallest regions:", ", ".join(f"{t}={a}px" for t, a in areas[:6]))
    zero = [t for t, a in areas if a < 400]
    if zero:
        print("WARNING tiny/empty regions:", zero)
        sys.exit(1)


if __name__ == "__main__":
    main()
