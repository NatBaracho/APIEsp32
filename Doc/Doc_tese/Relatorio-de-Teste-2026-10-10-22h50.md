# Relatório de Teste — Queda do banco principal por 1 hora e tabela commands

**Data:** 10/10/2026, 22:50 (queda das 21:11 às 22:11; fila vazia às 22:49)
**Executado por:** IA (Claude Code, modelo Claude Opus 5.5), a pedido de Natã da Silva Baracho
**Branch:** `test/queda-do-banco-principal` (PR #24), enviada ao GitHub depois da aprovação
**Base:** pedidos de Natã em 10/10/2026: simular 600 lacres com o banco principal fora do ar, por 1 hora, para ver se o banco aguenta; e testar a tabela `commands`
**Situação:** ✅ **aprovado por Natã da Silva Baracho em 10/10/2026** (seção 8)

---

## 1. Resumo

| Teste | Resultado |
| --- | --- |
| Queda do banco principal por 1 hora, com 600 lacres (`npm run simular:queda`) | **13 de 13** verificações |
| Tabela `commands`, com 3.000 comandos (`npm run simular:comandos`) | **24 de 24** verificações |
| `oxide.db` do projeto | Não participa dos testes (pastas temporárias) |
| Banco principal (Supabase) de verdade | **Não acessado** |

**A Oxide aguentou.** Com o banco principal fora do ar por 60 minutos, a API aceitou as 215.869 leituras, sem recusar nenhuma. Quando ele voltou, a fila esvaziou sozinha em 37,5 minutos e tudo chegou, sem perda e sem duplicar.

O ponto de atenção é a **volta**: o Worker envia cerca de 96 mensagens por segundo. Depois de uma queda longa, a fila demora a esvaziar (seção 4).

**Limite:** o banco principal foi o recebedor de teste, como nos testes anteriores.

## 2. Queda de 1 hora: o que foi simulado

- **600 lacres**, ativados e vinculados a um cilindro antes da queda.
- Cada lacre envia **uma leitura a cada 10 segundos**: 60 leituras por segundo. É 6 vezes mais pesado que uma leitura por minuto; escolhi esse ritmo para forçar o banco.
- **Banco principal fora do ar por 60 minutos.**
- API e Worker em processos separados. O Worker com a configuração padrão: uma rodada a cada 10 segundos, em lotes de 100.
- Depois dos 60 minutos, o banco principal volta e os lacres param de enviar, para medir só o esvaziamento da fila.

## 3. Durante a queda

| Minuto | Leituras aceitas no minuto | Recusadas | Sem resposta | Na fila | Banco (MB) | Metade das respostas em até | 95% em até | Mais lenta do minuto |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 3.598 | 0 | 0 | 3.598 | 2,9 | 3 ms | 6 ms | 35 ms |
| 5 | 3.595 | 0 | 0 | 17.980 | 12,0 | 3 ms | 7 ms | 27 ms |
| 10 | 3.600 | 0 | 0 | 35.972 | 23,3 | 4 ms | 9 ms | 51 ms |
| 15 | 3.592 | 0 | 0 | 53.952 | 34,6 | 6 ms | 19 ms | 82 ms |
| 20 | 3.597 | 0 | 0 | 71.945 | 46,1 | 5 ms | 12 ms | 56 ms |
| 25 | 3.600 | 0 | 0 | 89.938 | 57,5 | 8 ms | 27 ms | 109 ms |
| 30 | 3.600 | 0 | 0 | 107.928 | 69,0 | 5 ms | 18 ms | 47 ms |
| 35 | 3.600 | 0 | 0 | 125.915 | 80,4 | 5 ms | 18 ms | 90 ms |
| 40 | 3.600 | 0 | 0 | 143.907 | 92,1 | 6 ms | 14 ms | 41 ms |
| 45 | 3.600 | 0 | 0 | 161.889 | 103,3 | 11 ms | 40 ms | 182 ms |
| 50 | 3.600 | 0 | 0 | 179.878 | 114,9 | 11 ms | 38 ms | 213 ms |
| 55 | 3.600 | 0 | 0 | 197.878 | 126,2 | 11 ms | 44 ms | 104 ms |
| 57 | 3.591 | 0 | 0 | 205.069 | 130,7 | 11 ms | 52 ms | 479 ms |
| 60 | 3.600 | 0 | 0 | 215.869 | 137,4 | 11 ms | 41 ms | 111 ms |

| Conferência | Resultado |
| --- | --- |
| Leituras aceitas em 60 minutos | 215.869 |
| Leituras recusadas | 0 |
| Lacres sem resposta | 0 |
| Mensagens guardadas na fila no fim da queda | 215.869 |
| Tentativas gastas pela queda | 0 |
| `/health` avisando o problema (`503 DEGRADADO`) | 60 de 60 amostras |
| Tamanho do banco no fim | 137,4 MB, mais 4,1 MB do arquivo WAL |
| Resposta mais lenta em toda a hora | 479 ms |

O que os números mostram:

- **Nenhuma leitura se perdeu na entrada.** O ritmo ficou constante, em cerca de 3.600 por minuto, do primeiro ao último minuto.
- **O banco cresceu de forma regular:** cerca de 2,3 MB por minuto, ou 0,64 KB por leitura.
- **A resposta ficou mais lenta com a fila cheia, mas continuou rápida.** A metade das respostas passou de 3 ms para 11 ms, e 95% delas, de 6 ms para até 70 ms. A mais lenta de toda a hora levou 479 ms.

## 4. A volta: a fila esvazia

| Tempo depois da volta | Na fila |
| --- | --- |
| 0 min | 215.869 |
| 10 min | 158.869 |
| 20 min | 100.869 |
| 30 min | 42.869 |
| 37,5 min | 0 |

| Conferência final | Resultado |
| --- | --- |
| Tempo para esvaziar a fila | 37,5 minutos, a 96 mensagens por segundo |
| Mensagens na Oxide e no banco principal de teste | 216.469 e 216.469 |
| Leituras aceitas durante a queda que chegaram | 215.869 de 215.869 |
| Leituras com o cilindro do vínculo | Todas |
| Mensagens marcadas como enviadas | Todas (`SYNCED`) |
| Banco íntegro | Sim |
| `/health` de volta ao normal | `200 OK` |

As 216.469 mensagens são as 215.869 leituras da queda e as 600 ativações da preparação.

### O ponto de atenção: a velocidade da volta

O Worker envia até 1.000 mensagens por rodada (10 lotes de 100) e faz uma rodada a cada 10 segundos. Isso dá cerca de 96 mensagens por segundo.

- Neste teste, os lacres pararam de enviar na volta. Mesmo assim, a fila levou 37,5 minutos para esvaziar.
- **Se os lacres continuassem enviando no mesmo ritmo (60 por segundo), sobrariam cerca de 36 por segundo para reduzir a fila, e ela levaria perto de 1 hora e 40 minutos para esvaziar.** Esta é uma conta minha, não uma medida.
- **Se chegassem mais de 96 mensagens por segundo, a fila nunca esvaziaria**, mesmo com o banco principal no ar. Com 600 lacres enviando uma vez por minuto (10 por segundo), há folga de quase 10 vezes.

Nada se perde nesse tempo; o efeito é o sistema principal ver os dados com atraso. A velocidade muda sem mexer no código, pelo `.env`: `WORKER_BATCH_SIZE` (mensagens por lote) e `WORKER_INTERVAL_SECONDS` (tempo entre rodadas). Não testei outros valores, e o limite real vai depender de quanto a função do Supabase aguenta receber.

## 5. Tabela commands

O teste criou 3.000 comandos de válvula no sistema principal de teste (300 lacres, 10 para cada), mais 40 inválidos de propósito. O Worker os trouxe, cada lacre buscou os seus, executou e confirmou, e a confirmação voltou ao sistema. No meio, o banco principal, o Worker e a API foram derrubados.

| Conferência | Resultado |
| --- | --- |
| Comandos trazidos para a tabela, todos como `PENDENTE` | 3.000 de 3.000 ✅ |
| Comandos de tipo desconhecido ou de dispositivo que não existe | 0 gravados ✅ |
| Worker buscando a lista toda a cada rodada | Não duplicou nenhum ✅ |
| Data de criação em todos | Sim ✅ |
| `/health` mostrando os comandos pendentes | 3.000 ✅ |
| Cada lacre recebeu só os seus, na ordem de criação | 300 de 300 ✅ |
| Pedidos à API com a resposta esperada | 4.080 de 4.080 ✅ |
| Erros `500` | 0 ✅ |
| Comandos `EXECUTADO` e `ERRO` | 2.684 e 316, como previsto ✅ |
| Data da confirmação em todos; motivo só nos com erro | Sim ✅ |
| Dispositivo, tipo e resultado de cada comando | 3.000 conferidos, 0 diferentes ✅ |
| Uma mensagem de confirmação para cada comando | 3.000 ✅ |
| Resultado certo recebido pelo sistema principal | 3.000 de 3.000 ✅ |
| Comando já confirmado, reenviado pelo sistema | Não voltou a ficar pendente ✅ |
| Limpeza (`npm run retencao`) | Apagou só os 200 concluídos há mais de 30 dias; o pendente antigo ficou ✅ |
| Banco íntegro | Sim ✅ |

A API barrou o que devia: buscar sem chave (`401`), buscar os comandos de outro lacre (`403`), confirmar comando de outro (`404`), confirmar em nome de outro (`403`), `status` inválido (`400`), comando que não existe (`404`) e confirmar duas vezes (`409`).

Tempo de resposta: metade em até 32 ms, 99% em até 89 ms e a mais lenta em 130 ms, a 517 pedidos por segundo.

## 6. Pontos de atenção

- **Os dois testes rodaram na mesma máquina, em parte ao mesmo tempo.** O teste da tabela `commands` e, depois, a API do projeto ligada para testes manuais rodaram durante a queda de 1 hora. Os tempos de resposta podem ter se influenciado um pouco; os resultados de conteúdo (nada perdido, nada duplicado) não dependem disso.
- **No teste da tabela `commands`, as três quedas aconteceram quase juntas**, nos primeiros 8 segundos, porque o teste todo durou 7,9 segundos. Os lacres ficaram sem conexão 320 vezes, tentaram de novo e nada se perdeu.
- **Queda mais longa que 1 hora não foi testada.** Pelo crescimento medido (2,3 MB por minuto neste ritmo), um dia inteiro fora do ar daria cerca de 3,3 GB. É uma conta, não uma medida.
- **A limpeza não apaga o que está pendente.** Durante uma queda, o arquivo só cresce; ele volta a diminuir com `npm run retencao -- --confirmar`, depois que as mensagens forem enviadas e passarem do prazo.
- **Não testado:** o Supabase de verdade, o lacre de verdade e queda de energia no meio de uma gravação.

### Fora dos testes, a pedido de Natã

- Foram gravados 4 comandos de exemplo (`CMD-EXEMPLO-001` a `004`) no `oxide.db` do projeto, para a tabela `commands` aparecer preenchida. Antes, foi feita a cópia `backups/oxide-20261011T004001.db`. Os dois pendentes são comandos de verdade para a API: devem ser apagados antes de ligar um lacre real.
- Foi criada uma coleção do Thunder Client com 25 requisições (`thunder-client/thunder-collection_API-do-lacre.json`), para testar a API na mão. A importação no Thunder Client não foi conferida pela IA.

## 7. Questionário de validação (responda sim ou não)

1. O teste da queda (600 lacres, uma leitura a cada 10 segundos, 1 hora) representa o que você queria?
2. Os resultados estão de acordo com o que você espera?
3. Quer que eu teste o Worker com lotes maiores, para a fila esvaziar mais depressa depois de uma queda?
4. Aprova os dois testes novos (`npm run simular:queda` e `npm run simular:comandos`) no projeto?
5. Os 4 comandos de exemplo ficam no `oxide.db` que vai para o GitHub? (não = eu apago antes de enviar)
6. A coleção do Thunder Client vai para o GitHub? Ela leva escrita a chave de teste do `DSP-000001`.
7. Posso atualizar os documentos e enviar ao GitHub, num PR novo?

## 8. Validação e teste com lotes maiores (10/10/2026)

Natã da Silva Baracho respondeu **sim** às sete perguntas: **aprovado por Natã da Silva Baracho em 10/10/2026**.

### 8.1 Worker com lotes maiores (pergunta 3)

Repeti o teste com uma queda de 5 minutos (600 lacres, cerca de 18.000 leituras na fila), mudando só o tamanho do lote do Worker (`WORKER_BATCH_SIZE`). O intervalo entre as rodadas ficou em 10 segundos.

| Tamanho do lote | Mensagens por rodada | Velocidade medida na volta | Verificações | Tempo para esvaziar 216.000 mensagens |
| --- | --- | --- | --- | --- |
| 100 (padrão) | até 1.000 | 96 por segundo | 13 de 13 | 37,5 minutos (medido no teste de 1 hora) |
| 500 | até 5.000 | cerca de 400 por segundo | 13 de 13 | cerca de 9 minutos (conta) |
| 1.000 | até 10.000 | cerca de 720 por segundo | 13 de 13 | cerca de 5 minutos (conta) |

- Com os lotes maiores, nada se perdeu nem duplicou, e a API continuou respondendo normalmente aos lacres (resposta mais lenta de 145 ms).
- A velocidade das duas linhas de baixo é aproximada: a fila esvaziou em menos de 1 minuto e o teste confere de 5 em 5 segundos.
- **O padrão continua em 100.** O lote maior foi testado só com o recebedor de teste, que responde na hora. A função do Supabase pode ter limite de tamanho do pedido e de tempo; o valor certo deve ser escolhido no primeiro teste com o Supabase de verdade. Para mudar, basta o `.env` (`WORKER_BATCH_SIZE`).

### 8.2 O que foi para o GitHub

- Os dois testes novos (`npm run simular:queda` e `npm run simular:comandos`).
- O `oxide.db` do projeto com os 4 comandos de exemplo (`CMD-EXEMPLO-001` a `004`).
- A coleção do Thunder Client (`thunder-client/`), com a chave de teste do `DSP-000001`.
- Os documentos atualizados e o registro 23 em `DocumentacaoFinal/`.
