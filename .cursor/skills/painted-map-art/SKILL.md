---
name: painted-map-art
description: Gera arte original de tabuleiro contínuo para o War2 via MCP war2-imagine (xAI Imagine / Higgsfield) ou Cursor GenerateImage. Use when the user asks for map art, board painting, Grok Imagine, Higgsfield, or to replace Pixi blob territories with a painted world map.
---

# Arte de mapa pintado (War2)

## Legal

Só arte **original**. Não raspar, decompilar, referenciar ou copiar GrowGames, Hasbro, War comercial, nem screenshots desses jogos.

## Ferramentas (por ordem)

1. MCP `war2-imagine` → `generate_image` se `XAI_API_KEY` (ou Higgsfield) estiver configurado. Grava em `tools/mcp-imagine/out/`.
2. Senão, ferramenta nativa Cursor `GenerateImage`.
3. Não fingir um MCP do site grok.com/imagine — esse produto não tem API pública. A API é xAI: `POST https://api.x.ai/v1/images/generations`, modelo `grok-imagine-image-2.0`.

Lê `tools/mcp-imagine/README.md` para env + `mcp.json`.

## Prompt (tabuleiro)

Pedir **um** mapa-mundo pintado contínuo (óleo/gouache sobre linho), vista top-down, continentes ligados por mares, costas naturais, sem peças-blob soltas, sem mesa de feltro, sem UI, sem texto de marca. Aspecto 16:9 ou 2:1, resolução 2k. Continentes no estilo clássico de conquista (América do Norte/Sul, Europa, África, Ásia, Oceania) mas desenho original.

## Depois de ter o PNG

Não reescrever o engine. Só o client: um Sprite de fundo + `LAYOUT[].poly` como hit-test. Não mudar nomes/adjacência sem testes de mapa verdes.
