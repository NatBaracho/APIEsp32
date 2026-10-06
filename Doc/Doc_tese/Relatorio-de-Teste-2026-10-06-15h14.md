# Relatório de Teste — API Oxide

**Data/hora:** 06/10/2026, publicado às 15:14
**Executor:** IA (Claude Code, modelo Claude Opus 5.5), com validação humana de Natã da Silva Baracho
**Commit/versão:** branch `fix/revisao-plano-de-teste`, a partir de `f49ef6e`
**Ambiente:** Windows 11 Pro, Node.js v24.21.0, Git Bash 5.3, porta 3000 (suíte isolada na 3999), cópias isoladas do `oxide.db` (o banco real não foi alterado)
**Base:** `PlanoDeTeste.md` v1.2 e `RoteiroDeTeste.md` v1.2

## 1. Resumo

| Indicador | Valor |
| --- | --- |
| Compilação (`npx tsc --noEmit`) | PASSOU |
| Suíte automatizada | 50/50 (executada duas vezes seguidas) |
| Casos manuais executados (Roteiro, seções 5 e 6) | 67 (linhas da seção 3.2; algumas agrupam casos, ex.: BD-01/02) |
| PASSOU | 61 |
| FALHOU | 0 |
| ACHADO | 6 (cinco itens na seção 4; AUT-08 e AUT-09 são um só item) |
| NÃO EXECUTADO | Casos da seção 7 do Roteiro (funcionalidades pendentes) |
| Banco restaurado | Sim (execução em cópia; restauração da seção 8 conferida) |
| Validação humana | **Aprovada por Natã da Silva Baracho** |

## 2. Escopo da entrega

Correções encontradas na revisão do Plano de Teste e ajustes definidos na validação:

| # | Mudança | Origem |
| --- | --- | --- |
| 1 | Reenvio do `message_id` de posição repetida retorna `409`; o `message_id` fica em `telemetry_queue.last_repeat_message_id` | Revisão (questões 1 e 2) |
| 2 | Posição e lacre iguais à última telemetria respondem `200 Posição já registrada; data e hora atualizadas` | Validação, 2ª rodada |
| 3 | `seal_status` (`LOCKED`, `UNLOCKED`, `BROKEN`) na telemetria; mudança de estado no mesmo lugar gera nova linha | Validação, 2ª rodada |
| 4 | `attempt_count` do ESP32 gravado em `device_attempt_count` (telemetria e eventos); `status`/`attempt_count` da fila controlados pelo servidor | Validação (questão 3) |
| 5 | `api_key` exclusiva por dispositivo (`409` e índice único) | Revisão |
| 6 | `active` restrito a `0`/`1` (`400` e triggers no banco) | Revisão |
| 7 | Tipos inválidos na telemetria retornam `400`; dispositivo inexistente retorna `404` | Revisão |
| 8 | `node_modules/` fora do versionamento (`.gitignore`) | Revisão |

## 3. Validação pela IA

### 3.1 Compilação e suíte automatizada

- `npx tsc --noEmit`: sem erros.
- `npm test`: 50 casos, 50 aprovados, código de saída `0`. Uma segunda execução seguida sobre o mesmo banco também deu 50/50, confirmando que a inicialização pode ser repetida sem erro.

### 3.2 Resultados por caso (Roteiro de Teste v1.2)

| ID | Descrição | Esperado | Obtido | Resultado |
| --- | --- | --- | --- | --- |
| DEV-08 | Cadastro sem `firmware_version` | `201`; `firmware_version` nulo, `active` 1 | `201`; nulo e 1 | PASSOU |
| DEV-09 | GET não cria registros | Contagem igual | 5 e 5 | PASSOU |
| DEV-10 | `api_key` já usada | `409` | `409 API Key já está em uso` | PASSOU |
| DEV-11 | `active: 7` | `400` | `400 active deve ser 0 ou 1` | PASSOU |
| DEV-12 | `firmware_version: 123` | `400` | `400 firmware_version deve ser texto` | PASSOU |
| SEG-01 | `GET /devices/:id` sem autenticação | Sem `api_key` no corpo | Corpo contém `api_key` | ACHADO (R4) |
| AUT-07 | Dispositivo-alvo inexistente | `404` | `404` | PASSOU |
| AUT-08 | Chave de outro dispositivo na telemetria | Decisão pendente | `202` | ACHADO (R5) |
| AUT-09 | Chave de outro dispositivo no evento | Decisão pendente | `202` | ACHADO (R5) |
| AUT-10 | Header em minúsculas | `200` | `200` | PASSOU |
| TEL-02 | Telemetria válida | `202` | `202` | PASSOU |
| TEL-03 | `message_id` repetido | `409` | `409 Mensagem duplicada` | PASSOU |
| TEL-04 | Mesma posição e lacre | `200`, sem nova linha | `200 Posição já registrada; data e hora atualizadas`; `last_repeat_message_id = MSG-RT-002` | PASSOU |
| TEL-20 | Reenvio da posição repetida | `409` | `409 Mensagem duplicada` | PASSOU |
| TEL-05 | Posição diferente | `202`, nova linha | `202`, linha criada | PASSOU |
| TEL-06 | Duas telemetrias sem coordenadas | `202` e `202` | `202` e `202`, coordenadas nulas | PASSOU |
| TEL-08 | `last_seen_at` ISO 8601 | Valor gravado igual | `2026-10-04T15:30:00.000Z` | PASSOU |
| TEL-10 | `last_seen_at` na repetição | Preenchido pelo servidor | `AAAA-MM-DD HH:MM:SS` | PASSOU |
| TEL-11 | Só latitude | `202`, nova linha | `202`, linha criada | PASSOU |
| TEL-12 | Coordenadas como texto | `400` | `400 Campo latitude com tipo inválido` | PASSOU |
| TEL-13 | Latitude/longitude `999` | Sem regra definida | `202` | ACHADO |
| TEL-15 | Dispositivo inexistente | `404` | `404 Dispositivo não encontrado` | PASSOU |
| TEL-21 | `status: SYNCED`, `attempt_count: 99` | `PENDING`, `0`, `device_attempt_count` 99 | `PENDING`, `0`, 99 | PASSOU |
| TEL-22 | `latitude: true` / `payload_json` objeto | `400` nos dois | `400` nos dois | PASSOU |
| TEL-23 | `seal_status: OPEN` | `400` | `400 seal_status deve ser LOCKED, UNLOCKED ou BROKEN` | PASSOU |
| TEL-24 | `LOCKED` → `BROKEN` na mesma posição, depois `BROKEN` de novo | `202`, `202`, `200` | `202`, `202`, `200`; `BROKEN` gravado em linha própria | PASSOU |
| TEL-25 | `attempt_count: -1` | `400` | `400` | PASSOU |
| TEL-07 | JSON malformado | `400` | `400 Requisição inválida` | PASSOU |
| TEL-17 | Corpo vazio | `400` | `400` | PASSOU |
| TEL-16 | Listagem | `200`, ordem decrescente | `200`, ordem decrescente | PASSOU |
| TEL-19 | Duas requisições simultâneas | Uma `202`, uma `409`, uma linha | `202` e `409`, uma linha | PASSOU |
| EVT-05 | `UNLOCKED` e `BROKEN` | `202` e `202` | `202` e `202` | PASSOU |
| EVT-06 | `seal_status: ACTIVE` | `400` | `400` | PASSOU |
| EVT-10 | `status: SYNCED` no evento | Gravado `PENDING` | `PENDING` | PASSOU |
| EVT-12 | Sem `seal_status` | `202`, nulo | `202`, nulo | PASSOU |
| EVT-11 | `attempt_count: 7` | `attempt_count` 0, `device_attempt_count` 7 | 0 e 7 | PASSOU |
| EVT-13 | `attempt_count: -1` | `400` | `400` | PASSOU |
| EVT-08 | Evento repetido | `409` | `409` | PASSOU |
| EVT-09 | `event_type` em `message_type` | Conferido via SQL | Conferido | PASSOU |
| CMD-12 | Ordem dos pendentes | `CMD-RT-001` antes de `002` | Correto | PASSOU |
| CMD-09 | Confirmação `ERRO` | `200`, `error_message` gravado | `200`, `falha simulada` | PASSOU |
| CMD-10 | `error_message: 123` | `400` | `400` | PASSOU |
| CMD-11 | Comando de outro dispositivo | `404` | `404` | PASSOU |
| CMD-07 | Reconfirmação | `409` | `409 Comando já confirmado` | PASSOU |
| CMD-13 | `POST /iot/commands` | `404` | `404` | PASSOU |
| ALT-07 | Seis tipos de alerta | `201` nos seis | `201` nos seis | PASSOU |
| ALT-08 | `severity_id` inexistente | `400` | `400` | PASSOU |
| ALT-09 | `status_id` texto, `0`, `-1` | `400` nos três | `400` nos três | PASSOU |
| ALT-10 | Sem `title` | `400` | `400` | PASSOU |
| ALT-11 | Sem `description` | `201` | `201` | PASSOU |
| ALT-06 | Alerta repetido | `409` | `409 Alerta duplicado` | PASSOU |
| ALT-12 | Códigos de severidade | Taxonomia definida | Só estados de dispositivo/lacre | ACHADO (R6) |
| SEG-04 | Chave previsível `auto-<device_id>` | Avaliar risco | `200` com a chave deduzida | ACHADO |
| SEG-05 | Injeção SQL | Sem alteração de dados | `404` na telemetria; título gravado literalmente; tabelas intactas | PASSOU |
| SEG-06 | Corpo de 10 MB | `413` e API no ar | `413`; `GET /` `200` | PASSOU |
| SEG-07 | Detalhes internos nas respostas | Nenhum | Nenhum `SQLITE` ou stack trace | PASSOU |
| SEG-08 | Chave por query string | `401` | `401` | PASSOU |
| BD-01/02 | Tabelas | Sem `sync_*` e sem tabela extra | Conforme | PASSOU |
| BD-03 | Duplicatas | 0 | 0 em `devices`, `api_key`, `telemetry`, `events` | PASSOU |
| BD-04 | FK inexistente | Erro de FK | `FOREIGN KEY constraint failed` | PASSOU |
| BD-05/06 | FKs de `commands` e `alerts` | Conforme o plano | Conforme | PASSOU |
| BD-08 | `active = 2` | Erro `CHECK` | `CHECK constraint failed: active IN (0,1)` | PASSOU |
| BD-11 | Inicialização repetida | Contagem igual, sem erro | 5 e 5, sem erro | PASSOU |
| BD-12/13 | Catálogo e colunas de `devices` | Conforme | Conforme | PASSOU |
| BD-15 | Limpeza | 0 registros `DSP-TEST%` | 0 | PASSOU |
| BD-16 | Índice único de `api_key` | Existe; duplicata falha | `idx_devices_api_key`; `UNIQUE constraint failed` | PASSOU |
| BD-17 | Colunas e índice novos | Presentes | Presentes | PASSOU |

## 4. Defeitos e achados

Nenhum defeito novo. Os achados abaixo já constavam no plano como riscos ou decisões pendentes:

| # | ID do caso | Severidade | Descrição | Situação |
| --- | --- | --- | --- | --- |
| 1 | SEG-01 | Alta | `GET /devices` e `GET /devices/:id` expõem `api_key` sem autenticação | Risco R4, pendente |
| 2 | AUT-08, AUT-09 | Alta | Telemetria e eventos aceitam chave de outro dispositivo | Risco R5, decisão pendente |
| 3 | SEG-04 | Alta | Dispositivo criado por evento recebe chave previsível `auto-<device_id>` | Pendente |
| 4 | ALT-12 | Média | Catálogo `status` não tem níveis de severidade | Risco R6, pendente |
| 5 | TEL-13 | Média | Coordenadas fora da faixa válida são aceitas | Regra a definir |

## 5. Casos não executados

| ID | Motivo |
| --- | --- |
| ASC-*, HIS-*, GEO-*, AUT-C*, SYN-*, FLX-* | Funcionalidades ainda não implementadas |
| SEG-09 a SEG-11 | Hardening futuro |
| ESP-03, ESP-05, ESP-06, OPE-* | Dependem de hardware ou da fase de operação |

## 6. Validação humana (questionário)

Respondido por **Natã da Silva Baracho** em 06/10/2026.

### 6.1 Primeira rodada: correções da revisão

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | Reenvio do `message_id` de posição repetida deve retornar `409`? | Sim |
| 2 | Guardar esses `message_id` numa tabela nova (`telemetry_position_repeats`)? | **Não** |
| 3 | `status` e `attempt_count` sempre definidos pelo servidor, ignorando o dispositivo? | **Não** ("o ESP32 sempre vai mandar os dados") |
| 4 | `api_key` exclusiva por dispositivo (`409`)? | Sim |
| 5 | `active` só `0` ou `1` (`400` e bloqueio no banco)? | Sim |
| 6 | Dispositivo inexistente retorna `404`? | Sim |
| 7 | Campos numéricos como texto rejeitados com `400`? | Sim |
| 8 | O firmware envia os campos numéricos como número? | Sim |
| 9 | Retirar `node_modules/` do repositório? | Sim |
| 10 | Manter `oxide.db` versionado por enquanto? | Sim |
| 11 | Testes da IA suficientes como validação automatizada? | Sim |
| 12 | Conferiu as alterações de código e aprova? | Sim |
| 13 | Aprova Plano e Roteiro v1.1? | Sim |
| 14 | Aprova a atualização dos demais documentos? | Sim |
| 15 | Aprova a entrega para o merge? | Sim |

**Decisões tomadas a partir das respostas "não":**
- **Questão 2:** usar a coluna `last_repeat_message_id` na `telemetry_queue`.
- **Questão 3:** o responsável explicou que o ESP32 fica no lacre do cilindro e informa se o lacre está fechado, aberto ou rompido. Na repetição, a API deve avisar que a posição já existe e atualizar só a data e a hora. Só o dado mais antigo segue para o banco principal. Decidido:
  - o firmware envia `seal_status`;
  - a posição repetida responde `200`;
  - a mudança de estado do lacre na mesma posição grava uma nova linha;
  - o `attempt_count` do ESP32 (tentativas de envio) vai para `device_attempt_count`.

### 6.2 Segunda rodada: ajustes das questões 2 e 3

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | Guardar o `message_id` da repetição em `last_repeat_message_id`, sem tabela nova? | Sim |
| 2 | Aceita que só a repetição mais recente fique guardada (reenvio de uma mais antiga responde `200`, sem duplicar)? | Sim |
| 3 | Posição repetida responde `200 Posição já registrada; data e hora atualizadas`; dado novo `202`? | Sim |
| 4 | Estado do lacre em `seal_status` (`LOCKED`, `UNLOCKED`, `BROKEN`), outro valor `400`? | Sim |
| 5 | Repetição só com posição e lacre iguais (rompimento sempre gera registro)? | Sim |
| 6 | `attempt_count` do ESP32 em `device_attempt_count`, `400` se negativo ou não inteiro? | Sim |
| 7 | `status` e `attempt_count` da fila controlados pelo servidor, para o Worker? | Sim |
| 8 | O firmware será ajustado para enviar `seal_status` e tratar o `200`? | Sim |
| 9 | Testes da IA desta rodada suficientes? | Sim |
| 10 | Aprova Plano e Roteiro v1.2? | Sim |
| 11 | Aprova a entrega completa para registro, documentação e GitHub? | Sim |

## 7. Conclusão

**Aprovado com ressalvas.** Todas as regras implementadas passaram nos testes automatizados e manuais, sem nenhum defeito. As ressalvas são os cinco achados da seção 4, todos já registrados como riscos ou decisões pendentes do plano e fora do escopo desta entrega.

> **Validação aprovada por Natã da Silva Baracho em 06/10/2026.**

## 8. Recomendações

1. Ajustar o firmware do ESP32 para enviar `seal_status` e `attempt_count` e tratar as respostas `200`, `202`, `400`, `404` e `409`.
2. Decidir a validação de ownership em telemetria e eventos (AUT-08 e AUT-09).
3. Proteger `GET /devices` e remover `api_key` da resposta (SEG-01).
4. Substituir a chave previsível `auto-<device_id>` dos dispositivos criados por evento (SEG-04).
5. Definir a taxonomia de severidade dos alertas e a faixa válida de coordenadas (ALT-12, TEL-13).
