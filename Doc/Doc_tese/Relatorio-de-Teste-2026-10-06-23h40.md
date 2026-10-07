# Relatório de Teste — API Oxide (alertas em português, análise e encerramento)

**Data/hora:** 06/10/2026, publicado às 23:40; execução final do Roteiro das 23:32:37 às 23:33:06
**Executor:** IA (Claude Code, modelo Claude Opus 5.5), com validação humana de Natã da Silva Baracho
**Commit/versão:** branch `feat/alertas-em-portugues`, a partir da `main` `d0c5cb8` (merge do PR #11)
**Ambiente:** Windows 11 Pro, Node.js v24.21.0, Git Bash, porta 3000, banco **`oxide.db` real** (com backup e restauração)
**Base:** `PlanoDeTeste.md` v1.8 e `RoteiroDeTeste.md` v1.8
**Relatório anterior:** [21h31 (entrega B)](Relatorio-de-Teste-2026-10-06-21h31.md)

## 1. Resumo

| Indicador | Valor |
| --- | --- |
| Compilação (`npx tsc --noEmit`) | PASSOU |
| Suíte automatizada | 86/86 (15 casos novos), em quatro rodadas |
| Migração dos alertas antigos (cópias do banco) | PASSOU nos dois formatos anteriores |
| Banco criado só pelo script do `Oxidedb.md` (BD-14) | 86/86 (com o dispositivo semente) |
| Roteiro: seção de alertas (5.7) | 25 respostas HTTP conforme |
| Roteiro: demais seções | Respostas HTTP idênticas à rodada da entrega B (sem regressão) |
| FALHOU | 0 |
| ACHADO | 0 (um defeito do próprio roteiro, corrigido: seção 4) |
| Banco restaurado | Sim, idêntico ao original (SHA-256 `3454c8d4…` antes e depois) |
| Validação humana | **Aprovada por Natã da Silva Baracho** |

## 2. Escopo da entrega

| # | Decisão |
| --- | --- |
| 1 | `alert_type` aceita os 28 códigos do catálogo `Tipos-de-Erro.md` (mesma lista do FluxID, decisão P5); API e banco (`CHECK`) recusam qualquer outro |
| 2 | Transição: os 6 nomes antigos em inglês continuam aceitos e são gravados em português, até nova decisão |
| 3 | Alertas já gravados migrados automaticamente; tipo desconhecido vira `DISPOSITIVO_FALHA` com o original na descrição |
| 4 | Severidade padrão = sugerida no catálogo (`SEM_COMUNICACAO` passa de `MEDIA` para `ALTA`) |
| 5 | `PATCH /api/v1/iot/alerts/{alert_id}/status`: `ABERTO` → `EM_ANALISE` → `ENCERRADO`, ou `ABERTO` → `ENCERRADO`; `ENCERRADO` é final |
| 6 | Encerrar exige `resolved_by` e `resolution_note` (colunas novas); a data é preenchida sozinha |
| 7 | `GET /api/v1/iot/alerts` com filtros `status` e `device_id` |
| 8 | Rotas de listagem e de mudança de status abertas e provisórias, até o controle por perfil do FluxID |

## 3. Validação pela IA

### 3.1 Suíte automatizada (grupo "Alertas")

| Caso | Resultado |
| --- | --- |
| Nome antigo `SEAL_BROKEN` sem `severity` | `201`, gravado `LACRE_VIOLADO`, `CRITICA`, `ABERTO` |
| `LOW_BATTERY` com `severity` e campos antigos | `201`, gravado `BATERIA_BAIXA`, `ALTA`, `ABERTO` |
| Código do catálogo `SEM_COMUNICACAO` | `201`, severidade padrão `ALTA` |
| Tipo `UNKNOWN_TYPE` e `toString` | `400` nos dois |
| Tipo antigo gravado direto no banco | Recusado (`CHECK`) |
| Listagem por dispositivo | `200`, 3 alertas, do mais recente ao mais antigo |
| Listagem com `status` inválido | `400` |
| `PATCH` em alerta inexistente; com `status` `ABERTO` | `404`; `400` |
| Encerrar sem `resolution_note` | `400` |
| `ABERTO` → `EM_ANALISE`; repetir | `200` (sem data de encerramento); `409` |
| `EM_ANALISE` → `ENCERRADO` | `200`, data, quem e motivo gravados |
| Mudar alerta `ENCERRADO` | `409` "Alerta já encerrado; um problema novo gera um alerta novo" |
| `ABERTO` → `ENCERRADO` direto | `200` |
| `ENCERRADO` sem data direto no banco | Recusado (`CHECK`) |
| Filtro `status=ENCERRADO` | `200`, 2 alertas |

### 3.2 Migração dos alertas antigos

Executada em cópias do `oxide.db` real, nunca no original.

| Formato de origem | Alertas inseridos | Resultado |
| --- | --- | --- |
| Anterior à entrega C (`status_id`/`severity_id`, como o `oxide.db` real) | Os 6 tipos em inglês, um tipo desconhecido (`REBOOT_LOOP`) e um alerta resolvido | Tipos convertidos; `REBOOT_LOOP` → `DISPOSITIVO_FALHA` com "[tipo original: REBOOT_LOOP]" na descrição; resolvido → `ENCERRADO` com a data preservada; `foreign_key_check` vazio e `integrity_check` ok |
| Entregas C a B (severidade em texto, tipo livre) | `SEAL_BROKEN` `EM_ANALISE`, `LOW_BATTERY` `ENCERRADO`, `COMMUNICATION_LOST` `ABERTO` | Tipos convertidos; severidade, status e datas preservados (a severidade antiga não é recalculada) |
| Segunda inicialização | — | Nada migrado de novo; mesma contagem |

### 3.3 Roteiro v1.8 no banco real (seção 5.7)

| ID | Esperado | Obtido | Resultado |
| --- | --- | --- | --- |
| ALT-07 | `201` ×6, gravados em português | Conforme | PASSOU |
| ALT-08 | `400` (severidade fora da lista) | `400` | PASSOU |
| ALT-09 | `201`; `ALTA`, `ABERTO`, sem campos antigos | Conforme | PASSOU |
| ALT-10 | `400` (sem `title`) | `400` | PASSOU |
| ALT-11 | `201` (sem `description`) | `201` | PASSOU |
| ALT-06 | `409` | `409` | PASSOU |
| ALT-13 | `201`; `GPS_SEM_SINAL`, `MEDIA` | Conforme | PASSOU |
| ALT-03 | `400` (`LIGAR_SIRENE`, `constructor`) | `400` ×2 | PASSOU |
| ALT-12 | 9 alertas com tipo e severidade esperados, todos `ABERTO` | Conforme (`SEM_COMUNICACAO` `ALTA`) | PASSOU |
| ALT-14 | `200` total 9; `400` com `status=FECHADO` | Conforme | PASSOU |
| ALT-20 | `400` (`ABERTO`); `404` (inexistente) | Conforme | PASSOU |
| ALT-15 | `200`, `EM_ANALISE`, `resolved_at` nulo | Conforme | PASSOU |
| ALT-19 | `409` (repetir); `409` (reabrir encerrado) | Conforme | PASSOU |
| ALT-18 | `400` (encerrar sem motivo) | `400` | PASSOU |
| ALT-16 | `200`, data, quem e motivo | Conforme | PASSOU |
| ALT-17 | `200` (encerrar direto) | `200` | PASSOU |
| ALT-14 | `200` total 2 com `status=ENCERRADO` | Conforme | PASSOU |
| BD-19 | `CHECK constraint failed` ×2 | Conforme | PASSOU |

Demais seções: respostas HTTP idênticas às da rodada anterior; duplicatas 0; regras de banco (`FOREIGN KEY`, `CHECK`, `UNIQUE`) funcionando; inicialização repetida sem erro (BD-11); limpeza com 0 registros de teste (BD-15). O `SEG-05` (injeção SQL) continua usando `DEVICE_ERROR`, que agora é convertido para `DISPOSITIVO_FALHA`: `201` e tabela intacta.

### 3.4 Script do `Oxidedb.md` (BD-14)

O bloco SQL do `Oxidedb.md` v1.6 foi executado num banco vazio, criando as 10 tabelas, com `alerts` já no formato novo. A suíte deu 86/86 nesse banco, com o dispositivo semente `DSP-000001` inserido.

## 4. Correção feita durante os testes

| Onde | Problema | Correção |
| --- | --- | --- |
| Roteiro v1.8, ALT-14 | A listagem mostrava o fim da resposta (`tail -c`), mas o campo `total` fica no começo, e a contagem não aparecia como evidência | Troca por `grep -oE '"total":[0-9]+\|HTTP:[0-9]+'`; Roteiro executado de novo por completo. Aprovada no questionário (pergunta 9) |

Ajuste de documentação sem efeito no comportamento: no Swagger, o exemplo do tipo de comando foi corrigido de `REBOOT` para `TRAVAR_VALVULA`.

## 5. Casos não executados

| ID | Motivo |
| --- | --- |
| HIS-04 | Reassociação do mesmo par: sem teste específico |
| GEO-*, AUT-C*, SYN-*, FLX-* (exceto FLX-18 a FLX-22) | Funcionalidades ainda não implementadas |
| SEG-09 a SEG-11 | Hardening futuro |
| ESP-03, ESP-05, ESP-06, OPE-* | Dependem de hardware ou da fase de operação |

## 6. Validação humana (questionário)

Respondido por **Natã da Silva Baracho** em 06/10/2026.

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | O firmware que ainda manda `SEAL_BROKEN`, `LOW_BATTERY` etc. continua funcionando, e o alerta é gravado em português? | Sim |
| 2 | A API aceita os 28 códigos do catálogo (mais os 6 nomes antigos convertidos), e a API e o banco recusam qualquer outro tipo? | Sim (após explicação) |
| 3 | A severidade padrão segue o catálogo (`SEM_COMUNICACAO` passa a nascer `ALTA`)? | Sim |
| 4 | Alertas antigos migrados sozinhos; tipo desconhecido vira `DISPOSITIVO_FALHA` com o original na descrição? | Sim |
| 5 | `GET /api/v1/iot/alerts` lista, com filtros `status` e `device_id`? | Sim |
| 6 | Caminhos do `PATCH`, exigência de `resolved_by` e `resolution_note` e encerrado sem reabrir (`409`)? | Sim |
| 7 | Rotas abertas e provisórias até o controle por perfil do FluxID? | Sim |
| 8 | Rotas em `/api/v1/iot/alerts`? | Sim |
| 9 | Aceita a correção do ALT-14 no roteiro? | Sim |
| 10 | Aprova registrar, atualizar os documentos e enviar ao GitHub? | Sim |

## 7. Conclusão

**Aprovado.** Os alertas da Oxide passam a usar os mesmos códigos em português do catálogo e do FluxID, sem quebrar o firmware atual. Os alertas antigos são convertidos sozinhos. O gestor já consegue listar, analisar e encerrar um alerta, e o encerramento fica registrado com data, quem encerrou e o motivo. A API e o banco recusam qualquer tipo fora do catálogo. Não houve regressão.

> **Validação aprovada por Natã da Silva Baracho em 06/10/2026.**

## 8. Recomendações

1. Atualizar o firmware do ESP32 para enviar os códigos em português (ex.: `LACRE_VIOLADO`, `GPS_INATIVO`) e, depois disso, decidir quando os nomes em inglês deixam de ser aceitos.
2. Próximas entregas: geofence e rota (incluindo a justificativa do motorista); alertas e comandos automáticos a partir do `error_type`; Worker.
3. No Worker, mapear `resolved_by` (texto) para o usuário do FluxID em `alertas.encerrado_por`.
