import type { LastBattle } from "@war2/engine";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

function die(value: number, side: "atk" | "def", dead: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = `die die-${side}${dead ? " die-dead" : ""}`;
  el.textContent = String(value);
  el.setAttribute("aria-label", `${side === "atk" ? "ataque" : "defesa"} ${value}`);
  return el;
}

/**
 * Render the last battle into `host`: attacker dice on top, defender below.
 * Dice roll (random faces) for a short beat, then settle on the real values.
 * Losing dice are dimmed. Respects prefers-reduced-motion (instant settle).
 * Returns a cancel function so a new battle can pre-empt the animation.
 */
export function showBattle(host: HTMLElement, battle: LastBattle): () => void {
  host.hidden = false;
  host.innerHTML = "";

  const atkRow = document.createElement("div");
  atkRow.className = "dice-row";
  const defRow = document.createElement("div");
  defRow.className = "dice-row";

  // Highest dice are paired; the loser of each pair is the dead die.
  const atkSorted = [...battle.attackDice].sort((a, b) => b - a);
  const defSorted = [...battle.defendDice].sort((a, b) => b - a);
  const pairs = Math.min(atkSorted.length, defSorted.length);
  const atkDead = new Array(atkSorted.length).fill(false);
  const defDead = new Array(defSorted.length).fill(false);
  for (let i = 0; i < pairs; i++) {
    if (atkSorted[i]! > defSorted[i]!) defDead[i] = true;
    else atkDead[i] = true;
  }

  const atkEls = atkSorted.map((v, i) => die(v, "atk", atkDead[i]!));
  const defEls = defSorted.map((v, i) => die(v, "def", defDead[i]!));
  atkEls.forEach((e) => atkRow.append(e));
  defEls.forEach((e) => defRow.append(e));

  const atkLabel = document.createElement("span");
  atkLabel.className = "dice-label";
  atkLabel.textContent = "ataque";
  const defLabel = document.createElement("span");
  defLabel.className = "dice-label";
  defLabel.textContent = "defesa";

  host.append(atkLabel, atkRow, defLabel, defRow);

  if (prefersReducedMotion()) return () => {};

  const allEls = [...atkEls, ...defEls];
  const finals = [...atkSorted, ...defSorted];
  const start = performance.now();
  const DURATION = 520;
  let raf = 0;
  let cancelled = false;

  const tick = (now: number) => {
    if (cancelled) return;
    const t = now - start;
    if (t >= DURATION) {
      allEls.forEach((el, i) => (el.textContent = String(finals[i])));
      host.classList.remove("rolling");
      return;
    }
    // faces tumble faster at the start, slowing toward the settle
    allEls.forEach((el) => (el.textContent = String(1 + Math.floor(Math.random() * 6))));
    host.classList.add("rolling");
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
    allEls.forEach((el, i) => (el.textContent = String(finals[i])));
    host.classList.remove("rolling");
  };
}
