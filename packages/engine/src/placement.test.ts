import { describe, expect, it } from "vitest";
import { createGame } from "./createGame.ts";
import { createSeededRng } from "./rng.ts";
import { reduce } from "./reduce.ts";
import { listLegalActions } from "./legal.ts";
import type { GameState } from "./types.ts";

const rng = createSeededRng(3);

function finishSetup(s: GameState): GameState {
  let st = s;
  while (st.phase === "setup_place") {
    const act = listLegalActions(st, st.currentPlayerId)[0];
    if (!act) throw new Error("setup");
    const r = reduce(st, act, rng);
    if (!r.ok) throw new Error(r.error);
    st = r.state;
  }
  return st;
}

describe("continent placement", () => {
  it("rejects putting continent bonus outside that continent", () => {
    const raw = createGame({
      rng: createSeededRng(11),
      players: [
        { id: "a", nickname: "A", color: "red" },
        { id: "b", nickname: "B", color: "blue" },
      ],
    });
    const s = finishSetup(raw);
    const me = s.currentPlayerId;
    s.armiesToPlace = { general: 0, byContinent: { south_america: 2 }, byTerritory: {} };
    s.mustTrade = false;
    s.phase = "reinforce";
    s.territories.brasil = { ownerId: me, armies: 1 };
    s.territories.mexico = { ownerId: me, armies: 1 };

    const outside = reduce(
      s,
      { type: "place", playerId: me, territoryId: "mexico", count: 1 },
      rng,
    );
    expect(outside.ok).toBe(false);
    const inside = reduce(s, { type: "place", playerId: me, territoryId: "brasil", count: 1 }, rng);
    expect(inside.ok).toBe(true);
    if (inside.ok) {
      expect(inside.state.territories.brasil.armies).toBe(2);
      expect(inside.state.armiesToPlace.byContinent.south_america).toBe(1);
    }
  });
});
