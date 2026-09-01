import { describe, expect, it } from "vitest";
import { defendDiceCount } from "./combat.ts";
import { createGame } from "./createGame.ts";
import { listLegalActions } from "./legal.ts";
import { createSeededRng } from "./rng.ts";
import { reduce } from "./reduce.ts";
import type { GameState } from "./types.ts";

const rng = createSeededRng(5);

function finishSetup(s: GameState): GameState {
  let st = s;
  let n = 0;
  while (st.phase === "setup_place") {
    const act = listLegalActions(st, st.currentPlayerId)[0];
    if (!act) throw new Error("setup");
    const r = reduce(st, act, rng);
    if (!r.ok) throw new Error(r.error);
    st = r.state;
    if (++n > 5000) throw new Error("setup stuck");
  }
  return st;
}

describe("turn flow extras", () => {
  it("starts the first ordered player after setup", () => {
    const g = createGame({
      rng: createSeededRng(8),
      players: [
        { id: "a", nickname: "A", color: "red" },
        { id: "b", nickname: "B", color: "blue" },
      ],
    });
    const first = g.playerOrder[0];
    const done = finishSetup(g);
    expect(done.phase).toBe("reinforce");
    expect(done.currentPlayerId).toBe(first);
  });

  it("defense may use 3 dice", () => {
    expect(defendDiceCount(1)).toBe(1);
    expect(defendDiceCount(2)).toBe(2);
    expect(defendDiceCount(3)).toBe(3);
    expect(defendDiceCount(10)).toBe(3);
  });
});
