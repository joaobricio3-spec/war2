import { describe, expect, it } from "vitest";
import { cloneState } from "./clone.ts";
import { beginTurn, createGame } from "./createGame.ts";
import { createSeededRng } from "./rng.ts";
import { reduce } from "./reduce.ts";
import { listLegalActions } from "./legal.ts";
import { pendingPlaceTotal } from "./cards.ts";
import type { GameState } from "./types.ts";
import type { TerritoryId } from "./map/classic.ts";
import { areNeighbors } from "./map/classic.ts";

const rng = createSeededRng(7);

function game(): GameState {
  return createGame({
    rng: createSeededRng(7),
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

function dumpAll(s: GameState): GameState {
  let st = s;
  while (st.phase === "reinforce" && pendingPlaceTotal(st.armiesToPlace) > 0 && !st.mustTrade) {
    const place = listLegalActions(st, st.currentPlayerId).find((a) => a.type === "place");
    if (!place) break;
    const r = reduce(st, place, rng);
    if (!r.ok) throw new Error(r.error);
    st = r.state;
  }
  if (st.phase === "reinforce" && pendingPlaceTotal(st.armiesToPlace) === 0 && !st.mustTrade) {
    const r = reduce(st, { type: "endReinforce", playerId: st.currentPlayerId }, rng);
    if (!r.ok) throw new Error(r.error);
    st = r.state;
  }
  return st;
}

describe("reduce", () => {
  it("does not mutate the previous state object", () => {
    const s = finishSetup(game());
    const snap = JSON.stringify(s);
    const act = listLegalActions(s, s.currentPlayerId)[0]!;
    const r = reduce(s, act, rng);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(s)).toBe(snap);
  });

  it("rejects actions out of turn", () => {
    const s = finishSetup(game());
    const other = s.playerOrder.find((id) => id !== s.currentPlayerId)!;
    const r = reduce(s, { type: "endReinforce", playerId: other }, rng);
    expect(r.ok).toBe(false);
  });

  it("grants at least 3 armies and continent bonus on owned continents", () => {
    const s = finishSetup(game());
    expect(s.phase).toBe("reinforce");
    const total = pendingPlaceTotal(s.armiesToPlace);
    expect(total).toBeGreaterThanOrEqual(3);
    const me = s.currentPlayerId;
    const withSa = cloneState(s);
    withSa.territories.argentina = { ownerId: me, armies: 1 };
    withSa.territories.bolivia = { ownerId: me, armies: 1 };
    withSa.territories.brasil = { ownerId: me, armies: 1 };
    withSa.territories.venezuela = { ownerId: me, armies: 1 };
    const turned = beginTurn(withSa, me);
    expect(turned.armiesToPlace.byContinent.south_america).toBe(2);
  });

  it("forces a trade at 5 cards", () => {
    let s = dumpAll(finishSetup(game()));
    const me = s.currentPlayerId;
    s = cloneState(s);
    s.territories.brasil = { ownerId: me, armies: 1 };
    const p = s.players.find((pl) => pl.id === me)!;
    p.cards = [
      { id: "c1", kind: "territory", territoryId: "brasil", shape: "circle" },
      { id: "c2", kind: "territory", territoryId: "mexico", shape: "circle" },
      { id: "c3", kind: "territory", territoryId: "china", shape: "circle" },
      { id: "c4", kind: "territory", territoryId: "egito", shape: "triangle" },
      { id: "c5", kind: "territory", territoryId: "japao", shape: "square" },
    ];
    s = beginTurn(s, me);
    expect(s.mustTrade).toBe(true);
    expect(s.phase).toBe("reinforce");
    const end = reduce(s, { type: "endReinforce", playerId: me }, rng);
    expect(end.ok).toBe(false);
    const tr = reduce(s, { type: "trade", playerId: me, cardIds: ["c1", "c2", "c3"] }, rng);
    expect(tr.ok).toBe(true);
    if (tr.ok) {
      expect(tr.state.tradeCount).toBe(1);
      expect(pendingPlaceTotal(tr.state.armiesToPlace)).toBeGreaterThanOrEqual(4);
      expect(tr.state.armiesToPlace.byTerritory.brasil).toBe(2);
    }
  });

  it("runs a deterministic attack with injected rng and occupy", () => {
    let s = dumpAll(finishSetup(game()));
    const me = s.currentPlayerId;
    let from: TerritoryId | null = null;
    let to: TerritoryId | null = null;
    for (const [id, t] of Object.entries(s.territories) as [TerritoryId, (typeof s.territories)[TerritoryId]][]) {
      if (t.ownerId !== me || t.armies < 2) continue;
      for (const n of Object.keys(s.territories) as TerritoryId[]) {
        if (areNeighbors(id, n) && s.territories[n].ownerId !== me) {
          from = id;
          to = n;
          break;
        }
      }
      if (from) break;
    }
    expect(from && to).toBeTruthy();
    s = cloneState(s);
    s.territories[from!].armies = 5;
    s.territories[to!].armies = 1;
    const fixed = {
      nextInt: (() => {
        let n = 0;
        return () => {
          n += 1;
          return n <= 3 ? 6 : 1;
        };
      })(),
      shuffle: <T>(x: T[]) => x,
    };
    const r = reduce(
      s,
      { type: "attack", playerId: me, from: from!, to: to!, armies: 3 },
      fixed,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.pendingOccupy).not.toBeNull();
    expect(r.state.conqueredThisTurn).toBe(true);
    const occ = reduce(r.state, { type: "occupy", playerId: me, armies: 3 }, fixed);
    expect(occ.ok).toBe(true);
    if (occ.ok) {
      expect(occ.state.territories[to!].ownerId).toBe(me);
      expect(occ.state.territories[to!].armies).toBe(3);
      expect(occ.state.territories[from!].armies).toBe(2);
    }
  });

  it("blocks chaining the same armies through two borders in one fortify", () => {
    let s = dumpAll(finishSetup(game()));
    const me = s.currentPlayerId;
    s = cloneState(s);
    s.phase = "fortify";
    s.territories.brasil = { ownerId: me, armies: 5 };
    s.territories.venezuela = { ownerId: me, armies: 1 };
    s.territories.mexico = { ownerId: me, armies: 1 };
    const r1 = reduce(
      s,
      { type: "fortify", playerId: me, from: "brasil", to: "venezuela", armies: 4 },
      rng,
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = reduce(
      r1.state,
      { type: "fortify", playerId: me, from: "venezuela", to: "mexico", armies: 4 },
      rng,
    );
    expect(r2.ok).toBe(false);
    const r3 = reduce(
      r1.state,
      { type: "fortify", playerId: me, from: "venezuela", to: "mexico", armies: 1 },
      rng,
    );
    expect(r3.ok).toBe(false);

    const parked = cloneState(s);
    parked.territories.venezuela = { ownerId: me, armies: 3 };
    const moveIn = reduce(
      parked,
      { type: "fortify", playerId: me, from: "brasil", to: "venezuela", armies: 4 },
      rng,
    );
    expect(moveIn.ok).toBe(true);
    if (!moveIn.ok) return;
    const onward = reduce(
      moveIn.state,
      { type: "fortify", playerId: me, from: "venezuela", to: "mexico", armies: 1 },
      rng,
    );
    expect(onward.ok).toBe(true);
    if (onward.ok) {
      expect(onward.state.territories.mexico.armies).toBe(2);
      expect(onward.state.territories.venezuela.armies).toBe(6);
    }
  });

  it("plays random legal moves without crashing (smoke)", () => {
    let s = finishSetup(game());
    const smokeRng = createSeededRng(123);
    for (let i = 0; i < 200; i++) {
      if (s.phase === "over") break;
      const acts = listLegalActions(s, s.currentPlayerId);
      expect(acts.length).toBeGreaterThan(0);
      const act = acts[smokeRng.nextInt(0, acts.length - 1)]!;
      const r = reduce(s, act, smokeRng);
      expect(r.ok, r.ok ? "" : r.error).toBe(true);
      if (r.ok) s = r.state;
    }
  });
});
