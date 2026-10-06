# Relatório de Teste — API Oxide (entrega A: segurança)

**Data/hora:** 06/10/2026, publicado às 17:35; execução do Roteiro das 17:00:04 às 17:00:31
**Executor:** IA (Claude Code, modelo Claude Opus 5.5), com validação humana de Natã da Silva Baracho
**Commit/versão:** branch `fix/seguranca-api`, a partir da `main` `70b9c90` (merge do PR #1)
**Ambiente:** Windows 11 Pro, Node.js v24.21.0, npm 11.19.0, Git Bash 5.3, porta 3000, banco **`oxide.db` real** (com backup e restauração)
**Base:** `PlanoDeTeste.md` v1.3 e `RoteiroDeTeste.md` v1.4
**Relatórios anteriores:** [15h14](Relatorio-de-Teste-2026-10-06-15h14.md), [15h49](Relatorio-de-Teste-2026-10-06-15h49.md)

## 1. Resumo

| Indicador | Valor |
| --- | --- |
| Compilação (`npx tsc --noEmit`) | PASSOU |
| Suíte automatizada | 52/52 (50 anteriores + 2 novos) |
| Respostas HTTP dos casos manuais (seções 5.1 a 5.8) | 77, todas iguais ao esperado |
| Verificações do banco (seção 6 e BD-11) | Todas conforme |
| FALHOU | 0 |
| ACHADO | 2 (ALT-12 e TEL-13, previstos para a entrega C) |
| Banco restaurado | Sim, idêntico ao original (SHA-256 `3454c8d4…` antes e depois) |
| Validação humana | **Aprovada por Natã da Silva Baracho** |

## 2. Escopo da entrega

Decisões tomadas por Natã da Silva Baracho antes da implementação. A API precisa ficar aberta para outros integrantes verem o projeto e para o montador do lacre testar sem impedimento:

| Achado | Decisão | Implementação |
| --- | --- | --- |
| SEG-01: `GET /devices` expunha `api_key` | Rotas abertas, sem a chave nas respostas | `DeviceService` devolve dispositivo sem `api_key`; esquema do Swagger atualizado |
| AUT-08/09: telemetria e eventos aceitavam chave de outro dispositivo | Exigir a chave do próprio `device_id` | `apiKeyDeviceMiddleware` em `POST /iot/telemetries` e `POST /iot/events` (`403`) |
| SEG-04: evento criava dispositivo com chave previsível | Remover a criação automática | `ensureDeviceExists` removido; dispositivo não cadastrado recebe `404` |
| SEG-02: `POST /devices` aberto | Manter (decisão aceita) | Cadastro provisório até o Worker trazer o cadastro oficial do FluxID |
| SEG-03: listagem geral de telemetrias | Manter (decisão aceita) | Equipe acompanha os testes de todos os lacres |

Decisões que **não** foram implementadas, a pedido do responsável: chave de administrador (`ADMIN_API_KEY`) e troca das chaves de teste do `oxide.db`.

Documentação: `Desenvolvimento.md` reorganizado em duas partes. A Parte 1 é um guia para a equipe e o programador do ESP32, abrindo com o texto do responsável sobre o papel da Oxide. A Parte 2 guarda o histórico.

## 3. Validação pela IA

### 3.1 Compilação e suíte

- `npx tsc --noEmit`: sem erros.
- `npm test` numa cópia do banco e depois no Roteiro, sobre o banco real: 52/52 nas duas execuções.
- Testes novos: chave de outro dispositivo em telemetria (`403`, nada gravado) e em eventos (`403`, nada gravado).
- Testes alterados: listagem e busca de dispositivos conferem a ausência de `api_key`; o antigo "auto-criação de dispositivo" passou a exigir `404` e nenhum dispositivo criado.

### 3.2 Casos que mudaram nesta entrega (Roteiro v1.4)

| ID | Esperado | Obtido | Resultado |
| --- | --- | --- | --- |
| SEG-01 | `200` sem `api_key` | `200`; corpo sem `api_key` (também em DEV-08) | PASSOU |
| AUT-08 | `403`, nenhuma linha | `403 API Key não pertence ao dispositivo`; `MSG-RT-A08` ausente | PASSOU |
| AUT-09 | `403`, nenhuma linha | `403 API Key não pertence ao dispositivo`; `EVT-RT-A09` ausente | PASSOU |
| SEG-04 | `404` e chave deduzida `401` | `404`; `EVT-RT-AUTO` ausente; `auto-DSP-TEST-AUTOCREATE` → `401` | PASSOU |
| TEL-15 | `404` | `404 Dispositivo não encontrado` | PASSOU |
| SEG-05 | `404` na telemetria; título gravado literalmente | `404` e `201`; tabelas intactas | PASSOU |

Todos os demais casos do Roteiro (dispositivos, telemetria, eventos, comandos, alertas, segurança e banco) deram o mesmo resultado do [relatório das 15h49](Relatorio-de-Teste-2026-10-06-15h49.md), sem regressão.

### 3.3 Banco de dados

- Duplicatas: 0 em `devices`, `api_key`, `telemetry_queue` e `events`.
- Regras do banco: `FOREIGN KEY`, `CHECK (active IN (0,1))` e `UNIQUE (api_key)` funcionando.
- Inicialização repetida: 5 status antes e depois, sem erro no log.
- Limpeza: 0 registros `DSP-TEST%`. Banco restaurado com checksum idêntico; nenhum arquivo temporário restante.

## 4. Defeitos e achados

Nenhum defeito. Achados restantes, já planejados para a entrega C:

| # | ID | Severidade | Descrição |
| --- | --- | --- | --- |
| 1 | ALT-12 | Média | Catálogo sem níveis de severidade |
| 2 | TEL-13 | Média | Coordenadas fora da faixa válida aceitas |

Achados resolvidos nesta entrega: SEG-01, AUT-08, AUT-09 e SEG-04. SEG-02 e SEG-03 passaram a ser decisões aceitas.

## 5. Casos não executados

| ID | Motivo |
| --- | --- |
| Estrutura do FluxID (SYN-09 a SYN-11) | Fora do escopo desta entrega |
| ASC-*, HIS-*, GEO-*, AUT-C*, SYN-*, FLX-* | Funcionalidades ainda não implementadas |
| SEG-09 a SEG-11 | Hardening futuro |
| ESP-03, ESP-05, ESP-06, OPE-* | Dependem de hardware ou da fase de operação |

## 6. Validação humana (questionário)

Respondido por **Natã da Silva Baracho** em 06/10/2026.

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | Rotas `/devices` abertas, mas sem mostrar a `api_key`? | Sim |
| 2 | Telemetria e eventos retornam `403` com chave de outro dispositivo? | Sim |
| 3 | Evento de dispositivo não cadastrado retorna `404`, sem criação automática, com cadastro prévio em `POST /devices` até o FluxID assumir? | Sim |
| 4 | SEG-02 e SEG-03 registrados como decisões aceitas? | Sim |
| 5 | Testes da IA (compilação, 52/52, roteiro no banco real com checksum idêntico) suficientes? | Sim |
| 6 | Aprova o Plano de Teste v1.3 e o Roteiro de Teste v1.4? | Sim |
| 7 | A Parte 1 do Desenvolvimento atende quem programa o ESP32? | Sim |
| 8 | O texto sobre o papel da Oxide ficou fiel (ajustes só em `telemetry_queue` e `ERRO`)? | Sim |
| 9 | Concorda com a tabela de respostas da seção 1.5 (`409` é sucesso; reenvio com o mesmo `message_id` só em `500`, sem resposta ou tempo esgotado)? | Sim |
| 10 | Aprova a entrega A para relatório, atualização dos documentos e envio ao GitHub? | Sim |

Decisões tomadas antes da implementação (registradas nas perguntas de definição): rotas de dispositivos abertas sem chave de administrador; chaves de teste mantidas; listagem geral de telemetrias mantida; cadastro oficial no FluxID com `POST /devices` provisório na Oxide; estado de falha do comando continua `ERRO`; catálogo de comandos (`TRAVAR_VALVULA`, `DESTRAVAR_VALVULA`) fica para a entrega D.

## 7. Conclusão

**Aprovado.** Os três achados de severidade alta (SEG-01, AUT-08/09 e SEG-04) foram resolvidos sem bloquear a equipe nem o montador do lacre. Não houve regressão nos demais casos. Os achados restantes (ALT-12 e TEL-13) pertencem à entrega C.

> **Validação aprovada por Natã da Silva Baracho em 06/10/2026.**

## 8. Recomendações

1. Ajustar o firmware do ESP32 conforme a Parte 1 do Desenvolvimento: chave do próprio dispositivo, `seal_status`, `attempt_count` e a tabela de respostas da seção 1.5.
2. Cadastrar cada lacre em `POST /devices` antes do primeiro envio, até o Worker trazer o cadastro do FluxID.
3. Seguir para a entrega C (severidade dos alertas e faixa de coordenadas).
4. Reavaliar SEG-02 e SEG-03 antes de colocar a API em produção.
