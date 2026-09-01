# GOAL — War 2.0 jogável de verdade

Contrato durável. O agente não termina porque "parece pronto". Isto é **War Grow (Brasil)**,
não Risk: reforço é `÷2`, não `÷3`. Regras canônicas em [`docs/WAR-RULES.md`](docs/WAR-RULES.md).

## Resultado esperado

Um humano abre o app, entende o teatro em 10s, joga uma campanha inteira contra a IA sem
quebrar regra, sem tela branca, sem clique-morto, com dados visíveis, missão honesta, save
que volta, mapa a 60+ fps (sem teto a 30). É War — mais rápido, mais legível, mais justo que
o clássico. Não é um mapa com HUD.

## Estrutura deste repo (importante)

Monorepo pnpm. Os scripts `npm` da raiz delegam para o pnpm workspace:

- `@war2/engine` — regras (fonte da verdade). Testes em `packages/engine/src/*.test.ts`.
- `@war2/shared` — protocolo WebSocket.
- `@war2/client` — PixiJS 8, rAF sem teto de FPS, UI HTML. Fonte em `packages/client/src/`.
- `@war2/server` — salas, autoridade no reducer.

O gate (`scripts/war-gate.mjs`) mira esses caminhos reais, não `src/game/`.

## Decisão de regra registrada

O template colado dizia "defesa 1–2". Isso é a regra do **Risk**, não do War Grow. O engine
e `docs/rules/classic.md` implementam **defesa até 3 dados** de propósito
(`packages/engine/src/turn.test.ts` "defense may use 3 dice"). Por `AGENTS.md` ("o teste do
engine ganha"), mantemos **defesa `min(3, tropas_destino)`** e documentamos aqui.

## Verificação (gate + comandos)

Sem `GATE_OK=1` no output do turno, o goal **não** está cumprido.

- [x] `npm test` exit 0 — `package.json:12` (57 engine + 2 server neste turno)
- [x] `npm run typecheck` exit 0 — `package.json:13`
- [x] `npm run build` exit 0 — `package.json:14`
- [x] `npm run gate` imprime `GATE_OK=1` — `scripts/war-gate.mjs:81`
- [x] Playthrough humano: title → campanha → reforço → dados → conquista com ocupação visível →
      deslocamento/passar turno → Ajuda/Esc; console sem JS; screenshots em disco
      (perder um combate e save/reload já evidenciados em turnos anteriores).

## Definition of Done — Motor

Marque só com `arquivo:linha` + log de comando.

- [x] 42 territórios, 6 continentes, bônus 5 / 2 / 5 / 3 / 7 / 2 — `packages/engine/src/gate.test.ts:16-27`
- [x] Grafo simétrico; Alasca–Vladivostok — `packages/engine/src/gate.test.ts:30-38`
- [x] Setup 40 / 35 / 30 / 25 / 20 — `packages/engine/src/createGame.ts:15-21`
- [x] Reforço `max(3, floor(n/2))` + bônus — `packages/engine/src/createGame.ts:54-57`
- [x] Dados ataque 1–3, defesa 1–3, empate = defesa — `packages/engine/src/combat.ts:11-22`
- [x] Conquista `[min(dados, origem−1), origem−1]` — `packages/engine/src/reduce.ts:236-239,263-264`
- [x] Remanejo: uma transferência conectada — `packages/engine/src/reduce.ts:290-307` + `legal.ts:7-20`
- [x] 44 cartas; sets; 4,6,8,10,12,15,+5; +2 território seu — `createGame.ts:27-38` + `cards.ts:7-20` + `reduce.ts:167-171`
- [x] 5 cartas = troca obrigatória; eliminar herda; 6+ — `createGame.ts:58` + `reduce.ts:79-82`
- [x] Missões Grow (18-com-2 qualificados; fallback 24) — `objectives.ts:61-64,43-44,95-102` + `gate.test.ts:74-98`
- [x] Último vivo também vence — `packages/engine/src/reduce.ts:35-38`
- [x] IA recruta/oficial/marechal, só no próprio turno — `packages/engine/src/ai.ts:20-24,160` + `ai.test.ts:85-123`

## Definition of Done — Apresentação

- [x] Mapa no refresh; sem `maxFPS = 30` / `setInterval` — `packages/client/src/board.ts` `ticker.maxFPS = 0` + `scripts/war-gate.mjs:62-72`
- [x] Dados rolam e assentam — `packages/client/src/dice.ts:67-75`
- [x] Combate, conquista, "sua vez", "IA pensando" — `main.ts` status + `#occupy` + `dice.ts`
- [ ] Shake opcional (ainda sem trauma²); `prefers-reduced-motion` em dados/IA/overlays — `dice.ts:55` + `style.css` reduce
- [x] Title / loading / empty / help / log / gameover — `index.html` overlays; setup inicial ainda é automático (`autoSetup`)

## Definition of Done — UX

- [x] Boot no title; Continuar só com save — `index.html` overlay visível; `main.ts` `loadCampaign` desabilita Continuar
- [x] Loading honesto no início da campanha — `main.ts` `#loading` + `setTimeout(40)`
- [x] Empty: sem save / sem cartas / diário vazio — `#cards-empty` `#log-empty` + Continuar disabled
- [x] Alvos legais destacados; clique ilegal só troca seleção — `legalTargets` + guarda em `onTerritory`
- [x] Mobile: `overflow-x: hidden`, botões `min-height/width: 44px`, `safe-area-inset` — `style.css`
- [x] Esc fecha ajuda/gameover; backdrop fecha ajuda — `main.ts` keydown + `#help` click
- [x] Rótulos: Abandonar / Nova campanha / Título — `index.html`

## Loop (cada turno)

1. `npm run gate`. Se falhar, a falha é a tarefa. Não polir HUD com motor quebrado.
2. Jogar o caminho que quebrou.
3. Pegar o DoD falso de maior severidade: **regras > turno quebrado > IA inútil > jank > vazio/loading > polish**.
4. Um conserto. Re-rodar gate + playthrough.

Proibido: reescrever do zero; trocar War por Risk; auth/multiplayer/loja; chamar de pronto
depois de "refatorei o HUD"; pular o gate porque "é visual".

## Veredito obrigatório no turno final

```
GATE_OK=1
DoD: N/N boxes evidenced
Playthrough: <o que foi clicado>
Forbidden phrases used: none
```
