# Relatório de Teste — API Oxide (entrega C: severidade dos alertas e faixa de coordenadas)

**Data/hora:** 06/10/2026, publicado às 19:28; execução do Roteiro das 19:24:00 às 19:24:26
**Executor:** IA (Claude Code, modelo Claude Opus 5.5), com validação humana de Natã da Silva Baracho
**Commit/versão:** branch `feat/severidade-coordenadas`, a partir da `main` `5b4fc91` (merge do PR #2)
**Ambiente:** Windows 11 Pro, Node.js v24.21.0, npm 11.19.0, Git Bash 5.3, porta 3000, banco **`oxide.db` real** (com backup e restauração)
**Base:** `PlanoDeTeste.md` v1.4 e `RoteiroDeTeste.md` v1.5
**Relatório anterior:** [17h35 (entrega A)](Relatorio-de-Teste-2026-10-06-17h35.md)

## 1. Resumo

| Indicador | Valor |
| --- | --- |
| Compilação (`npx tsc --noEmit`) | PASSOU |
| Suíte automatizada | 55/55 (três casos novos e um substituído) |
| Migração da tabela `alerts` antiga | PASSOU (testada com alertas gravados) |
| Respostas HTTP dos casos manuais (seções 5.1 a 5.8) | Todas iguais ao esperado |
| Verificações do banco (seção 6 e BD-11) | Todas conforme |
| FALHOU | 0 |
| ACHADO | 0 (ALT-12 e TEL-13 resolvidos nesta entrega) |
| Banco restaurado | Sim, idêntico ao original (SHA-256 `3454c8d4…` antes e depois) |
| Validação humana | **Aprovada por Natã da Silva Baracho** |

## 2. Escopo da entrega

Decisões de Natã da Silva Baracho antes da implementação (recomendações aceitas):

| # | Decisão |
| --- | --- |
| 1 | Severidade em texto: `BAIXA`, `MEDIA`, `ALTA`, `CRITICA` (mesmos valores do FluxID) |
| 2 | Severidade opcional; padrão por tipo: `SEAL_BROKEN` `CRITICA`; `GEOFENCE_EXIT` e `COMMAND_FAILURE` `ALTA`; `DEVICE_ERROR` e `COMMUNICATION_LOST` `MEDIA`; `LOW_BATTERY` `BAIXA` |
| 3 | Status do alerta em texto (`ABERTO`, `EM_ANALISE`, `ENCERRADO`); nasce `ABERTO`, definido pelo servidor |
| 4 | Campos antigos `status_id`/`severity_id` ignorados, sem quebrar o firmware |
| 5 | Latitude fora de -90 a 90 ou longitude fora de -180 a 180 → `400`; `0,0` continua aceito |
| 6 | Latitude e longitude juntas ou nenhuma → `400` se vier só uma |
| 7 | Mudança local do `oxide.db` (colunas criadas pela API em execução) descartada |

Implementação: `models/Alert.ts`, `AlertController`, `AlertService`, `AlertRepository`, `TelemetryController`, migração em `connection.ts`, Swagger e testes.

## 3. Validação pela IA

### 3.1 Compilação, suíte e migração

- `npx tsc --noEmit`: sem erros.
- `npm test`: 55/55, numa cópia do banco do GitHub e depois sobre o banco real (Roteiro).
- Testes novos: alerta com severidade informada e campos antigos ignorados; latitude fora da faixa; só latitude. O teste "status_id inexistente" virou "severity inválida".
- Migração: numa cópia do banco com dois alertas no formato antigo, a tabela foi recriada com IDs, títulos e descrições preservados; `SEAL_BROKEN` → `CRITICA`, `LOW_BATTERY` → `BAIXA`; alerta com `resolved_at` → `ENCERRADO`. O banco passou a rejeitar severidade inválida (`CHECK constraint failed`).

### 3.2 Casos que mudaram nesta entrega (Roteiro v1.5)

| ID | Esperado | Obtido | Resultado |
| --- | --- | --- | --- |
| TEL-11 | `400`, nenhuma linha | `400 latitude e longitude devem ser enviadas juntas`; `MSG-RT-007` ausente | PASSOU |
| TEL-13 | `400`, nenhuma linha | `400 latitude deve estar entre -90 e 90 e longitude entre -180 e 180`; `MSG-RT-009` ausente | PASSOU |
| ALT-07 | `201` nos seis tipos | `201` ×6 | PASSOU |
| ALT-08 | `400` com `severity` `URGENTE` | `400 severity deve ser BAIXA, MEDIA, ALTA ou CRITICA` | PASSOU |
| ALT-09 | `201`, `severity` `ALTA`, `status` `ABERTO`, sem campos antigos | `201`; `ALTA`, `ABERTO`; sem `status_id`/`severity_id` | PASSOU |
| ALT-10 / ALT-11 / ALT-06 | `400` / `201` / `409` | `400` / `201` / `409` | PASSOU |
| ALT-12 | Severidade padrão por tipo, todos `ABERTO` | 001 `CRITICA`, 002 `ALTA`, 003 `BAIXA`, 004 `MEDIA`, 005 `ALTA`, 006 `MEDIA`, 007 `BAIXA`, 009 `ALTA`; todos `ABERTO` | PASSOU |
| BD-06 | `alerts` com 1 FK | Uma FK (`devices`) | PASSOU |
| SEG-05 | Alerta com título de injeção gravado literalmente | `201`; tabelas intactas | PASSOU |

Demais casos (dispositivos, autenticação, telemetria, eventos, comandos, segurança e banco): mesmos resultados do [relatório das 17h35](Relatorio-de-Teste-2026-10-06-17h35.md), sem regressão. Duplicatas 0; `FOREIGN KEY`, `CHECK (active)` e `UNIQUE (api_key)` funcionando; inicialização repetida sem erro; limpeza com 0 registros `DSP-TEST%`.

## 4. Defeitos e achados

Nenhum defeito e nenhum achado aberto. Resolvidos nesta entrega: ALT-12 (severidade sem semântica, risco R6), TEL-13 (coordenadas fora da faixa) e R3 (testes dependentes de IDs do catálogo).

Pendência funcional registrada (não é defeito): rotas para analisar e encerrar alertas (`EM_ANALISE`, `ENCERRADO`).

## 5. Casos não executados

| ID | Motivo |
| --- | --- |
| Estrutura do FluxID (SYN-09 a SYN-11) | Prevista para a entrega E |
| ASC-*, HIS-*, GEO-*, AUT-C*, SYN-*, FLX-* | Funcionalidades ainda não implementadas |
| SEG-09 a SEG-11 | Hardening futuro |
| ESP-03, ESP-05, ESP-06, OPE-* | Dependem de hardware ou da fase de operação |

## 6. Validação humana (questionário)

Respondido por **Natã da Silva Baracho** em 06/10/2026.

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | Severidade em texto (`BAIXA`, `MEDIA`, `ALTA`, `CRITICA`), igual ao FluxID? | Sim |
| 2 | Severidade padrão por tipo quando o ESP32 não enviar? | Sim |
| 3 | Todo alerta nasce `ABERTO`, definido pelo servidor? | Sim |
| 4 | `status_id` e `severity_id` de firmware antigo ignorados sem erro? | Sim |
| 5 | Migração automática da tabela `alerts` antiga, preservando os alertas? | Sim |
| 6 | Latitude e longitude juntas e dentro da faixa (`400` caso contrário), com `0,0` aceito? | Sim |
| 7 | Testes da IA suficientes? | Sim |
| 8 | Aprova o Plano de Teste v1.4 e o Roteiro de Teste v1.5? | Sim |
| 9 | Aprova a entrega C para relatório, documentos e GitHub? | Sim |

## 7. Conclusão

**Aprovado.** A severidade e o status dos alertas passaram a ter significado e a usar os mesmos valores do FluxID, sem quebrar firmwares antigos e sem perder alertas já gravados. A telemetria deixou de aceitar posições impossíveis ou incompletas. Não houve regressão e não restam achados abertos.

> **Validação aprovada por Natã da Silva Baracho em 06/10/2026.**

## 8. Recomendações

1. Atualizar o firmware do ESP32: enviar `severity` (opcional) nos alertas e omitir latitude/longitude enquanto o GPS não tiver posição.
2. Seguir para a entrega E (banco FluxID e plano de integração).
3. Planejar as rotas de análise e encerramento de alertas junto com o Worker ou a API do FluxID.
