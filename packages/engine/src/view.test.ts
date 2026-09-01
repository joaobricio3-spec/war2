import { describe, expect, it } from "vitest";
import { createGame } from "./createGame.ts";
import { isObjectiveMet } from "./objectives.ts";
import { createSeededRng } from "./rng.ts";
import { viewFor } from "./view.ts";

describe("viewFor", () => {
  it("hides opponents objectives and card identities", () => {
    const g = createGame({
      rng: createSeededRng(1),
      players: [
        { id: "a", nickname: "A", color: "red" },
        { id: "b", nickname: "B", color: "blue" },
      ],
    });
    g.players[0]!.cards.push({
      id: "card-brasil",
      kind: "territory",
      territoryId: "brasil",
      shape: "circle",
    });
    const view = viewFor(g, "b");
    const a = view.players.find((p) => p.id === "a")!;
    expect(a.objective).toEqual({ kind: "hidden" });
    expect(a.cards[0]?.kind).toBe("joker");
    expect(a.cards[0]?.id).not.toBe("card-brasil");
    const b = view.players.find((p) => p.id === "b")!;
    expect(b.objective).toEqual(g.players[1]!.objective);
  });

  it("does not mask with a real 24-territory objective", () => {
    const g = createGame({
      rng: createSeededRng(1),
      players: [
        { id: "a", nickname: "A", color: "red" },
        { id: "b", nickname: "B", color: "blue" },
      ],
    });
    for (const id of Object.keys(g.territories) as (keyof typeof g.territories)[]) {
      g.territories[id] = { ownerId: "a", armies: 1 };
    }
    g.players.find((p) => p.id === "a")!.objective = { kind: "destroy_color", color: "blue" };
    const view = viewFor(g, "b");
    expect(view.players.find((p) => p.id === "a")!.objective).toEqual({ kind: "hidden" });
    expect(isObjectiveMet(view, "a")).toBe(false);
  });
});
