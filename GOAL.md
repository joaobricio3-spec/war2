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

- [ ] `npm test` exit 0 (inclui `packages/engine/src/*.test.ts`)
- [ ] `npm run typecheck` exit 0
- [ ] `npm run build` exit 0
- [ ] `npm run gate` imprime `GATE_OK=1` e exit 0
- [ ] Playthrough humano colado: title → nova campanha vs IA → reforço → atacar e ver dados →
      perder um combate → conquistar → remanejar → save/reload; console limpa; screenshots em disco.

## Definition of Done — Motor

Marque só com `arquivo:linha` + log de comando.

- [ ] 42 territórios, 6 continentes, bônus 5 / 2 / 5 / 3 / 7 / 2
- [ ] Grafo simétrico (A→B ⇒ B→A); Alasca–Vladivostok existe
- [ ] Setup 40 / 35 / 30 / 25 / 20 tropas para 2–6 jogadores
- [ ] Reforço `max(3, floor(n/2))` + bônus (nunca `÷3`)
- [ ] Dados: ataque 1–3, defesa 1–3 (War Grow), empate = defesa
- [ ] Conquista: move no mínimo os dados usados, no máximo origem−1, 1 fica
- [ ] Remanejo: uma transferência, só por territórios seus conectados
- [ ] 44 cartas (42+2 curingas); sets 3 iguais / 1 de cada / curinga; 4,6,8,10,12,15 depois +5; +2 se o território é seu
- [ ] 5 cartas = troca obrigatória; eliminar herda cartas; 6+ troca na hora
- [ ] Missões Grow (18-com-2 conta 18 qualificados; pares de continente; destruir cor com fallback 24)
- [ ] Último vivo também vence
- [ ] IA não trava a UI, não joga no turno humano; recruta / oficial / marechal jogam diferente

## Definition of Done — Apresentação

- [ ] Mapa no refresh do monitor (transform/opacity). Sem `setInterval` de câmera e sem `maxFPS = 30`
- [ ] Dados: faces aleatórias enquanto rolam, assentam no valor real
- [ ] Combate, conquista, "sua vez", "IA pensando" — visível
- [ ] Shake opcional; `prefers-reduced-motion` respeitado
- [ ] Title / setup / loading / empty / help / log / gameover com enter/exit

## Definition of Done — UX

- [ ] Boot não começa campanha sozinho. Title é a porta. Continuar só com save real
- [ ] Loading honesto — nunca tela preta/branca >300ms sem texto
- [ ] Empty: sem save, sem cartas, diário vazio
- [ ] Alvos legais destacados; clique ilegal não "come" o input
- [ ] Mobile ~390px: sem overflow X, alvos ≥44px, safe-area
- [ ] Esc fecha overlay; backdrop fecha help/log
- [ ] Rótulos fazem o que dizem (Abandonar / Nova campanha / Título)

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
