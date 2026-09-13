#!/usr/bin/env python3
"""Generate the whole arcade board in one pass — background art, territory
region masks, border lines and the click index map.

Everything is defined here (no classifier against painted art):
  continent silhouette = smoothed union of that continent's layout polys
  territory region     = silhouette ∩ Voronoi between the continent's anchors
  sea                  = flat ink-teal gradient + grain + vignette
  land base            = parchment + grain + soft coast shading

Outputs:
  assets/world-board-arcade.png   background (sea + neutral land)
  assets/masks/<id>.png           region alpha per territory (tintable)
  assets/territory-lines.png      region borders + coast outline
  assets/regions-index.png        R = LAYOUT index + 1, 0 = sea/none
  tools/arcade-preview.png        composite check

Usage: python scripts/build-board.py
"""
import re
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
LAYOUT_TS = ROOT / "packages/client/src/layout.ts"
CLASSIC_TS = ROOT / "packages/engine/src/map/classic.ts"
ASSETS = ROOT / "packages/client/public/assets"
BOARD_PNG = ASSETS / "world-board-arcade.png"
MASK_DIR = ASSETS / "masks"
LINES_PNG = ASSETS / "territory-lines.png"
INDEX_PNG = ASSETS / "regions-index.png"
W, H = 1536, 1024


def load_layout():
    src = LAYOUT_TS.read_text(encoding="utf-8")
    block = re.search(r"POLYS[^=]*=\s*\{(.*?)\n\};", src, re.S).group(1)
    polys = {}
    for m in re.finditer(r"(\w+):\s*\[((?:\d+,\s*)*\d+)\]", block):
        nums = [int(n) for n in m.group(2).split(",")]
        polys[m.group(1)] = [(nums[i], nums[i + 1]) for i in range(0, len(nums), 2)]
    anchors = {}
    am = re.search(r"ANCHORS[^=]*=\s*\{(.*?)\};", src, re.S)
    for m2 in re.finditer(r"(\w+):\s*\[(\d+),\s*(\d+)\]", am.group(1)):
        anchors[m2.group(1)] = (int(m2.group(2)), int(m2.group(3)))
    csrc = CLASSIC_TS.read_text(encoding="utf-8")
    cblock = re.search(r"CONTINENT_OF[^=]*=\s*\{(.*?)\};", csrc, re.S).group(1)
    cont = dict(re.findall(r'(\w+):\s*"(\w+)"', cblock))
    pblock = re.search(r"PAIRS[^=]*=\s*\[(.*?)\];", csrc, re.S).group(1)
    pairs = re.findall(r'\["(\w+)",\s*"(\w+)"\]', pblock)
    return polys, anchors, cont, pairs


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def to_img(mask):
    return Image.fromarray((mask * 255).astype(np.uint8), "L")


def to_arr(img):
    return np.asarray(img) > 127


def raster_poly(pts, dilate=0):
    pm = Image.new("L", (W, H), 0)
    ImageDraw.Draw(pm).polygon(pts, fill=255)
    if dilate:
        pm = pm.filter(ImageFilter.MaxFilter(dilate))
    return to_arr(pm)


def smooth(mask, erode=9, blur=12):
    """Organic edge: slight erode then blur + threshold."""
    im = to_img(mask).filter(ImageFilter.MinFilter(erode))
    im = im.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(im) > 118


def fill_holes(mask):
    """Anything not connected to the border becomes land."""
    sea = ~mask
    seen = np.zeros(mask.shape, dtype=bool)
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
    return ~seen


def main():
    polys, anchors, cont, pairs = load_layout()
    tids = list(polys)
    continents = sorted(set(cont.values()))
    by_cont = {c: [t for t in tids if cont[t] == c] for c in continents}

    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

    # --- continent silhouettes -------------------------------------------
    sil = {}
    land = np.zeros((H, W), dtype=bool)
    for c in continents:
        u = np.zeros((H, W), dtype=bool)
        for t in by_cont[c]:
            # ~10px dilation merges mainland polys into one landmass; real
            # islands (Britain, Iceland, Japan, Madagascar) stay separate.
            u |= raster_poly(polys[t], dilate=21)
        s = fill_holes(smooth(u))
        sil[c] = s
        land |= s
    (ROOT / "tools").mkdir(exist_ok=True)
    to_img(land).save(ROOT / "tools/landmask.png")

    # --- regions: poly-authored borders inside the continent silhouette.
    # A silhouette pixel covered by polys goes to the nearest covering anchor
    # (borders land where the polys meet — the authored adjacency). Uncovered
    # land (smoothed coast beyond the polys) goes to the nearest anchor of the
    # same continent. Regions can never leak across continent silhouettes.
    regions = {}
    for c in continents:
        ids = by_cont[c]
        cov = np.stack([raster_poly(polys[t]) for t in ids])
        best_cov = np.full((H, W), -1, np.int16)
        best_covd = np.full((H, W), np.inf, np.float32)
        best_any = np.full((H, W), -1, np.int16)
        best_anyd = np.full((H, W), np.inf, np.float32)
        for i, t in enumerate(ids):
            cx, cy = anchors.get(t, centroid(polys[t]))
            d = (xx - cx) ** 2 + (yy - cy) ** 2
            upd = cov[i] & (d < best_covd)
            best_cov[upd] = i
            best_covd[upd] = d[upd]
            upd = d < best_anyd
            best_any[upd] = i
            best_anyd[upd] = d[upd]
        owner = np.where(best_cov >= 0, best_cov, best_any)
        for i, t in enumerate(ids):
            regions[t] = sil[c] & (owner == i)

    # --- masks + index map -------------------------------------------------
    MASK_DIR.mkdir(parents=True, exist_ok=True)
    idx = np.zeros((H, W), dtype=np.uint8)
    for i, t in enumerate(tids):
        r = regions[t]
        idx[r] = i + 1
        rimg = to_img(r).filter(ImageFilter.GaussianBlur(1.2))
        rgba = np.zeros((H, W, 4), dtype=np.uint8)
        rgba[..., :3] = 255
        rgba[..., 3] = np.asarray(rimg)
        Image.fromarray(rgba, "RGBA").save(MASK_DIR / f"{t}.png", optimize=True)

    idx_rgba = np.zeros((H, W, 4), dtype=np.uint8)
    idx_rgba[..., 0] = idx
    idx_rgba[..., 3] = 255
    Image.fromarray(idx_rgba, "RGBA").save(INDEX_PNG, optimize=True)

    # Visual lanes: every game adjacency whose regions don't share a raster
    # border needs a drawn route (sea crossings, island chains, continental
    # gaps). Neighbours that DO touch get a real border instead.
    visual_lanes = []
    for a, b in pairs:
        ra = to_arr(to_img(regions[a]).filter(ImageFilter.MaxFilter(7)))
        if not (ra & regions[b]).any():
            visual_lanes.append([a, b])
    import json

    (ASSETS / "visual-lanes.json").write_text(
        json.dumps(visual_lanes), encoding="utf-8"
    )

    # --- border lines ------------------------------------------------------
    sea_d = to_arr(to_img(~land).filter(ImageFilter.MaxFilter(5)))
    inner = np.zeros((H, W), dtype=bool)
    coast = np.zeros((H, W), dtype=bool)
    for t in tids:
        r = to_arr(to_img(regions[t]).filter(ImageFilter.GaussianBlur(1.2)))
        r = np.asarray(to_img(r)) > 90
        er = to_arr(to_img(r).filter(ImageFilter.MinFilter(5)))
        e = r & ~er
        inner |= e & ~sea_d
        coast |= e & sea_d
    lines = np.zeros((H, W, 4), dtype=np.uint8)
    lines[..., 0], lines[..., 1], lines[..., 2] = 26, 20, 12
    lines[..., 3] = np.where(coast, 150, 0)
    lines[..., 3] = np.where(inner, 235, lines[..., 3])
    Image.fromarray(lines, "RGBA").save(LINES_PNG, optimize=True)

    # --- background art ----------------------------------------------------
    rng = np.random.default_rng(7)
    grain = rng.normal(0, 1, (H, W)).astype(np.float32)
    grain = np.asarray(
        Image.fromarray(((grain - grain.min()) / np.ptp(grain) * 255).astype(np.uint8))
        .filter(ImageFilter.GaussianBlur(2)),
        dtype=np.float32,
    ) / 255.0

    vx = (xx / W - 0.5) ** 2 + (yy / H - 0.5) ** 2
    vign = np.clip(vx * 2.2, 0, 1)

    bg = np.zeros((H, W, 3), dtype=np.float32)
    # sea: deep ink-teal, a touch lighter toward the middle, vignette edges
    sea_rgb = np.array([16, 34, 42], dtype=np.float32)
    bg[:] = sea_rgb
    bg += (grain[..., None] - 0.5) * 14
    bg *= (1 - vign[..., None] * 0.45)

    # faint graticule on sea — sells "world map" without real geography
    grat = np.zeros((H, W), dtype=bool)
    for gy in range(120, H, 160):
        grat |= (np.abs(yy - gy) < 0.8)
    for gx in range(90, W, 170):
        grat |= (np.abs(xx - gx) < 0.8)
    bg[grat & ~land] += 9

    # land: neutral warm parchment + grain; coast gets a soft inner shade
    land_rgb = np.array([146, 128, 92], dtype=np.float32)
    shade = land & to_arr(to_img(~land).filter(ImageFilter.MaxFilter(7)))
    bg[land] = land_rgb
    bg[land] += ((grain[..., None] - 0.5) * 26)[land]
    bg[shade] *= 0.82
    bg[land] *= (1 - vign[..., None][land] * 0.25)

    Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8), "RGB").save(
        BOARD_PNG, optimize=True
    )

    # --- composite preview ---------------------------------------------------
    LANDC = {
        "north_america": 0xC9A24A, "south_america": 0x3F8A48, "europe": 0x3D6AA0,
        "africa": 0xB86A3A, "asia": 0x7A8F3A, "oceania": 0x2F7A72,
    }
    prev = Image.open(BOARD_PNG).convert("RGBA")
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for t in tids:
        m = np.asarray(Image.open(MASK_DIR / f"{t}.png"))[..., 3]
        c = LANDC.get(cont[t], 0x888888)
        tint = np.zeros((H, W, 4), dtype=np.uint8)
        tint[..., 0], tint[..., 1], tint[..., 2] = c >> 16 & 255, c >> 8 & 255, c & 255
        tint[..., 3] = (m.astype(np.float32) * 0.78).astype(np.uint8)
        lay = Image.alpha_composite(lay, Image.fromarray(tint, "RGBA"))
    prev = Image.alpha_composite(prev, lay)
    prev = Image.alpha_composite(prev, Image.fromarray(lines, "RGBA"))
    dprev = ImageDraw.Draw(prev)
    for a, b in visual_lanes:
        ax, ay = anchors.get(a, centroid(polys[a]))
        bx, by = anchors.get(b, centroid(polys[b]))
        if abs(bx - ax) > W / 2:
            left, right = ((ax, ay), (bx, by)) if ax < bx else ((bx, by), (ax, ay))
            dprev.line([left, (left[0] - 60, left[1] - 10), (-14, left[1] - 22)],
                       fill=(196, 163, 90, 150), width=2)
            dprev.line([right, (right[0] + 60, right[1] - 10), (W + 14, right[1] - 22)],
                       fill=(196, 163, 90, 150), width=2)
        else:
            dx, dy = bx - ax, by - ay
            ln = (dx * dx + dy * dy) ** 0.5 or 1
            k = min(64, ln * 0.18)
            mx, my = (ax + bx) / 2 - dy / ln * k, (ay + by) / 2 + dx / ln * k
            pts = []
            for i in range(25):
                t = i / 24
                pts.append((
                    (1 - t) ** 2 * ax + 2 * (1 - t) * t * mx + t * t * bx,
                    (1 - t) ** 2 * ay + 2 * (1 - t) * t * my + t * t * by,
                ))
            dprev.line(pts, fill=(196, 163, 90, 150), width=2)
    prev.convert("RGB").save(ROOT / "tools/arcade-preview.png")

    areas = sorted((t, int(regions[t].sum())) for t in tids)
    print(f"land: {land.mean() * 100:.1f}%  regions: {len(regions)}")
    print("smallest:", ", ".join(f"{t}={a}px" for t, a in areas[:6]))
    bad = [t for t, a in areas if a < 400]
    if bad:
        print("WARNING tiny/empty:", bad)
        sys.exit(1)


if __name__ == "__main__":
    main()
