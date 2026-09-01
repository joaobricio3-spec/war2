import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import {
  TERRITORY_BY_ID,
  type GameState,
  type PlayerId,
  type TerritoryId,
} from "@war2/engine";
import { LAYOUT, LAYOUT_BY_ID, SEA_LANES, WORLD } from "./layout.ts";

const CHIP: Record<string, number> = {
  red: 0xc45c4a,
  blue: 0x3d7ab5,
  green: 0x3d8f5a,
  yellow: 0xd4a84a,
  black: 0x8a847c,
  white: 0xd9d4c8,
};

type Cell = {
  glow: Graphics;
  name: Text;
  disc: Graphics;
  count: Text;
};

export interface BoardHooks {
  onTerritory: (id: TerritoryId) => void;
}

export async function createBoard(host: HTMLElement, hooks: BoardHooks) {
  const app = new Application();
  await app.init({
    background: 0x090b0e,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    resizeTo: host,
  });
  app.ticker.maxFPS = 0;
  host.appendChild(app.canvas);

  const mapTex = await Assets.load<Texture>("/assets/world-relief.jpg");

  const world = new Container();
  app.stage.addChild(world);

  const relief = new Sprite(mapTex);
  relief.width = WORLD.width;
  relief.height = WORLD.height;
  relief.eventMode = "none";
  world.addChild(relief);

  const lanes = new Graphics();
  world.addChild(lanes);
  for (const [a, b] of SEA_LANES) {
    const pa = LAYOUT_BY_ID[a];
    const pb = LAYOUT_BY_ID[b];
    const mx = (pa.cx + pb.cx) / 2;
    const my = (pa.cy + pb.cy) / 2 - 36;
    lanes.moveTo(pa.cx, pa.cy);
    lanes.quadraticCurveTo(mx, my, pb.cx, pb.cy);
  }
  lanes.stroke({ width: 1.25, color: 0x6a8aaa, alpha: 0.35 });

  const cells = new Map<TerritoryId, Cell>();
  let panned = false;

  for (const l of LAYOUT) {
    const cell = new Container();
    cell.eventMode = "static";
    cell.cursor = "pointer";
    cell.hitArea = {
      contains(x: number, y: number) {
        const dx = (x - l.cx) / l.rx;
        const dy = (y - l.cy) / l.ry;
        return dx * dx + dy * dy <= 1;
      },
    };
    cell.on("pointertap", () => {
      if (panned) return;
      hooks.onTerritory(l.id);
    });

    const glow = new Graphics();
    const name = new Text({
      text: TERRITORY_BY_ID[l.id].name,
      style: {
        fontFamily: 'Figtree, Candara, "Segoe UI", sans-serif',
        fontSize: 10,
        fill: 0xd9d4c8,
        align: "center",
        fontWeight: "600",
      },
    });
    name.anchor.set(0.5, 1);
    name.position.set(l.cx, l.cy - 20);
    name.alpha = 0.72;

    const disc = new Graphics();
    const count = new Text({
      text: "1",
      style: {
        fontFamily: "IBM Plex Mono, ui-monospace, Consolas, monospace",
        fontSize: 13,
        fill: 0xf4f1ea,
        fontWeight: "600",
      },
    });
    count.anchor.set(0.5);
    count.position.set(l.cx, l.cy);

    cell.addChild(glow, name, disc, count);
    world.addChild(cell);
    cells.set(l.id, { glow, name, disc, count });
  }

  const fitWorld = () => {
    const pad = 16;
    const sx = (app.screen.width - pad * 2) / WORLD.width;
    const sy = (app.screen.height - pad * 2) / WORLD.height;
    const s = Math.min(sx, sy, 1.35);
    world.scale.set(s);
    world.position.set(
      (app.screen.width - WORLD.width * s) / 2,
      (app.screen.height - WORLD.height * s) / 2,
    );
  };
  fitWorld();
  app.renderer.on("resize", fitWorld);

  let dragging = false;
  let lx = 0;
  let ly = 0;
  app.canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    panned = false;
    lx = e.clientX;
    ly = e.clientY;
  });
  window.addEventListener("pointerup", () => {
    dragging = false;
  });
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lx;
    const dy = e.clientY - ly;
    if (!panned && dx * dx + dy * dy < 36) return;
    panned = true;
    world.x += dx;
    world.y += dy;
    lx = e.clientX;
    ly = e.clientY;
  });
  app.canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const scale = Math.min(3.2, Math.max(0.35, world.scale.x * (e.deltaY > 0 ? 0.92 : 1.08)));
      world.scale.set(scale);
    },
    { passive: false },
  );

  function render(
    state: GameState,
    selected: TerritoryId | null,
    viewer: PlayerId,
    highlights?: ReadonlySet<TerritoryId>,
  ) {
    for (const l of LAYOUT) {
      const occ = state.territories[l.id];
      const owner = state.players.find((p) => p.id === occ.ownerId);
      const color = CHIP[owner?.color ?? "white"] ?? 0x888888;
      const cell = cells.get(l.id)!;
      const mine = occ.ownerId === viewer;
      const on = selected === l.id;
      const target = highlights?.has(l.id) ?? false;

      cell.glow.clear();
      cell.glow.ellipse(l.cx, l.cy, l.rx, l.ry);
      cell.glow.fill({ color, alpha: on ? 0.28 : target ? 0.24 : mine ? 0.16 : 0.1 });
      cell.glow.ellipse(l.cx, l.cy, l.rx, l.ry);
      cell.glow.stroke({
        width: on ? 2.4 : target ? 2.4 : 1.2,
        color: on ? 0xf0c987 : target ? 0xf0c987 : color,
        alpha: on ? 0.95 : target ? 0.85 : 0.45,
      });
      if (target) {
        cell.glow.ellipse(l.cx, l.cy, l.rx + 5, l.ry + 5);
        cell.glow.stroke({ width: 1.5, color: 0xf0c987, alpha: 0.55 });
      }

      cell.disc.clear();
      cell.disc.circle(l.cx, l.cy, 15);
      cell.disc.fill({ color: 0x090b0e, alpha: 0.92 });
      cell.disc.stroke({ width: 2.5, color, alpha: 1 });
      cell.count.text = String(occ.armies);
      cell.name.alpha = on || target ? 1 : 0.62;
    }
  }

  function fps(): number {
    return app.ticker.FPS;
  }

  return { render, fps, app };
}
