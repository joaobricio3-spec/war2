import { attackDiceCount } from "./combat.ts";
import { listLegalActions, reachableOwn } from "./legal.ts";
import { areNeighbors, TERRITORY_IDS, type TerritoryId } from "./map/classic.ts";
import { territoryContinent } from "./objectives.ts";
import type { Action, GameState, PlayerId } from "./types.ts";

export type Difficulty = "recruta" | "oficial" | "marechal";

interface Profile {
  /** Minimum (from.armies − to.armies) advantage to launch an attack. */
  minAdvantage: number;
  /** Minimum armies on the origin to consider attacking. */
  minFromArmies: number;
  /** Trade voluntarily once the hand reaches this size. */
  tradeHandSize: number;
  /** Consolidate armies with one fortify when there is nothing worth attacking. */
  fortifies: boolean;
  /** Concentrate the placement pool on a spearhead instead of spreading. */
  spearhead: boolean;
  /** Push occupy to the max even when the origin stays a border. */
  occupyMax: boolean;
}

const PROFILES: Record<Difficulty, Profile> = {
  recruta: {
    minAdvantage: 2,
    minFromArmies: 3,
    tradeHandSize: 5,
    // O perfil conservador é exatamente o que deve consolidar — antes ele
    // nunca fortificava e deixava exércitos presos no interior.
    fortifies: true,
    spearhead: false,
    occupyMax: false,
  },
  oficial: {
    minAdvantage: 1,
    minFromArmies: 3,
    tradeHandSize: 4,
    fortifies: true,
    spearhead: false,
    occupyMax: false,
  },
  marechal: {
    minAdvantage: 1,
    minFromArmies: 2,
    tradeHandSize: 3,
    fortifies: true,
    spearhead: true,
    occupyMax: true,
  },
};

const neighborsOf = (id: TerritoryId): TerritoryId[] =>
  TERRITORY_IDS.filter((other) => areNeighbors(id, other));

const ownedIds = (state: GameState, playerId: PlayerId): TerritoryId[] =>
  TERRITORY_IDS.filter((id) => state.territories[id].ownerId === playerId);

function enemyNeighbors(state: GameState, playerId: PlayerId, id: TerritoryId): TerritoryId[] {
  return neighborsOf(id).filter((n) => state.territories[n].ownerId !== playerId);
}

const isBorder = (state: GameState, playerId: PlayerId, id: TerritoryId): boolean =>
  enemyNeighbors(state, playerId, id).length > 0;

function enemyPressure(state: GameState, playerId: PlayerId, id: TerritoryId): number {
  return enemyNeighbors(state, playerId, id).reduce(
    (sum, n) => sum + state.territories[n].armies,
    0,
  );
}

/** Where the next placement army should go, respecting continent/territory locks. */
function placementTarget(
  state: GameState,
  playerId: PlayerId,
  profile: Profile,
): { territoryId: TerritoryId; count: number } | null {
  const owned = ownedIds(state, playerId);
  if (owned.length === 0) return null;
  const pending = state.armiesToPlace;

  // 1. Territory-locked armies must land on their own territory.
  for (const id of owned) {
    const locked = pending.byTerritory[id] ?? 0;
    if (locked > 0) return { territoryId: id, count: locked };
  }

  // 2. Continent-locked armies must land inside that continent.
  for (const [cont, amount] of Object.entries(pending.byContinent)) {
    if (!amount) continue;
    const inCont = owned.filter((id) => territoryContinent(id) === cont);
    if (inCont.length === 0) continue;
    const borders = inCont.filter((id) => isBorder(state, playerId, id));
    const pool = borders.length ? borders : inCont;
    // Spearhead despeja o pool de uma vez; os demais colocam 1 e reavaliam —
    // cada chamada espalha para a próxima fronteira mais carente.
    return {
      territoryId: pickPlacement(state, playerId, profile, pool),
      count: profile.spearhead ? amount : 1,
    };
  }

  // 3. General armies go to the best border (or anywhere if fully interior).
  if (pending.general > 0) {
    const borders = owned.filter((id) => isBorder(state, playerId, id));
    const pool = borders.length ? borders : owned;
    return {
      territoryId: pickPlacement(state, playerId, profile, pool),
      count: profile.spearhead ? pending.general : 1,
    };
  }
  return null;
}

function pickPlacement(
  state: GameState,
  playerId: PlayerId,
  profile: Profile,
  pool: TerritoryId[],
): TerritoryId {
  const scored = pool.map((id) => {
    const own = state.territories[id].armies;
    const pressure = enemyPressure(state, playerId, id);
    // Marechal builds a spearhead (concentrate where it already leads);
    // recruta/oficial shore up the border under the most pressure.
    const score = profile.spearhead ? own - pressure : pressure - own;
    return { id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.id;
}

const territoryCount = (state: GameState, playerId: PlayerId): number =>
  ownedIds(state, playerId).length;

const continentSize = (cont: string): number =>
  TERRITORY_IDS.filter((id) => territoryContinent(id) === cont).length;

/** O jogador possui todos os territórios do continente? */
function ownsWholeContinent(state: GameState, playerId: PlayerId, cont: string): boolean {
  return TERRITORY_IDS.filter((id) => territoryContinent(id) === cont).every(
    (id) => state.territories[id].ownerId === playerId,
  );
}

/** Conquistar `to` fecha o continente inteiro? */
function completesContinent(state: GameState, playerId: PlayerId, to: TerritoryId): boolean {
  const cont = territoryContinent(to);
  return TERRITORY_IDS.filter(
    (id) => territoryContinent(id) === cont && id !== to,
  ).every((id) => state.territories[id].ownerId === playerId);
}

interface AttackChoice {
  from: TerritoryId;
  to: TerritoryId;
  armies: 1 | 2 | 3;
  advantage: number;
  score: number;
}

function bestAttack(state: GameState, playerId: PlayerId, profile: Profile): AttackChoice | null {
  let best: AttackChoice | null = null;
  for (const from of ownedIds(state, playerId)) {
    const fromArmies = state.territories[from].armies;
    if (fromArmies < profile.minFromArmies || fromArmies < 2) continue;
    const dice = attackDiceCount(fromArmies, 3);
    if (dice < 1) continue;
    for (const to of enemyNeighbors(state, playerId, from)) {
      const toArmies = state.territories[to].armies;
      const advantage = fromArmies - toArmies;
      // Almofada de paridade: em dados iguais o empate favorece o defensor —
      // +1 de vantagem sangra exército sem ganho. Alvos ≥3 pedem folga real.
      const needed = toArmies >= 3 ? Math.max(profile.minAdvantage, 2) : profile.minAdvantage;
      if (advantage < needed) continue;
      let score = advantage;
      // Fechar continente vale bônus por turno para sempre.
      if (completesContinent(state, playerId, to)) score += 4;
      // Eliminar um jogador quase morto rouba as cartas dele.
      if (territoryCount(state, state.territories[to].ownerId) <= 2) score += 3;
      // Não sangrar guarnição de continente que já seguramos — expõe o bônus.
      if (
        ownsWholeContinent(state, playerId, territoryContinent(from)) &&
        isBorder(state, playerId, from)
      )
        score -= 3;
      if (
        !best ||
        score > best.score ||
        (score === best.score && toArmies < state.territories[best.to].armies)
      ) {
        best = { from, to, armies: dice as 1 | 2 | 3, advantage, score };
      }
    }
  }
  return best;
}

/** One consolidating move: surplus → the most undermanned reachable border. */
function bestFortify(
  state: GameState,
  playerId: PlayerId,
): { from: TerritoryId; to: TerritoryId; armies: number } | null {
  let best: { from: TerritoryId; to: TerritoryId; armies: number; deficit: number } | null = null;
  for (const from of ownedIds(state, playerId)) {
    const fromArmies = state.territories[from].armies;
    const movable = fromArmies - 1;
    if (movable < 1) continue;
    // Interior feeds livremente; fronteira só cede o excedente além do piso
    // de contenção — uma pilha de 15 ao lado de 1 inimigo não fica parada.
    const surplus = isBorder(state, playerId, from)
      ? Math.max(0, fromArmies - (enemyPressure(state, playerId, from) + 2))
      : movable;
    const send = Math.min(movable, surplus);
    if (send < 1) continue;
    for (const to of reachableOwn(state, from, playerId)) {
      if (!isBorder(state, playerId, to)) continue;
      // Destino por déficit: a fronteira mais descoberta ganha, não a que já
      // tem guarnição sobrando.
      const deficit = enemyPressure(state, playerId, to) - state.territories[to].armies;
      if (deficit <= 0) continue;
      if (!best || deficit > best.deficit) {
        best = { from, to, armies: send, deficit };
      }
    }
  }
  return best ? { from: best.from, to: best.to, armies: best.armies } : null;
}

/** Entre os trios legais, prefere o que dá +2 por território próprio e poupa coringa. */
function bestTrade(state: GameState, playerId: PlayerId, trades: Action[]): Action | null {
  if (trades.length === 0) return null;
  const player = state.players.find((p) => p.id === playerId)!;
  const owned = new Set(ownedIds(state, playerId));
  let best: Action | null = null;
  let bestScore = -Infinity;
  for (const t of trades) {
    if (t.type !== "trade") continue;
    const cards = t.cardIds.map((id) => player.cards.find((c) => c.id === id)!);
    const ownedBonus = cards.filter(
      (c) => c.kind !== "joker" && owned.has(c.territoryId),
    ).length;
    const jokers = cards.filter((c) => c.kind === "joker").length;
    const score = ownedBonus * 2 - jokers;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/**
 * Decide the next single action for an AI player whose turn it is. Returns null
 * only when the player cannot legally act (not this player's turn / game over).
 * Every returned action is accepted by `reduce` — note that `place`/`fortify`
 * with count>1 are legal inputs but are NOT enumerated by `listLegalActions`
 * (which only emits count/armies = 1).
 */
export function aiChooseAction(
  state: GameState,
  playerId: PlayerId,
  difficulty: Difficulty,
): Action | null {
  if (state.phase === "over" || state.currentPlayerId !== playerId) return null;
  const legal = listLegalActions(state, playerId);
  if (legal.length === 0) return null;
  const profile = PROFILES[difficulty] ?? PROFILES.oficial;

  // Occupy a just-conquered territory. Se o alvo segue na fronteira, leva o
  // máximo; conquista para o interior recebe o mínimo e preserva a origem.
  if (state.pendingOccupy) {
    const occupies = legal.filter((a) => a.type === "occupy");
    if (occupies.length === 0) return legal[0]!;
    const staysBorder = enemyNeighbors(state, playerId, state.pendingOccupy.to).length > 0;
    return profile.occupyMax || staysBorder
      ? occupies[occupies.length - 1]!
      : occupies[0]!;
  }

  // Setup: drop the lone army on the neediest owned border, com leve viés
  // para continentes que já temos parte — fecha bônus mais cedo.
  if (state.phase === "setup_place") {
    const owned = ownedIds(state, playerId);
    const borders = owned.filter((id) => isBorder(state, playerId, id));
    const pool = borders.length ? borders : owned;
    let target: TerritoryId | null = null;
    let best = -Infinity;
    for (const id of pool) {
      const cont = territoryContinent(id);
      const myShare = owned.filter((o) => territoryContinent(o) === cont).length;
      const score =
        enemyPressure(state, playerId, id) -
        state.territories[id].armies +
        (myShare / continentSize(cont)) * 2;
      if (score > best) {
        best = score;
        target = id;
      }
    }
    return target ? { type: "place", playerId, territoryId: target, count: 1 } : legal[0]!;
  }

  const player = state.players.find((p) => p.id === playerId)!;
  const trades = legal.filter((a) => a.type === "trade");

  // Mandatory trade (5+ cards, or 6+ after an elimination).
  if (state.mustTrade) return bestTrade(state, playerId, trades) ?? legal[0]!;

  if (state.phase === "reinforce") {
    // Optional trade when the hand is large enough for this personality.
    if (trades.length && player.cards.length >= profile.tradeHandSize) {
      return bestTrade(state, playerId, trades) ?? trades[0]!;
    }
    const target = placementTarget(state, playerId, profile);
    if (target) {
      return { type: "place", playerId, territoryId: target.territoryId, count: target.count };
    }
    const end = legal.find((a) => a.type === "endReinforce");
    return end ?? legal[0]!;
  }

  if (state.phase === "attack") {
    const attack = bestAttack(state, playerId, profile);
    // Consolidação vence sangria marginal: perfis não-spearhead preferem
    // fortificar a um ataque de vantagem mínima sem valor estratégico.
    const marginal = !attack || attack.score < 2;
    const wantsConsolidate = profile.fortifies && (profile.spearhead ? !attack : marginal);
    if (wantsConsolidate) {
      const fort = bestFortify(state, playerId);
      if (fort) {
        return { type: "fortify", playerId, from: fort.from, to: fort.to, armies: fort.armies };
      }
    }
    if (attack) {
      return { type: "attack", playerId, from: attack.from, to: attack.to, armies: attack.armies };
    }
    if (profile.fortifies) {
      const fort = bestFortify(state, playerId);
      if (fort) {
        return { type: "fortify", playerId, from: fort.from, to: fort.to, armies: fort.armies };
      }
    }
    return legal.find((a) => a.type === "endTurn") ?? legal[0]!;
  }

  if (state.phase === "fortify") {
    return legal.find((a) => a.type === "endTurn") ?? legal[0]!;
  }

  return legal[0]!;
}
