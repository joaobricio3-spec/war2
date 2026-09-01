import { cloneState } from "./clone.ts";
import type { GameCard, GameState, Objective, PlayerId } from "./types.ts";

const HIDDEN_OBJECTIVE: Objective = { kind: "hidden" };

function hideCard(card: GameCard): GameCard {
  if (card.kind === "joker") return { id: card.id, kind: "joker", shape: "joker" };
  return {
    id: card.id,
    kind: "territory",
    territoryId: card.territoryId,
    shape: card.shape,
  };
}

/** Snapshot the player may see: others' cards/objectives stripped. */
export function viewFor(state: GameState, viewerId: PlayerId | null): GameState {
  const next = cloneState(state);
  for (const p of next.players) {
    const mine = p.id === viewerId;
    if (!mine) {
      p.objective = HIDDEN_OBJECTIVE;
      p.cards = p.cards.map((_, i) => ({
        id: `hidden-${p.id}-${i}`,
        kind: "joker" as const,
        shape: "joker" as const,
      }));
    } else {
      p.cards = p.cards.map(hideCard);
    }
  }
  next.deck = next.deck.map((c, i) => ({
    id: `hidden-deck-${i}`,
    kind: "joker",
    shape: "joker",
  }));
  return next;
}
