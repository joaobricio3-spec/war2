#!/usr/bin/env node
/**
 * E2E gauntlet — plays a full War2 match over real WebSockets against a real
 * `startServer` instance (2 bots driven by `listLegalActions`).
 *
 * The match itself lives in `packages/server/src/e2e.test.ts` and runs under
 * the existing vitest setup (the workspace packages are TypeScript source, so
 * plain `node` cannot import them directly — vitest resolves the TS).
 *
 * Usage: node scripts/e2e-match.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.join(root, "packages", "server");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const child = spawn(pnpm, ["exec", "vitest", "run", "src/e2e.test.ts"], {
  cwd: serverDir,
  stdio: "inherit",
  // Windows cannot exec .cmd shims without a shell (spawn EINVAL).
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`e2e-match: vitest killed by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
