import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import {
  TERRITORY_BY_ID,
  type GameState,
  type PlayerId,
  type TerritoryId,
} from "@war2/engine";
import { LAYOUT, LAYOUT_BY_ID, WORLD } from "./layout.ts";

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
  fill: Sprite;
  halo: Sprite;
  name: Text;
  disc: Graphics;
  count: Text;
};

export interface BoardHooks {
  onTerritory: (id: TerritoryId) => void;
  onEmpty?: () => void;
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

  const mapTex = await Assets.load<Texture>("/assets/world-board-arcade.png");
  const lineTex = await Assets.load<Texture>("/assets/territory-lines.png");
  const lanes = (await (await fetch("/assets/visual-lanes.json")).json()) as [
    TerritoryId,
    TerritoryId,
  ][];
  const maskTex = new Map<TerritoryId, Texture>();
  await Promise.all(
    LAYOUT.map(async (l) => {
      maskTex.set(l.id, await Assets.load<Texture>(`/assets/masks/${l.id}.png`));
    }),
  );

  // Index map: pixel → território (mesma regra Voronoi∩terra que gera as
  // máscaras). Clique e região visível são a mesma coisa, sempre.
  const idxImg = new Image();
  idxImg.src = "/assets/regions-index.png";
  await idxImg.decode();
  const idxCanvas = document.createElement("canvas");
  idxCanvas.width = WORLD.width;
  idxCanvas.height = WORLD.height;
  const idxCtx = idxCanvas.getContext("2d")!;
  idxCtx.drawImage(idxImg, 0, 0);
  const idxData = idxCtx.getImageData(0, 0, WORLD.width, WORLD.height).data;

  const world = new Container();
  app.stage.addChild(world);

  const relief = new Sprite(mapTex);
  relief.width = WORLD.width;
  relief.height = WORLD.height;
  relief.alpha = 1;
  relief.eventMode = "static";
  relief.cursor = "pointer";
  relief.on("pointertap", (e) => {
    if (panned) return;
    // Clique = pixel do index map: a região que você vê é a que recebe.
    const p = world.toLocal(e.global);
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const n =
      x >= 0 && x < WORLD.width && y >= 0 && y < WORLD.height
        ? (idxData[(y * WORLD.width + x) * 4] ?? 0)
        : 0;
    const t = n > 0 ? LAYOUT[n - 1]?.id : undefined;
    if (t) hooks.onTerritory(t);
    else hooks.onEmpty?.();
  });
  world.addChild(relief);

  // Arcade board: fills são sprites das máscaras de região (polígono ∩ terra
  // pintada), tingidos por continente+dono — a área colorida segue a costa.
  const fillLayer = new Container();
  world.addChild(fillLayer);

  const lanesG = new Graphics();
  world.addChild(lanesG);
  for (const [a, b] of lanes) {
    const pa = LAYOUT_BY_ID[a];
    const pb = LAYOUT_BY_ID[b];
    if (Math.abs(pb.cx - pa.cx) > WORLD.width / 2) {
      // Cross-map link (Alaska↔Vladivostok wraps the Pacific): draw short
      // stubs toward each edge instead of a line across the whole board.
      const left = pa.cx < pb.cx ? pa : pb;
      const right = pa.cx < pb.cx ? pb : pa;
      lanesG.moveTo(left.cx, left.cy);
      lanesG.quadraticCurveTo(left.cx - 60, left.cy - 10, -14, left.cy - 22);
      lanesG.moveTo(right.cx, right.cy);
      lanesG.quadraticCurveTo(right.cx + 60, right.cy - 10, WORLD.width + 14, right.cy - 22);
    } else {
      // Arco dobrando na perpendicular do link — não atravessa território
      // alheio em linha reta nem sobe sempre na mesma direção.
      const dx = pb.cx - pa.cx;
      const dy = pb.cy - pa.cy;
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.min(64, len * 0.18);
      const mx = (pa.cx + pb.cx) / 2 - (dy / len) * k;
      const my = (pa.cy + pb.cy) / 2 + (dx / len) * k;
      lanesG.moveTo(pa.cx, pa.cy);
      lanesG.quadraticCurveTo(mx, my, pb.cx, pb.cy);
    }
  }
  lanesG.stroke({ width: 1.7, color: 0xc4a35a, alpha: 0.45 });

  // Baked region outlines (coast-accurate) over fills, under markers.
  const linesSprite = new Sprite(lineTex);
  linesSprite.width = WORLD.width;
  linesSprite.height = WORLD.height;
  linesSprite.eventMode = "none";
  world.addChild(linesSprite);

  const markLayer = new Container();
  world.addChild(markLayer);

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
    const tex = maskTex.get(l.id)!;

    // Halo: mesma região levemente expandida — rim glow em seleção/alvo.
    const halo = new Sprite(tex);
    halo.width = WORLD.width;
    halo.height = WORLD.height;
    halo.alpha = 0;
    halo.eventMode = "none";

    const fill = new Sprite(tex);
    fill.width = WORLD.width;
    fill.height = WORLD.height;
    fill.eventMode = "none";
    fillLayer.addChild(halo, fill);

    const name = new Text({
      text: TERRITORY_BY_ID[l.id].name,
      style: {
        fontFamily: 'Figtree, Candara, "Segoe UI", sans-serif',
        fontSize: 11,
        fill: 0xf4f1ea,
        align: "center",
        fontWeight: "700",
        stroke: { color: 0x090b0e, width: 3, join: "round" },
      },
    });
    name.anchor.set(0.5, 1);
    name.position.set(l.cx, l.cy - 20);
    name.alpha = 0.78;
    name.eventMode = "none";

    const disc = new Graphics();
    disc.eventMode = "none";
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
    count.eventMode = "none";

    markLayer.addChild(name, disc, count);
    cells.set(l.id, { fill, halo, name, disc, count });
  }

  let fitScale = 1;
  const clampPan = () => {
    // Always keep at least KEEP px of the board reachable on screen.
    const KEEP = 160;
    const w = WORLD.width * world.scale.x;
    const h = WORLD.height * world.scale.y;
    baseX = Math.min(app.screen.width - KEEP, Math.max(KEEP - w, baseX));
    baseY = Math.min(app.screen.height - KEEP, Math.max(KEEP - h, baseY));
  };
  const fitWorld = () => {
    const sx = app.screen.width / WORLD.width;
    const sy = app.screen.height / WORLD.height;
    // Contain (min) so all 42 territories stay on-screen; cover cropped the
    // Americas off a tall board and hid the stack the player just placed.
    const s = Math.min(sx, sy);
    fitScale = s;
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
  let dragDist = 0;

  /** Zoom ancorado num ponto da tela (cursor ou meio do pinch). */
  const zoomAt = (px: number, py: number, target: number) => {
    const s0 = world.scale.x;
    const s1 = Math.min(3.2, Math.max(fitScale, target));
    if (s1 === s0) return;
    // The world point under `px,py` must stay under it after scaling.
    const k = s1 / s0;
    baseX = px - (px - baseX) * k;
    baseY = py - (py - baseY) * k;
    world.scale.set(s1);
    clampPan();
    applyWorldPos();
  };

  // Teclado: setas arrastam a câmera, +/− dão zoom no centro da tela.
  const panBy = (dx: number, dy: number) => {
    baseX += dx;
    baseY += dy;
    clampPan();
    applyWorldPos();
  };
  const zoomBy = (factor: number) =>
    zoomAt(app.screen.width / 2, app.screen.height / 2, world.scale.x * factor);

  // Multi-pointer tracking: 1 dedo = pan/tap, 2 dedos = pinch.
  const ptrs = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  let pinchMid = { x: 0, y: 0 };

  app.canvas.addEventListener("pointerdown", (e) => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      pinchMid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      dragging = false;
      panned = true; // gesto não é tap
      return;
    }
    dragging = true;
    panned = false;
    dragDist = 0;
    lx = e.clientX;
    ly = e.clientY;
  });
  const endPtr = (e: PointerEvent) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size === 1) {
      // Um dedo sobra do pinch: continua como pan a partir de onde está.
      const rest = [...ptrs.values()][0]!;
      lx = rest.x;
      ly = rest.y;
      dragDist = 999; // mantém panned — não vira tap
      dragging = true;
    }
    if (ptrs.size === 0) dragging = false;
  };
  window.addEventListener("pointerup", endPtr);
  window.addEventListener("pointercancel", endPtr);
  window.addEventListener("pointermove", (e) => {
    const p = ptrs.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      const rect = app.canvas.getBoundingClientRect();
      baseX += mid.x - pinchMid.x;
      baseY += mid.y - pinchMid.y;
      if (pinchDist > 0) {
        zoomAt(mid.x - rect.left, mid.y - rect.top, world.scale.x * (d / pinchDist));
      }
      pinchDist = d;
      pinchMid = mid;
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - lx;
    const dy = e.clientY - ly;
    lx = e.clientX;
    ly = e.clientY;
    // Cumulative threshold: a slow drag pans instead of teleporting the map
    // by the whole accumulated delta once the threshold trips.
    dragDist += Math.hypot(dx, dy);
    if (!panned && dragDist < 6) return;
    panned = true;
    baseX += dx;
    baseY += dy;
    clampPan();
    applyWorldPos();
  });
  app.canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = app.canvas.getBoundingClientRect();
      zoomAt(
        e.clientX - rect.left,
        e.clientY - rect.top,
        world.scale.x * (e.deltaY > 0 ? 0.92 : 1.08),
      );
    },
    { passive: false },
  );
  // Esc (handled in main.ts) calls resetView — dblclick would fire two
  // pointertap actions on the territory under the cursor, so it stays free.

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
      const fill = mixRgb(land, color, 0.6);
      const cell = cells.get(l.id)!;
      const on = selected === l.id;
      const target = highlights?.has(l.id) ?? false;

      // Fill sprite: região costa-acurada tingida continente+dono.
      cell.fill.tint = fill;
      cell.fill.alpha = on ? 0.92 : target ? 0.86 : 0.78;

      // Halo: rim glow por expansão da mesma máscara em torno da âncora.
      if (on || target) {
        const s = on ? 1.045 : 1.03;
        cell.halo.scale.set(s);
        cell.halo.position.set(l.cx * (1 - s), l.cy * (1 - s));
        cell.halo.tint = on ? 0xffd76a : 0x6ec6ff;
        cell.halo.alpha = on ? 0.9 : 0.75;
      } else {
        cell.halo.alpha = 0;
      }

      cell.disc.clear();
      cell.disc.circle(l.cx, l.cy, 15);
      cell.disc.fill({ color: 0x090b0e, alpha: 0.92 });
      cell.disc.stroke({
        width: on || target ? 3 : 2.5,
        color: on ? 0xffd76a : target ? 0x6ec6ff : color,
        alpha: 1,
      });
      cell.count.text = String(occ.armies);
      cell.name.alpha = on || target ? 1 : 0.78;
    }
  }

  function fps(): number {
    return app.ticker.FPS;
  }

  function shake(amount: number) {
    if (reducedMotion) return;
    trauma = Math.min(1, trauma + amount);
  }

  return { render, fps, shake, resetView: fitWorld, panBy, zoomBy, app };
}
