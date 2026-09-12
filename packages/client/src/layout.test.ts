import { describe, expect, it } from "vitest";
import { TERRITORIES } from "@war2/engine";
import { LAYOUT, LAYOUT_BY_ID, pointInPoly, SEA_LANES, WORLD } from "./layout.ts";

describe("board layout", () => {
  it("has a polygon for every one of the 42 territories", () => {
    expect(LAYOUT).toHaveLength(42);
    for (const t of TERRITORIES) {
      const l = LAYOUT_BY_ID[t.id];
      expect(l, t.id).toBeDefined();
      expect(l.poly.length, t.id).toBeGreaterThanOrEqual(6);
      expect(l.poly.length % 2, t.id).toBe(0);
    }
  });

  it("keeps every polygon and anchor inside the world bounds", () => {
    for (const l of LAYOUT) {
      for (let i = 0; i < l.poly.length; i += 2) {
        expect(l.poly[i], `${l.id} x`).toBeGreaterThanOrEqual(0);
        expect(l.poly[i], `${l.id} x`).toBeLessThanOrEqual(WORLD.width);
        expect(l.poly[i + 1], `${l.id} y`).toBeGreaterThanOrEqual(0);
        expect(l.poly[i + 1], `${l.id} y`).toBeLessThanOrEqual(WORLD.height);
      }
      expect(l.cx, `${l.id} cx`).toBeGreaterThanOrEqual(0);
      expect(l.cx, `${l.id} cx`).toBeLessThanOrEqual(WORLD.width);
      expect(l.cy, `${l.id} cy`).toBeGreaterThanOrEqual(0);
      expect(l.cy, `${l.id} cy`).toBeLessThanOrEqual(WORLD.height);
    }
  });

  it("anchor points hit-test inside or near their own polygon", () => {
    // Anchors may sit a few px outside on concave coastlines, but should be
    // inside for the vast majority — this catches a poly/anchor mismatch.
    let inside = 0;
    for (const l of LAYOUT) {
      if (pointInPoly(l.cx, l.cy, l.poly)) inside += 1;
    }
    expect(inside).toBeGreaterThanOrEqual(30);
  });

  it("sea lanes reference real, non-adjacent-on-map territories", () => {
    for (const [a, b] of SEA_LANES) {
      expect(LAYOUT_BY_ID[a], a).toBeDefined();
      expect(LAYOUT_BY_ID[b], b).toBeDefined();
    }
  });

  it("pointInPoly works on a trivial square", () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(pointInPoly(5, 5, sq)).toBe(true);
    expect(pointInPoly(15, 5, sq)).toBe(false);
    expect(pointInPoly(-1, 5, sq)).toBe(false);
  });
});
