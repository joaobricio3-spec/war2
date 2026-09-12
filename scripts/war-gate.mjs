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

console.log("\n--- running test suites (engine + server) ---");
for (const pkg of ["@war2/engine", "@war2/server"]) {
  const test = spawnSync("pnpm", ["--filter", pkg, "run", "test"], {
    cwd: ROOT,
    stdio: "inherit",
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (test.status !== 0) fail(`${pkg} test suite exited ${test.status}`);
  else ok(`${pkg} test suite passed`);
}

console.log("\n--- running typecheck (pnpm -r typecheck) ---");
const tsc = spawnSync("pnpm", ["-r", "--if-present", "typecheck"], {
  cwd: ROOT,
  stdio: "inherit",
  encoding: "utf8",
  shell: process.platform === "win32",
});
if (tsc.status !== 0) fail(`typecheck exited ${tsc.status}`);
else ok("typecheck passed");

// 3. No fps cap, no Math.random in the engine, no camera game-loop on
//    setInterval.
console.log("\n--- static checks (fps cap / engine RNG / camera loop) ---");
const allSrc = readAllFiles(join(ROOT, "packages"), [".ts", ".tsx"]).filter(
  (f) => !f.endsWith(".test.ts"),
);
const capRe = /\b(?:maxFPS|minFPS|targetFPS)\s*[:=]\s*(?!0\b)\d+/;
const capHits = allSrc.filter((f) => capRe.test(readFileSync(f, "utf8")));
if (capHits.length) fail(`fps capped in: ${capHits.map((f) => f.replace(ROOT + "/", "")).join(", ")}`);
else ok("no fps cap");

const engineCode = readAllFiles(engineSrc, [".ts"]).filter((f) => !f.endsWith(".test.ts"));
const rngHits = engineCode.filter((f) => /Math\.random\s*\(/.test(readFileSync(f, "utf8")));
if (rngHits.length) fail(`Math.random in engine: ${rngHits.map((f) => f.replace(ROOT + "/", "")).join(", ")}`);
else ok("no Math.random in engine");

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
