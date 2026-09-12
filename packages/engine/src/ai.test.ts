import { describe, expect, it } from "vitest";
import { aiChooseAction, type Difficulty } from "./ai.ts";
import { cloneState } from "./clone.ts";
import { createGame } from "./createGame.ts";
import { listLegalActions } from "./legal.ts";
import { TERRITORY_IDS } from "./map/classic.ts";
import { reduce } from "./reduce.ts";
import { createSeededRng } from "./rng.ts";
import type { Action, GameState } from "./types.ts";

function newGame(colors: Difficulty[] = ["oficial", "oficial", "oficial"], seed = 1): GameState {
  const palette = ["red", "blue", "green", "yellow", "black", "white"] as const;
  return createGame({
    rng: createSeededRng(seed),
    players: colors.map((_, i) => ({ id: `p${i + 1}`, nickname: `AI${i + 1}`, color: palette[i]! })),
  });
}

/**
 * `listLegalActions` enumerates moves with count/armies fixed at 1; `reduce` is
 * the real authority and accepts larger counts. So a legal *target* means: same
 * action type and same territories, ignoring the exact army count.
 */
function matchesLegalTarget(action: Action, legal: Action[]): boolean {
  return legal.some((l) => {
    if (l.type !== action.type) return false;
    if (action.type === "place" && l.type === "place") return l.territoryId === action.territoryId;
    if (action.type === "attack" && l.type === "attack")
      return l.from === action.from && l.to === action.to;
    if (action.type === "fortify" && l.type === "fortify")
      return l.from === action.from && l.to === action.to;
    return true;
  });
}

/** Run an all-AI game to completion (or a hard cap) applying only AI moves. */
function playOut(
  state: GameState,
  diffs: Difficulty[],
  seed = 42,
  maxActions = 200_000,
): { state: GameState; actions: number; illegal: number } {
  const rng = createSeededRng(seed);
  let s = state;
  let actions = 0;
  let illegal = 0;
  while (s.phase !== "over" && actions < maxActions) {
    const pid = s.currentPlayerId;
    const idx = Number(pid.slice(1)) - 1;
    const action = aiChooseAction(s, pid, diffs[idx]!);
    if (!action) break;
    const legal = listLegalActions(s, pid);
    if (!matchesLegalTarget(action, legal)) illegal += 1;
    const r = reduce(s, action, rng);
    if (!r.ok) throw new Error(`AI produced rejected action: ${r.error} :: ${JSON.stringify(action)}`);
    s = r.state;
    actions += 1;
  }
  return { state: s, actions, illegal };
}

describe("AI", () => {
  it("only ever emits reduce-accepted actions targeting legal squares", () => {
    const diffs: Difficulty[] = ["recruta", "oficial", "marechal"];
    const { illegal, actions } = playOut(newGame(diffs, 3), diffs, 7);
    expect(illegal).toBe(0); // playOut throws if reduce ever rejects an AI move
    expect(actions).toBeGreaterThan(100); // it actually played a lot, not one move
  });

  it("plays a full 3-AI game to a winner without getting stuck", () => {
    const diffs: Difficulty[] = ["oficial", "oficial", "oficial"];
    const { state, actions } = playOut(newGame(diffs, 5), diffs, 11);
    expect(state.phase).toBe("over");
    expect(state.winnerId).not.toBeNull();
    expect(actions).toBeLessThan(200_000);
  });

  it("terminates full games across many seeds and player counts", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const diffs: Difficulty[] = ["recruta", "oficial", "marechal", "oficial"];
      const { state } = playOut(newGame(diffs, seed), diffs, seed * 13);
      expect(state.phase).toBe("over");
      expect(state.winnerId).not.toBeNull();
    }
  });

  it("never acts out of turn or after game over", () => {
    const g = newGame(["oficial", "oficial"], 2);
    // wrong player asking
    expect(aiChooseAction(g, "p2", "oficial")).toBeNull();
    const over: GameState = { ...g, phase: "over", winnerId: "p1" };
    expect(aiChooseAction(over, over.currentPlayerId, "oficial")).toBeNull();
  });

  it("marechal takes a thin-border attack that recruta refuses", () => {
    // Deterministic contract check: on a board whose only opening is a
    // 2-army stack vs a 1-army neighbor (advantage 1), recruta must pass
    // (needs ≥3 armies and advantage ≥2) while marechal attacks.
    const s = cloneState(newGame(["recruta", "marechal"], 2));
    s.phase = "attack";
    s.currentPlayerId = "p1";
    s.pendingOccupy = null;
    s.mustTrade = false;
    for (const id of TERRITORY_IDS) {
      s.territories[id] = { ownerId: "p2", armies: 99 };
    }
    s.territories.brasil = { ownerId: "p1", armies: 2 };
    s.territories.venezuela = { ownerId: "p2", armies: 1 };

    const recruta = aiChooseAction(s, "p1", "recruta");
    expect(recruta?.type).toBe("endTurn");

    const marechal = aiChooseAction(s, "p1", "marechal");
    expect(marechal?.type).toBe("attack");
    if (marechal?.type === "attack") {
      expect(marechal.from).toBe("brasil");
      expect(marechal.to).toBe("venezuela");
    }
  });
});
