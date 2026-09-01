import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** tools/mcp-imagine (works from src/ or dist/) */
export const PACKAGE_ROOT = path.resolve(here, "..");
export const REPO_ROOT = process.env.WAR2_ROOT
  ? path.resolve(process.env.WAR2_ROOT)
  : path.resolve(PACKAGE_ROOT, "..", "..");
export const DEFAULT_OUT_DIR = path.join(PACKAGE_ROOT, "out");

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function mimeOf(buf: Buffer): string {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) {
    return "image/webp";
  }
  return "image/jpeg";
}

export function extFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export function slug(text: string): string {
  const s = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return s || "image";
}

export function resolveOutputPath(outputPath: string | undefined, prompt: string, mime: string): string {
  const ext = extFor(mime);
  const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "").slice(0, 15);
  const fallback = path.join(DEFAULT_OUT_DIR, `${stamp}-${slug(prompt)}.${ext}`);
  if (!outputPath) return fallback;

  const resolved = path.isAbsolute(outputPath) ? path.resolve(outputPath) : path.resolve(REPO_ROOT, outputPath);
  if (!isInside(REPO_ROOT, resolved)) {
    throw new Error(`output_path precisa ficar dentro do repositório (${REPO_ROOT})`);
  }
  if (resolved.endsWith(path.sep) || path.extname(resolved) === "") {
    return path.join(resolved, `${stamp}-${slug(prompt)}.${ext}`);
  }
  return resolved;
}

export async function writeImage(filePath: string, buf: Buffer): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buf);
  return filePath;
}

const MAX_EMBED_BYTES = 2_500_000;

export function maybeEmbed(buf: Buffer): { type: "image"; data: string; mimeType: string } | undefined {
  if (buf.length > MAX_EMBED_BYTES) return undefined;
  return { type: "image", data: buf.toString("base64"), mimeType: mimeOf(buf) };
}
