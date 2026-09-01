import { describe, expect, it } from "vitest";
import { cloneState } from "./clone.ts";
import { beginTurn, createGame, drawCard } from "./createGame.ts";
import { listLegalActions } from "./legal.ts";
import { TERRITORY_IDS, type TerritoryId } from "./map/classic.ts";
import { isObjectiveMet, objectivesForColors } from "./objectives.ts";
import { reduce } from "./reduce.ts";
import { createSeededRng } from "./rng.ts";
import type { GameCard, GameState, PlayerId } from "./types.ts";

const rng = createSeededRng(7);

const trio: GameCard[] = [
  { id: "c1", kind: "territory", territoryId: "brasil", shape: "circle" },
  { id: "c2", kind: "territory", territoryId: "mexico", shape: "circle" },
  { id: "c3", kind: "territory", territoryId: "china", shape: "circle" },
];

function twoPlayer(seed = 7): GameState {
  return createGame({
    rng: createSeededRng(seed),
    players: [
      { id: "a", nickname: "Ana", color: "red" },
      { id: "b", nickname: "Bia", color: "blue" },
    ],
  });
}

function threePlayer(seed = 1): GameState {
  return createGame({
    rng: createSeededRng(seed),
    players: [
      { id: "a", nickname: "Ana", color: "red" },
      { id: "b", nickname: "Bia", color: "blue" },
      { id: "c", nickname: "Caio", color: "green" },
    ],
  });
}

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

function crushWinRng() {
  return {
    nextInt: (() => {
      let n = 0;
      return () => {
        n += 1;
        return n <= 3 ? 6 : 1;
      };
    })(),
    shuffle: <T>(x: T[]) => x,
  };
}

function giveCards(s: GameState, playerId: PlayerId, cards: GameCard[]): void {
  s.players.find((p) => p.id === playerId)!.cards = cards;
}

describe("occupy outranks forced trade", () => {
  it("lists only occupy while pendingOccupy, and trade cannot wipe the conquest", () => {
    let s = cloneState(finishSetup(twoPlayer()));
    const me = s.currentPlayerId;
    s.phase = "attack";
    s.mustTrade = true;
    s.pendingOccupy = { from: "brasil", to: "venezuela", maxArmies: 3 };
    s.territories.brasil = { ownerId: me, armies: 5 };
    s.territories.venezuela = { ownerId: me, armies: 0 };
    giveCards(s, me, [
      ...trio,
      { id: "c4", kind: "territory", territoryId: "egito", shape: "triangle" },
      { id: "c5", kind: "territory", territoryId: "japao", shape: "square" },
      { id: "c6", kind: "territory", territoryId: "india", shape: "square" },
    ]);

    const legal = listLegalActions(s, me);
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.every((a) => a.type === "occupy")).toBe(true);

    const traded = reduce(s, { type: "trade", playerId: me, cardIds: ["c1", "c2", "c3"] }, rng);
    expect(traded.ok).toBe(false);

    const occ = reduce(s, { type: "occupy", playerId: me, armies: 3 }, rng);
    expect(occ.ok).toBe(true);
    if (!occ.ok) return;
    expect(occ.state.pendingOccupy).toBeNull();
    expect(occ.state.territories.venezuela.armies).toBe(3);
    expect(occ.state.mustTrade).toBe(true);
    expect(occ.state.phase).toBe("reinforce");
  });
});

describe("destroy_color is the eliminator's objective", () => {
  it("does not crown a third party; converts their card to 24", () => {
    let s = cloneState(finishSetup(threePlayer(2)));
    s.players.find((p) => p.id === "a")!.objective = { kind: "destroy_color", color: "green" };
    s.players.find((p) => p.id === "b")!.objective = { kind: "territories", count: 24 };
    s.players.find((p) => p.id === "c")!.objective = { kind: "territories", count: 24 };
    s.currentPlayerId = "b";
    s.phase = "attack";
    s.mustTrade = false;
    s.pendingOccupy = null;
    s.winnerId = null;
    for (const id of TERRITORY_IDS) {
      s.territories[id] = { ownerId: "b", armies: 1 };
    }
    const aLands = TERRITORY_IDS.filter((id) => id !== "brasil" && id !== "argentina").slice(0, 10);
    for (const id of aLands) s.territories[id] = { ownerId: "a", armies: 1 };
    s.territories.brasil = { ownerId: "b", armies: 5 };
    s.territories.argentina = { ownerId: "c", armies: 1 };

    const r = reduce(
      s,
      { type: "attack", playerId: "b", from: "brasil", to: "argentina", armies: 3 },
      crushWinRng(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.winnerId).toBeNull();
    expect(r.state.players.find((p) => p.id === "c")!.alive).toBe(false);
    expect(r.state.players.find((p) => p.id === "c")!.killedBy).toBe("b");
    expect(r.state.players.find((p) => p.id === "a")!.objective).toEqual({
      kind: "territories",
      count: 24,
    });
    expect(isObjectiveMet(r.state, "a")).toBe(false);

    const occ = reduce(r.state, { type: "occupy", playerId: "b", armies: 3 }, rng);
    expect(occ.ok).toBe(true);
    if (!occ.ok) return;
    expect(occ.state.winnerId).not.toBe("a");
  });

  it("lets the killer win destroy_color after occupy", () => {
    let s = cloneState(finishSetup(threePlayer(3)));
    s.players.find((p) => p.id === "a")!.objective = { kind: "territories", count: 24 };
    s.players.find((p) => p.id === "b")!.objective = { kind: "destroy_color", color: "green" };
    s.currentPlayerId = "b";
    s.phase = "attack";
    s.mustTrade = false;
    s.pendingOccupy = null;
    s.winnerId = null;
    for (const id of TERRITORY_IDS) {
      s.territories[id] = { ownerId: "a", armies: 1 };
    }
    s.territories.brasil = { ownerId: "b", armies: 5 };
    s.territories.argentina = { ownerId: "c", armies: 1 };

    const r = reduce(
      s,
      { type: "attack", playerId: "b", from: "brasil", to: "argentina", armies: 3 },
      crushWinRng(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.winnerId).toBeNull();
    const occ = reduce(r.state, { type: "occupy", playerId: "b", armies: 3 }, rng);
    expect(occ.ok).toBe(true);
    if (!occ.ok) return;
    expect(occ.state.winnerId).toBe("b");
    expect(occ.state.phase).toBe("over");
  });
});

describe("post-elimination hand limit", () => {
  it("does not force a trade at 5 inherited cards, does at 6", () => {
    let s = cloneState(finishSetup(threePlayer(4)));
    s.currentPlayerId = "b";
    s.phase = "attack";
    s.mustTrade = false;
    s.pendingOccupy = null;
    s.winnerId = null;
    for (const p of s.players) {
      p.objective = { kind: "territories_min_armies", count: 18, minArmies: 2 };
    }
    giveCards(s, "b", trio.slice(0, 2));
    giveCards(s, "c", [trio[2]!]);
    for (const id of TERRITORY_IDS) {
      s.territories[id] = { ownerId: id === "argentina" ? "c" : "a", armies: 1 };
    }
    s.territories.brasil = { ownerId: "b", armies: 5 };
    s.territories.argentina = { ownerId: "c", armies: 1 };

    const r = reduce(
      s,
      { type: "attack", playerId: "b", from: "brasil", to: "argentina", armies: 3 },
      crushWinRng(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.id === "b")!.cards).toHaveLength(3);
    expect(r.state.mustTrade).toBe(false);

    const six = cloneState(s);
    giveCards(six, "b", [
      ...trio,
      { id: "c4", kind: "territory", territoryId: "egito", shape: "triangle" },
      { id: "c5", kind: "territory", territoryId: "japao", shape: "square" },
    ]);
    giveCards(six, "c", [{ id: "c6", kind: "territory", territoryId: "india", shape: "square" }]);
    const r6 = reduce(
      six,
      { type: "attack", playerId: "b", from: "brasil", to: "argentina", armies: 3 },
      crushWinRng(),
    );
    expect(r6.ok).toBe(true);
    if (!r6.ok) return;
    expect(r6.state.players.find((p) => p.id === "b")!.cards).toHaveLength(6);
    expect(r6.state.mustTrade).toBe(true);
    const occ = reduce(r6.state, { type: "occupy", playerId: "b", armies: 1 }, rng);
    expect(occ.ok).toBe(true);
    if (!occ.ok) return;
    expect(occ.state.phase).toBe("reinforce");
    expect(listLegalActions(occ.state, "b").every((a) => a.type === "trade")).toBe(true);
  });
});

describe("discard recycle", () => {
  it("shuffles the discard into the deck before drawing", () => {
    let s = cloneState(finishSetup(twoPlayer()));
    const me = s.currentPlayerId;
    const discarded: GameCard[] = [
      { id: "d1", kind: "territory", territoryId: "brasil", shape: "circle" },
      { id: "d2", kind: "territory", territoryId: "mexico", shape: "triangle" },
      { id: "d3", kind: "territory", territoryId: "china", shape: "square" },
    ];
    s.deck = [];
    s.discard = discarded;
    const reversing = {
      nextInt: () => 1,
      shuffle: <T>(items: T[]) => [...items].reverse(),
    };
    const next = drawCard(s, me, reversing);
    expect(next.discard).toEqual([]);
    expect(next.players.find((p) => p.id === me)!.cards.at(-1)?.id).toBe("d3");
    expect(next.deck.map((c) => c.id)).toEqual(["d2", "d1"]);
  });
});

describe("victory waits for occupy", () => {
  it("does not declare a 24-territory win on the killing attack", () => {
    let s = cloneState(finishSetup(twoPlayer()));
    const me = "a";
    const other = "b";
    s.currentPlayerId = me;
    s.phase = "attack";
    s.mustTrade = false;
    s.pendingOccupy = null;
    s.winnerId = null;
    s.players.find((p) => p.id === me)!.objective = { kind: "territories", count: 24 };
    const mine = TERRITORY_IDS.filter((id) => id !== "argentina").slice(0, 23);
    for (const id of TERRITORY_IDS) {
      s.territories[id] = { ownerId: other, armies: 1 };
    }
    for (const id of mine) s.territories[id] = { ownerId: me, armies: 1 };
    s.territories.brasil = { ownerId: me, armies: 5 };
    s.territories.argentina = { ownerId: other, armies: 1 };
    const owned = TERRITORY_IDS.filter((id) => s.territories[id].ownerId === me).length;
    expect(owned).toBe(23);

    const r = reduce(
      s,
      { type: "attack", playerId: me, from: "brasil", to: "argentina", armies: 3 },
      crushWinRng(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.winnerId).toBeNull();
    expect(r.state.phase).toBe("attack");
    const occ = reduce(r.state, { type: "occupy", playerId: me, armies: 3 }, rng);
    expect(occ.ok).toBe(true);
    if (!occ.ok) return;
    expect(occ.state.winnerId).toBe(me);
  });
});

describe("one card after conquest", () => {
  it("draws one card on endTurn if conqueredThisTurn, none otherwise", () => {
    let s = cloneState(finishSetup(twoPlayer()));
    const me = s.currentPlayerId;
    const before = s.players.find((p) => p.id === me)!.cards.length;
    s.phase = "fortify";
    s.conqueredThisTurn = true;
    s.pendingOccupy = null;
    s.mustTrade = false;
    s.deck = [
      { id: "draw-1", kind: "territory", territoryId: "japao", shape: "square" },
      { id: "draw-2", kind: "territory", territoryId: "china", shape: "circle" },
    ];
    const r = reduce(s, { type: "endTurn", playerId: me }, rng);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = r.state.players.find((p) => p.id === me)!;
    expect(after.cards.length).toBe(before + 1);
    expect(after.cards.some((c) => c.id === "draw-1")).toBe(true);

    const s2 = cloneState(s);
    s2.conqueredThisTurn = false;
    const r2 = reduce(s2, { type: "endTurn", playerId: me }, rng);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.players.find((p) => p.id === me)!.cards.length).toBe(before);
  });
});

describe("eliminated seats", () => {
  it("skips a dead player on endTurn", () => {
    let s = cloneState(finishSetup(threePlayer(8)));
    s.playerOrder = ["a", "b", "c"];
    s.currentPlayerId = "a";
    s.phase = "attack";
    s.mustTrade = false;
    s.pendingOccupy = null;
    s.conqueredThisTurn = false;
    s.players.find((p) => p.id === "b")!.alive = false;
    const r = reduce(s, { type: "endTurn", playerId: "a" }, rng);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.currentPlayerId).toBe("c");
  });
});

describe("trade table and +2", () => {
  it("pays 4 then 6 globally and +2 on each owned territory in the trio", () => {
    let s = cloneState(finishSetup(twoPlayer()));
    const me = s.currentPlayerId;
    s.phase = "reinforce";
    s.mustTrade = false;
    s.tradeCount = 0;
    s.armiesToPlace = { general: 0, byContinent: {}, byTerritory: {} };
    s.territories.brasil = { ownerId: me, armies: 1 };
    s.territories.venezuela = { ownerId: me, armies: 1 };
    giveCards(s, me, [
      { id: "t1", kind: "territory", territoryId: "brasil", shape: "circle" },
      { id: "t2", kind: "territory", territoryId: "venezuela", shape: "circle" },
      { id: "t3", kind: "territory", territoryId: "china", shape: "circle" },
      { id: "t4", kind: "territory", territoryId: "egito", shape: "triangle" },
      { id: "t5", kind: "territory", territoryId: "japao", shape: "square" },
      { id: "t6", kind: "territory", territoryId: "india", shape: "circle" },
    ]);
    const r1 = reduce(s, { type: "trade", playerId: me, cardIds: ["t1", "t2", "t3"] }, rng);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.state.tradeCount).toBe(1);
    expect(r1.state.armiesToPlace.general).toBe(4);
    expect(r1.state.armiesToPlace.byTerritory.brasil).toBe(2);
    expect(r1.state.armiesToPlace.byTerritory.venezuela).toBe(2);

    const r2 = reduce(r1.state, { type: "trade", playerId: me, cardIds: ["t4", "t5", "t6"] }, rng);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.tradeCount).toBe(2);
    expect(r2.state.armiesToPlace.general).toBe(10);
  });
});

describe("objectivesForColors", () => {
  it("drops destroy cards for colors that are not seated", () => {
    const pool = objectivesForColors(["red", "blue", "green"]);
    const destroy = pool.filter((o) => o.kind === "destroy_color");
    expect(destroy.map((o) => o.kind === "destroy_color" && o.color)).toEqual([
      "blue",
      "red",
      "green",
    ]);
    expect(destroy.some((o) => o.kind === "destroy_color" && o.color === "white")).toBe(false);
    expect(destroy.some((o) => o.kind === "destroy_color" && o.color === "black")).toBe(false);
    expect(destroy.some((o) => o.kind === "destroy_color" && o.color === "yellow")).toBe(false);
  });
});

describe("immutability beyond setup place", () => {
  it("does not mutate input on attack, occupy, trade, or fortify", () => {
    let s = cloneState(finishSetup(twoPlayer()));
    const me = s.currentPlayerId;
    s.phase = "attack";
    s.mustTrade = false;
    s.territories.brasil = { ownerId: me, armies: 5 };
    s.territories.argentina = { ownerId: s.playerOrder.find((id) => id !== me)!, armies: 1 };
    const snap = JSON.stringify(s);
    const r = reduce(
      s,
      { type: "attack", playerId: me, from: "brasil", to: "argentina", armies: 3 },
      crushWinRng(),
    );
    expect(r.ok).toBe(true);
    expect(JSON.stringify(s)).toBe(snap);
    if (!r.ok) return;
    const snap2 = JSON.stringify(r.state);
    const occ = reduce(r.state, { type: "occupy", playerId: me, armies: 3 }, rng);
    expect(occ.ok).toBe(true);
    expect(JSON.stringify(r.state)).toBe(snap2);

    const t = cloneState(s);
    t.phase = "reinforce";
    giveCards(t, me, trio);
    const snap3 = JSON.stringify(t);
    const tr = reduce(t, { type: "trade", playerId: me, cardIds: ["c1", "c2", "c3"] }, rng);
    expect(tr.ok).toBe(true);
    expect(JSON.stringify(t)).toBe(snap3);

    const f = cloneState(s);
    f.phase = "fortify";
    f.territories.brasil = { ownerId: me, armies: 5 };
    f.territories.venezuela = { ownerId: me, armies: 1 };
    const snap4 = JSON.stringify(f);
    const fr = reduce(f, { type: "fortify", playerId: me, from: "brasil", to: "venezuela", armies: 4 }, rng);
    expect(fr.ok).toBe(true);
    expect(JSON.stringify(f)).toBe(snap4);
  });
});

describe("beginTurn continent bonus", () => {
  it("puts South America bonus in byContinent", () => {
    let s = cloneState(finishSetup(twoPlayer()));
    const me = s.currentPlayerId;
    for (const id of ["argentina", "bolivia", "brasil", "venezuela"] as TerritoryId[]) {
      s.territories[id] = { ownerId: me, armies: 1 };
    }
    s = beginTurn(s, me);
    expect(s.armiesToPlace.byContinent.south_america).toBe(2);
    expect(s.armiesToPlace.general).toBeGreaterThanOrEqual(3);
  });
});
