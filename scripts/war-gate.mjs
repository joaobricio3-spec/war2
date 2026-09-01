#!/usr/bin/env node
// War 2.0 gate. Fails (exit 1) unless every hard invariant holds. Prints
// exactly `GATE_OK=1` on the last line only when everything passes.
// See GOAL.md and docs/WAR-RULES.md.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const fail = (msg) => failures.push(msg);
const ok = (msg) => console.log(`  ok  ${msg}`);

function readAllFiles(dir, exts) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".vite") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...readAllFiles(full, exts));
    else if (exts.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}

// 1. Required normative docs exist.
for (const doc of ["GOAL.md", "docs/WAR-RULES.md"]) {
  if (existsSync(join(ROOT, doc))) ok(`${doc} present`);
  else fail(`missing required doc: ${doc}`);
}

// 2. Engine test files exist and the suite passes (42 territories, symmetric
//    graph, reinforce /2, tie=defense, 18-with-2 mission live in the suite).
const engineSrc = join(ROOT, "packages/engine/src");
const engineTests = readAllFiles(engineSrc, [".test.ts"]);
if (engineTests.length === 0) fail("no engine test files under packages/engine/src");
else ok(`${engineTests.length} engine test files found`);

if (!existsSync(join(engineSrc, "gate.test.ts"))) {
  fail("packages/engine/src/gate.test.ts (gate assertions) is missing");
} else {
  ok("gate.test.ts present");
}

console.log("\n--- running engine test suite (pnpm --filter @war2/engine test) ---");
const test = spawnSync("pnpm", ["--filter", "@war2/engine", "run", "test"], {
  cwd: ROOT,
  stdio: "inherit",
  encoding: "utf8",
});
if (test.status !== 0) fail(`engine test suite exited ${test.status}`);
else ok("engine test suite passed");

// 3. No 30fps cap and no camera game-loop on setInterval.
console.log("\n--- static checks (fps cap / camera loop) ---");
const allSrc = readAllFiles(join(ROOT, "packages"), [".ts", ".tsx"]).filter(
  (f) => !f.endsWith(".test.ts"),
);
const capRe = /maxFPS\s*[:=]\s*30\b/;
const capHits = allSrc.filter((f) => capRe.test(readFileSync(f, "utf8")));
if (capHits.length) fail(`maxFPS capped to 30 in: ${capHits.map((f) => f.replace(ROOT + "/", "")).join(", ")}`);
else ok("no maxFPS = 30 cap");

const clientSrc = allSrc.filter((f) => f.includes("packages/client/src"));
const intervalRe = /\bsetInterval\s*\(/;
const intervalHits = clientSrc.filter((f) => intervalRe.test(readFileSync(f, "utf8")));
if (intervalHits.length)
  fail(`setInterval (camera loop) in client src: ${intervalHits.map((f) => f.replace(ROOT + "/", "")).join(", ")}`);
else ok("no setInterval camera loop in client src");

// Verdict.
console.log("");
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\nGATE_FAILED: ${failures.length} problem(s)`);
  process.exit(1);
}
console.log("GATE_OK=1");
