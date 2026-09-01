# Como contribuir

## Antes do código

1. Abra uma issue (use o template `engine`, `client`, `server` ou `good first issue`).
2. Uma issue = um comportamento testável. PRs enormes voltam.

## Motor (`packages/engine`)

- Toda regra nova começa por um teste Vitest que **falha**.
- `reduce(state, action)` é a única porta. Sem atalho no client.
- RNG é injetado (`rng.nextInt(1, 6)`). Teste de combate nunca chama `Math.random`.
- Mapa: grafo em `src/map/classic.ts`. Beleza (polígonos) fica no client.

## Client

- Sem `targetFPS` / cap no ticker. O loop é `requestAnimationFrame` na taxa do monitor.
- O ticker **não** chama `reduce`. Só lê o último snapshot.
- UI de turno em HTML/CSS (nítida em qualquer refresh). O canvas é o mapa.

## Server

- Autoridade: rejeita ação de quem não é o jogador da vez ou não possui o slot.
- Mesmo `reduce` do engine. Sem segunda implementação de combate.

## Comandos

```bash
pnpm test
pnpm typecheck
```

CI no GitHub Actions roda os dois em todo push.

## Commits

Mensagens curtas no imperativo, em português ou inglês, focadas no *porquê*:

`feat: troca de cartas força 5 na mão`

Não commitar `.env`, tokens, nem assets de terceiros sem licença.
