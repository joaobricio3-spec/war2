export { reduce } from "./reduce.ts";
export { createGame, beginTurn, drawCard } from "./createGame.ts";
export { viewFor } from "./view.ts";
export { listLegalActions } from "./legal.ts";
export { createSeededRng, rollDice, type Rng } from "./rng.ts";
export { resolveBattle, attackDiceCount, defendDiceCount } from "./combat.ts";
export { isValidTrade, tradeArmies, pendingPlaceTotal } from "./cards.ts";
export {
  isObjectiveMet,
  effectiveObjective,
  objectivesForColors,
  ALL_OBJECTIVES,
  continentBonusFor,
} from "./objectives.ts";
export {
  TERRITORIES,
  TERRITORY_BY_ID,
  CONTINENTS,
  CONTINENT_BY_ID,
  TERRITORY_IDS,
  areNeighbors,
  type TerritoryId,
  type ContinentId,
} from "./map/classic.ts";
export type {
  Action,
  GameState,
  ReduceResult,
  PlayerId,
  ArmyColor,
  Phase,
  GameCard,
  Objective,
  Player,
} from "./types.ts";
