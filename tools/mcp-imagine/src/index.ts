#!/usr/bin/env node
/**
 * MCP stdio: generate_image + list_models.
 * Logs só em stderr (stdout é JSON-RPC).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  CATALOG,
  generateHiggsfield,
  generateXai,
  HF_DEFAULT_ENDPOINT,
  keysPresent,
  listXaiModels,
} from "./providers.js";
import { maybeEmbed, mimeOf, resolveOutputPath, writeImage } from "./save.js";

const server = new McpServer({
  name: "war2-imagine",
  version: "0.1.0",
});

server.tool(
  "list_models",
  "Lista modelos de imagem documentados (xAI Imagine vs grok-2-image legado vs Higgsfield Soul) e se as env vars estão presentes. Não revela chaves.",
  {
    refresh_remote: z
      .boolean()
      .optional()
      .describe("Se true e XAI_API_KEY existir, também chama GET https://api.x.ai/v1/models e filtra ids com image/imagine."),
  },
  async ({ refresh_remote }) => {
    const keys = keysPresent();
    let remote: string[] | { error: string } | undefined;
    if (refresh_remote) {
      try {
        remote = await listXaiModels();
      } catch (e) {
        remote = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    const payload = {
      honesty: {
        grok_com_imagine:
          "Produto consumer em https://grok.com/imagine (login X). Não há API pública para ‘logar no grok.com’. A Imagine API é https://api.x.ai/v1/images/generations com Bearer XAI_API_KEY.",
        cursor_generate_image:
          "Esta sessão Cursor já tem a ferramenta nativa GenerateImage (namespace cursor). Não precisa de MCP para um teste rápido de arte.",
        higgsfield_hosted_mcp:
          "Higgsfield já publica MCP hospedado em https://mcp.higgsfield.ai (OAuth, sem API key). Este servidor local usa a REST documentada para gravar o ficheiro no repo.",
        legal: "Arte original only. Não copiar/raspar GrowGames nem War comercial.",
      },
      keys_present: keys,
      catalog: CATALOG,
      xai_models_remote: remote,
      docs: {
        xai_imagine: "https://docs.x.ai/developers/model-capabilities/imagine",
        xai_image_gen: "https://docs.x.ai/developers/model-capabilities/images/generation",
        xai_pricing: "https://docs.x.ai/developers/models",
        xai_console: "https://console.x.ai",
        higgsfield: "https://docs.higgsfield.ai/docs",
        higgsfield_quickstart: "https://docs.higgsfield.ai/docs/quickstart.md",
        higgsfield_mcp: "https://mcp.higgsfield.ai",
      },
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  },
);

server.tool(
  "generate_image",
  "Gera uma imagem original (xAI Imagine API ou Higgsfield Soul) e grava no disco do repo. Use para arte de tabuleiro contínuo — nunca clonar GrowGames/War comercial.",
  {
    prompt: z.string().min(1).describe("Descrição da imagem. Arte original; não pedir cópia de jogo comercial."),
    provider: z
      .enum(["xai", "higgsfield"])
      .optional()
      .describe("Padrão: xai. higgsfield usa POST /higgsfield-ai/soul/v2/standard + poll."),
    model: z
      .string()
      .optional()
      .describe("xAI: grok-imagine-image-2.0 (padrão). Higgsfield: path do modelo, default higgsfield-ai/soul/v2/standard."),
    aspect_ratio: z
      .string()
      .optional()
      .describe("Só xAI Imagine. Docs: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, 21:9, auto, …"),
    resolution: z.enum(["1k", "2k"]).optional().describe("Só xAI Imagine. Padrão da API: 1k."),
    quality: z
      .enum(["low", "medium", "auto"])
      .optional()
      .describe("Só grok-imagine-image-2.0. Docs: low | medium | auto."),
    n: z.number().int().min(1).max(10).optional().describe("Só xAI, 1–10. Padrão 1."),
    output_path: z
      .string()
      .optional()
      .describe("Caminho relativo à raiz do repo ou absoluto dentro do repo. Se omitir: tools/mcp-imagine/out/."),
  },
  async (args) => {
    const provider = args.provider ?? "xai";
    try {
      const saved: string[] = [];
      const embeds: Array<{ type: "image"; data: string; mimeType: string }> = [];

      if (provider === "xai") {
        const model = args.model ?? "grok-imagine-image-2.0";
        const images = await generateXai({
          prompt: args.prompt,
          model,
          aspectRatio: args.aspect_ratio,
          resolution: args.resolution,
          quality: args.quality,
          n: args.n,
        });
        for (const img of images) {
          const dest = resolveOutputPath(args.output_path, args.prompt, mimeOf(img.buffer));
          saved.push(await writeImage(dest, img.buffer));
          const embed = maybeEmbed(img.buffer);
          if (embed) embeds.push(embed);
        }
      } else {
        const endpoint = args.model ?? HF_DEFAULT_ENDPOINT;
        const img = await generateHiggsfield(args.prompt, endpoint);
        const dest = resolveOutputPath(args.output_path, args.prompt, mimeOf(img.buffer));
        saved.push(await writeImage(dest, img.buffer));
        const embed = maybeEmbed(img.buffer);
        if (embed) embeds.push(embed);
      }

      const text = JSON.stringify(
        {
          ok: true,
          provider,
          files: saved,
          note: embeds.length
            ? "Imagem também vem no content (type=image) para o chat."
            : "Ficheiro grande demais para embed no chat; abre o path.",
        },
        null,
        2,
      );
      return {
        content: [{ type: "text" as const, text }, ...embeds],
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("war2-imagine MCP ready (stdio)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
