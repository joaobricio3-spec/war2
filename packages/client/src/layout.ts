import type { TerritoryId } from "@war2/engine";
import { TERRITORIES } from "@war2/engine";

export interface Layout {
  id: TerritoryId;
  poly: number[];
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  w: number;
  h: number;
}

/** Pixel centers on `world-relief.jpg` (1792×1008, same crop as the Grok Imagine map). */
const MARKERS: Record<TerritoryId, { cx: number; cy: number; rx: number; ry: number }> = {
  alaska: { cx: 168, cy: 198, rx: 52, ry: 36 },
  mackenzie: { cx: 300, cy: 155, rx: 70, ry: 40 },
  groenlandia: { cx: 560, cy: 95, rx: 58, ry: 42 },
  vancouver: { cx: 236, cy: 268, rx: 50, ry: 34 },
  ottawa: { cx: 360, cy: 248, rx: 52, ry: 36 },
  labrador: { cx: 468, cy: 228, rx: 44, ry: 32 },
  california: { cx: 228, cy: 368, rx: 54, ry: 38 },
  nova_york: { cx: 378, cy: 348, rx: 50, ry: 36 },
  mexico: { cx: 286, cy: 458, rx: 48, ry: 34 },
  venezuela: { cx: 392, cy: 538, rx: 42, ry: 30 },
  bolivia: { cx: 348, cy: 628, rx: 40, ry: 36 },
  brasil: { cx: 458, cy: 618, rx: 52, ry: 44 },
  argentina: { cx: 400, cy: 748, rx: 40, ry: 48 },
  islandia: { cx: 688, cy: 148, rx: 28, ry: 22 },
  inglaterra: { cx: 758, cy: 228, rx: 32, ry: 24 },
  suecia: { cx: 848, cy: 148, rx: 36, ry: 28 },
  franca: { cx: 778, cy: 302, rx: 34, ry: 26 },
  alemanha: { cx: 858, cy: 292, rx: 34, ry: 26 },
  polonia: { cx: 918, cy: 238, rx: 34, ry: 26 },
  moscou: { cx: 1024, cy: 188, rx: 52, ry: 36 },
  argelia: { cx: 808, cy: 418, rx: 56, ry: 40 },
  egito: { cx: 938, cy: 408, rx: 40, ry: 30 },
  congo: { cx: 878, cy: 538, rx: 42, ry: 34 },
  sudan: { cx: 978, cy: 508, rx: 44, ry: 36 },
  africa_do_sul: { cx: 898, cy: 688, rx: 46, ry: 40 },
  madagascar: { cx: 1048, cy: 688, rx: 28, ry: 32 },
  oriente_medio: { cx: 1048, cy: 368, rx: 46, ry: 34 },
  aral: { cx: 1148, cy: 318, rx: 42, ry: 32 },
  omsk: { cx: 1158, cy: 188, rx: 46, ry: 32 },
  siberia: { cx: 1290, cy: 148, rx: 60, ry: 36 },
  dudinka: { cx: 1430, cy: 118, rx: 48, ry: 30 },
  vladivostok: { cx: 1578, cy: 198, rx: 48, ry: 34 },
  tchita: { cx: 1410, cy: 218, rx: 40, ry: 28 },
  mongolia: { cx: 1370, cy: 288, rx: 46, ry: 30 },
  japao: { cx: 1526, cy: 338, rx: 26, ry: 30 },
  china: { cx: 1368, cy: 368, rx: 58, ry: 40 },
  india: { cx: 1230, cy: 438, rx: 46, ry: 36 },
  vietna: { cx: 1410, cy: 458, rx: 36, ry: 30 },
  sumatra: { cx: 1390, cy: 548, rx: 36, ry: 26 },
  borneo: { cx: 1488, cy: 548, rx: 34, ry: 26 },
  nova_gine: { cx: 1574, cy: 572, rx: 34, ry: 24 },
  australia: { cx: 1524, cy: 708, rx: 58, ry: 42 },
};

function ellipsePoly(cx: number, cy: number, rx: number, ry: number): number[] {
  const n = 20;
  const poly: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    poly.push(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry);
  }
  return poly;
}

export const LAYOUT: Layout[] = TERRITORIES.map((t) => {
  const m = MARKERS[t.id];
  return {
    id: t.id,
    poly: ellipsePoly(m.cx, m.cy, m.rx, m.ry),
    cx: m.cx,
    cy: m.cy,
    rx: m.rx,
    ry: m.ry,
    w: m.rx * 2,
    h: m.ry * 2,
  };
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

export const WORLD = { width: 1792, height: 1008 };
