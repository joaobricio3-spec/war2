#!/usr/bin/env python3
"""Map 42 original pieces onto the packed 1536×1024 painting.

Each continent is authored in unit-space [0,1]² then fitted to the painted
land bbox so Brazil sits on the green continent, Europe on the blue cluster,
etc. Shared unit vertices keep seams nested. Not a copy of any commercial board.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_TS = ROOT / "packages/client/src/layout.ts"
PREVIEW = Path("/tmp/layout-preview.png")
BOARD = ROOT / "packages/client/public/assets/world-board.jpg"
W, H = 1536, 1024

# Painted land boxes (from the 100px grid on world-board.jpg).
BOX = {
    "na": (85, 75, 415, 505),
    "sa": (265, 535, 458, 955),
    "gr": (475, 28, 668, 208),
    "eu": (555, 175, 825, 455),
    "af": (560, 450, 895, 915),
    "as": (800, 55, 1415, 705),
    "oc": (1145, 665, 1445, 938),
    "is": (575, 175, 655, 245),
    "en": (555, 230, 640, 340),
    "jp": (1310, 255, 1405, 405),
    "md": (800, 730, 870, 870),
}


def fit(box: str, ux: float, uy: float) -> tuple[int, int]:
    x0, y0, x1, y1 = BOX[box]
    return int(x0 + ux * (x1 - x0)), int(y0 + uy * (y1 - y0))


def poly(box: str, *uv: tuple[float, float]) -> list[int]:
    out: list[int] = []
    for ux, uy in uv:
        x, y = fit(box, ux, uy)
        out.extend((max(6, min(W - 6, x)), max(6, min(H - 6, y))))
    return out


# Unit-space War-like partitions. Neighbors share the same UV corners.
POLYS: dict[str, list[int]] = {
    # North America
    "alaska": poly(
        "na",
        (0.02, 0.18), (0.12, 0.04), (0.30, 0.08), (0.34, 0.24),
        (0.26, 0.36), (0.10, 0.38), (0.02, 0.30),
    ),
    "mackenzie": poly(
        "na",
        (0.30, 0.08), (0.50, 0.02), (0.70, 0.06), (0.76, 0.22),
        (0.62, 0.34), (0.42, 0.36), (0.34, 0.24),
    ),
    "vancouver": poly(
        "na",
        (0.02, 0.30), (0.10, 0.38), (0.26, 0.36), (0.34, 0.24),
        (0.40, 0.48), (0.22, 0.60), (0.04, 0.56),
    ),
    "ottawa": poly(
        "na",
        (0.34, 0.24), (0.42, 0.36), (0.62, 0.34), (0.70, 0.48),
        (0.54, 0.60), (0.40, 0.48),
    ),
    "labrador": poly(
        "na",
        (0.62, 0.34), (0.76, 0.22), (0.92, 0.20), (0.98, 0.40),
        (0.82, 0.54), (0.70, 0.48),
    ),
    "california": poly(
        "na",
        (0.04, 0.56), (0.22, 0.60), (0.40, 0.48), (0.48, 0.68),
        (0.32, 0.82), (0.10, 0.80), (0.02, 0.68),
    ),
    "nova_york": poly(
        "na",
        (0.40, 0.48), (0.54, 0.60), (0.70, 0.48), (0.82, 0.54),
        (0.88, 0.70), (0.68, 0.80), (0.48, 0.68),
    ),
    "mexico": poly(
        "na",
        (0.10, 0.80), (0.32, 0.82), (0.48, 0.68), (0.68, 0.80),
        (0.62, 0.96), (0.38, 1.00), (0.18, 0.94),
    ),
    "groenlandia": poly(
        "gr",
        (0.08, 0.12), (0.40, 0.02), (0.78, 0.10), (0.92, 0.40),
        (0.70, 0.88), (0.32, 0.92), (0.08, 0.55),
    ),
    # South America — narrow painted continent
    "venezuela": poly(
        "sa",
        (0.08, 0.04), (0.42, 0.00), (0.78, 0.06), (0.88, 0.22),
        (0.55, 0.32), (0.18, 0.28),
    ),
    "bolivia": poly(
        "sa",
        (0.18, 0.28), (0.55, 0.32), (0.58, 0.58), (0.32, 0.70),
        (0.10, 0.58),
    ),
    "brasil": poly(
        "sa",
        (0.55, 0.32), (0.88, 0.22), (1.00, 0.38), (0.96, 0.62),
        (0.72, 0.72), (0.58, 0.58),
    ),
    "argentina": poly(
        "sa",
        (0.10, 0.58), (0.32, 0.70), (0.58, 0.58), (0.72, 0.72),
        (0.60, 0.92), (0.32, 1.00), (0.12, 0.86),
    ),
    # Europe — compact blue cluster
    "islandia": poly(
        "eu",
        (0.06, 0.00), (0.26, 0.00), (0.24, 0.14), (0.06, 0.16),
    ),
    "inglaterra": poly(
        "eu",
        (0.00, 0.20), (0.16, 0.16), (0.20, 0.40), (0.12, 0.56), (0.00, 0.48),
    ),
    "suecia": poly(
        "eu",
        (0.42, 0.02), (0.72, 0.00), (0.88, 0.18), (0.70, 0.36),
        (0.42, 0.32), (0.32, 0.14),
    ),
    "franca": poly(
        "eu",
        (0.16, 0.40), (0.32, 0.32), (0.48, 0.42), (0.50, 0.68),
        (0.32, 0.86), (0.14, 0.74),
    ),
    "alemanha": poly(
        "eu",
        (0.32, 0.14), (0.42, 0.32), (0.70, 0.36), (0.68, 0.58),
        (0.48, 0.62), (0.42, 0.38), (0.22, 0.30),
    ),
    "polonia": poly(
        "eu",
        (0.70, 0.36), (0.88, 0.18), (1.00, 0.38), (0.92, 0.68),
        (0.68, 0.72), (0.68, 0.58),
    ),
    "moscou": poly(
        "eu",
        (0.72, 0.00), (0.98, 0.04), (1.00, 0.38), (0.88, 0.18),
    ),
    # Africa
    "argelia": poly(
        "af",
        (0.04, 0.08), (0.38, 0.00), (0.62, 0.10), (0.58, 0.32),
        (0.32, 0.40), (0.06, 0.30),
    ),
    "egito": poly(
        "af",
        (0.62, 0.10), (0.88, 0.04), (1.00, 0.22), (0.90, 0.40),
        (0.64, 0.42), (0.58, 0.32),
    ),
    "congo": poly(
        "af",
        (0.06, 0.30), (0.32, 0.40), (0.58, 0.32), (0.60, 0.58),
        (0.52, 0.62), (0.28, 0.58), (0.10, 0.58),
    ),
    "sudan": poly(
        "af",
        (0.58, 0.32), (0.64, 0.42), (0.90, 0.40), (0.96, 0.62),
        (0.78, 0.58), (0.52, 0.62), (0.60, 0.58),
    ),
    "africa_do_sul": poly(
        "af",
        (0.28, 0.58), (0.52, 0.62), (0.78, 0.58), (0.90, 0.76),
        (0.72, 0.96), (0.44, 0.98), (0.30, 0.80),
    ),
    "madagascar": poly(
        "md",
        (0.12, 0.08), (0.70, 0.00), (0.95, 0.35), (0.72, 0.95), (0.10, 0.80),
    ),
    # Asia — large right land
    "oriente_medio": poly(
        "as",
        (0.00, 0.32), (0.16, 0.22), (0.28, 0.34), (0.24, 0.52),
        (0.08, 0.56), (0.00, 0.44),
    ),
    "aral": poly(
        "as",
        (0.16, 0.22), (0.32, 0.16), (0.42, 0.30), (0.34, 0.46),
        (0.24, 0.52), (0.28, 0.34),
    ),
    "omsk": poly(
        "as",
        (0.16, 0.22), (0.28, 0.04), (0.46, 0.06), (0.50, 0.22),
        (0.42, 0.30), (0.32, 0.16),
    ),
    "dudinka": poly(
        "as",
        (0.46, 0.06), (0.66, 0.02), (0.78, 0.14), (0.64, 0.26),
        (0.50, 0.22),
    ),
    "siberia": poly(
        "as",
        (0.50, 0.22), (0.64, 0.26), (0.78, 0.14), (0.86, 0.30),
        (0.70, 0.40), (0.52, 0.36),
    ),
    "tchita": poly(
        "as",
        (0.78, 0.14), (0.92, 0.10), (1.00, 0.24), (0.92, 0.38),
        (0.86, 0.30),
    ),
    "mongolia": poly(
        "as",
        (0.42, 0.30), (0.52, 0.36), (0.70, 0.40), (0.68, 0.56),
        (0.48, 0.54), (0.34, 0.46),
    ),
    "vladivostok": poly(
        "as",
        (0.86, 0.30), (0.92, 0.38), (1.00, 0.24), (1.00, 0.48),
        (0.86, 0.50),
    ),
    "china": poly(
        "as",
        (0.34, 0.46), (0.48, 0.54), (0.68, 0.56), (0.70, 0.72),
        (0.50, 0.76), (0.32, 0.64), (0.24, 0.52),
    ),
    "india": poly(
        "as",
        (0.08, 0.56), (0.24, 0.52), (0.32, 0.64), (0.28, 0.82),
        (0.12, 0.86), (0.04, 0.70),
    ),
    "vietna": poly(
        "as",
        (0.32, 0.64), (0.50, 0.76), (0.56, 0.88), (0.38, 0.92),
        (0.28, 0.82),
    ),
    "japao": poly(
        "jp",
        (0.10, 0.08), (0.55, 0.00), (0.95, 0.22), (0.80, 0.70),
        (0.35, 0.95), (0.05, 0.55),
    ),
    # Oceania
    "sumatra": poly(
        "oc",
        (-0.15, -0.08), (0.12, -0.12), (0.22, 0.18), (0.02, 0.32),
        (-0.18, 0.18),
    ),
    "borneo": poly(
        "oc",
        (0.18, -0.10), (0.42, -0.08), (0.50, 0.20), (0.28, 0.34),
        (0.12, 0.18),
    ),
    "nova_gine": poly(
        "oc",
        (0.48, -0.12), (0.78, -0.06), (0.88, 0.18), (0.62, 0.30),
        (0.42, 0.16),
    ),
    "australia": poly(
        "oc",
        (0.08, 0.28), (0.40, 0.22), (0.72, 0.28), (0.88, 0.50),
        (0.70, 0.88), (0.32, 0.98), (0.10, 0.70),
    ),
}

# Sea-lane islands sitting in the water (India–Sumatra already near).
# Pull Sumatra/Borneo/New Guinea up toward SE Asia / painted archipelago.
# The oc box starts at y=655; islands should sit a bit north of Australia.
# Negative uy already does that.

IDS = list(POLYS.keys())
assert len(IDS) == 42, len(IDS)


def write_ts() -> None:
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
        "/** Peças assentadas na pintura 1536×1024 (caixas dos continentes pintados). */",
        "const POLYS: Record<TerritoryId, number[]> = {",
    ]
    def with_mids(pts: list[int]) -> list[int]:
        out: list[int] = []
        n = len(pts) // 2
        for i in range(n):
            j = (i + 1) % n
            x0, y0 = pts[i * 2], pts[i * 2 + 1]
            x1, y1 = pts[j * 2], pts[j * 2 + 1]
            out.extend((x0, y0, (x0 + x1) // 2, (y0 + y1) // 2))
        return out

    for tid in IDS:
        body = ", ".join(str(p) for p in with_mids(POLYS[tid]))
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
    print("wrote", OUT_TS, "territories", len(IDS))


def preview() -> None:
    from PIL import Image, ImageDraw, ImageFont

    im = Image.open(BOARD).convert("RGBA").resize((W, H), Image.Resampling.LANCZOS)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    tint = {
        "alaska": (201, 162, 74), "mackenzie": (201, 162, 74), "groenlandia": (201, 162, 74),
        "vancouver": (201, 162, 74), "ottawa": (201, 162, 74), "labrador": (201, 162, 74),
        "california": (201, 162, 74), "nova_york": (201, 162, 74), "mexico": (201, 162, 74),
        "venezuela": (63, 138, 72), "bolivia": (63, 138, 72), "brasil": (63, 138, 72),
        "argentina": (63, 138, 72),
        "islandia": (61, 106, 160), "inglaterra": (61, 106, 160), "suecia": (61, 106, 160),
        "franca": (61, 106, 160), "alemanha": (61, 106, 160), "polonia": (61, 106, 160),
        "moscou": (61, 106, 160),
        "argelia": (184, 106, 58), "egito": (184, 106, 58), "congo": (184, 106, 58),
        "sudan": (184, 106, 58), "africa_do_sul": (184, 106, 58), "madagascar": (184, 106, 58),
        "oriente_medio": (122, 143, 58), "aral": (122, 143, 58), "omsk": (122, 143, 58),
        "dudinka": (122, 143, 58), "siberia": (122, 143, 58), "tchita": (122, 143, 58),
        "mongolia": (122, 143, 58), "vladivostok": (122, 143, 58), "china": (122, 143, 58),
        "japao": (122, 143, 58), "india": (122, 143, 58), "vietna": (122, 143, 58),
        "sumatra": (47, 122, 114), "borneo": (47, 122, 114), "nova_gine": (47, 122, 114),
        "australia": (47, 122, 114),
    }
    font = ImageFont.load_default()
    for tid, pts in POLYS.items():
        xy = [(pts[i], pts[i + 1]) for i in range(0, len(pts), 2)]
        r, g, b = tint[tid]
        d.polygon(xy, fill=(r, g, b, 72), outline=(20, 12, 8, 210))
        cx = sum(p[0] for p in xy) / len(xy)
        cy = sum(p[1] for p in xy) / len(xy)
        d.text((cx - 16, cy - 5), tid[:10], fill=(250, 244, 230, 240), font=font)
    Image.alpha_composite(im, overlay).convert("RGB").save(PREVIEW, quality=90)
    print("wrote", PREVIEW)


if __name__ == "__main__":
    write_ts()
    preview()
