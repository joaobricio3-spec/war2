# Regras canônicas — War (Grow, Brasil)

Fonte de verdade normativa do produto. **Não é Risk (Hasbro).** Reforço é `÷2`, não `÷3`.
A implementação executável é `@war2/engine`. Se o código divergir daqui, vale o teste do
engine e esta página é corrigida no mesmo PR (ver `AGENTS.md`). Complementos e casos de
borda ficam em `docs/rules/classic.md` e `docs/rules/edge-cases.md`.

## Tabuleiro

- 42 territórios, 6 continentes.
- Bônus de continente: América do Norte **5**, América do Sul **2**, Europa **5**,
  África **3**, Ásia **7**, Oceania **2**.
- Fronteiras são **não-dirigidas** (A→B implica B→A). Alasca–Vladivostok existe.
- Nomes seguem o mapa Grow (Mackenzie, Ottawa, Labrador, Moscou, Aral, Dudinka, Tchita,
  Vladivostok…), não os 42 nomes ingleses do Risk.

## Setup

- 2–6 jogadores. Neste produto: **um humano + 1–5 IAs**. Cores únicas; o humano escolhe a
  sua, as IAs pegam as restantes.
- Territórios embaralhados e distribuídos 1 a 1 até acabar o mapa (sobras para os primeiros
  da ordem sorteada). Cada território começa com **1** tropa.
- Tropas restantes a posicionar: `40 − 5×(jogadores − 2)` menos os territórios já recebidos.
  2→40, 3→35, 4→30, 5→25, 6→20.
- Posicionamento inicial alternado, 1 tropa por vez, nos territórios próprios.
- Missões secretas (modo missão) ou "último vivo" (dominação = 42 territórios).
- Quem começa: o **humano** (turno 1).

## Turno

Ordem: **reforço → ataque → deslocamento → carta**.

### Reforço

- Tropas livres = `max(3, floor(territórios / 2))` **+ bônus de continentes inteiros**.
  **Nunca `÷3`.** O bônus de continente só pode ser posto em territórios daquele continente.
- Pode trocar cartas antes de posicionar. Com **5** cartas a troca é **obrigatória** (pode
  ser mais de um set enquanto restar ≥5).
- Posiciona todas as tropas do turno. Sem ataque enquanto restar reforço ou troca obrigatória.

### Ataque (zero ou mais, até desistir)

- Origem própria com **≥2** tropas; destino vizinho inimigo.
- Dados de ataque = `min(3, tropas_origem − 1)`.
- Dados de defesa = `min(3, tropas_destino)`. **War Grow usa até 3 dados de defesa**
  (o Risk usa 2; aqui seguimos Grow). Confirmado por `packages/engine/src/turn.test.ts`
  ("defense may use 3 dice") e `docs/rules/classic.md`.
- Ordenam-se os dados decrescentes e compara-se par a par: maior vence; **empate = defesa**.
- Conquista (destino a 0): move no mínimo os dados de ataque usados, no máximo `origem − 1`,
  sempre fica ≥1 na origem.
- Eliminar o último território de alguém: o eliminado sai e o atacante **herda as cartas**.
  Com 6+ cartas, troca na hora e as tropas da troca entram no tabuleiro antes de seguir.
- Conquistou ≥1 território no turno → compra **1** carta ao encerrar os ataques.

### Deslocamento

- **No máximo uma** transferência: origem → destino próprios, caminho conectado só por
  territórios seus, deixa ≥1 na origem. Cada efetivo desloca-se no máximo uma vez por turno.

## Cartas

- 44 cartas: 42 de território (figura círculo / triângulo / quadrado) + 2 curingas.
- Set válido de 3: três iguais, ou uma de cada, ou completado com curinga.
- Valores de troca **globais** da partida (não por jogador): 4, 6, 8, 10, 12, 15; depois +5.
- Se uma carta trocada é de território seu: **+2** tropas naquele território, na hora.
- Cartas usadas vão ao descarte; baralho vazio → embaralha o descarte.

## Missões (modo missão)

Sorteio sem repetir; ninguém recebe "destruir a própria cor".

- 24 territórios.
- 18 territórios com **pelo menos 2 tropas em cada** um desses 18 (extras com 1 não contam).
- Pares de continente (Ásia+AS, Ásia+África, AN+África, AN+Oceania) e
  "Europa + AS + mais um" / "Europa + Oceania + mais um".
- Destruir a cor X. Se X não está na mesa, X é você, ou outro matou X: vira 24 territórios.
  Só conta se **você** eliminou X.

Vitória é checada após conquistas/occupy, colocação, troca, deslocamento e início/fim de
turno — nunca no ataque que deixa o território a 0. **Último sobrevivente também vence.**

## IA

- Não age fora do próprio turno; não aceita input humano enquanto está pensando.
- **Recruta**: só ataca com vantagem clara, para cedo.
- **Oficial**: equilibrada; troca com 4+ se houver set.
- **Marechal**: agressiva; persegue a missão, pressiona frentes.
- Nunca trava a UI: ações intercaladas com espera curta (quase nula com `prefers-reduced-motion`).

## Apresentação

- Mapa no refresh do monitor (transform/opacity). **Proibido** `setInterval` de câmera e
  `maxFPS = 30`. RAF com delta cap 0.1s só para shake/dados.
- Dados rolam de verdade (faces aleatórias enquanto rolam, assentam no valor real).
- "Sua vez", "IA pensando", combate e conquista visíveis. `prefers-reduced-motion` respeitado.
