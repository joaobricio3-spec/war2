#!/usr/bin/env python3
"""Territory gauntlet — evolve 42 nested pieces onto the painted board.

Unconstrained watershed ate continents and collapsed slivers. This loop keeps a
War-like UV partition as the genome, clips/snaps coasts to the paint, and
mutates until the score plateaus. Nothing is carton-perfect; re-run anytime.

Does not copy a commercial board. Original painting + authored UV only.
"""
from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage.measure import approximate_polygon, find_contours

ROOT = Path(__file__).resolve().parents[1]
BOARD = ROOT / "packages/client/public/assets/world-board-v2.jpg"
OUT_TS = ROOT / "packages/client/src/layout.ts"
PREVIEW = Path("/tmp/gauntlet-preview.png")
LOG = Path("/tmp/gauntlet-score.jsonl")
GENOME = Path("/tmp/gauntlet-genome.json")
W, H = 1536, 1024

# Painted continent windows. Islands get their own box so they cannot swallow
# the parent landmass.
BOX0: dict[str, tuple[int, int, int, int]] = {
    "na": (78, 72, 422, 508),
    "sa": (248, 528, 462, 968),
    "gr": (458, 22, 674, 214),
    "eu": (548, 168, 818, 448),
    "af": (552, 438, 892, 918),
    "as": (798, 52, 1408, 698),
    "oc": (1138, 648, 1458, 948),
    "jp": (1324, 268, 1406, 388),
    "md": (812, 748, 868, 848),
}

GROUP: dict[str, str] = {
    "alaska": "na", "mackenzie": "na", "vancouver": "na", "ottawa": "na",
    "labrador": "na", "california": "na", "nova_york": "na", "mexico": "na",
    "groenlandia": "gr",
    "venezuela": "sa", "bolivia": "sa", "brasil": "sa", "argentina": "sa",
    "islandia": "eu", "inglaterra": "eu", "suecia": "eu", "franca": "eu",
    "alemanha": "eu", "polonia": "eu", "moscou": "eu",
    "argelia": "af", "egito": "af", "congo": "af", "sudan": "af",
    "africa_do_sul": "af", "madagascar": "md",
    "oriente_medio": "as", "aral": "as", "omsk": "as", "dudinka": "as",
    "siberia": "as", "tchita": "as", "mongolia": "as", "vladivostok": "as",
    "china": "as", "india": "as", "vietna": "as", "japao": "jp",
    "sumatra": "oc", "borneo": "oc", "nova_gine": "oc", "australia": "oc",
}

# War-like unit partitions. Neighbors share corners in UV space.
UV0: dict[str, list[tuple[float, float]]] = {
    "alaska": [(0.02, 0.18), (0.12, 0.04), (0.30, 0.08), (0.34, 0.24), (0.26, 0.36), (0.10, 0.38), (0.02, 0.30)],
    "mackenzie": [(0.30, 0.08), (0.50, 0.02), (0.70, 0.06), (0.76, 0.22), (0.62, 0.34), (0.42, 0.36), (0.34, 0.24)],
    "vancouver": [(0.02, 0.30), (0.10, 0.38), (0.26, 0.36), (0.34, 0.24), (0.40, 0.48), (0.22, 0.60), (0.04, 0.56)],
    "ottawa": [(0.34, 0.24), (0.42, 0.36), (0.62, 0.34), (0.70, 0.48), (0.54, 0.60), (0.40, 0.48)],
    "labrador": [(0.62, 0.34), (0.76, 0.22), (0.92, 0.20), (0.98, 0.40), (0.82, 0.54), (0.70, 0.48)],
    "california": [(0.04, 0.56), (0.22, 0.60), (0.40, 0.48), (0.48, 0.68), (0.32, 0.82), (0.10, 0.80), (0.02, 0.68)],
    "nova_york": [(0.40, 0.48), (0.54, 0.60), (0.70, 0.48), (0.82, 0.54), (0.88, 0.70), (0.68, 0.80), (0.48, 0.68)],
    "mexico": [(0.10, 0.80), (0.32, 0.82), (0.48, 0.68), (0.68, 0.80), (0.62, 0.96), (0.38, 1.00), (0.18, 0.94)],
    "groenlandia": [(0.08, 0.12), (0.40, 0.02), (0.78, 0.10), (0.92, 0.40), (0.70, 0.88), (0.32, 0.92), (0.08, 0.55)],
    "venezuela": [(0.08, 0.04), (0.42, 0.00), (0.78, 0.06), (0.88, 0.22), (0.55, 0.32), (0.18, 0.28)],
    "bolivia": [(0.18, 0.28), (0.55, 0.32), (0.58, 0.58), (0.32, 0.70), (0.10, 0.58)],
    "brasil": [(0.55, 0.32), (0.88, 0.22), (1.00, 0.38), (0.96, 0.62), (0.72, 0.72), (0.58, 0.58)],
    "argentina": [(0.10, 0.58), (0.32, 0.70), (0.58, 0.58), (0.72, 0.72), (0.60, 0.92), (0.32, 1.00), (0.12, 0.86)],
    "islandia": [(0.06, 0.00), (0.26, 0.00), (0.24, 0.14), (0.06, 0.16)],
    "inglaterra": [(0.00, 0.20), (0.16, 0.16), (0.20, 0.40), (0.12, 0.56), (0.00, 0.48)],
    "suecia": [(0.42, 0.02), (0.72, 0.00), (0.88, 0.18), (0.70, 0.36), (0.42, 0.32), (0.32, 0.14)],
    "franca": [(0.16, 0.40), (0.32, 0.32), (0.48, 0.42), (0.50, 0.68), (0.32, 0.86), (0.14, 0.74)],
    "alemanha": [(0.32, 0.14), (0.42, 0.32), (0.70, 0.36), (0.68, 0.58), (0.48, 0.62), (0.42, 0.38), (0.22, 0.30)],
    "polonia": [(0.70, 0.36), (0.88, 0.18), (1.00, 0.38), (0.92, 0.68), (0.68, 0.72), (0.68, 0.58)],
    "moscou": [(0.72, 0.00), (0.98, 0.04), (1.00, 0.38), (0.88, 0.18)],
    "argelia": [(0.04, 0.08), (0.38, 0.00), (0.62, 0.10), (0.58, 0.32), (0.32, 0.40), (0.06, 0.30)],
    "egito": [(0.62, 0.10), (0.88, 0.04), (1.00, 0.22), (0.90, 0.40), (0.64, 0.42), (0.58, 0.32)],
    "congo": [(0.06, 0.30), (0.32, 0.40), (0.58, 0.32), (0.60, 0.58), (0.52, 0.62), (0.28, 0.58), (0.10, 0.58)],
    "sudan": [(0.58, 0.32), (0.64, 0.42), (0.90, 0.40), (0.96, 0.62), (0.78, 0.58), (0.52, 0.62), (0.60, 0.58)],
    "africa_do_sul": [(0.28, 0.58), (0.52, 0.62), (0.78, 0.58), (0.90, 0.76), (0.72, 0.96), (0.44, 0.98), (0.30, 0.80)],
    "madagascar": [(0.12, 0.08), (0.70, 0.00), (0.95, 0.35), (0.72, 0.95), (0.10, 0.80)],
    "oriente_medio": [(0.00, 0.32), (0.16, 0.22), (0.28, 0.34), (0.24, 0.52), (0.08, 0.56), (0.00, 0.44)],
    "aral": [(0.16, 0.22), (0.32, 0.16), (0.42, 0.30), (0.34, 0.46), (0.24, 0.52), (0.28, 0.34)],
    "omsk": [(0.16, 0.22), (0.28, 0.04), (0.46, 0.06), (0.50, 0.22), (0.42, 0.30), (0.32, 0.16)],
    "dudinka": [(0.46, 0.06), (0.66, 0.02), (0.78, 0.14), (0.64, 0.26), (0.50, 0.22)],
    "siberia": [(0.50, 0.22), (0.64, 0.26), (0.78, 0.14), (0.86, 0.30), (0.70, 0.40), (0.52, 0.36)],
    "tchita": [(0.78, 0.14), (0.92, 0.10), (1.00, 0.24), (0.92, 0.38), (0.86, 0.30)],
    "mongolia": [(0.42, 0.30), (0.52, 0.36), (0.70, 0.40), (0.68, 0.56), (0.48, 0.54), (0.34, 0.46)],
    "vladivostok": [(0.86, 0.30), (0.92, 0.38), (1.00, 0.24), (1.00, 0.48), (0.86, 0.50)],
    "china": [(0.34, 0.46), (0.48, 0.54), (0.68, 0.56), (0.70, 0.72), (0.50, 0.76), (0.32, 0.64), (0.24, 0.52)],
    "india": [(0.08, 0.56), (0.24, 0.52), (0.32, 0.64), (0.28, 0.82), (0.12, 0.86), (0.04, 0.70)],
    "vietna": [(0.32, 0.64), (0.50, 0.76), (0.56, 0.88), (0.38, 0.92), (0.28, 0.82)],
    "japao": [(0.10, 0.08), (0.55, 0.00), (0.95, 0.22), (0.80, 0.70), (0.35, 0.95), (0.05, 0.55)],
    "sumatra": [(0.00, 0.06), (0.22, 0.02), (0.30, 0.26), (0.12, 0.38), (-0.02, 0.24)],
    "borneo": [(0.28, 0.04), (0.50, 0.02), (0.56, 0.26), (0.36, 0.38), (0.22, 0.22)],
    "nova_gine": [(0.54, 0.02), (0.80, 0.04), (0.90, 0.24), (0.68, 0.36), (0.50, 0.20)],
    "australia": [(0.08, 0.28), (0.40, 0.22), (0.72, 0.28), (0.88, 0.50), (0.70, 0.88), (0.32, 0.98), (0.10, 0.70)],
}

IDS = list(GROUP.keys())
assert len(IDS) == 42 and set(UV0) == set(IDS)

MIN_AREA = {
    "islandia": 350, "inglaterra": 400, "madagascar": 350, "japao": 400,
    "sumatra": 400, "borneo": 400, "nova_gine": 400,
}


def hsv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    r = rgb[..., 0].astype(np.float32) / 255.0
    g = rgb[..., 1].astype(np.float32) / 255.0
    b = rgb[..., 2].astype(np.float32) / 255.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    df = mx - mn + 1e-6
    h = np.zeros_like(mx)
    m = mx == r
    h[m] = ((g - b) / df)[m]
    m = mx == g
    h[m] = 2.0 + ((b - r) / df)[m]
    m = mx == b
    h[m] = 4.0 + ((r - g) / df)[m]
    deg = (h / 6.0 % 1.0) * 360.0
    s = df / (mx + 1e-6)
    return deg, s, mx


def paint_features(rgb: np.ndarray) -> dict[str, np.ndarray]:
    deg, sat, val = hsv(rgb)
    lum = (
        0.30 * rgb[..., 0].astype(np.float32)
        + 0.59 * rgb[..., 1].astype(np.float32)
        + 0.11 * rgb[..., 2].astype(np.float32)
    ) / 255.0
    r = rgb[..., 0].astype(np.float32) / 255.0
    g = rgb[..., 1].astype(np.float32) / 255.0
    b = rgb[..., 2].astype(np.float32) / 255.0
    edge = np.hypot(ndi.sobel(lum, axis=0), ndi.sobel(lum, axis=1))
    # Conservative sea: very dark OR blue-teal with low luma.
    sea = (val < 0.17) | (
        (deg >= 152) & (deg <= 232) & (val < 0.28) & (sat > 0.16) & (b > r + 0.015) & (lum < 0.26)
    )
    land = ~sea
    land = ndi.binary_opening(land, iterations=1)
    land = ndi.binary_closing(land, iterations=1)
    return {"deg": deg, "sat": sat, "val": val, "lum": lum, "edge": edge, "land": land, "r": r, "g": g, "b": b}


def clamp_box(box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = box
    x0 = int(np.clip(x0, 4, W - 20))
    y0 = int(np.clip(y0, 4, H - 20))
    x1 = int(np.clip(x1, x0 + 24, W - 4))
    y1 = int(np.clip(y1, y0 + 24, H - 4))
    return x0, y0, x1, y1


def fit(box: tuple[int, int, int, int], ux: float, uy: float) -> tuple[int, int]:
    x0, y0, x1, y1 = box
    x = int(round(x0 + ux * (x1 - x0)))
    y = int(round(y0 + uy * (y1 - y0)))
    return int(np.clip(x, 4, W - 5)), int(np.clip(y, 4, H - 5))


def rasterize(poly: list[int]) -> np.ndarray:
    im = Image.new("L", (W, H), 0)
    xy = [(poly[i], poly[i + 1]) for i in range(0, len(poly), 2)]
    if len(xy) >= 3:
        ImageDraw.Draw(im).polygon(xy, fill=1)
    return np.array(im, dtype=bool)


def _flat(pts: np.ndarray) -> list[int]:
    if len(pts) >= 2 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    out: list[int] = []
    for x, y in pts:
        out.extend((int(np.clip(round(float(x)), 4, W - 5)), int(np.clip(round(float(y)), 4, H - 5))))
    return out


def contour_of(region: np.ndarray, fallback: list[int], max_pts: int = 48) -> list[int]:
    area = int(region.sum())
    if area < 40:
        return list(fallback)
    cs = find_contours(region.astype(np.float32), 0.5)
    if not cs:
        return list(fallback)
    c = max(cs, key=len)
    if len(c) < 8:
        return list(fallback)
    pts = np.stack([c[:, 1], c[:, 0]], axis=1)
    tol = 1.05
    simp = approximate_polygon(pts, tolerance=tol)
    while len(simp) > max_pts and tol < 10:
        tol *= 1.18
        simp = approximate_polygon(pts, tolerance=tol)
    if len(simp) < 12 and len(pts) >= 24:
        step = max(1, len(pts) // 32)
        simp = pts[::step]
    flat = _flat(simp)
    if len(flat) < 8:
        return list(fallback)
    # Reject slivers: bbox must have both axes >= 8px and area-ish raster.
    xs, ys = flat[0::2], flat[1::2]
    if max(xs) - min(xs) < 8 or max(ys) - min(ys) < 8:
        return list(fallback)
    rast = rasterize(flat)
    if int(rast.sum()) < 80:
        return list(fallback)
    return flat


def snap_coast(
    x: int,
    y: int,
    box: tuple[int, int, int, int],
    feat: dict[str, np.ndarray],
    radius: int = 16,
) -> tuple[int, int]:
    x0, y0, x1, y1 = box
    edge = feat["edge"]
    land = feat["land"]
    best = (x, y)
    best_s = float(edge[y, x]) + (4.0 if land[y, x] else 0.0)
    for r in range(1, radius + 1):
        for ang in range(0, 360, 24):
            nx = int(round(x + r * math.cos(math.radians(ang))))
            ny = int(round(y + r * math.sin(math.radians(ang))))
            if nx < x0 or ny < y0 or nx >= x1 or ny >= y1:
                continue
            s = float(edge[ny, nx]) + (4.0 if land[ny, nx] else 0.0)
            if s > best_s:
                best_s = s
                best = (nx, ny)
    return best


def decode(
    boxes: dict[str, tuple[int, int, int, int]],
    uvs: dict[str, list[tuple[float, float]]],
    feat: dict[str, np.ndarray],
) -> dict[str, list[int]]:
    raw: dict[str, list[int]] = {}
    for tid in IDS:
        box = boxes[GROUP[tid]]
        pts = [fit(box, ux, uy) for ux, uy in uvs[tid]]
        # Midpoint subdivision so coasts can bend.
        sub: list[tuple[int, int]] = []
        n = len(pts)
        for i in range(n):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % n]
            sub.append((x0, y0))
            sub.append(((x0 + x1) // 2, (y0 + y1) // 2))
        raw[tid] = [c for p in sub for c in p]

    # Union raster per group to know interior vs coast.
    unions: dict[str, np.ndarray] = {}
    for g in boxes:
        acc = np.zeros((H, W), dtype=bool)
        for tid, gg in GROUP.items():
            if gg == g:
                acc |= rasterize(raw[tid])
        unions[g] = acc

    snapped: dict[str, list[int]] = {}
    for tid in IDS:
        g = GROUP[tid]
        box = boxes[g]
        pts = [(raw[tid][i], raw[tid][i + 1]) for i in range(0, len(raw[tid]), 2)]
        n = len(pts)
        out: list[int] = []
        union = unions[g]
        for i, (x, y) in enumerate(pts):
            prv = pts[(i - 1) % n]
            nxt = pts[(i + 1) % n]
            mx = (prv[0] + nxt[0]) / 2
            my = (prv[1] + nxt[1]) / 2
            ox = int(np.clip(x + (x - mx) * 0.35, 0, W - 1))
            oy = int(np.clip(y + (y - my) * 0.35, 0, H - 1))
            exterior = not union[oy, ox]
            if exterior:
                x, y = snap_coast(x, y, box, feat)
            out.extend((x, y))
        # Clip raster to land on the perimeter, keep UV fallback if clip dies.
        uv_rast = rasterize(out)
        keep = uv_rast & feat["land"]
        # Restore interior ocean-texture holes so pieces stay solid.
        hole = uv_rast & ~keep
        hole = hole & ~ndi.binary_dilation(~uv_rast, iterations=2)
        keep |= hole
        snapped[tid] = contour_of(keep, out)
    return snapped


def score(
    polys: dict[str, list[int]],
    boxes: dict[str, tuple[int, int, int, int]],
    feat: dict[str, np.ndarray],
) -> dict:
    land = feat["land"]
    land_fracs = []
    areas = []
    ocean = 0
    poly_px = 0
    offbox = 0
    sliver = 0
    verts_ok = 0
    for tid, poly in polys.items():
        rast = rasterize(poly)
        n = int(rast.sum())
        areas.append(n)
        if n == 0:
            land_fracs.append(0.0)
            continue
        on = int((rast & land).sum())
        land_fracs.append(on / n)
        ocean += n - on
        poly_px += n
        xs, ys = poly[0::2], poly[1::2]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        x0, y0, x1, y1 = boxes[GROUP[tid]]
        if not (x0 <= cx <= x1 and y0 <= cy <= y1):
            offbox += 1
        if max(xs) - min(xs) < 10 or max(ys) - min(ys) < 10:
            sliver += 1
        nv = len(poly) // 2
        if 8 <= nv <= 52:
            verts_ok += 1
    missing = [t for t in IDS if t not in polys]
    tiny = 0
    for tid, a in zip(polys, areas):
        if a < MIN_AREA.get(tid, 700):
            tiny += 1
    # Giants: Japan / Madagascar must stay island-sized.
    giant = 0
    for tid, cap in (("japao", 22000), ("madagascar", 18000)):
        if tid in polys and int(rasterize(polys[tid]).sum()) > cap:
            giant += 1
    mean_lf = float(np.mean(land_fracs)) if land_fracs else 0.0
    min_lf = float(np.min(land_fracs)) if land_fracs else 0.0
    spill = ocean / max(1, poly_px)
    claimed = 0
    for poly in polys.values():
        claimed += int((rasterize(poly) & land).sum())
    cover = claimed / max(1, int(land.sum()))
    # Size balance inside each group (no one piece eats the box).
    bal = 0.0
    ng = 0
    for g in boxes:
        members = [t for t, gg in GROUP.items() if gg == g]
        aa = [int(rasterize(polys[t]).sum()) if t in polys else 0 for t in members]
        if sum(aa) == 0:
            continue
        rel = np.array(aa, dtype=np.float64) / max(1, sum(aa))
        expect = 1.0 / len(members)
        bal += 1.0 - float(np.mean(np.abs(rel - expect)))
        ng += 1
    balance = bal / max(1, ng)
    total = (
        48.0 * mean_lf
        + 12.0 * min_lf
        + 10.0 * min(1.0, cover)
        + 10.0 * balance
        + 0.15 * verts_ok
        - 16.0 * spill
        - 5.0 * len(missing)
        - 1.2 * tiny
        - 3.0 * sliver
        - 4.0 * offbox
        - 6.0 * giant
    )
    return {
        "score": round(total, 3),
        "mean_land": round(mean_lf, 4),
        "min_land": round(min_lf, 4),
        "cover": round(cover, 4),
        "balance": round(balance, 4),
        "missing": missing,
        "tiny": tiny,
        "sliver": sliver,
        "offbox": offbox,
        "giant": giant,
        "n": len(polys),
        "ocean_px": ocean,
        "poly_px": poly_px,
        "verts_ok": verts_ok,
    }


def mutate(
    boxes: dict[str, tuple[int, int, int, int]],
    uvs: dict[str, list[tuple[float, float]]],
    rng: np.random.Generator,
    feat: dict[str, np.ndarray] | None = None,
    worst: list[str] | None = None,
) -> tuple[dict[str, tuple[int, int, int, int]], dict[str, list[tuple[float, float]]]]:
    nb = {k: tuple(v) for k, v in boxes.items()}
    nu = {k: [tuple(p) for p in v] for k, v in uvs.items()}
    if rng.random() < 0.55:
        g = str(rng.choice(list(nb.keys())))
        x0, y0, x1, y1 = nb[g]
        which = int(rng.integers(0, 4))
        delta = int(rng.integers(-10, 11))
        arr = [x0, y0, x1, y1]
        arr[which] += delta
        nb[g] = clamp_box((arr[0], arr[1], arr[2], arr[3]))
    targets = list(worst or [])
    if feat is not None and targets:
        land = feat["land"]
        for tid in targets[:6]:
            g = GROUP[tid]
            x0, y0, x1, y1 = nb[g]
            roi = land[y0:y1, x0:x1]
            if not roi.any():
                continue
            ys, xs = np.where(roi)
            lx = float(xs.mean()) / max(1, x1 - x0)
            ly = float(ys.mean()) / max(1, y1 - y0)
            pts = nu[tid]
            cx = sum(p[0] for p in pts) / len(pts)
            cy = sum(p[1] for p in pts) / len(pts)
            dx, dy = (lx - cx) * 0.18, (ly - cy) * 0.18
            nu[tid] = [
                (float(np.clip(ux + dx, -0.25, 1.2)), float(np.clip(uy + dy, -0.25, 1.2)))
                for ux, uy in pts
            ]
    for tid in IDS:
        if rng.random() > 0.35:
            continue
        pts = nu[tid]
        i = int(rng.integers(0, len(pts)))
        ux, uy = pts[i]
        pts[i] = (
            float(np.clip(ux + rng.normal(0, 0.035), -0.25, 1.2)),
            float(np.clip(uy + rng.normal(0, 0.035), -0.25, 1.2)),
        )
    return nb, nu


def write_ts(polys: dict[str, list[int]]) -> None:
    lines = [
        'import type { TerritoryId } from "@war2/engine";',
        'import { TERRITORIES } from "@war2/engine";',
        "",
        "export interface Layout {",
        "  id: TerritoryId;",
        "  poly: number[];",
        "  cx: number;",
        "  cy: number;",
        "  rx: number;",
        "  ry: number;",
        "  w: number;",
        "  h: number;",
        "}",
        "",
        "/** Peças UV + costa da pintura 1536×1024 (gauntlet). */",
        "const POLYS: Record<TerritoryId, number[]> = {",
    ]
    for tid in IDS:
        body = ", ".join(str(p) for p in polys[tid])
        lines.append(f"  {tid}: [{body}],")
    lines.append("};")
    lines.append(
        """
function centroid(poly: number[]): { cx: number; cy: number } {
  let x = 0;
  let y = 0;
  const n = poly.length / 2;
  for (let i = 0; i < poly.length; i += 2) {
    x += poly[i]!;
    y += poly[i + 1]!;
  }
  return { cx: x / n, cy: y / n };
}

function extents(poly: number[]): { rx: number; ry: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    const px = poly[i]!;
    const py = poly[i + 1]!;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return { rx: (maxX - minX) / 2, ry: (maxY - minY) / 2 };
}

/** Even-odd point-in-polygon. `poly` is flat [x,y,…]. */
export function pointInPoly(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2]!;
    const yi = poly[i * 2 + 1]!;
    const xj = poly[j * 2]!;
    const yj = poly[j * 2 + 1]!;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export const LAYOUT: Layout[] = TERRITORIES.map((t) => {
  const poly = POLYS[t.id];
  const { cx, cy } = centroid(poly);
  const { rx, ry } = extents(poly);
  return { id: t.id, poly, cx, cy, rx, ry, w: rx * 2, h: ry * 2 };
});

export const LAYOUT_BY_ID = Object.fromEntries(LAYOUT.map((l) => [l.id, l])) as Record<
  TerritoryId,
  Layout
>;

export const SEA_LANES: [TerritoryId, TerritoryId][] = [
  ["alaska", "vladivostok"],
  ["brasil", "argelia"],
  ["groenlandia", "islandia"],
  ["india", "sumatra"],
];

export const WORLD = { width: 1536, height: 1024 };
"""
    )
    OUT_TS.write_text("\n".join(lines), encoding="utf-8")


def preview(rgb: np.ndarray, polys: dict[str, list[int]]) -> None:
    im = Image.fromarray(rgb).convert("RGBA")
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    tint = {
        "na": (201, 162, 74, 78), "sa": (63, 138, 72, 78), "gr": (210, 210, 200, 78),
        "eu": (61, 106, 160, 78), "af": (184, 106, 58, 78), "md": (184, 106, 58, 78),
        "as": (122, 143, 58, 78), "jp": (122, 143, 58, 78), "oc": (47, 122, 114, 78),
    }
    for tid, poly in polys.items():
        xy = [(poly[i], poly[i + 1]) for i in range(0, len(poly), 2)]
        d.polygon(xy, fill=tint[GROUP[tid]], outline=(20, 12, 8, 220))
        cx = sum(p[0] for p in xy) / len(xy)
        cy = sum(p[1] for p in xy) / len(xy)
        d.text((cx - 16, cy - 5), tid[:10], fill=(250, 244, 230, 230))
    Image.alpha_composite(im, overlay).convert("RGB").save(PREVIEW, quality=88)


def run_round(
    boxes: dict[str, tuple[int, int, int, int]],
    uvs: dict[str, list[tuple[float, float]]],
    feat: dict[str, np.ndarray],
    rgb: np.ndarray,
    rng: np.random.Generator,
    iters: int,
    patience: int,
    eps: float,
    round_id: int,
) -> tuple[dict, dict[str, list[int]], dict, dict]:
    best_boxes, best_uvs = boxes, uvs
    best_polys = decode(boxes, uvs, feat)
    best_rep = score(best_polys, boxes, feat)
    best_s = best_rep["score"]
    stall = 0
    print(
        f"round {round_id} start  score={best_s:6.2f}  land={best_rep['mean_land']:.3f}  "
        f"min={best_rep['min_land']:.3f}  n={best_rep['n']}  tiny={best_rep['tiny']}  "
        f"sliver={best_rep['sliver']}  giant={best_rep['giant']}"
    )
    for it in range(1, iters + 1):
        worst_ids = []
        land = feat["land"]
        fracs = []
        for tid, poly in best_polys.items():
            rast = rasterize(poly)
            n = int(rast.sum())
            lf = int((rast & land).sum()) / n if n else 0.0
            fracs.append((lf, tid))
        fracs.sort()
        worst_ids = [t for _, t in fracs[:8]]
        nb, nu = mutate(best_boxes, best_uvs, rng, feat, worst_ids)
        polys = decode(nb, nu, feat)
        rep = score(polys, nb, feat)
        rep["round"] = round_id
        rep["iter"] = it
        with LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rep) + "\n")
        improved = rep["n"] == 42 and rep["score"] > best_s + eps
        if improved:
            best_s = rep["score"]
            best_rep = rep
            best_polys = polys
            best_boxes, best_uvs = nb, nu
            stall = 0
            write_ts(best_polys)
            preview(rgb, best_polys)
            print(
                f"  r{round_id} i{it:02d}  BEST {best_s:6.2f}  land={rep['mean_land']:.3f}  "
                f"min={rep['min_land']:.3f}  bal={rep['balance']:.3f}  tiny={rep['tiny']}  "
                f"spill={rep['ocean_px']}"
            )
        else:
            stall += 1
        if stall >= patience:
            print(f"  r{round_id} plateau after {it} iters")
            break
    return best_rep, best_polys, best_boxes, best_uvs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", type=int, default=12)
    ap.add_argument("--iters", type=int, default=28)
    ap.add_argument("--patience", type=int, default=8)
    ap.add_argument("--eps", type=float, default=0.05)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    rgb = np.array(Image.open(BOARD).convert("RGB").resize((W, H), Image.Resampling.LANCZOS))
    feat = paint_features(rgb)
    print(f"land fraction {feat['land'].mean():.3f}")
    LOG.write_text("", encoding="utf-8")
    rng = np.random.default_rng(args.seed)
    boxes = {k: clamp_box(v) for k, v in BOX0.items()}
    uvs = {k: [tuple(p) for p in v] for k, v in UV0.items()}
    if args.resume and GENOME.exists():
        saved = json.loads(GENOME.read_text(encoding="utf-8"))
        boxes = {k: clamp_box(tuple(v)) for k, v in saved["boxes"].items()}
        uvs = {k: [tuple(p) for p in v] for k, v in saved["uvs"].items()}
        print(f"resumed genome from {GENOME}")
    t0 = time.time()
    global_best = -1e9
    global_polys: dict[str, list[int]] | None = None
    global_rep: dict | None = None
    for r in range(1, args.rounds + 1):
        # Fresh jitter each round from the current best genome.
        if r > 1:
            boxes, uvs = mutate(boxes, uvs, rng, feat)
        rep, polys, boxes, uvs = run_round(
            boxes, uvs, feat, rgb, rng, args.iters, args.patience, args.eps, r
        )
        if rep["n"] == 42 and rep["score"] > global_best:
            global_best = rep["score"]
            global_polys = polys
            global_rep = rep
            write_ts(global_polys)
            preview(rgb, global_polys)
            GENOME.write_text(
                json.dumps({"boxes": boxes, "uvs": uvs, "score": global_best}, indent=2),
                encoding="utf-8",
            )
            print(f"GLOBAL BEST {global_best:.3f}")
    if global_polys is None:
        raise SystemExit("gauntlet failed: no pieces")
    write_ts(global_polys)
    preview(rgb, global_polys)
    GENOME.write_text(
        json.dumps({"boxes": boxes, "uvs": uvs, "score": global_best}, indent=2),
        encoding="utf-8",
    )
    print("BEST", json.dumps(global_rep))
    print(f"wrote {OUT_TS} and {PREVIEW} in {time.time() - t0:.1f}s")
    print("loop stopped on plateau — not carton-perfect, re-run the gauntlet to keep going")


if __name__ == "__main__":
    main()
