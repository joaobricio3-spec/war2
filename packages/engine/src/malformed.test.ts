import { describe, expect, it } from "vitest";
import { pendingPlaceTotal } from "./cards.ts";
import { createGame } from "./createGame.ts";
import { listLegalActions } from "./legal.ts";
import { TERRITORIES, TERRITORY_IDS, type TerritoryId } from "./map/classic.ts";
import { reduce } from "./reduce.ts";
import { createSeededRng } from "./rng.ts";
import type { Action, GameState } from "./types.ts";

const rng = createSeededRng(7);

function game(seed = 7): GameState {
  return createGame({
    rng: createSeededRng(seed),
    players: [
      { id: "a", nickname: "Ana", color: "red" },
      { id: "b", nickname: "Bia", color: "blue" },
    ],
  });
}

function finishSetup(s: GameState): GameState {
  let st = s;
  let guard = 0;
  while (st.phase === "setup_place") {
    const act = listLegalActions(st, st.currentPlayerId)[0];
    if (!act) throw new Error("no setup action");
    const r = reduce(st, act, rng);
    if (!r.ok) throw new Error(r.error);
    st = r.state;
    if (++guard > 2000) throw new Error("setup stuck");
  }
  return st;
}

function toAttack(s: GameState): GameState {
  let st = finishSetup(s);
  while (st.phase === "reinforce" && pendingPlaceTotal(st.armiesToPlace) > 0) {
    const place = listLegalActions(st, st.currentPlayerId).find((a) => a.type === "place");
    if (!place) throw new Error("no place action");
    const r = reduce(st, place, rng);
    if (!r.ok) throw new Error(r.error);
    st = r.state;
  }
  const r = reduce(st, { type: "endReinforce", playerId: st.currentPlayerId }, rng);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe("malformed actions", () => {
  it("rejects non-integer place counts instead of corrupting armies", () => {
    const st = finishSetup(game());
    const me = st.currentPlayerId;
    const mine = TERRITORY_IDS.find((id) => st.territories[id].ownerId === me)!;
    const before = st.territories[mine].armies;
    const bad = reduce(
      st,
      { type: "place", playerId: me, territoryId: mine, count: 1.5 } as Action,
      rng,
    );
    expect(bad.ok).toBe(false);
    const nan = reduce(
      st,
      { type: "place", playerId: me, territoryId: mine, count: Number.NaN } as Action,
      rng,
    );
    expect(nan.ok).toBe(false);
    expect(st.territories[mine].armies).toBe(before);
  });

  it("rejects unknown territory ids without throwing", () => {
    const st = game();
    const me = st.currentPlayerId;
    const bad = reduce(
      st,
      { type: "place", playerId: me, territoryId: "atlantis", count: 1 } as unknown as Action,
      rng,
    );
    expect(bad.ok).toBe(false);
  });

  it("rejects non-integer and bogus attack payloads", () => {
    const st = toAttack(game());
    const me = st.currentPlayerId;
    const [from, to] = (() => {
      for (const t of TERRITORIES) {
        if (t.id in st.territories && st.territories[t.id].ownerId === me) {
          const nb = t.neighbors.find((n) => st.territories[n].ownerId !== me);
          if (nb && st.territories[t.id].armies > 1) return [t.id, nb];
        }
      }
      throw new Error("no attack edge");
    })();
    const nan = reduce(
      st,
      { type: "attack", playerId: me, from, to, armies: Number.NaN } as Action,
      rng,
    );
    expect(nan.ok).toBe(false);
    const bogus = reduce(
      st,
      { type: "attack", playerId: me, from: "atlantis", to, armies: 1 } as unknown as Action,
      rng,
    );
    expect(bogus.ok).toBe(false);
  });

  it("rejects non-integer occupy", () => {
    const st = toAttack(game());
    st.pendingOccupy = { from: "brasil", to: "argentina", minArmies: 1, maxArmies: 3 };
    const bad = reduce(
      st,
      { type: "occupy", playerId: st.currentPlayerId, armies: 1.5 } as Action,
      rng,
    );
    expect(bad.ok).toBe(false);
  });

  it("rejects non-integer fortify and unknown endpoints", () => {
    const st = toAttack(game());
    st.phase = "fortify";
    const me = st.currentPlayerId;
    const [from, to] = TERRITORY_IDS.filter((id) => st.territories[id].ownerId === me);
    const frac = reduce(
      st,
      { type: "fortify", playerId: me, from: from!, to: to!, armies: 0.5 } as Action,
      rng,
    );
    expect(frac.ok).toBe(false);
    const bogus = reduce(
      st,
      { type: "fortify", playerId: me, from: from!, to: "atlantis", armies: 1 } as unknown as Action,
      rng,
    );
    expect(bogus.ok).toBe(false);
  });

  it("rejects non-array cardIds without throwing", () => {
    const st = finishSetup(game());
    const bad = reduce(
      st,
      { type: "trade", playerId: st.currentPlayerId, cardIds: "x" } as unknown as Action,
      rng,
    );
    expect(bad.ok).toBe(false);
  });
});

describe("createGame options", () => {
  it("honors firstPlayerId for setup order and current player", () => {
    const s = createGame({
      rng: createSeededRng(11),
      players: [
        { id: "a", nickname: "Ana", color: "red" },
        { id: "b", nickname: "Bia", color: "blue" },
        { id: "c", nickname: "Caio", color: "green" },
      ],
      firstPlayerId: "b",
    });
    expect(s.playerOrder[0]).toBe("b");
    expect(s.currentPlayerId).toBe("b");
    expect(new Set(s.playerOrder).size).toBe(3);
  });
});

describe("map goldens", () => {
  it("pins the full adjacency graph", () => {
    const edges = TERRITORIES.flatMap((t) =>
      t.neighbors.filter((n) => n > t.id).map((n) => `${t.id}|${n}`),
    ).sort();
    expect(edges).toMatchSnapshot();
  });

  it("adjacency is symmetric and every territory has a neighbor", () => {
    for (const t of TERRITORIES) {
      expect(t.neighbors.length).toBeGreaterThan(0);
      for (const n of t.neighbors) {
        const other = TERRITORIES.find((x) => x.id === n);
        expect(other?.neighbors).toContain(t.id);
      }
    }
  });
});
