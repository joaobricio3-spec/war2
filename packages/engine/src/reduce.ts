import { isValidTrade, pendingPlaceTotal, tradeArmies } from "./cards.ts";
import { cloneState } from "./clone.ts";
import { attackDiceCount, defendDiceCount, resolveBattle } from "./combat.ts";
import { beginTurn, drawCard, emptyPending, nextAlive } from "./createGame.ts";
import { areNeighbors, TERRITORY_BY_ID, type TerritoryId } from "./map/classic.ts";
import {
  convertOrphanDestroyObjectives,
  isObjectiveMet,
  playerControlsCount,
  territoryContinent,
} from "./objectives.ts";
import { rollDice, type Rng } from "./rng.ts";
import type { Action, GameState, PlayerId, ReduceResult } from "./types.ts";

function fail(error: string): ReduceResult {
  return { ok: false, error };
}

function checkWin(state: GameState): GameState {
  if (state.winnerId) return state;
  const next = cloneState(state);
  const order = [
    next.currentPlayerId,
    ...next.players.map((p) => p.id).filter((id) => id !== next.currentPlayerId),
  ];
  for (const id of order) {
    const p = next.players.find((pl) => pl.id === id);
    if (!p?.alive) continue;
    if (isObjectiveMet(next, p.id)) {
      next.winnerId = p.id;
      next.phase = "over";
      return next;
    }
  }
  const alive = next.players.filter((p) => p.alive);
  if (alive.length === 1 && alive[0]) {
    next.winnerId = alive[0].id;
    next.phase = "over";
  }
  return next;
}

function requireCurrent(state: GameState, playerId: PlayerId): string | null {
  if (state.phase === "over") return "partida encerrada";
  if (state.currentPlayerId !== playerId) return "não é a sua vez";
  return null;
}

function consumePlace(state: GameState, territoryId: TerritoryId, count: number): string | null {
  const t = state.territories[territoryId];
  if (t.ownerId !== state.currentPlayerId) return "território inimigo";
  let left = count;
  const byTer = state.armiesToPlace.byTerritory[territoryId] ?? 0;
  const takeTer = Math.min(byTer, left);
  if (takeTer) {
    state.armiesToPlace.byTerritory[territoryId] = byTer - takeTer;
    left -= takeTer;
  }
  const cont = territoryContinent(territoryId);
  const byCont = state.armiesToPlace.byContinent[cont] ?? 0;
  const takeCont = Math.min(byCont, left);
  if (takeCont) {
    state.armiesToPlace.byContinent[cont] = byCont - takeCont;
    left -= takeCont;
  }
  if (left > state.armiesToPlace.general) return "exércitos insuficientes / continente errado";
  state.armiesToPlace.general -= left;
  t.armies += count;
  return null;
}

function eliminateIfNeeded(state: GameState, victimId: PlayerId, killerId: PlayerId): void {
  if (playerControlsCount(state, victimId) > 0) return;
  const victim = state.players.find((p) => p.id === victimId);
  const killer = state.players.find((p) => p.id === killerId);
  if (!victim || !killer || !victim.alive) return;
  victim.alive = false;
  victim.killedBy = killerId;
  killer.cards.push(...victim.cards);
  victim.cards = [];
  state.mustTrade = killer.cards.length > 5;
  convertOrphanDestroyObjectives(state, victim.color, killerId);
}

export function reduce(state: GameState, action: Action, rng: Rng): ReduceResult {
  const err = requireCurrent(state, action.playerId);
  if (err) return fail(err);

  switch (action.type) {
    case "place":
      return place(state, action);
    case "trade":
      return trade(state, action);
    case "endReinforce":
      return endReinforce(state, action);
    case "attack":
      return attack(state, action, rng);
    case "occupy":
      return occupy(state, action);
    case "fortify":
      return fortify(state, action);
    case "endTurn":
      return endTurn(state, action, rng);
    default:
      return fail("ação desconhecida");
  }
}

function place(
  state: GameState,
  action: Extract<Action, { type: "place" }>,
): ReduceResult {
  if (action.count < 1) return fail("count < 1");
  const next = cloneState(state);

  if (next.phase === "setup_place") {
    if (action.count !== 1) return fail("no setup coloca-se 1 por vez");
    const p = next.players.find((pl) => pl.id === action.playerId)!;
    if (p.setupRemaining < 1) return fail("sem exércitos de setup");
    const t = next.territories[action.territoryId];
    if (t.ownerId !== action.playerId) return fail("território inimigo");
    t.armies += 1;
    p.setupRemaining -= 1;
    const someoneLeft = next.players.some((pl) => pl.setupRemaining > 0);
    if (!someoneLeft) {
      return { ok: true, state: checkWin(beginTurn(next, next.playerOrder[0]!)) };
    }
    let cursor = action.playerId;
    for (let i = 0; i < next.playerOrder.length; i++) {
      cursor = nextAlive(next, cursor);
      const np = next.players.find((pl) => pl.id === cursor)!;
      if (np.setupRemaining > 0) {
        next.currentPlayerId = cursor;
        break;
      }
    }
    return { ok: true, state: next };
  }

  if (next.phase !== "reinforce") return fail("não é fase de colocação");
  if (next.mustTrade) return fail("troca obrigatória");
  const placeErr = consumePlace(next, action.territoryId, action.count);
  if (placeErr) return fail(placeErr);
  return { ok: true, state: checkWin(next) };
}

function trade(
  state: GameState,
  action: Extract<Action, { type: "trade" }>,
): ReduceResult {
  if (state.pendingOccupy) return fail("ocupe o território conquistado");
  if (state.phase !== "reinforce" && !(state.phase === "attack" && state.mustTrade)) {
    return fail("troca só no reforço (ou com 6+ cartas após eliminação)");
  }
  const next = cloneState(state);
  const player = next.players.find((p) => p.id === action.playerId)!;
  const selected = action.cardIds.map((id) => player.cards.find((c) => c.id === id));
  if (selected.some((c) => !c) || new Set(action.cardIds).size !== 3) {
    return fail("3 cartas próprias");
  }
  const cards = selected as NonNullable<(typeof selected)[0]>[];
  if (!isValidTrade(cards)) return fail("trio inválido");

  const armies = tradeArmies(next.tradeCount);
  next.tradeCount += 1;
  next.armiesToPlace.general += armies;
  for (const c of cards) {
    if (c.kind === "territory" && next.territories[c.territoryId].ownerId === player.id) {
      next.armiesToPlace.byTerritory[c.territoryId] =
        (next.armiesToPlace.byTerritory[c.territoryId] ?? 0) + 2;
    }
    next.discard.push(c);
  }
  player.cards = player.cards.filter((c) => !action.cardIds.includes(c.id));
  next.mustTrade = player.cards.length >= 5;
  if (next.phase === "attack" && !next.mustTrade && pendingPlaceTotal(next.armiesToPlace) === 0) {
    /* stay in attack */
  } else if (next.phase === "attack") {
    next.phase = "reinforce";
  }
  return { ok: true, state: checkWin(next) };
}

function endReinforce(
  state: GameState,
  action: Extract<Action, { type: "endReinforce" }>,
): ReduceResult {
  if (state.phase !== "reinforce") return fail("não é reforço");
  if (state.mustTrade) return fail("troca obrigatória");
  if (pendingPlaceTotal(state.armiesToPlace) > 0) return fail("ainda há exércitos para colocar");
  const next = cloneState(state);
  next.phase = "attack";
  next.armiesToPlace = emptyPending();
  void action;
  return { ok: true, state: next };
}

function attack(
  state: GameState,
  action: Extract<Action, { type: "attack" }>,
  rng: Rng,
): ReduceResult {
  if (state.mustTrade) return fail("troca obrigatória");
  if (state.phase === "reinforce" && pendingPlaceTotal(state.armiesToPlace) === 0 && !state.mustTrade) {
    /* allow implicit? no, must endReinforce */
  }
  if (state.phase !== "attack") return fail("não é fase de ataque");
  if (state.pendingOccupy) return fail("ocupe o território conquistado");

  const from = state.territories[action.from];
  const to = state.territories[action.to];
  if (from.ownerId !== action.playerId) return fail("origem inimiga");
  if (to.ownerId === action.playerId) return fail("não ataca o próprio");
  if (!areNeighbors(action.from, action.to)) return fail("não são vizinhos");
  const diceN = attackDiceCount(from.armies, action.armies);
  if (diceN < 1 || diceN !== action.armies) return fail("número de exércitos de ataque inválido");

  const next = cloneState(state);
  const nFrom = next.territories[action.from];
  const nTo = next.territories[action.to];
  const defN = defendDiceCount(nTo.armies);
  const attackDice = rollDice(rng, diceN);
  const defendDice = rollDice(rng, defN);
  const { attackLosses, defendLosses } = resolveBattle(attackDice, defendDice);
  nFrom.armies -= attackLosses;
  nTo.armies -= defendLosses;
  next.lastBattle = { attackDice, defendDice, attackLosses, defendLosses };

  if (nTo.armies <= 0) {
    const victim = nTo.ownerId;
    nTo.armies = 0;
    nTo.ownerId = action.playerId;
    next.conqueredThisTurn = true;
    const maxArmies = nFrom.armies - 1;
    const minArmies = Math.min(diceN, maxArmies);
    next.pendingOccupy = { from: action.from, to: action.to, minArmies, maxArmies };
    eliminateIfNeeded(next, victim, action.playerId);
  }
  return { ok: true, state: next };
}

function occupy(
  state: GameState,
  action: Extract<Action, { type: "occupy" }>,
): ReduceResult {
  if (state.phase !== "attack" || !state.pendingOccupy) return fail("nada a ocupar");
  const { from, to, minArmies, maxArmies } = state.pendingOccupy;
  if (action.armies < minArmies || action.armies > maxArmies) return fail("ocupação fora do intervalo");
  const next = cloneState(state);
  const origin = next.territories[from];
  if (origin.armies - action.armies < 1) return fail("origem precisa ficar com 1");
  origin.armies -= action.armies;
  next.territories[to].armies = action.armies;
  next.territories[to].ownerId = action.playerId;
  next.pendingOccupy = null;
  if (next.mustTrade) {
    next.phase = "reinforce";
  }
  return { ok: true, state: checkWin(next) };
}

function fortify(
  state: GameState,
  action: Extract<Action, { type: "fortify" }>,
): ReduceResult {
  if (state.mustTrade) return fail("troca obrigatória");
  if (state.pendingOccupy) return fail("ocupe primeiro");
  if (state.phase === "attack") {
    const nextPhase = cloneState(state);
    nextPhase.phase = "fortify";
    return fortify(nextPhase, action);
  }
  if (state.phase !== "fortify") return fail("não é deslocamento");
  if (action.armies < 1) return fail("armies < 1");
  if (!areNeighbors(action.from, action.to)) return fail("não são vizinhos");
  const from = state.territories[action.from];
  const to = state.territories[action.to];
  if (from.ownerId !== action.playerId || to.ownerId !== action.playerId) {
    return fail("só entre territórios próprios");
  }
  const arrived = state.arrivedThisTurn[action.from] ?? 0;
  const movable = from.armies - 1 - arrived;
  if (action.armies > movable) return fail("exército já deslocado ou ocupação");

  const next = cloneState(state);
  next.territories[action.from].armies -= action.armies;
  next.territories[action.to].armies += action.armies;
  next.arrivedThisTurn[action.to] = (next.arrivedThisTurn[action.to] ?? 0) + action.armies;
  return { ok: true, state: checkWin(next) };
}

function endTurn(
  state: GameState,
  action: Extract<Action, { type: "endTurn" }>,
  rng: Rng,
): ReduceResult {
  if (state.mustTrade) return fail("troca obrigatória");
  if (state.pendingOccupy) return fail("ocupe primeiro");
  if (state.phase === "reinforce") return fail("termine o reforço");
  if (state.phase !== "attack" && state.phase !== "fortify") return fail("não pode passar agora");

  let next = cloneState(state);
  if (next.conqueredThisTurn) {
    next = drawCard(next, action.playerId, rng);
  }
  const nid = nextAlive(next, action.playerId);
  next.turnIndex += 1;
  next = beginTurn(next, nid);
  return { ok: true, state: checkWin(next) };
}

export function ownedTerritories(state: GameState, playerId: PlayerId): TerritoryId[] {
  return (Object.keys(state.territories) as TerritoryId[]).filter(
    (id) => state.territories[id].ownerId === playerId,
  );
}

export { TERRITORY_BY_ID };
