# MCP Imagine (xAI + Higgsfield)

MCP **local** (stdio) para gerar arte **original** e gravar no disco. Não é scraper do grok.com. Não copia GrowGames / War comercial.

## O que existe de verdade (2026-08)

| Produto | API de developer? | Como chamar |
| --- | --- | --- |
| **grok.com/imagine** (consumer) | Não. Login X no site. | Sem MCP “oficial do site”. |
| **xAI Imagine API** | Sim. | `POST https://api.x.ai/v1/images/generations` + `Authorization: Bearer $XAI_API_KEY` |
| **grok-2-image** | Alias legado. | Ainda aparece em metadados de algumas chaves (`grok-2-image-1212`). A doc de Image Generation só exemplifica `grok-imagine-*`. Página de modelo dedicada 404. |
| **Higgsfield REST** | Sim. | `POST https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard` + poll `GET /requests/{id}/status`. Auth: `Authorization: Key $HF_API_KEY_ID:$HF_API_KEY_SECRET` |
| **Higgsfield MCP hospedado** | Sim (OAuth). | `https://mcp.higgsfield.ai` — já existe; não reimplementámos os 30 modelos. |
| **Cursor GenerateImage** | Nativo nesta sessão. | Ferramenta `cursor` / `GenerateImage`. Serve para um teste rápido **sem** chave. |

Docs:

- Imagine overview: https://docs.x.ai/developers/model-capabilities/imagine
- Image generation: https://docs.x.ai/developers/model-capabilities/images/generation
- Preços Imagine: https://docs.x.ai/developers/models (`grok-imagine-image` $0.02, `grok-imagine-image-2.0` $0.04, `grok-imagine-image-quality` $0.05)
- Console: https://console.x.ai
- Higgsfield: https://docs.higgsfield.ai/docs
- Higgsfield quickstart: https://docs.higgsfield.ai/docs/quickstart.md

## Instalar (só este pacote)

```powershell
cd tools\mcp-imagine
pnpm install --ignore-workspace
pnpm build
copy .env.example .env
# edita .env e cola XAI_API_KEY (e opcionalmente as duas HF_*)
```

`--ignore-workspace` é obrigatório: este pacote **não** está no `pnpm-workspace.yaml` da raiz (só `packages/*`). Sem a flag, o pnpm sobe para o monorepo e não instala nada aqui.

Não commitar `.env`. O `.gitignore` da raiz já ignora `.env`.

## Ligar no Cursor

Copia o bloco de `mcp.json.example` para:

- projeto: `.cursor/mcp.json`, ou
- global: `%USERPROFILE%\.cursor\mcp.json`

```json
{
  "mcpServers": {
    "war2-imagine": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/tools/mcp-imagine/dist/index.js"],
      "env": {
        "XAI_API_KEY": "${env:XAI_API_KEY}",
        "HF_API_KEY_ID": "${env:HF_API_KEY_ID}",
        "HF_API_KEY_SECRET": "${env:HF_API_KEY_SECRET}"
      },
      "envFile": "${workspaceFolder}/tools/mcp-imagine/.env"
    }
  }
}
```

Reinicia o Cursor (ou Toggle MCP). Tools: `list_models`, `generate_image`.

Higgsfield hospedado (OAuth, sem REST key), se quiseres o studio deles em vez deste save-to-disk:

```json
"higgsfield": {
  "url": "https://mcp.higgsfield.ai"
}
```

## Tools

- `list_models` — catálogo documentado + `keys_present`. `refresh_remote: true` chama `GET https://api.x.ai/v1/models`.
- `generate_image` — gera e grava em `tools/mcp-imagine/out/` (ou `output_path` dentro do repo).

Padrão xAI: `grok-imagine-image-2.0`, `response_format: b64_json` (URLs da xAI são temporárias).

Higgsfield: só o body `{ "prompt" }` do Quickstart. Não inventámos `aspect_ratio` para Soul.

## Tabuleiro Pixi (próximo passo, não feito aqui)

Hoje o Pixi desenha **blobs orgânicos** com textura de velino em cima de feltro (`packages/client/src/board.ts`). Com uma pintura boa (16:9 ou 2:1, 2k, mundo contínuo, costas/continentes sem “peças de puzzle”):

1. Gravar o vencedor em `packages/client/public/assets/` (ex. `world-board.png`).
2. Trocar o fundo feltro+células por **um** `Sprite` do mapa.
3. Manter `LAYOUT[].poly` só como **hit area** (clique) + overlay de exércitos; não preencher o polígono com wash opaco.
4. Ajustar `WORLD` / `layout.ts` para coincidir com a pintura — nomes/adjacência **não** mudam sem testes de mapa verdes.

## Legal

Arte original. Sem raspar, decompilar ou copiar assets GrowGames / Hasbro / War comercial.
