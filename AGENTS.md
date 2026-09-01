# War2 — contrato para agentes e humanos

## Fonte da verdade

- Regras de jogo existem **somente** em `@war2/engine`.
- Client **não** valida vitória, bônus de continente, legalidade de ataque nem combinação de cartas além de desabilitar botões com `listLegalActions` (que chama o engine).
- Server **não** reimplementa combate. Autoriza (sala, slot, vez) e aplica `reduce`.
- Documentação normativa: `docs/rules/classic.md` e `docs/rules/edge-cases.md`. Se código e doc divergirem, o teste do engine ganha; depois a doc é corrigida no mesmo PR.

## Actions

Toda jogada é um objeto `{ type, ...payload }` aplicado em:

```ts
reduce(state, action) → { ok: true, state } | { ok: false, error }
```

Não mutar `state` por fora. `reduce` trata o estado como imutável (cópia estrutural).

## RNG

Combate e baralho usam `Rng` injetado. Proibido `Math.random` no engine.

## FPS

O client Pixi **não** define teto de FPS. `ticker.maxFPS = 0`. Simulação de regras não roda dentro do ticker.

## Fatias

PRs pequenos. Nomes de território, adjacência e objetivos só mudam com testes de mapa/objetivo verdes.

## O que não fazer

- Raspar, decompilar ou copiar assets/cliente do GrowGames ou de qualquer War comercial.
- Colocar regra de vitória no Pixi, no HTML ou no server “na mão”.
- Capar o ticker a 30 ou 60 “porque o War oficial faz isso”.
