import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import {
  TERRITORY_BY_ID,
  type GameState,
  type PlayerId,
  type TerritoryId,
} from "@war2/engine";
import { LAYOUT, LAYOUT_BY_ID, SEA_LANES, WORLD, pointInPoly } from "./layout.ts";

const CHIP: Record<string, number> = {
  red: 0xc45c4a,
  blue: 0x3d7ab5,
  green: 0x3d8f5a,
  yellow: 0xd4a84a,
  black: 0x8a847c,
  white: 0xd9d4c8,
};

const LAND: Record<string, number> = {
  north_america: 0xc9a24a,
  south_america: 0x3f8a48,
  europe: 0x3d6aa0,
  africa: 0xb86a3a,
  asia: 0x7a8f3a,
  oceania: 0x2f7a72,
};

function mixRgb(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

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

  const mapTex = await Assets.load<Texture>("/assets/world-board-v2.jpg");

  const world = new Container();
  app.stage.addChild(world);

  const relief = new Sprite(mapTex);
  relief.width = WORLD.width;
  relief.height = WORLD.height;
  relief.alpha = 1;
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
  lanes.stroke({ width: 2, color: 0xc4a35a, alpha: 0.55 });

  const cells = new Map<TerritoryId, Cell>();
  let panned = false;
  let baseX = 0;
  let baseY = 0;
  let shakeX = 0;
  let shakeY = 0;
  let trauma = 0;
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  const applyWorldPos = () => {
    world.position.set(baseX + shakeX, baseY + shakeY);
  };

  for (const l of LAYOUT) {
    const cell = new Container();
    cell.eventMode = "static";
    cell.cursor = "pointer";
    cell.hitArea = {
      contains(x: number, y: number) {
        return pointInPoly(x, y, l.poly);
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
        fontSize: 11,
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
    const sx = app.screen.width / WORLD.width;
    const sy = app.screen.height / WORLD.height;
    // Contain (min) so all 42 territories stay on-screen; cover cropped the
    // Americas off a tall board and hid the stack the player just placed.
    const s = Math.min(sx, sy);
    world.scale.set(s);
    baseX = (app.screen.width - WORLD.width * s) / 2;
    baseY = (app.screen.height - WORLD.height * s) / 2;
    applyWorldPos();
  };
  fitWorld();
  app.renderer.on("resize", fitWorld);

  // Camera shake: trauma decays on rAF, offset is trauma² so hits feel sharp
  // then die. Pan lives on baseX/baseY so shake never drifts the map.
  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, 0.1);
    if (reducedMotion || trauma <= 0) {
      if (shakeX !== 0 || shakeY !== 0) {
        shakeX = 0;
        shakeY = 0;
        applyWorldPos();
      }
      trauma = 0;
      return;
    }
    trauma = Math.max(0, trauma - 4.2 * dt);
    const mag = trauma * trauma * 22;
    shakeX = (Math.random() * 2 - 1) * mag;
    shakeY = (Math.random() * 2 - 1) * mag;
    applyWorldPos();
  });

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
    baseX += dx;
    baseY += dy;
    applyWorldPos();
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
      const land = LAND[TERRITORY_BY_ID[l.id].continent] ?? color;
      const fill = mixRgb(land, color, 0.55);
      const cell = cells.get(l.id)!;
      const on = selected === l.id;
      const target = highlights?.has(l.id) ?? false;

      cell.glow.clear();
      cell.glow.poly(l.poly);
      cell.glow.fill({ color: fill, alpha: on ? 0.46 : target ? 0.34 : 0.16 });
      cell.glow.poly(l.poly);
      cell.glow.stroke({
        width: on || target ? 2.5 : 1.4,
        color: on || target ? 0xf0c987 : 0x1c140c,
        alpha: on || target ? 0.95 : 0.55,
      });

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

  function shake(amount: number) {
    if (reducedMotion) return;
    trauma = Math.min(1, trauma + amount);
  }

  return { render, fps, shake, app };
}
