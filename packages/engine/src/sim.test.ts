import { describe, expect, it } from "vitest";
import { createGame } from "./createGame.ts";
import { createSeededRng } from "./rng.ts";
import { listLegalActions } from "./legal.ts";
import { reduce } from "./reduce.ts";

describe("headless match", () => {
  it("reaches a winner or survives 1500 legal moves", () => {
    const rng = createSeededRng(2026);
    let s = createGame({
      rng,
      players: [
        { id: "a", nickname: "A", color: "red" },
        { id: "b", nickname: "B", color: "blue" },
        { id: "c", nickname: "C", color: "green" },
      ],
    });
    for (let i = 0; i < 1500; i++) {
      if (s.phase === "over" || s.winnerId) break;
      const acts = listLegalActions(s, s.currentPlayerId);
      expect(acts.length, `stuck at ${s.phase} turn ${s.turnIndex}`).toBeGreaterThan(0);
      const act = acts[rng.nextInt(0, acts.length - 1)]!;
      const r = reduce(s, act, rng);
      expect(r.ok, r.ok ? "" : r.error).toBe(true);
      if (r.ok) s = r.state;
    }
    expect(s.turnIndex).toBeGreaterThan(0);
  });
});
