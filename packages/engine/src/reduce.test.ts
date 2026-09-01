import { describe, expect, it } from "vitest";
import { cloneState } from "./clone.ts";
import { beginTurn, createGame } from "./createGame.ts";
import { createSeededRng } from "./rng.ts";
import { reduce } from "./reduce.ts";
import { listLegalActions } from "./legal.ts";
import { pendingPlaceTotal } from "./cards.ts";
import type { GameState } from "./types.ts";
import type { TerritoryId } from "./map/classic.ts";
import { areNeighbors, TERRITORY_IDS } from "./map/classic.ts";

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

  it("rejects occupy below dice used or above origin-1, and leaves ≥1 on origin", () => {
    let s = dumpAll(finishSetup(game()));
    const me = s.currentPlayerId;
    const other = s.playerOrder.find((id) => id !== me)!;
    s = cloneState(s);
    s.phase = "attack";
    s.mustTrade = false;
    s.pendingOccupy = null;
    s.territories.brasil = { ownerId: me, armies: 5 };
    s.territories.venezuela = { ownerId: other, armies: 1 };
    const crush = {
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
      { type: "attack", playerId: me, from: "brasil", to: "venezuela", armies: 3 },
      crush,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.pendingOccupy).toEqual({
      from: "brasil",
      to: "venezuela",
      minArmies: 3,
      maxArmies: 4,
    });
    expect(r.state.territories.brasil.armies).toBe(5);

    const tooFew = reduce(r.state, { type: "occupy", playerId: me, armies: 2 }, crush);
    expect(tooFew.ok).toBe(false);
    if (!tooFew.ok) expect(tooFew.error).toBe("ocupação fora do intervalo");

    const tooMany = reduce(r.state, { type: "occupy", playerId: me, armies: 5 }, crush);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error).toBe("ocupação fora do intervalo");

    const legal = listLegalActions(r.state, me);
    expect(legal.every((a) => a.type === "occupy")).toBe(true);
    expect(legal.filter((a) => a.type === "occupy").map((a) => a.armies)).toEqual([3, 4]);

    const occDice = reduce(r.state, { type: "occupy", playerId: me, armies: 3 }, crush);
    expect(occDice.ok).toBe(true);
    if (!occDice.ok) return;
    expect(occDice.state.territories.venezuela.armies).toBe(3);
    expect(occDice.state.territories.brasil.armies).toBe(2);
    expect(occDice.state.territories.brasil.armies).toBeGreaterThanOrEqual(1);
    expect(occDice.state.pendingOccupy).toBeNull();

    const occMax = reduce(r.state, { type: "occupy", playerId: me, armies: 4 }, crush);
    expect(occMax.ok).toBe(true);
    if (!occMax.ok) return;
    expect(occMax.state.territories.venezuela.armies).toBe(4);
    expect(occMax.state.territories.brasil.armies).toBe(1);
  });

  it("allows exactly one connected-path fortify per turn", () => {
    let s = dumpAll(finishSetup(game()));
    const me = s.currentPlayerId;
    const other = s.playerOrder.find((id) => id !== me)!;
    s = cloneState(s);
    s.phase = "fortify";
    s.fortifiedThisTurn = false;
    for (const id of TERRITORY_IDS) {
      s.territories[id] = { ownerId: other, armies: 1 };
    }
    s.territories.brasil = { ownerId: me, armies: 5 };
    s.territories.venezuela = { ownerId: me, armies: 1 };
    s.territories.mexico = { ownerId: me, armies: 1 };
    s.territories.japao = { ownerId: me, armies: 1 };
    expect(areNeighbors("brasil", "venezuela")).toBe(true);
    expect(areNeighbors("venezuela", "mexico")).toBe(true);
    expect(areNeighbors("brasil", "mexico")).toBe(false);

    const r1 = reduce(
      s,
      { type: "fortify", playerId: me, from: "brasil", to: "venezuela", armies: 4 },
      rng,
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.state.fortifiedThisTurn).toBe(true);
    expect(r1.state.territories.brasil.armies).toBe(1);
    expect(r1.state.territories.venezuela.armies).toBe(5);

    const r2 = reduce(
      r1.state,
      { type: "fortify", playerId: me, from: "venezuela", to: "mexico", armies: 1 },
      rng,
    );
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe("só um deslocamento por turno");

    const hop = cloneState(s);
    const r3 = reduce(
      hop,
      { type: "fortify", playerId: me, from: "brasil", to: "mexico", armies: 4 },
      rng,
    );
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.state.territories.brasil.armies).toBe(1);
    expect(r3.state.territories.mexico.armies).toBe(5);
    expect(r3.state.fortifiedThisTurn).toBe(true);

    const isolated = cloneState(s);
    const r4 = reduce(
      isolated,
      { type: "fortify", playerId: me, from: "brasil", to: "japao", armies: 1 },
      rng,
    );
    expect(r4.ok).toBe(false);
    if (!r4.ok) expect(r4.error).toBe("sem caminho por territórios seus");
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
