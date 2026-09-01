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

/**
 * Peças originais do tabuleiro (1792×1008). Recorte estilo conquista clássica
 * (AN à esquerda, AS pendurada, Europa compacta no centro, África abaixo,
 * Ásia à direita, Oceania no canto). Arestas vizinhas coincidem de propósito.
 */
const POLYS: Record<TerritoryId, number[]> = {
  alaska: [18, 168, 78, 88, 188, 68, 228, 128, 188, 198, 98, 228, 28, 208],
  mackenzie: [188, 68, 348, 38, 468, 58, 508, 128, 438, 178, 288, 198, 228, 128],
  groenlandia: [518, 18, 668, 28, 698, 108, 648, 188, 548, 198, 498, 118],
  vancouver: [28, 208, 98, 228, 188, 198, 228, 268, 188, 348, 78, 368, 18, 298],
  ottawa: [188, 198, 288, 198, 438, 178, 468, 248, 378, 318, 238, 328, 228, 268],
  labrador: [438, 178, 508, 128, 588, 138, 618, 218, 548, 298, 468, 248],
  california: [18, 298, 78, 368, 188, 348, 238, 328, 268, 418, 178, 478, 48, 458],
  nova_york: [238, 328, 378, 318, 468, 248, 548, 298, 538, 398, 398, 468, 268, 418],
  mexico: [178, 478, 268, 418, 398, 468, 428, 538, 318, 588, 198, 568, 148, 518],

  venezuela: [198, 568, 318, 588, 428, 538, 468, 598, 348, 648, 218, 628],
  bolivia: [218, 628, 348, 648, 368, 778, 258, 818, 178, 738],
  brasil: [348, 648, 468, 598, 578, 578, 618, 698, 548, 818, 368, 778],
  argentina: [258, 818, 368, 778, 548, 818, 518, 978, 308, 988, 218, 908],

  islandia: [708, 48, 788, 38, 808, 108, 738, 128, 698, 88],
  inglaterra: [698, 148, 798, 128, 828, 198, 788, 258, 698, 248, 678, 188],
  suecia: [808, 38, 968, 28, 1008, 88, 968, 168, 828, 178, 808, 108],
  franca: [678, 188, 698, 248, 788, 258, 838, 318, 778, 368, 668, 348, 648, 268],
  alemanha: [828, 178, 968, 168, 998, 228, 948, 298, 838, 318, 788, 258],
  polonia: [968, 168, 1008, 88, 1128, 78, 1168, 168, 1108, 258, 998, 228],
  moscou: [1008, 28, 1228, 18, 1288, 98, 1228, 198, 1168, 168, 1128, 78],

  argelia: [648, 348, 778, 368, 838, 318, 948, 298, 978, 398, 888, 478, 698, 488, 638, 418],
  egito: [948, 298, 1108, 258, 1188, 308, 1168, 408, 1048, 458, 978, 398],
  congo: [698, 488, 888, 478, 928, 558, 868, 668, 718, 688, 658, 588],
  sudan: [888, 478, 978, 398, 1048, 458, 1168, 408, 1188, 528, 1088, 628, 928, 558],
  africa_do_sul: [718, 688, 868, 668, 928, 558, 1088, 628, 1068, 778, 928, 868, 748, 848],
  madagascar: [1108, 688, 1198, 678, 1218, 818, 1128, 838],

  oriente_medio: [1168, 168, 1228, 198, 1288, 98, 1368, 148, 1388, 268, 1288, 348, 1188, 308],
  aral: [1228, 198, 1288, 98, 1368, 148, 1428, 198, 1408, 278, 1288, 348],
  omsk: [1228, 18, 1428, 8, 1488, 78, 1428, 198, 1368, 148, 1288, 98],
  dudinka: [1428, 8, 1628, 8, 1688, 68, 1608, 128, 1488, 78],
  siberia: [1488, 78, 1608, 128, 1688, 68, 1728, 148, 1648, 218, 1508, 198],
  tchita: [1608, 128, 1688, 68, 1768, 88, 1778, 188, 1688, 228, 1648, 218],
  mongolia: [1428, 198, 1508, 198, 1648, 218, 1688, 228, 1668, 318, 1528, 338, 1408, 278],
  vladivostok: [1768, 88, 1788, 118, 1788, 228, 1728, 258, 1688, 228, 1778, 188],
  china: [1408, 278, 1528, 338, 1668, 318, 1688, 398, 1588, 478, 1428, 468, 1368, 368],
  japao: [1688, 228, 1728, 258, 1788, 228, 1788, 348, 1708, 378, 1668, 318],
  india: [1288, 348, 1408, 278, 1368, 368, 1428, 468, 1368, 548, 1228, 538, 1188, 428],
  vietna: [1428, 468, 1588, 478, 1628, 548, 1528, 598, 1388, 568, 1368, 548],

  sumatra: [1228, 538, 1368, 548, 1388, 568, 1368, 648, 1228, 658, 1188, 588],
  borneo: [1388, 568, 1528, 598, 1568, 548, 1628, 548, 1648, 628, 1528, 668, 1388, 648],
  nova_gine: [1628, 548, 1768, 538, 1788, 598, 1768, 668, 1648, 628],
  australia: [1368, 648, 1528, 668, 1648, 628, 1768, 668, 1768, 848, 1628, 928, 1428, 918, 1328, 808],
};

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

export const WORLD = { width: 1792, height: 1008 };
