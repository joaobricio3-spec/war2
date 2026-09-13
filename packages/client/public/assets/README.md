Arte original, sem referência a produtos Grow/Hasbro.

- `world-board-arcade.png` — fundo gerado proceduralmente (mar tinta + grão + vinheta + graticule, terra pergaminho neutra). `world-board-v*.jpg`/`world-relief.jpg` são arte anterior.
- `masks/<territory>.png` — região por território (fronteira dos polys ∩ silhueta do continente), alpha tintable — o board desenha cada território como sprite tingido por continente+dono.
- `territory-lines.png` — contornos das regiões (fronteiras + costas), overlay único acima dos fills.
- `regions-index.png` — mapa de índice (R = índice do território na ordem do `LAYOUT`, 0 = mar) — hit-test de clique idêntico às regiões visíveis.
- `visual-lanes.json` — pares adjacentes sem fronteira rasterizada (travessias de mar) que o board desenha como rotas.
- Tudo gerado por `scripts/build-board.py` — rodar de novo após mexer em `layout.ts` ou adjacência.
- `world-relief.jpg` — relevo anterior (arquivo legado).
- `card-circle.png` / `card-triangle.png` / `card-square.png` — emblemas de carta em latão
- `card-joker.png` — emblema de coringa em latão
- `die-red.png` / `die-ivory.png` — faces de dado sem pips (ataque / defesa)
- `logo.png` — logotipo WAR2
- `felt-table.png` — mesa de nogueira + feltro (overlay)
- `vellum-grain.png` — fibra de velino
- `compass-rose.png` — rosa dos ventos em latão
- `blotter-leather.png` — blotter de couro do painel

Não redistribuir como se fossem fotos de um jogo comercial.
