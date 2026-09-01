# Regras clássicas (tabuleiro)

Fonte: regras públicas do jogo de conquista territorial brasileiro de 42 territórios e objetivos secretos (não o cliente comercial GrowGames). O engine `@war2/engine` é a implementação executável. Se divergir, o teste ganha e esta página é atualizada no mesmo PR.

## Peças

- Mapa: 6 continentes, 42 territórios.
- 6 cores de exército: branco, preto, vermelho, azul, amarelo, verde.
- 14 cartas de objetivo.
- 44 cartas de território: 42 (território + figura círculo, triângulo ou quadrado) e 2 coringas (as três figuras).
- Dados: até 3 de ataque e até 3 de defesa. Empate fica com a **defesa**.

## Setup

1. 2 a 6 jogadores (o tabuleiro clássico cita 3–6; 2 é suportado para hotseat).
2. Cores únicas. Objetivos “destruir a cor X” de cores **ausentes** saem do baralho.
3. Retiram-se os coringas; distribuem-se as 42 cartas-território. Cada território recebe **1** exército do dono.
4. Exércitos restantes (tabela estilo clássico) são colocados um a um, em sentido horário: 2 jogadores 40, 3→35, 4→30, 5→25, 6→20, menos os já postos no deal.
5. Sorteia-se 1 objetivo secreto por jogador. Se o objetivo for “destruir a própria cor”, trata-se como **24 territórios** (ver edge cases).
6. Cartas-território voltam ao monte com os 2 coringas, embaralhadas.

## Turno

Nesta ordem:

1. **Receber** exércitos e **colocar** todos (e trocar cartas, se quiser ou for obrigatório).
2. **Atacar** (opcional, repetível).
3. **Deslocar** (opcional).
4. **Carta:** se conquistou ≥1 território neste turno, recebe **uma** carta, depois dos deslocamentos.

### Reforço

- `max(3, floor(territórios / 2))` exércitos livres, em qualquer território próprio.
- Bônus de continente (Tabela I), **obrigatoriamente** nos territórios daquele continente:
  - América do Sul 4 territórios → +2
  - América do Norte 9 → +5
  - Europa 7 → +5
  - África 6 → +3
  - Ásia 12 → +7
  - Oceania 4 → +2
- Troca de cartas (Tabela II, contada **por jogo**, não por jogador): 4, 6, 8, 10, 12, depois 15, 20, 25… (+5).
  - Trio válido: três figuras iguais **ou** três distintas. Coringa completa qualquer figura.
  - Opcional com 3–4 cartas; **obrigatório** com 5.
  - Se uma carta do trio for território próprio: **+2** naquele território, obrigatórios.

### Combate

- Atacar só território **adjacente** inimigo (inclui pontilhado Alasca–Vladivostok).
- Ataque exige ≥2 no território de origem (1 fica de ocupação). Dados de ataque = `min(3, exércitos − 1)`.
- Defesa usa `min(3, exércitos)` (o de ocupação defende). Isto é a regra de tabuleiro clássica, **não** o Risk de 2 dados de defesa.
- Ordenam-se os dados decrescentes; compara-se par a par; empate = defesa.
- Conquista: defesa a 0. Ocupação imediata: move no mínimo o número de dados de ataque usados, no máximo origem−1, sempre deixando ≥1 na origem.
- Quantos ataques quiser, de um ou vários territórios.

### Deslocamento

- **Exatamente uma** transferência por turno, entre dois territórios **seus** ligados por um caminho em que **todos** os territórios são seus (não precisa ser adjacente).
- Sempre resta ≥1 de ocupação na origem.

### Cartas após conquista

Uma carta por turno se houve conquista, **depois** do deslocamento. Coringas entram no monte. Monte esgotado: recicla o descarte (cartas já trocadas), embaralha.

### Eliminação

O eliminador recebe as cartas do eliminado. Não pode ficar com mais de 5; se passar, troca até caber **depois** de ocupar. Só o eliminador cumpre “destruir essa cor”; os outros donos da mesma missão passam a 24 territórios.

## Objetivos (14)

1. Europa + Oceania + **um terceiro** continente.
2. Ásia + América do Sul.
3. Europa + América do Sul + **um terceiro** continente.
4. 18 territórios, cada um com ≥2 exércitos.
5. Ásia + África.
6. América do Norte + África.
7. 24 territórios.
8. América do Norte + Oceania.
9–14. Destruir por completo azuis / amarelos / vermelhos / pretos / brancos / verdes.

Vitória: cumprir o objetivo e revelar a carta. Verificado após occupy, colocação, troca, deslocamento e fim de turno — não no ataque que deixa o território a 0.
