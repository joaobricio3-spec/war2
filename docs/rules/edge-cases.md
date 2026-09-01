# Edge cases

Complemento de `classic.md`. Cada item tem (ou deve ter) teste em `@war2/engine`.

## Combate

- Empate no par de dados: defesa não perde aquele exército.
- Ataque 3 vs defesa 1: só se compara o maior de cada lado; o atacante só pode perder 1.
- Ataque 3 vs defesa 3: três comparações.
- Não se ataca com 1 no território. Não se ataca território próprio nem não-adjacente.
- Depois da conquista, `occupy` é a **única** ação legal até acontecer (inclusive se a mão passou de 5 por eliminação). `armies` ∈ `[min(dadosUsados, origem−1), origem−1]`, origem fica ≥1.
- Vitória de territórios/continentes só é checada **depois** do occupy (o território conquistado não fica a 0 exércitos como estado estável).

## Cartas

- 5 na mão no **início** do reforço: a única ação legal é `trade` até a mão ter <5.
- Após eliminar alguém e herdar cartas, `occupy` vem **antes** de qualquer troca. Se a mão ficar ≥6, `mustTrade` e a fase volta a `reinforce` depois do occupy.
- Dois coringas + qualquer carta: trio válido (três iguais).
- Um coringa + duas iguais: três iguais. Um coringa + duas distintas: três distintas.
- Três coringas não ocorrem (só existem 2).
- +2 por território do trio: se duas cartas do trio forem territórios próprios, +2 em **cada**.
- Trocas usam o contador **global** da partida.
- Uma carta por turno mesmo com 10 conquistas.
- Não recebe carta se só atacou e não conquistou.
- Descarte de trios volta ao fundo quando o monte acaba, **embaralhado**.

## Objetivos

- Cores fora da mesa: objetivos “destruir X” **não** entram no sorteio.
- Objetivo “destruir a própria cor”: equivalente a 24 territórios.
- “Europa + Oceania + terceiro”: Europa e Oceania **e** pelo menos um dentre AN, AS, África, Ásia. Terceiro não pode ser Europa nem Oceania.
- “Europa + AS + terceiro”: análogo.
- 18 com 2: contar só territórios próprios com `armies >= 2`; ter 18 territórios com alguns a 1 não basta.
- Destruir cor: só o **eliminador** cumpre o objetivo. Se um terceiro mata o alvo, os outros donos dessa missão passam a “24 territórios”. Alvo a 0 territórios não basta para quem não deu o golpe.
- Objetivo “destruir a própria cor”: equivalente a 24 territórios.

## Continente e colocação

- Bônus de continente **não** pode ser posto fora do continente.
- Exércitos “gerais” (territórios/2 e troca) podem ir a qualquer território próprio.
- +2 de carta só naquele território.
- `endReinforce` é ilegal enquanto restar qualquer exército pendente **ou** mão ≥5.

## Deslocamento

- Mover 5 do Brasil à Venezuela e, no mesmo turno, esses 5 da Venezuela ao México: **ilegal**.
- Exércitos que **já estavam** na Venezuela podem ir ao México no mesmo turno.
- Modelo: cada território acumula `arrivedThisTurn`; só `armies - 1 - arrivedThisTurn` pode sair.

## Setup

- 42 territórios distribuídos o mais igualmente possível (resto para os primeiros da ordem sorteada).
- Ordem dos jogadores e baralho: RNG injetado, reproduzível nos testes.

## Fim de turno / vez

- Só o `currentPlayerId` age. Fora da vez: `ok: false`.
- `endTurn` na fase de ataque (sem occupy pendente) ou fortify: se conquistou, compra carta, limpa flags, passa a vez, a nova vez já calcula reforço.
- Jogador eliminado é pulado.

## Rede

- O server não inventa regra. Snapshot completo no servidor; o client da vez vê o próprio objetivo e as próprias cartas; os outros objetivos/cartas vêm mascarados via `viewFor`.
