/**
 * Só chama endpoints documentados. Não há scraper de grok.com/imagine.
 *
 * xAI Imagine: https://docs.x.ai/developers/model-capabilities/images/generation
 * Higgsfield:   https://docs.higgsfield.ai/docs
 */

export const XAI_BASE = "https://api.x.ai/v1";
export const HF_BASE = "https://api.higgsfield.ai";
export const HF_DEFAULT_ENDPOINT = "higgsfield-ai/soul/v2/standard";

export type CatalogEntry = {
  id: string;
  provider: "xai" | "higgsfield";
  price: string;
  notes: string;
  docs: string;
};

/** Modelos de imagem citados nas docs oficiais (2026-08). */
export const CATALOG: CatalogEntry[] = [
  {
    id: "grok-imagine-image-2.0",
    provider: "xai",
    price: "$0.04 / imagem",
    notes:
      "Flagship atual da Imagine API. No site, Image 2.0 é o Quality Mode de grok.com/imagine — a API usa este slug, não um endpoint separado do produto consumer.",
    docs: "https://docs.x.ai/developers/models/grok-imagine-image-2.0",
  },
  {
    id: "grok-imagine-image",
    provider: "xai",
    price: "$0.02 / imagem",
    notes: "Imagine mais barato/rápido. Alias de data: grok-imagine-image-2026-03-02.",
    docs: "https://docs.x.ai/developers/models/grok-imagine-image",
  },
  {
    id: "grok-imagine-image-quality",
    provider: "xai",
    price: "$0.05 / imagem",
    notes: "Imagine qualidade alta. Aliases: grok-imagine-image-quality-latest, grok-imagine-image-pro.",
    docs: "https://docs.x.ai/developers/models/grok-imagine-image-quality",
  },
  {
    id: "grok-2-image",
    provider: "xai",
    price: "legado (metadados de algumas chaves listam grok-2-image-1212)",
    notes:
      "Ainda aparece como alias em GET /v1/api-key de algumas contas. A página de modelo dedicada 404. A doc de Image Generation só exemplifica grok-imagine-*. Prefira grok-imagine-image-2.0.",
    docs: "https://docs.x.ai/developers/model-capabilities/images/generation",
  },
  {
    id: HF_DEFAULT_ENDPOINT,
    provider: "higgsfield",
    price: "créditos Higgsfield (conta)",
    notes:
      "Único endpoint de imagem no Quickstart oficial. Corpo documentado: { prompt }. Geração assíncrona + poll em /requests/{id}/status.",
    docs: "https://docs.higgsfield.ai/docs/quickstart.md",
  },
];

export type XaiGenArgs = {
  prompt: string;
  model: string;
  aspectRatio?: string;
  resolution?: "1k" | "2k";
  quality?: "low" | "medium" | "auto";
  n?: number;
};

export type GeneratedImage = {
  buffer: Buffer;
  model: string;
  sourceUrl?: string;
};

function xaiKey(): string {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "XAI_API_KEY ausente. Crie a chave em https://console.x.ai e coloque no .env ou em mcp.json env.",
    );
  }
  return key;
}

function hfAuth(): string {
  const id = process.env.HF_API_KEY_ID?.trim();
  const secret = process.env.HF_API_KEY_SECRET?.trim();
  if (!id || !secret) {
    throw new Error(
      "HF_API_KEY_ID / HF_API_KEY_SECRET ausentes. Crie em https://cloud.higgsfield.ai (Authorization: Key id:secret).",
    );
  }
  return `Key ${id}:${secret}`;
}

export function keysPresent(): { xai: boolean; higgsfield: boolean } {
  return {
    xai: Boolean(process.env.XAI_API_KEY?.trim()),
    higgsfield: Boolean(process.env.HF_API_KEY_ID?.trim() && process.env.HF_API_KEY_SECRET?.trim()),
  };
}

function imagineModel(model: string): boolean {
  return model.startsWith("grok-imagine-");
}

export async function listXaiModels(): Promise<string[]> {
  const res = await fetch(`${XAI_BASE}/models`, {
    headers: { Authorization: `Bearer ${xaiKey()}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${XAI_BASE}/models → HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = JSON.parse(text) as { data?: Array<{ id?: string }> };
  const ids = (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
  return ids.filter((id) => /image|imagine/i.test(id));
}

export async function generateXai(args: XaiGenArgs): Promise<GeneratedImage[]> {
  const n = args.n ?? 1;
  const body: Record<string, unknown> = {
    model: args.model,
    prompt: args.prompt,
    n,
    response_format: "b64_json",
  };
  // Parâmetros extra só nas docs da Imagine. grok-2-image legado: model+prompt.
  if (imagineModel(args.model)) {
    if (args.aspectRatio) body.aspect_ratio = args.aspectRatio;
    if (args.resolution) body.resolution = args.resolution;
    if (args.quality && args.model === "grok-imagine-image-2.0") body.quality = args.quality;
  }

  const res = await fetch(`${XAI_BASE}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${xaiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${XAI_BASE}/images/generations → HTTP ${res.status}: ${text.slice(0, 800)}`);
  }
  const json = JSON.parse(text) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    error?: { message?: string };
  };
  if (!json.data?.length) {
    throw new Error(`Resposta xAI sem data: ${text.slice(0, 400)}`);
  }
  const out: GeneratedImage[] = [];
  for (const item of json.data) {
    if (item.b64_json) {
      out.push({ buffer: Buffer.from(item.b64_json, "base64"), model: args.model });
      continue;
    }
    if (item.url) {
      const img = await fetch(item.url);
      if (!img.ok) throw new Error(`Download da URL temporária xAI falhou: HTTP ${img.status}`);
      out.push({ buffer: Buffer.from(await img.arrayBuffer()), model: args.model, sourceUrl: item.url });
      continue;
    }
    throw new Error("Item xAI sem b64_json nem url.");
  }
  return out;
}

type HfStatus = {
  status: string;
  request_id?: string;
  status_url?: string;
  error?: string | null;
  images?: Array<{ url: string }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function generateHiggsfield(prompt: string, endpoint: string): Promise<GeneratedImage> {
  const auth = hfAuth();
  const path = endpoint.replace(/^\//, "");
  const submit = await fetch(`${HF_BASE}/${path}`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    // Quickstart documenta apenas `prompt`. Não inventar aspect_ratio etc.
    body: JSON.stringify({ prompt }),
  });
  const submitText = await submit.text();
  if (!submit.ok) {
    throw new Error(`POST ${HF_BASE}/${path} → HTTP ${submit.status}: ${submitText.slice(0, 800)}`);
  }
  const queued = JSON.parse(submitText) as HfStatus;
  const statusUrl =
    queued.status_url ??
    (queued.request_id ? `${HF_BASE}/requests/${queued.request_id}/status` : undefined);
  if (!statusUrl) {
    throw new Error(`Higgsfield não devolveu status_url: ${submitText.slice(0, 400)}`);
  }

  let delay = 2000;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const st = await fetch(statusUrl, { headers: { Authorization: auth } });
    const stText = await st.text();
    if (!st.ok) {
      throw new Error(`GET status Higgsfield → HTTP ${st.status}: ${stText.slice(0, 400)}`);
    }
    const body = JSON.parse(stText) as HfStatus;
    if (body.status === "completed") {
      const url = body.images?.[0]?.url;
      if (!url) throw new Error(`Higgsfield completed sem images[].url: ${stText.slice(0, 400)}`);
      const img = await fetch(url);
      if (!img.ok) throw new Error(`Download Higgsfield falhou: HTTP ${img.status}`);
      return { buffer: Buffer.from(await img.arrayBuffer()), model: path, sourceUrl: url };
    }
    if (body.status === "failed" || body.status === "nsfw" || body.status === "canceled") {
      throw new Error(`Higgsfield ${body.status}${body.error ? `: ${body.error}` : ""}`);
    }
    await sleep(delay);
    delay = Math.min(delay * 1.5, 10_000);
  }
  throw new Error("Timeout (180s) esperando Higgsfield completar.");
}
