# Relatório de Teste — API Oxide (entrega B: associação dispositivo → lacre → cilindro)

**Data/hora:** 06/10/2026, publicado às 21:31; execução do Roteiro das 21:18:06 às 21:18:33
**Executor:** IA (Claude Code, modelo Claude Opus 5.5), com validação humana de Natã da Silva Baracho
**Commit/versão:** branch `feat/associacao-lacre-cilindro`, a partir da `main` `b69c2ca` (merge do PR #7)
**Ambiente:** Windows 11 Pro, Node.js v24.21.0, npm 11.19.0, Git Bash 5.3, porta 3000, banco **`oxide.db` real** (com backup e restauração)
**Base:** `PlanoDeTeste.md` v1.7 e `RoteiroDeTeste.md` v1.7
**Relatório anterior:** [20h35 (entrega D)](Relatorio-de-Teste-2026-10-06-20h35.md)

## 1. Resumo

| Indicador | Valor |
| --- | --- |
| Compilação (`npx tsc --noEmit`) | PASSOU |
| Suíte automatizada | 71/71 (14 casos novos), executada duas vezes seguidas |
| Roteiro: casos anteriores | 67 respostas HTTP idênticas à rodada da entrega D (sem regressão) |
| Roteiro: nova seção 5.9 | 17 respostas HTTP conforme |
| Banco criado só pelo script do `Oxidedb.md` (BD-14) | 71/71 (com o dispositivo semente) |
| FALHOU | 0 |
| ACHADO | 0 |
| Banco restaurado | Sim, idêntico ao original (SHA-256 `3454c8d4…` antes e depois) |
| Validação humana | **Aprovada por Natã da Silva Baracho** |

## 2. Escopo da entrega

| # | Decisão |
| --- | --- |
| 1 | Associação como cópia provisória na Oxide, nos mesmos códigos (`LCR-…`, `CIL-…`) e estados do FluxID, até o Worker |
| 2 | Lacre: código, UID NFC e estado. Cilindro: código, número de série e estado |
| 3 | Rotas abertas e provisórias: `/seals`, `/cylinders`, `/assignments` (com troca, encerramento e histórico) |
| 4 | Regras do FluxID: RN04, RN05, conflito `409`, nada apagado (RN21), troca numa transação |
| 5 | `lacre_id`/`cilindro_id` da telemetria sempre do vínculo ativo |
| 6 | Erros do catálogo só registrados (coluna `error_type`), sem alerta |
| 7 | Tabelas em inglês, valores em português |

Consequências aprovadas no questionário: o estado do lacre segue o vínculo (`INSTALADO`/`REMOVIDO`); o código `DISPOSITIVO_SEM_LACRE` entra no catálogo de erros.

## 3. Validação pela IA

### 3.1 Suíte automatizada (grupo novo "Associação")

| Caso | Resultado |
| --- | --- |
| Cadastro de lacres (padrão `EM_ESTOQUE`) e cilindros (padrão `DISPONIVEL`) | `201` |
| Lacre duplicado, UID NFC repetido, número de série repetido | `409` |
| Lacre cadastrado como `INSTALADO` | `400` |
| Vínculo dispositivo ↔ lacre; dispositivo com lacre ativo | `201`; `409` |
| Vínculo lacre ↔ cilindro; lacre passa a `INSTALADO` | `201`; `INSTALADO` |
| Cilindro com lacre ativo; lacre `DANIFICADO` instalado | `409`; `409` |
| Telemetria com `lacre_id`/`cilindro_id` falsos no payload | Gravados os do vínculo; `error_type` nulo |
| Telemetria enviada antes do vínculo | `error_type = DISPOSITIVO_SEM_LACRE` |
| Evento `UNLOCKED` com cilindro `EM_TRANSITO` | `error_type = LACRE_ABERTO_EM_TRANSITO` |
| Troca com `replace: true` | Antigo encerrado ("Substituído por novo vínculo") e `REMOVIDO`; novo `INSTALADO` |
| Telemetria de lacre sem cilindro | `error_type = LACRE_SEM_CILINDRO` |
| Encerrar vínculo; encerrar de novo | `200` e lacre `REMOVIDO`; `409` |
| Histórico do cilindro | Dois vínculos, do mais recente ao mais antigo |
| `INSTALADO` manual | `409` |

### 3.2 Roteiro v1.7 no banco real (seção 5.9)

| ID | Esperado | Obtido | Resultado |
| --- | --- | --- | --- |
| Cadastro | `201` ×3 | `201` ×3 | PASSOU |
| ASC-01 | `201`, `201`; lacre `INSTALADO` | Conforme | PASSOU |
| ASC-02 | `409` (cilindro com lacre) | `409` | PASSOU |
| ASC-04 | `409` (lacre com dispositivo) | `409` | PASSOU |
| ASC-05 | `404` (lacre inexistente) | `404` | PASSOU |
| ASC-09 | `202`; `LCR-RT-1`/`CIL-RT-1`; `error_type` nulo | Conforme (lacre falso ignorado) | PASSOU |
| ASC-10 | `200`, `202`; `LACRE_ABERTO_EM_TRANSITO` | Conforme | PASSOU |
| ASC-06 | `201`; `LCR-RT-1` `REMOVIDO`, `LCR-RT-2` `INSTALADO` | Conforme | PASSOU |
| ASC-11 | `202`; `LACRE_SEM_CILINDRO` | Conforme | PASSOU |
| ASC-07 | `200`, depois `409` | Conforme | PASSOU |
| HIS-02/03 | `200`; `LCR-RT-2` e `LCR-RT-1`, encerrados | Conforme | PASSOU |

Demais seções: as 67 respostas HTTP ficaram idênticas às da entrega D; duplicatas 0; regras de banco (`FOREIGN KEY`, `CHECK`, `UNIQUE`) funcionando; inicialização repetida sem erro; limpeza com 0 registros de teste.

### 3.3 Script do `Oxidedb.md` (BD-14)

O bloco SQL do documento foi executado num banco vazio: criou as 10 tabelas (incluindo `seals`, `cylinders`, `seal_assignments`, `cylinder_assignments` e as colunas `error_type`). A suíte deu 71/71 nesse banco, com o dispositivo semente `DSP-000001` inserido (sem ele, só os 6 testes que dependem da semente falham, como previsto no risco R2 do plano).

## 4. Defeitos e achados

Nenhum. Pendências registradas: substituir a cópia provisória pelos dados do FluxID (Worker); teste de reassociação do mesmo par (HIS-04); alertas automáticos a partir do `error_type`.

## 5. Casos não executados

| ID | Motivo |
| --- | --- |
| HIS-04 | Reassociação do mesmo par: comportamento coberto pelo modelo, sem teste específico |
| GEO-*, AUT-C*, SYN-*, FLX-* (exceto FLX-18 a FLX-22) | Funcionalidades ainda não implementadas |
| SEG-09 a SEG-11 | Hardening futuro |
| ESP-03, ESP-05, ESP-06, OPE-* | Dependem de hardware ou da fase de operação |

## 6. Validação humana (questionário)

Respondido por **Natã da Silva Baracho** em 06/10/2026.

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | Associação como cópia provisória na Oxide, nos mesmos códigos e estados do FluxID? | Sim |
| 2 | Regras do FluxID (RN04, RN05, `409`, nada apagado)? | Sim |
| 3 | Troca por `replace: true` numa única operação? | Sim |
| 4 | Estado do lacre seguindo o vínculo (`INSTALADO`/`REMOVIDO`; `INSTALADO` não manual)? | Sim |
| 5 | Rotas abertas e provisórias, como `/devices`? | Sim |
| 6 | `lacre_id`/`cilindro_id` sempre do vínculo, ignorando o payload? | Sim |
| 7 | `error_type` registrado sem alerta, na ordem de prioridade? | Sim |
| 8 | Novo código `DISPOSITIVO_SEM_LACRE` no catálogo? | Sim |
| 9 | Testes da IA suficientes? | Sim |
| 10 | Aprova Plano v1.7 e Roteiro v1.7? | Sim |
| 11 | Aprova a entrega B para relatório, documentos e GitHub? | Sim |

## 7. Conclusão

**Aprovado.** A Oxide passou a saber a que lacre e cilindro cada dispositivo pertence, com as mesmas regras e o mesmo histórico do FluxID, sem apagar nada e sem perder a ligação com o cadastro oficial. A telemetria passou a carregar o lacre e o cilindro corretos, e os primeiros erros operacionais do catálogo já ficam registrados no recebimento. Não houve regressão.

> **Validação aprovada por Natã da Silva Baracho em 06/10/2026.**

## 8. Recomendações

1. Cadastrar e vincular os lacres de teste do montador antes dos próximos envios do ESP32 (seção 1.3 do Desenvolvimento), para os dados não ficarem marcados como `DISPOSITIVO_SEM_LACRE`.
2. Próximas entregas: `alert_type` em português; regras e alertas automáticos a partir do `error_type` (incluindo comandos automáticos); Worker.
3. Acrescentar o teste HIS-04 numa próxima rodada.
