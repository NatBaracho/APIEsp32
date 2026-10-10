# Plano de Teste — FluxID / Oxide IoT

**Versão:** 2.0
**Data:** 10/10/2026
**Escopo:** API Oxide (Node.js + TypeScript + Express + SQLite), sincronização com o PostgreSQL FluxID e API FluxID (NestJS) planejada
**Validação humana:** Natã da Silva Baracho

> Este plano consolida o que já foi implementado e testado (suíte `tests/api.test.ts`, 96 casos) e o que ainda precisa ser testado conforme o `Checklist-Projeto.md`, o `Banco_FluxID.md` (v3.0) e o `Regras-de-Negocio-e-Banco-Oxide.md`. Cada caso indica sua situação: **Automatizado**, **Manual executado** ou **Pendente**.

---

## 0. Plano atual: modelo enxuto (desde 10/10/2026)

Em 10/10/2026 a API passou a ter uma fila única e a entregar os dados ao Supabase. **Esta seção é o plano que vale hoje.** As seções 6 a 13 são o histórico do modelo anterior (filas separadas, cópia do cadastro e envio ao FluxID); muitos daqueles casos deixaram de existir junto com as rotas.

### 0.1 Como testar

| Teste | Comando | Onde roda |
| --- | --- | --- |
| Compilação | `npx tsc --noEmit` | Projeto |
| Suíte (71 casos) | `npm test` | Pasta temporária, banco novo, recebedor de teste no lugar do Supabase |
| Simulador (23 verificações) | `npm run simular` | Pasta temporária, banco novo, recebedor de teste |
| Migração do banco real | Roteiro, seção 4 | Numa **cópia** da `oxide.db` |

A suíte e o simulador não tocam no `oxide.db` do projeto nem no banco principal, e podem rodar com a API ligada.

### 0.2 Casos (todos automatizados na suíte)

| ID | Caso | Esperado |
| --- | --- | --- |
| V2-GER-01 | `/`, Swagger e regra dos grupos | `200`; nenhuma rota sem grupo |
| V2-GER-02 | Banco novo | Só `commands`, `devices` e `mensagens` |
| V2-GER-03 | Rota antiga (`/api/v1/seals`) | `404` |
| V2-DEV-01 | Cadastro provisório de dispositivo | `201`; campos faltando `400`; `device_id` ou chave repetidos `409`; `active` e `firmware_version` inválidos `400` |
| V2-DEV-02 | Consulta de dispositivos | Sem `api_key` e sem `api_key_hash`; inexistente `404` |
| V2-AUT-01 | Sem chave e chave inválida | `401`, nada gravado |
| V2-AUT-02 | Dispositivo inativo; chave de outro dispositivo | `403`, nada gravado |
| V2-AUT-03 | Dispositivo não cadastrado | `404`, sem criação automática |
| V2-TEL-01 | Leitura válida | `202`, `PENDING`, com posição, bateria e `gps_ok` verdadeiro; `satelites` aceito; `attempt_count` do lacre em `device_attempt_count` |
| V2-TEL-02 | Sem `message_id`, sem posição, só latitude ou sem bateria | `400`, nada gravado |
| V2-TEL-03 | Tipos e faixas (latitude como texto, fora da faixa, bateria 150, `gps_ok` e `seal_status` inválidos, `attempt_count` negativo) | `400` |
| V2-TEL-04 | JSON malformado e corpo vazio | `400` |
| V2-TEL-05 | `message_id` repetido | `409`, sem linha nova |
| V2-TEL-06 | Mesma posição e mesmo lacre | `200`, sem linha nova; data, bateria e sinal atualizados na leitura anterior; reenvio desse `message_id` `409` |
| V2-TEL-07 | Posição nova | `202` e nova linha |
| V2-TEL-08 | GPS sem sinal (`gps_ok: false`) | `202`, gravado com `gps_ok` falso |
| V2-TEL-09 | `status` e `attempt_count` enviados pelo lacre | Não mudam a fila |
| V2-TEL-10 | `GET /iot/messages` | Últimas mensagens, com filtros; tipo inválido `400` |
| V2-EVT-01 | Evento sem `event_type`; sem posição e bateria | `400` |
| V2-EVT-02 | Evento válido; repetido; chave de outro; sem chave | `202`; `409`; `403`; `401` |
| V2-ALT-01 | Alerta com tipo fora do catálogo, severidade inválida, sem título ou sem posição e bateria | `400` |
| V2-ALT-02 | Alerta válido | `201` com a severidade do catálogo; severidade informada respeitada; nome antigo convertido; repetido `409` |
| V2-REG-01 | Bateria abaixo de 15% | `BATERIA_BAIXA` com origem `servidor`, posição e a mensagem de origem |
| V2-REG-02 | Bateria continua baixa; recupera e cai de novo | Não repete; depois, novo alerta |
| V2-REG-03 | Sinal abaixo de -105 dBm | `GSM_SINAL_FRACO` uma vez |
| V2-REG-04 | Lacre `UNLOCKED` e `BROKEN` | `LACRE_ABERTO_SEM_AUTORIZACAO` e `LACRE_VIOLADO` (CRITICA); sem repetir; fechar não alerta; evento também dispara |
| V2-REG-05 | Último estado do dispositivo | Contato, posição, bateria e lacre atualizados |
| V2-SYN-01 | Worker sem configuração | Não sobe e diz o que falta |
| V2-SYN-02 | Banco principal fora do ar; chave recusada (`401`) | Rodada `FALHOU`, fila intacta, nenhuma tentativa gasta |
| V2-SYN-03 | Mensagem aceita, recusada e sem resposta | `SYNCED`; parada com o motivo; nova tentativa marcada |
| V2-SYN-04 | Sexta falha | Para, sem próxima tentativa |
| V2-SYN-05 | `/sync/problems` e `/sync/retry` | Lista com a situação; `400`, `404` e `200` |
| V2-SYN-06 | Reenviar tudo de novo | Nada duplicado no banco principal |
| V2-SYN-07 | Posição repetida depois do envio | A leitura volta à fila e o banco principal recebe a nova data |
| V2-SYN-08 | Lotes | 5 mensagens em 3 lotes de até 2 |
| V2-CAD-01 | Dispositivo novo do banco principal | Chega só com o hash; autentica com a chave; a chave em texto guardada não autentica |
| V2-CAD-02 | Dispositivo existente recebe o hash | A chave antiga deixa de valer |
| V2-CAD-03 | Dispositivo desativado no banco principal | `403`; nada é apagado |
| V2-CMD-01 | Comando do banco principal | Chega ao lacre uma vez; tipo e dispositivo desconhecidos viram aviso |
| V2-CMD-02 | Confirmação | Status inválido `400`; inexistente `404`; `ERRO` gravado e enviado ao banco principal; de novo `409` |
| V2-CMD-03 | Regras do banco | Comando pendente com tipo fora do catálogo e status desconhecido recusados |
| V2-OPE-01 | `GET /health` | `200` normal; `503` com a última rodada falha; sem endereço nem chave |
| V2-MIG-01 | Banco no modelo antigo | Cópia de segurança; mensagens antigas `ARQUIVADA`; tabelas antigas removidas; segunda execução não repete |
| V2-OPE-02 | Backup e retenção | Cópia íntegra, mantendo as mais novas; retenção só mostra sem `--confirmar` e só apaga o que foi enviado há mais de 30 dias |

### 0.3 O que ainda não pode ser testado

| ID | Caso | Depende de |
| --- | --- | --- |
| V2-INT-01 | Envio ao Supabase de verdade | Função de recebimento e tabelas do lacre no projeto do frontend |
| V2-INT-02 | Lacre real enviando para a API | Envio HTTP ligado no firmware e leitura da bateria |
| V2-INT-03 | Ponta a ponta: lacre → API → Supabase → tela | Os dois anteriores |

---

## 1. Objetivo

Garantir que a cadeia ESP32 → API Oxide → SQLite (→ Worker → PostgreSQL FluxID) atenda às regras de negócio de segurança, rastreabilidade e controle operacional, com integridade de dados, idempotência e tratamento correto de erros.

Objetivos específicos:

- Confirmar os contratos HTTP (status e mensagens) de todos os endpoints.
- Validar autenticação por API Key e ownership do dispositivo.
- Garantir idempotência por `message_id`, `alert_id`, `command_id` e `device_id`.
- Verificar integridade do schema SQLite (constraints, FKs, migrações).
- Preparar a verificação das próximas entregas: associação dispositivo/lacre/cilindro, histórico, geofence, comandos automáticos e Worker SQLite → PostgreSQL.
- Registrar riscos de segurança conhecidos e seus testes de regressão.

---

## 2. Escopo

### 2.1 Dentro do escopo

| Área | Itens |
| --- | --- |
| API Oxide | `/`, `/api-docs`, `/api/v1/devices`, `/api/v1/iot/telemetries`, `/events`, `/commands`, `/alerts` |
| Segurança | Middleware `X-API-Key`, ownership, dispositivo inativo |
| Banco SQLite | Tabelas `devices`, `status`, `telemetry_queue`, `events`, `commands`, `alerts`; constraints; migrações |
| Regras de telemetria | Duplicidade, mesma posição GPS, ausência de GPS, `last_seen_at` |
| Firmware | Contrato de payload do ESP32 |
| Entregas futuras | Associação, histórico, geofence, comandos automáticos, Worker |
| API FluxID (planejada) | CRUD NestJS, RBAC, multiempresa, transações |

### 2.2 Fora do escopo (neste momento)

- Financeiro, portal do cliente final, contratos avançados, IA e ERP (fora do MVP).
- Testes de hardware do lacre (mecânica e NFC).
- Testes de carga em produção (apenas planejados na seção 10).
- Backup, retenção e observabilidade (fase de operação; ver seção 11).

---

## 3. Estratégia e níveis de teste

| Nível | Descrição | Ferramenta |
| --- | --- | --- |
| Compilação | Verificação de tipos | `npx tsc --noEmit` |
| Integração (E2E HTTP) | Chamadas reais à API contra SQLite | `npm test` (`tests/api.test.ts`, `fetch`) |
| Banco de dados | Verificação de schema, constraints e FKs | `PRAGMA table_info`, `PRAGMA foreign_key_list`, consultas SQL |
| Manual exploratório | Swagger UI e Postman | `http://localhost:3000/api-docs` |
| Segurança | Casos de acesso indevido e exposição de dados | Postman / scripts |
| Sincronização | SQLite → PostgreSQL com falhas simuladas | Banco local de análise, `pg_restore` do dump |
| Desempenho (futuro) | Ingestão de telemetria em volume | A definir (k6 ou autocannon) |

Princípios:

1. Testes não devem alterar a base real: usar cópia ou banco dedicado (ver risco R1).
2. Cada caso é repetível; dados de teste usam prefixo `DSP-TEST`.
3. Cada nova entrega reexecuta compilação e suíte completa (item pendente do checklist).

---

## 4. Ambiente e dados de teste

| Item | Definição |
| --- | --- |
| Servidor | `npm start`, porta 3000 (`PORT` configurável) |
| Banco | `oxide.db` em `process.cwd()`, com `PRAGMA foreign_keys = ON` |
| Dispositivo semente | `DSP-000001`, chave `auto-DSP-000001` |
| Dispositivos de teste | `DSP-TEST-AUTORUN`, `DSP-TEST-INACTIVE` (`active = 0`); `DSP-TEST-AUTOCREATE` é usado só para confirmar que **não** há criação automática |
| Catálogo `status` | `ACTIVE`, `INACTIVE`, `LOCKED`, `UNLOCKED`, `BROKEN` (IDs não devem ser assumidos) |
| PostgreSQL | Dump `sql/fluxid/FluxID.sql` (formato custom, `PGDMP`) restaurado em banco separado via `pg_restore`: servidor temporário ou container Docker `fluxid-analise` (`postgis/postgis:18-3.6`, só `127.0.0.1:54329`) |
| Massa FluxID | 3 organizações, 3 usuários, 20 destinatários, 50 cilindros/lacres/dispositivos, 200 telemetrias, 10 eventos, 10 alertas (sintética) |

Pré-condição para toda execução: banco com schema criado pelo script do `Oxidedb.md` ou pela inicialização da aplicação; backup antes de alterações estruturais.

---

## 5. Critérios de entrada, saída e suspensão

**Entrada**
- Compilação sem erros.
- Servidor iniciado e `GET /` respondendo `200`.
- Banco acessível e com permissão de escrita.

**Saída (aprovação)**
- 100% dos casos de severidade Alta aprovados.
- Nenhum defeito crítico ou alto aberto.
- Suíte automatizada sem falhas (hoje 96/96).
- Banco limpo após o teardown (zero registros `DSP-TEST%`).

**Suspensão**
- Falha de compilação.
- Corrupção ou perda de dados no `oxide.db`.
- Servidor não inicia.

---

## 6. Casos de teste — API Oxide

Legenda de situação: **A** = Automatizado, **M** = Manual executado, **P** = Pendente. Prioridade: Alta / Média / Baixa.

### 6.1 Geral e documentação

| ID | Caso | Resultado esperado | Prior. | Sit. |
| --- | --- | --- | --- | --- |
| GER-01 | `GET /` | `200`, texto "API ESP32 Online" | Alta | A |
| GER-02 | `GET /api-docs/` | `200`, HTML do Swagger UI | Média | A |
| GER-03 | `GET /api-docs/swagger-ui-init.js` | `200`, contém título "API ESP32" e `X-API-Key` | Média | A |
| GER-04 | Rota inexistente | `404` sem detalhes internos | Média | P |
| GER-05 | Corpo JSON literal `null` | `400` (rejeitado pelo parser) | Baixa | M |
| GER-06 | Grupos do Swagger | Toda rota tem um grupo declarado (Dispositivos, Telemetria, Eventos, Comandos, Alertas, Lacres, Cilindros, Vínculos); nenhuma no grupo "default" | Baixa | A |
| GER-07 | Página da proposta da API do frontend (`/api-docs-fluxid`) | `200`; cada página (`/api-docs` e `/api-docs-fluxid`) mostra o seu próprio conteúdo | Baixa | A |
| GER-08 | Funções da proposta | 21 funções, todas em grupo declarado; nenhuma rota `/api/v1/app` responde ainda (`404`) | Baixa | A |

### 6.2 Dispositivos (`/api/v1/devices`)

| ID | Caso | Resultado esperado | Prior. | Sit. |
| --- | --- | --- | --- | --- |
| DEV-01 | `GET /devices` | `200`, array contendo `DSP-000001`, sem `api_key` em nenhum item | Alta | A |
| DEV-02 | `GET /devices/:deviceId` existente | `200`, `device_id` correto, sem `api_key` | Alta | A |
| DEV-03 | `GET /devices/:deviceId` inexistente | `404`, `success: false` | Alta | A |
| DEV-04 | `POST /devices` sem campos | `400` | Alta | A |
| DEV-05 | `POST /devices` válido | `201`, `active = 1` por padrão, status opcionais `NULL` | Alta | A |
| DEV-06 | `POST /devices` duplicado | `409 Dispositivo duplicado`, sem nova linha | Alta | A |
| DEV-07 | `POST /devices` sem `active` e sem `firmware_version` | `201` (fallbacks `?? 1` e `?? null`) | Alta | A (indireto, DEV-05) |
| DEV-08 | `POST /devices` com `firmware_version` omitido | Persiste `NULL` | Baixa | P |
| DEV-09 | `GET /devices` não cria registros (idempotência de leitura) | Contagem inalterada | Baixa | M |
| DEV-10 | `POST /devices` com `api_key` já usada por outro dispositivo | `409 API Key já está em uso`, sem nova linha | Alta | A |
| DEV-11 | `POST /devices` com `active` diferente de `0`/`1` (ex.: `7`, `"abc"`) | `400 active deve ser 0 ou 1` | Média | A |
| DEV-12 | `POST /devices` com `firmware_version` não textual | `400` | Baixa | P |

### 6.3 Autenticação e autorização

| ID | Caso | Resultado esperado | Prior. | Sit. |
| --- | --- | --- | --- | --- |
| AUT-01 | `GET /iot/telemetries` sem header | `401 API Key obrigatória` | Alta | A |
| AUT-02 | Chave inválida | `401 API Key inválida` | Alta | A |
| AUT-03 | Chave de dispositivo inativo | `403 Dispositivo desativado` | Alta | A |
| AUT-04 | Chave válida | `200` | Alta | A |
| AUT-05 | Chave de outro dispositivo em comandos | `403 API Key não pertence ao dispositivo` | Alta | A |
| AUT-06 | Chave de outro dispositivo em alertas | `403` | Alta | A |
| AUT-07 | Dispositivo-alvo inexistente em rota protegida | `404` | Média | P |
| AUT-08 | Chave de outro dispositivo em `POST /telemetries` | `403 API Key não pertence ao dispositivo`, nenhuma linha | Alta | A |
| AUT-09 | Chave de outro dispositivo em `POST /events` | `403 API Key não pertence ao dispositivo`, nenhuma linha | Alta | A |
| AUT-10 | Header em minúsculas (`x-api-key`) | Aceito (headers HTTP não diferenciam caixa) | Baixa | P |

### 6.4 Telemetria

| ID | Caso | Resultado esperado | Prior. | Sit. |
| --- | --- | --- | --- | --- |
| TEL-01 | Sem `message_id`/`device_id` | `400 message_id e device_id são obrigatórios` | Alta | A |
| TEL-02 | Payload válido completo | `202 Telemetria recebida`, linha em `telemetry_queue` com `status = PENDING` | Alta | A |
| TEL-03 | `message_id` duplicado | `409 Mensagem duplicada`, uma única linha | Alta | A |
| TEL-04 | Mesma lat/long e mesmo `seal_status` da última telemetria, `message_id` novo | `200 Posição já registrada; data e hora atualizadas`, sem nova linha, `last_seen_at` atualizado | Alta | A |
| TEL-05 | Posição diferente | `202`, nova linha | Alta | A |
| TEL-06 | Duas telemetrias sem coordenadas | Ambas inseridas | Alta | M |
| TEL-07 | JSON malformado | `400 Requisição inválida` | Alta | A |
| TEL-08 | `last_seen_at` em ISO 8601 | Persistido como enviado | Média | M |
| TEL-09 | `last_seen_at` omitido | Persistido como `NULL` | Média | M |
| TEL-10 | Na repetição de posição, `last_seen_at` usa `CURRENT_TIMESTAMP` (não o enviado) | Conferir valor gravado | Média | P |
| TEL-11 | Apenas latitude informada (sem longitude) | `400 latitude e longitude devem ser enviadas juntas`, nenhuma linha | Média | A |
| TEL-12 | Coordenadas como string | `400 Campo latitude com tipo inválido`, nenhuma linha | Média | P |
| TEL-13 | Latitude fora de -90 a 90 ou longitude fora de -180 a 180 | `400 latitude deve estar entre -90 e 90 e longitude entre -180 e 180`, nenhuma linha | Média | A |
| TEL-14 | `payload_json` omitido | Grava serialização do objeto recebido | Baixa | P |
| TEL-15 | Telemetria para `device_id` inexistente | `404 Dispositivo não encontrado`, nenhuma linha | Alta | A |
| TEL-16 | `GET /telemetries` ordem decrescente por `id` | `200`, `id` 10 antes do 9 | Média | M |
| TEL-17 | Corpo ausente em `POST` | `400` (corpo tratado como objeto vazio) | Média | P |
| TEL-18 | Campos extras desconhecidos | Ignorados sem erro | Baixa | P |
| TEL-19 | Mesmo `message_id` em duas requisições concorrentes | Uma `202`, outra `409`; uma linha (violação `UNIQUE` também é convertida em `409`) | Alta | P |
| TEL-20 | Reenvio do `message_id` de uma telemetria de posição repetida (TEL-04) | `409 Mensagem duplicada`; `message_id` guardado em `telemetry_queue.last_repeat_message_id` (só a repetição mais recente de cada linha) | Alta | A |
| TEL-21 | ESP32 envia `status: "SYNCED"` e `attempt_count: 99` | `202`; `status = PENDING` e `attempt_count = 0` (colunas do Worker); `device_attempt_count = 99` | Alta | A |
| TEL-22 | Campo numérico com tipo não numérico (`latitude: true`) ou `payload_json` como objeto | `400 Campo <nome> com tipo inválido` (antes: `500`) | Média | A (latitude) |
| TEL-23 | `seal_status` fora de `LOCKED`/`UNLOCKED`/`BROKEN` | `400 seal_status deve ser LOCKED, UNLOCKED ou BROKEN` | Alta | A |
| TEL-24 | Mesma posição com `seal_status` diferente (ex.: `LOCKED` → `BROKEN`) | `202` e nova linha; a mudança do lacre não é tratada como repetição | Alta | A |
| TEL-25 | `attempt_count` negativo ou não inteiro | `400 attempt_count deve ser um inteiro maior ou igual a 0` | Média | A |

### 6.5 Eventos

| ID | Caso | Resultado esperado | Prior. | Sit. |
| --- | --- | --- | --- | --- |
| EVT-01 | Sem `X-API-Key` | `401` | Alta | A |
| EVT-02 | Sem `device_id` ou `event_type` | `400 message_id, device_id e event_type são obrigatórios` | Alta | A |
| EVT-03 | `seal_status` inválido (`OPEN`, `closed`) | `400`, nenhuma linha | Alta | A |
| EVT-04 | Evento válido com `seal_status: LOCKED` | `202`, `seal_status = LOCKED`, `status = PENDING` | Alta | A |
| EVT-05 | `seal_status` `UNLOCKED` e `BROKEN` | `202` em ambos | Alta | P |
| EVT-06 | `seal_status` `ACTIVE`/`INACTIVE` | `400` (não pertencem ao lacre) | Média | P |
| EVT-07 | Dispositivo não cadastrado | `404 Dispositivo não encontrado`; nenhum dispositivo é criado (sem criação automática) | Alta | A |
| EVT-08 | `message_id` duplicado | `409`, sem nova linha | Alta | A |
| EVT-09 | `event_type` gravado em `events.message_type` | Valor conferido via SQL | Média | P |
| EVT-10 | Cliente tenta enviar `status` no payload | Ignorado; servidor define `PENDING` | Média | P |
| EVT-11 | ESP32 envia `attempt_count` | `202`; `attempt_count = 0` (coluna do Worker) e valor enviado em `device_attempt_count` | Média | A |
| EVT-12 | Evento sem `seal_status` | `202`, `seal_status = NULL` | Baixa | P |
| EVT-13 | `attempt_count` negativo ou não inteiro | `400`, nenhuma linha | Média | P |

### 6.6 Comandos

| ID | Caso | Resultado esperado | Prior. | Sit. |
| --- | --- | --- | --- | --- |
| CMD-01 | `GET /commands/:deviceId` sem chave | `401` | Alta | A |
| CMD-02 | Chave de outro dispositivo | `403` | Alta | A |
| CMD-03 | Chave correta | `200`, apenas `PENDENTE`, ordem crescente de `id` | Alta | A |
| CMD-04 | `confirm` com status inválido | `400` | Alta | A |
| CMD-05 | `confirm` de comando inexistente | `404` | Alta | A |
| CMD-06 | `confirm` como `EXECUTADO` | `200`, `executed_at` preenchido | Alta | A |
| CMD-07 | Reconfirmação | `409 Comando já confirmado` | Alta | A |
| CMD-08 | Comando confirmado some da lista de pendentes | Lista sem o comando | Alta | A |
| CMD-09 | `confirm` como `ERRO` com `error_message` | `200`, mensagem gravada | Alta | M |
| CMD-10 | `error_message` não textual | `400` | Média | P |
| CMD-11 | `confirm` de comando de outro dispositivo | `404` | Alta | P |
| CMD-12 | Ordem de múltiplos comandos pendentes | Crescente por `id` | Média | P |
| CMD-13 | Não existe endpoint de criação de comando (decisão da entrega D: comandos criados pelo sistema, não por rota aberta) | `404` em `POST /iot/commands` | Baixa | M |
| CMD-14 | Comando `PENDENTE` com tipo fora de `TRAVAR_VALVULA`/`DESTRAVAR_VALVULA` ou status desconhecido | Rejeitado pelo banco (`CHECK constraint failed`); histórico com tipo antigo aceito | Alta | A |
| CMD-15 | Migração da tabela `commands` antiga | `LOCK_VALVE`/`UNLOCK_VALVE` convertidos; pendente com tipo desconhecido vira `ERRO` "tipo de comando descontinuado"; histórico preservado | Alta | M |

### 6.7 Alertas

| ID | Caso | Resultado esperado | Prior. | Sit. |
| --- | --- | --- | --- | --- |
| ALT-01 | Sem chave | `401` | Alta | A |
| ALT-02 | Chave de outro dispositivo | `403` | Alta | A |
| ALT-03 | `alert_type` fora do catálogo (inclusive `toString`) | `400` | Alta | A |
| ALT-04 | `severity` fora de `BAIXA`/`MEDIA`/`ALTA`/`CRITICA` | `400 severity deve ser BAIXA, MEDIA, ALTA ou CRITICA` | Alta | A |
| ALT-05 | Alerta com o nome antigo `SEAL_BROKEN`, sem `severity` | `201`, gravado como `LACRE_VIOLADO`, `severity = CRITICA` (padrão do tipo), `status = ABERTO`, `resolved_at = null` | Alta | A |
| ALT-06 | `alert_id` duplicado | `409 Alerta duplicado` | Alta | A |
| ALT-07 | Transição: os 6 nomes antigos | `201` e gravados em português: `SEAL_BROKEN` → `LACRE_VIOLADO`, `GEOFENCE_EXIT` → `SAIDA_GEOCERCA`, `LOW_BATTERY` → `BATERIA_BAIXA`, `DEVICE_ERROR` → `DISPOSITIVO_FALHA`, `COMMAND_FAILURE` → `COMANDO_FALHOU`, `COMMUNICATION_LOST` → `SEM_COMUNICACAO` | Alta | M |
| ALT-08 | Severidade padrão = sugerida no catálogo | `LACRE_VIOLADO` `CRITICA`; `SAIDA_GEOCERCA`, `COMANDO_FALHOU` e `SEM_COMUNICACAO` `ALTA`; `DISPOSITIVO_FALHA` e `GPS_SEM_SINAL` `MEDIA`; `BATERIA_BAIXA` `BAIXA` | Alta | A |
| ALT-09 | Firmware antigo envia `status_id`/`severity_id`/`status` | Campos ignorados: `201`, `severity` informada ou padrão, `status = ABERTO` | Média | A |
| ALT-10 | Falta `title` | `400` | Média | P |
| ALT-11 | `description` omitida | `201` | Baixa | P |
| ALT-12 | Severidade e status com os valores do FluxID | Colunas `severity` e `status` com `CHECK`; valores gravados conferidos via SQL | Alta | M |
| ALT-13 | Código do catálogo em português (ex.: `GPS_SEM_SINAL`, `SEM_COMUNICACAO`) | `201`, tipo gravado igual ao enviado | Alta | A |
| ALT-14 | `GET /iot/alerts` com filtros `device_id` e `status` | `200`, `total` e alertas do mais recente ao mais antigo; `status` inválido → `400` | Média | A |
| ALT-15 | `PATCH /iot/alerts/{id}/status` `ABERTO` → `EM_ANALISE` | `200`, `resolved_at` continua nulo | Alta | A |
| ALT-16 | `EM_ANALISE` → `ENCERRADO` com `resolved_by` e `resolution_note` | `200`, `resolved_at` preenchido, quem e motivo gravados | Alta | A |
| ALT-17 | `ABERTO` → `ENCERRADO` direto | `200` | Média | A |
| ALT-18 | Encerrar sem `resolved_by` ou `resolution_note` | `400` | Alta | A |
| ALT-19 | Transição repetida (`EM_ANALISE` de novo) ou alerta já `ENCERRADO` | `409`; encerrado não reabre ("um problema novo gera um alerta novo") | Alta | A |
| ALT-20 | Status inválido no `PATCH` (ex.: `ABERTO`) ou alerta inexistente | `400` e `404` | Média | A |
| ALT-21 | Migração dos alertas antigos | Tipos em inglês convertidos; tipo desconhecido vira `DISPOSITIVO_FALHA` com o original na descrição; severidade, status e datas preservados; funciona a partir do formato anterior à entrega C e do formato das entregas C a B | Alta | M |

> Observação: desde a entrega C, `status_id` e `severity_id` não existem mais em `alerts`. Severidade (`BAIXA`, `MEDIA`, `ALTA`, `CRITICA`) e status (`ABERTO`, `EM_ANALISE`, `ENCERRADO`) são texto, nos valores do FluxID. Desde a entrega de alertas em português, `alert_type` só aceita os códigos de `Tipos-de-Erro.md`; os nomes antigos em inglês são convertidos na API (transição).

---

## 7. Casos de teste — Banco de dados SQLite

| ID | Caso | Verificação | Prior. | Sit. |
| --- | --- | --- | --- | --- |
| BD-01 | Tabelas existentes | `SELECT name FROM sqlite_master` retorna `devices`, `status`, `telemetry_queue`, `events`, `commands`, `alerts`, `seals`, `cylinders`, `seal_assignments`, `cylinder_assignments` e `sync_logs` | Alta | M |
| BD-02 | Tabelas de sincronização | `sync_logs` existe (uma linha por rodada do Worker); `sync_items` não existe (o estado fica na fila) | Média | M |
| BD-03 | Unicidade | `device_id`, `message_id` (eventos e telemetrias), `command_id`, `alert_id`, `status.code` rejeitam duplicatas | Alta | M |
| BD-04 | FKs ativas | `PRAGMA foreign_keys` = 1; inserir evento/telemetria/alerta com `device_id` inexistente falha | Alta | P |
| BD-05 | `commands` FK | `ON UPDATE CASCADE`, `ON DELETE RESTRICT`; apagar dispositivo com comandos falha | Alta | M |
| BD-06 | `alerts` FKs e CHECKs | Uma FK (dispositivo); `CHECK` de `alert_type` (catálogo), `severity` e `status`; colunas `resolved_by` e `resolution_note`. Bancos antigos são migrados preservando os alertas | Alta | M |
| BD-07 | Defaults | `devices.active = 1`, `commands.status = 'PENDENTE'`, `alerts.created_at = CURRENT_TIMESTAMP`, `telemetry_queue.status = 'PENDING'`, `attempt_count = 0` | Média | M |
| BD-08 | Regra `active IN (0,1)` | Inserir ou atualizar `active = 2` falha com `CHECK constraint failed`. Em bancos antigos sem `CHECK`, a regra vem dos triggers `trg_devices_active_insert`/`_update` | Média | M |
| BD-09 | Migração de colunas legadas | `messge_tyoe`, `seel_status`, `firmware_versin ` renomeadas sem perda de dados | Alta | M |
| BD-10 | Migração de `telemetry_queue` legada | Recriação transacional preserva linhas e IDs; campos opcionais passam a aceitar `NULL` | Alta | M |
| BD-11 | Inicialização idempotente | Subir a aplicação duas vezes não duplica `status` nem falha | Alta | P |
| BD-12 | Colunas de status em `devices` | `device_status_id`, `valve_status_id`, `seal_status_id` existem e permanecem `NULL` | Média | M |
| BD-13 | Seed de `status` | 5 códigos inseridos uma única vez | Média | P |
| BD-14 | Criação do banco pelo script do `Oxidedb.md` em arquivo vazio | Schema equivalente ao criado pela aplicação: suíte completa sem falhas num banco criado só pelo script, mais o dispositivo semente (**executado nas entregas B e de alertas**) | Média | M |
| BD-15 | Teardown | Zero registros `DSP-TEST%` após a suíte | Alta | A |
| BD-16 | Índice único `idx_devices_api_key` | Existe quando não há chaves duplicadas; inserir chave repetida falha. Com duplicatas pré-existentes, a aplicação sobe e registra aviso | Alta | P |
| BD-18 | `CHECK` de `commands` | `status` em `PENDENTE`/`EXECUTADO`/`ERRO`; `command_type` do catálogo quando `PENDENTE` | Alta | A |
| BD-19 | `CHECK` de `alerts` | `alert_type` fora do catálogo é rejeitado; `ENCERRADO` sem `resolved_at` (ou `resolved_at` em alerta não encerrado) é rejeitado | Alta | A |
| BD-17 | Colunas novas | `telemetry_queue` com `last_repeat_message_id`, `seal_status` e `device_attempt_count` e índice `idx_telemetry_last_repeat_message_id`; `events` com `device_attempt_count` | Média | M |

---

## 8. Testes de segurança

| ID | Caso | Esperado | Prior. | Sit. |
| --- | --- | --- | --- | --- |
| SEG-01 | `GET /devices` e `GET /devices/:id` sem autenticação | `200` sem o campo `api_key`. As rotas continuam abertas por decisão do responsável (equipe e montador do lacre) | Alta | A |
| SEG-02 | `POST /devices` sem autenticação | **Decisão aceita:** continua aberto, sem credencial administrativa. É cadastro provisório até o Worker trazer o cadastro oficial do FluxID | Média | Decidido |
| SEG-03 | `GET /iot/telemetries` | **Decisão aceita:** continua retornando as telemetrias de todos os dispositivos a qualquer chave válida, para a equipe acompanhar os testes | Média | Decidido |
| SEG-04 | Evento para dispositivo não cadastrado | `404`; nenhum dispositivo criado e a chave deduzida `auto-<device_id>` responde `401` | Alta | M |
| SEG-05 | Injeção SQL em `device_id`, `message_id`, `title` (ex.: `' OR 1=1 --`) | Consultas parametrizadas; nenhuma alteração; resposta tratada | Alta | P |
| SEG-06 | Payload muito grande (ex.: 10 MB) | Rejeitado com `413` ou tratado sem derrubar o servidor | Média | P |
| SEG-07 | Erro interno | Resposta padronizada sem stack trace ou detalhes do banco | Média | P |
| SEG-08 | Chave enviada por query string | Não aceita | Baixa | P |
| SEG-09 | Rate limiting | Hardening futuro; teste após implementação | Baixa | P (futuro) |
| SEG-10 | Hash, rotação e revogação de chaves | Hardening futuro | Baixa | P (futuro) |
| SEG-11 | Auditoria de acesso e alteração | Hardening futuro | Baixa | P (futuro) |

---

## 9. Testes do contrato do firmware (ESP32)

| ID | Caso | Esperado | Sit. |
| --- | --- | --- | --- |
| ESP-01 | Payload de telemetria do guia (`message_id`, `device_id`, lat/long, velocidade, bateria, GSM) | `202` | M |
| ESP-02 | Retry com o **mesmo** `message_id` | `409`, sem duplicar linha; firmware trata `409` como "já recebido" | P |
| ESP-03 | Reinício do ESP32 | Sequência de `message_id` persistida (NVS) não reutiliza valores | P (teste no firmware) |
| ESP-04 | Sem GPS (fix ainda não obtido) | Telemetria aceita com coordenadas ausentes | M |
| ESP-05 | Consulta periódica de comandos e confirmação `EXECUTADO`/`ERRO` | Fluxo completo conforme seção 6.6 | P (ponta a ponta com hardware) |
| ESP-06 | Falha de rede durante o envio | Firmware reenvia sem perder a leitura | P |
| ESP-07 | Evento de lacre `BROKEN` seguido de alerta `LACRE_VIOLADO` | Evento `202` e alerta `201` | P |

---

## 10. Testes das próximas entregas (roadmap)

### 10.1 Associação Dispositivo → Lacre → Cilindro (entrega B)

Implementada na Oxide como cópia provisória do FluxID: rotas abertas `/seals`, `/cylinders` e `/assignments`. Situação: **A** automatizado, **M** no Roteiro, **P** pendente.

| ID | Caso | Esperado | Sit. |
| --- | --- | --- | --- |
| ASC-01 | Associar dispositivo a lacre e lacre a cilindro | `201` nos dois; lacre passa a `INSTALADO` | A |
| ASC-02 | Lacre com mais de um cilindro ativo (RN04) | `409` (use `replace: true` para trocar) | A |
| ASC-03 | Cilindro com mais de um lacre ativo (RN04) | `409` | A |
| ASC-04 | Lacre com mais de um dispositivo ativo; dispositivo com mais de um lacre ativo (RN05) | `409` | A |
| ASC-05 | Dispositivo, lacre ou cilindro inexistente | `404` | M |
| ASC-06 | Troca (`replace: true`) | Vínculo anterior encerrado com motivo "Substituído por novo vínculo", novo aberto; lacre substituído `REMOVIDO`, novo `INSTALADO`; histórico preservado | A |
| ASC-07 | Encerrar vínculo | `200`, `ended_at` e motivo preenchidos (sem `DELETE`, RN21); lacre `INSTALADO` vira `REMOVIDO`; encerrar de novo `409` | A |
| ASC-08 | Ownership | **Decisão aceita:** rotas de associação abertas e provisórias, como `/devices` | Decidido |
| ASC-09 | Telemetria com dispositivo vinculado | `lacre_id`/`cilindro_id` preenchidos pelo vínculo ativo; valores do payload ignorados | A |
| ASC-10 | Lacre aberto (`UNLOCKED`/`BROKEN`) com cilindro `EM_TRANSITO` | `error_type = LACRE_ABERTO_EM_TRANSITO`, sem alerta | A |
| ASC-11 | Telemetria de dispositivo sem lacre / lacre sem cilindro | `error_type` `DISPOSITIVO_SEM_LACRE` / `LACRE_SEM_CILINDRO` | A |
| ASC-12 | Lacre fora de `EM_ESTOQUE`/`REMOVIDO` instalado num cilindro | `409` | A |
| ASC-13 | Cadastro de lacre/cilindro duplicado (código, UID NFC) e lacre cadastrado como `INSTALADO` | `409` / `400`. Número de série repetido é **aceito** (`201`), porque a série só é única por empresa, no FluxID (achado A3, 07/10/2026) | A |
| ASC-14 | Estado `INSTALADO` manual | `409` (só pelo vínculo) | A |

### 10.2 Histórico de associações

| ID | Caso | Esperado | Sit. |
| --- | --- | --- | --- |
| HIS-01 | Associações sucessivas | Linhas com início e fim, sem sobrescrita | A |
| HIS-02 | Consulta por dispositivo, por lacre e por cilindro (`?device_id=`, `?seal_code=`, `?cylinder_code=`, `?active=true`) | Resultados corretos e completos | A |
| HIS-03 | Ordenação temporal | Mais recente primeiro | A |
| HIS-04 | Associar, desassociar e reassociar o mesmo par | Três registros distintos | P |
| HIS-05 | Períodos sem sobreposição para o mesmo ativo | Garantido pelos índices únicos parciais (`ended_at IS NULL`) | A |

### 10.3 Geofence (RN10 e RN11)

| ID | Caso | Esperado |
| --- | --- | --- |
| GEO-01 | Cadastro de geofence (formato e raio, referência inicial de 10 m, configurável) | Persistido e vinculado |
| GEO-02 | Posição dentro do raio | Nenhum alerta |
| GEO-03 | Posição exatamente no limite | Comportamento definido e documentado |
| GEO-04 | Saída da área | Evento e alerta `GEOFENCE_EXIT` criados |
| GEO-05 | Múltiplas telemetrias fora da área em sequência | Um único alerta por transição (sem duplicidade) |
| GEO-06 | Reentrada e nova saída | Novo alerta |
| GEO-07 | Coordenadas inválidas ou ausentes | Rejeitadas ou ignoradas conforme regra; nunca geram alerta falso |
| GEO-08 | Telemetria sem GPS | Não gera saída |
| GEO-09 | Geofence sem dispositivo vinculado | Nenhuma avaliação |

### 10.4 Comandos automáticos

| ID | Caso | Esperado |
| --- | --- | --- |
| AUT-C01 | Condição atendida (ex.: lacre `BROKEN` ou saída de geofence) | Comando criado `PENDENTE` |
| AUT-C02 | Condição não atendida | Nenhum comando |
| AUT-C03 | Mesmo gatilho repetido | Idempotência: sem comando duplicado |
| AUT-C04 | Expiração de comando não executado | Estado definido e não retornado como pendente |
| AUT-C05 | Falha (`ERRO`) | Política de repetição conforme regra |
| AUT-C06 | Confirmação do comando automático pelo dispositivo | Mesmo fluxo da seção 6.6 |

### 10.5 Worker SQLite → PostgreSQL

> Implementado em 07/10/2026 (`src/worker/`, scripts `004` e `005`). A IA fez uma verificação técnica no FluxID de análise no Docker (relatório [Relatorio-de-Teste-2026-10-07-01h30.md](Relatorio-de-Teste-2026-10-07-01h30.md)); o **teste formal** destes casos foi feito pela IA na mesma madrugada (Roteiro v1.10, seção 5.10, sem falhas); aprovado por Natã da Silva Baracho em 07/10/2026. Os casos INT são automatizados na suíte.

| ID | Caso | Esperado |
| --- | --- | --- |
| SYN-01 | Sincronização de itens `PENDING` | Marcados `SYNCED`; dados corretos no destino |
| SYN-02 | Reprocessamento do mesmo lote | Sem duplicar (idempotência por `message_id`) |
| SYN-03 | PostgreSQL indisponível | Rodada `FALHOU` em `sync_logs`; itens continuam `PENDING` **sem gastar tentativa** (escolha I2, aprovada) |
| SYN-04 | Recuperação após queda | Sem perda e sem duplicidade |
| SYN-05 | Falha no meio do lote | Transação garante consistência |
| SYN-06 | Telemetria sem GPS | Vai para `telemetrias_quarentena` (P2); `data_coleta` é a hora de chegada (P1) |
| SYN-07 | Mapeamento `device_id` → `dispositivo_id` (UUID) e `organizacao_id` | Pelo `codigo`; dispositivo ausente no FluxID → `ERROR` "dispositivo não cadastrado no FluxID" com novas tentativas |
| SYN-08 | Evento do lacre de dispositivo sem lacre vinculado | Espera (`PENDING` com próxima tentativa), sem gastar tentativa (P3) |
| SYN-09 | Alertas: tipos do catálogo (ex.: `LACRE_VIOLADO`, `SAIDA_GEOCERCA`, `BATERIA_BAIXA`, `SEM_COMUNICACAO`) gravados direto em `alertas.tipo` após o script `004` (decisão P5) | Satisfazem os `CHECK` do destino |
| SYN-10 | Alerta sem lacre ou sem cilindro na data, ou com código já usado no FluxID | Fica parado na Oxide (`ERROR` sem próxima tentativa) com a explicação; exceções de cadastro seguem sem cilindro/lacre |
| SYN-11 | Severidade e estado | Somente `BAIXA/MEDIA/ALTA/CRITICA` e `ABERTO/EM_ANALISE/ENCERRADO` |
| SYN-12 | Comandos | Permanecem só na Oxide (decisão da entrega D) |
| SYN-13 | Geração de UUIDs | `DEFAULT gen_random_uuid()` (script `001`); o Worker não gera UUID |
| SYN-14 | Registro em `sync_logs` | Cada rodada registrada com `OK`, `PARCIAL` ou `FALHOU` e resumo |
| SYN-15 | Inicialização e encerramento do Worker | Sem perda de itens em processamento |
| SYN-16 | Credenciais do PostgreSQL | Só no `.env` (fora do git); `.env.example` sem senha; nada em documentos |
| SYN-17 | Novas tentativas | Envio inicial + 5 tentativas (1 min, 5 min, 15 min, 1 h, 6 h); depois `ERROR` parado (P6, escolha I1) |
| SYN-18 | Eventos com e sem estado do lacre | `LOCKED`/`UNLOCKED`/`BROKEN` → `eventos_lacre` (`FECHAMENTO`/`ABERTURA_NAO_AUTORIZADA`/`VIOLACAO`); sem estado → `eventos_dispositivo` (P4) |
| SYN-19 | Suspeita de violação (P8) | Evento novo de violação ou abertura não autorizada passa o lacre de `INSTALADO` a `SUSPEITA_VIOLACAO`; nada além disso |
| SYN-20 | Alerta: lacre e cilindro da hora | Par do vínculo válido em `created_at`; alerta encerrado na Oxide atualiza o mesmo alerta no FluxID |
| SYN-21 | Cadastro FluxID → Oxide | Dispositivos (com hash), lacres, cilindros e vínculos chegam; o FluxID prevalece; nada é apagado; vínculo local contraditório é encerrado |
| SYN-22 | Chave por hash | Dispositivo com `api_key_hash` autentica só com a chave que gera o hash |
| SYN-23 | Gatilho FLX-26 | O FluxID recusa alerta cujo par lacre + cilindro não tinha vínculo na data |
| SYN-24 | Script `005` | Estruturas do frontend criadas; histórico do cilindro imutável e alimentado por vínculos e alertas |

### 10.6 Integração com o FluxID na suíte (`npm test`, grupo 10)

| ID | Caso | Esperado | Sit. |
| --- | --- | --- | --- |
| INT-01 | `GET /api/v1/sync/status` | `200` com as filas `telemetry`, `events` e `alerts` e as últimas rodadas | A |
| INT-02 | `GET /api/v1/sync/problems` | Fila inválida `400`; fila válida `200` | A |
| INT-03 | `POST /api/v1/sync/retry` | Sem dados `400`; item inexistente `404` | A |
| INT-04 | Nova tentativa pedida pelo gestor | Item parado volta a `PENDING` com tentativas zeradas | A |
| INT-05 | Mudança de status do alerta | Alerta volta à fila do Worker (`sync_status = PENDING`) | A |
| INT-06 | Chave por hash | Chave certa `202`; chave em texto guardada `401` | A |
| INT-07 | `GET /devices` | Sem `api_key` e sem `api_key_hash` | A |

---

### 10.7 Simulação do lacre (`npm run simular`)

Ferramenta de teste de ponta a ponta, fora da suíte: cada rodada faz cerca de 58 verificações, sobre a Oxide e o FluxID de análise no Docker. Relatório: [Relatorio-de-Teste-2026-10-07-18h45.md](Relatorio-de-Teste-2026-10-07-18h45.md).

| ID | Caso | Esperado |
| --- | --- | --- |
| SIM-01 | Operador: cadastro unitário (empresa, operador, cliente com endereço, cilindro, lacre, dispositivo, vínculos e rota/entrega) | Tudo cadastrado; lacre `INSTALADO`; entrega `PENDENTE` com o cilindro |
| SIM-02 | Operador: erros de cadastro | Série repetida na mesma empresa, código de lacre repetido, segundo lacre no cilindro e alerta com o par errado: recusados |
| SIM-03 | Operador: cadastro em massa (CSV) | 20 conjuntos numa transação; reimportação recusada inteira |
| SIM-04 | Cadastro FluxID → Oxide | 0 conflitos; todos os cilindros da empresa copiados (achado A3) |
| SIM-05 | Lacre ativo, trajeto, duplicidade e GPS sem sinal | `202`, `200` na posição repetida, `409` no `message_id` repetido, quarentena |
| SIM-06 | Lacre aberto em trânsito, fora da rota, geocerca (dentro e fora de 10 m), violação | `error_type` `LACRE_ABERTO_EM_TRANSITO`; distâncias calculadas; alertas aceitos |
| SIM-07 | Todos os alertas do catálogo, nome antigo e código inválido | `201` nos 28 códigos e no nome antigo; `400` no inválido |
| SIM-08 | Fila | FluxID fora do ar sem gastar tentativa; espera do vínculo; dispositivo fora do FluxID com nova tentativa; alerta sem lacre parado; reenvio sem duplicar; nova tentativa pelo gestor |
| SIM-09 | Gestor e visualização | Encerramento no FluxID; mapa com a cor do alerta; eventos, quarentena, histórico do cilindro e erros da sincronização |

## 11. Testes da API FluxID (NestJS) — fase planejada

Baseados nos critérios de aceite do `Banco_FluxID.md` (seção 15).

| ID | Caso | Esperado |
| --- | --- | --- |
| FLX-01 | Conexão com usuário PostgreSQL sem privilégio de superusuário (RNF13) | Conecta; operações de DDL negadas |
| FLX-02 | Swagger exibe e executa todas as rotas CRUD | Todas funcionais |
| FLX-03 | DTOs rejeitam dados inválidos | `400` padronizado |
| FLX-04 | Isolamento multiempresa (RN22) | Organização A não lê nem altera dados da B |
| FLX-05 | Autorização por perfis e permissões (RBAC) | `403` sem permissão |
| FLX-06 | Autenticação JWT | Token ausente/expirado → `401` |
| FLX-07 | Operações compostas (vínculo, entrega, custódia) em transação (RNF09) | Falha parcial faz rollback |
| FLX-08 | Sem `DELETE` físico em histórico (RN21) | Desativação lógica |
| FLX-09 | Violação de chave única/estrangeira | Convertida em erro HTTP legível (`409`/`400`) |
| FLX-10 | Telemetria única por `message_id` (RN14) | Duplicata rejeitada |
| FLX-11 | Um lacre ativo por cilindro e um dispositivo ativo por lacre (RN04, RN05) | Índices únicos parciais confirmados no schema (**confirmados no dump, entrega E**) |
| FLX-12 | Custódia ativa única por cilindro | Índice único parcial confirmado (**confirmado no dump, entrega E**) |
| FLX-13 | Busca por código, série, UID NFC e identificador de hardware (RF13, RNF14) | Resultados corretos sem expor UUID |
| FLX-14 | Teste hidrostático e inspeção de lacre (RF11, RF12) | Registro e alerta de vencimento (RN15) |
| FLX-15 | Auditoria de ações críticas (RN20) | Usuário, instante, entidade, valores anterior e novo |
| FLX-16 | Contagem contra a massa de teste | Tabelas conferem com a seção 11 do documento FluxID |
| FLX-17 | Migração para PostGIS (geocerca de produção) | Telemetrias migradas sem perda de coordenadas |
| FLX-18 | Scripts `sql/fluxid/001` e `002` executados duas vezes seguidas | 1ª execução altera o previsto; 2ª execução sem nenhuma alteração e sem erro (**executado na entrega E**) |
| FLX-19 | Inserção sem `id` em qualquer tabela | UUID gerado pelo banco (**executado na entrega E**) |
| FLX-20 | `api_key_hash` repetido em dois dispositivos; latitude fora da faixa; `eventos_lacre.message_id` repetido | Os três rejeitados pelo banco; evento sem `message_id` aceito (**executado na entrega E**) |
| FLX-21 | Isolamento da massa entre organizações (RN22) | Nenhuma mistura de organizações em vínculos, entregas, alertas e custódias (**executado na entrega E**) |
| FLX-22 | Coerência de negócio da massa | Nenhum cilindro reprovado circulando; lacres com violação em `SUSPEITA_VIOLACAO`; perfis com permissões (**executado na entrega E**) |
| FLX-23 | Script `003`: alertas sem cilindro | Preenchidos pelo vínculo lacre → cilindro válido em `aberto_em`; segunda execução sem alteração; demais tabelas sem mudança (**executado em 07/10/2026**) |
| FLX-24 | `CHECK` de cilindro e lacre no alerta | Alerta operacional sem cilindro ou sem lacre rejeitado; com os dois, aceito; exceções de cadastro aceitas (`LACRE_SEM_CILINDRO` sem cilindro, `DISPOSITIVO_SEM_LACRE` sem os dois); `LACRE_SEM_CILINDRO` sem lacre rejeitado (**executado em 07/10/2026**) |
| FLX-25 | Alerta sem vínculo na data | O `003` para, lista o código e não altera nada (**executado em 07/10/2026**) |
| FLX-26 | Gatilho do par lacre + cilindro | Alerta com par sem vínculo na data rejeitado (**pendente**, entrega futura) |

---

## 12. Fase de operação

| ID | Caso | Esperado |
| --- | --- | --- |
| OPE-01 | Backup e restauração do `oxide.db` e do PostgreSQL | Restauração íntegra, procedimento documentado |
| OPE-02 | Política de expurgo e retenção | Dados antigos removidos sem quebrar a sincronização |
| OPE-03 | Observabilidade (logs e métricas do Worker e da API) | Falhas visíveis |
| OPE-04 | Carga: ingestão de telemetria em volume (frequência real a definir) | Sem perda, latência dentro do limite a definir |
| OPE-05 | Integração completa ESP32 → API → SQLite → Worker → PostgreSQL | Dado chega íntegro ao destino |
| OPE-06 | LGPD, RLS e retenção | Conforme definição antes da produção |

> Não foram definidos SLA, RPO, RTO, frequência de telemetria ou prazo de alertas; os limites dos casos OPE-01 e OPE-04 devem ser preenchidos quando forem aprovados.

---

## 13. Matriz de rastreabilidade (regras → testes)

| Regra / requisito | Casos |
| --- | --- |
| RN03, RN14 (unicidade, `message_id`) | DEV-06, DEV-10, TEL-03, TEL-19, TEL-20, EVT-08, ALT-06, BD-03, BD-16, SYN-02 |
| RN04, RN05 (um vínculo ativo) | ASC-02 a ASC-04, FLX-11 |
| RN08, RN09 (lacre e abertura) | EVT-04, EVT-05, TEL-23, TEL-24, ALT-05, ESP-07 |
| RN10, RN11 (geofence e alerta) | GEO-01 a GEO-09, ALT-07 |
| RN12, RN13 (velocidade e telemetria) | TEL-02, TEL-14, ESP-01 |
| RN17 (valores controlados) | EVT-03, EVT-06, ALT-03, ALT-13, CMD-04, CMD-14, BD-18, BD-19, SYN-11 |
| RN20, RN21 (auditoria e histórico) | HIS-01, ASC-07, FLX-08, FLX-15, SEG-11 |
| RN22 (multiempresa) | FLX-04 |
| RN23 (alertas rastreáveis) | ALT-05, ALT-12, ALT-15 a ALT-19, SYN-09 |
| RF04, RF16 (CRUD e API) | DEV-01 a DEV-12, FLX-02 |
| RF08 (telemetria) | TEL-01 a TEL-25 |
| RF09, RF10 (eventos e alertas) | EVT-01 a EVT-13, ALT-01 a ALT-21 |
| RNF08 (telemetria indexada) | OPE-04 |
| RNF10 (erros padronizados) | SEG-07, FLX-03, FLX-09 |
| Autenticação por API Key (MVP) | AUT-01 a AUT-10, SEG-01 a SEG-04 |

---

## 14. Situação atual da execução

| Indicador | Valor |
| --- | --- |
| Suíte automatizada (`npm test`) | **Modelo enxuto:** 71 casos, 71 aprovados em 10/10/2026 (aguardando validação). Modelo anterior: 96 casos aprovados em 07/10/2026 |
| Simulador (`npm run simular`) | 23 de 23 verificações em 10/10/2026 |
| Compilação (`npx tsc --noEmit`) | Aprovada em 06/10/2026 |
| Relatórios | [Relatorio-de-Teste-2026-10-06-15h14.md](Relatorio-de-Teste-2026-10-06-15h14.md): correções e ajustes da entrega; [Relatorio-de-Teste-2026-10-06-15h49.md](Relatorio-de-Teste-2026-10-06-15h49.md): teste completo da API e do banco no `oxide.db` real. [Relatorio-de-Teste-2026-10-06-17h35.md](Relatorio-de-Teste-2026-10-06-17h35.md): entrega A (segurança); [Relatorio-de-Teste-2026-10-06-19h28.md](Relatorio-de-Teste-2026-10-06-19h28.md): entrega C (severidade e coordenadas); [Relatorio-de-Teste-2026-10-06-20h00.md](Relatorio-de-Teste-2026-10-06-20h00.md): entrega E (banco FluxID); [Relatorio-de-Teste-2026-10-06-20h35.md](Relatorio-de-Teste-2026-10-06-20h35.md): entrega D (catálogo de comandos e tipos de erro); [Relatorio-de-Teste-2026-10-06-21h31.md](Relatorio-de-Teste-2026-10-06-21h31.md): entrega B (associação); [Relatorio-de-Teste-2026-10-06-23h40.md](Relatorio-de-Teste-2026-10-06-23h40.md): alertas em português, análise e encerramento; [Relatorio-de-Teste-2026-10-07-00h15.md](Relatorio-de-Teste-2026-10-07-00h15.md): FluxID, alerta com cilindro e lacre obrigatórios; [Relatorio-de-Teste-2026-10-07-00h45.md](Relatorio-de-Teste-2026-10-07-00h45.md): grupos do Swagger e FluxID no Docker; [Relatorio-de-Teste-2026-10-07-01h30.md](Relatorio-de-Teste-2026-10-07-01h30.md): integração Oxide ⇄ FluxID; [Relatorio-de-Teste-2026-10-07-18h45.md](Relatorio-de-Teste-2026-10-07-18h45.md): simulador do lacre e série do cilindro. Todos **aprovados por Natã da Silva Baracho** |
| Cobertura da suíte | Dispositivos, autenticação, telemetria, eventos, comandos, alertas (criação, listagem, análise e encerramento) e associação |
| Lacunas prioritárias | SEG-05, TEL-19, ALT-07/08/12, EVT-05, BD-04/06/11/16 (fora da suíte; cobertos pelo Roteiro) |
| Entregas futuras | Todos os casos da seção 10 pendentes (funcionalidades ainda não implementadas) |

---

## 15. Riscos e observações

| ID | Risco | Mitigação |
| --- | --- | --- |
| R1 | A suíte atual grava na `oxide.db` real (limpa por `DELETE ... LIKE 'DSP-TEST%'` no início e no fim); falha no meio pode deixar resíduos ou afetar dados | Usar banco de teste dedicado (`DB_PATH` por variável de ambiente) ou cópia temporária |
| R2 | Testes dependem do dispositivo semente `DSP-000001` e da chave `auto-DSP-000001` | Criar a semente no setup da suíte |
| R3 | Testes assumiam `status_id = 1` e `severity_id = 2` | **Resolvido** na entrega C: alertas não usam mais IDs do catálogo |
| R4 | Exposição de `api_key` nos `GET /devices` | **Mitigado** na entrega A: respostas sem `api_key` (SEG-01) |
| R5 | Ownership não validado em telemetria e eventos | **Mitigado** na entrega A: `403` para chave de outro dispositivo (AUT-08/09) |
| R6 | Severidade sem semântica | **Resolvido** na entrega C: severidade em texto com os valores do FluxID (ALT-12) |
| R7 | Divergência de modelos (Oxide × FluxID) pode causar rejeição em massa no Worker | Casos SYN-06 a SYN-13 antes de implementar a sincronização |
| R8 | Testes concorrentes não cobertos (SQLite com `better-sqlite3` é síncrono, mas há risco entre processos). Telemetria e alertas convertem violação `UNIQUE` em `409`; eventos e dispositivos ainda responderiam `500` | TEL-19 |
| R9 | Ausência de `CHECK` para `alert_type` e `seal_status` no SQLite (validação só na aplicação) | Testes de API compensam; avaliar constraint |

---

## 16. Responsabilidades

| Papel | Responsável |
| --- | --- |
| Execução e automação | Desenvolvimento (com apoio de IA para compilação e chamadas HTTP) |
| Validação humana | Natã da Silva Baracho |
| Definições de regra pendentes (severidade, ownership, mapeamentos FluxID, políticas de sincronização) | Responsáveis de produto e arquitetura a indicar |

---

## 17. Procedimento de execução

1. Fazer backup de `oxide.db` (ou apontar para um banco de teste).
2. Executar `npx tsc --noEmit`.
3. Com a porta 3000 livre, executar `npm test` e registrar o resultado final. A suíte sobe a própria instância da API; se houver outra rodando, ela é testada no lugar do código atual.
4. Iniciar a API (`npm start`) em uma instância nova para os casos manuais.
5. Executar os casos manuais pendentes no Swagger, no Postman ou pelo `RoteiroDeTeste.md`.
6. Conferir o banco com as consultas da seção de verificação do `Oxidedb.md` ou da seção 6 do `RoteiroDeTeste.md`.
7. Registrar defeitos com ID do caso, passos, resultado obtido e esperado.
8. Repetir a suíte completa a cada nova entrega do roadmap e atualizar este plano.

---

## 18. Histórico do documento

| Versão | Data | Descrição |
| --- | --- | --- |
| 1.0 | 05/10/2026 | Criação do plano com base nos documentos do projeto e na suíte de 40 testes |
| 1.1 | 06/10/2026 | Correções na API: idempotência de posição repetida, `status`/`attempt_count` controlados pelo servidor, `api_key` única, validação de `active` e de tipos da telemetria, `404` para dispositivo inexistente. Novos casos DEV-10 a DEV-12, TEL-20 a TEL-22, BD-16 e BD-17; TEL-12, TEL-15 e BD-08 revisados; suíte com 46 casos |
| 1.2 | 06/10/2026 | Ajustes definidos por Natã da Silva Baracho: `last_repeat_message_id` no lugar da tabela `telemetry_position_repeats`; posição repetida responde `200`; `seal_status` na telemetria e repetição só com posição e lacre iguais; `attempt_count` do ESP32 em `device_attempt_count`. Novos casos TEL-23 a TEL-25 e EVT-13; TEL-04, TEL-20, TEL-21, EVT-11, BD-01 e BD-17 revisados; suíte com 50 casos |
| 1.3 | 06/10/2026 | Entrega A (segurança), decisões de Natã da Silva Baracho: `api_key` fora das respostas de `/devices` (SEG-01), chave do próprio dispositivo em telemetria e eventos (AUT-08/09), sem criação automática de dispositivo (EVT-07, SEG-04); SEG-02 e SEG-03 registrados como decisões aceitas; R4 e R5 mitigados; suíte com 52 casos |
| 1.4 | 06/10/2026 | Entrega C, decisões de Natã da Silva Baracho: severidade e status do alerta em texto com os valores do FluxID, severidade padrão por tipo, campos antigos ignorados; latitude e longitude juntas e dentro da faixa. ALT-04, ALT-05, ALT-07 a ALT-09, ALT-12, TEL-11, TEL-13 e BD-06 revisados; R3 e R6 resolvidos; suíte com 55 casos |
| 1.5 | 06/10/2026 | Entrega E (FluxID): FLX-11 e FLX-12 confirmados no dump; novos casos FLX-18 a FLX-22 executados num servidor PostgreSQL temporário |
| 1.6 | 06/10/2026 | Entrega D, decisões de Natã da Silva Baracho: catálogo de comandos (`TRAVAR_VALVULA`, `DESTRAVAR_VALVULA`) aplicado no banco, sem rota de criação; novos casos CMD-14, CMD-15 e BD-18; suíte com 57 casos |
| 1.7 | 06/10/2026 | Entrega B, decisões de Natã da Silva Baracho: associação dispositivo → lacre → cilindro na Oxide (cópia provisória do FluxID), rotas abertas, regras RN04/RN05, troca, histórico e `error_type`; ASC-01 a ASC-14 e HIS-01 a HIS-05 revisados; suíte com 71 casos |
| 1.8 | 06/10/2026 | Entrega de alertas, decisões de Natã da Silva Baracho: `alert_type` com os códigos do catálogo em português (nomes antigos convertidos), severidade padrão do catálogo, listagem e rota para analisar e encerrar alertas; ALT-03, ALT-05, ALT-07, ALT-08 e BD-06 revisados; novos ALT-13 a ALT-21 e BD-19; suíte com 86 casos |
| 1.9 | 07/10/2026 | FluxID, decisão de Natã da Silva Baracho: alerta com cilindro e lacre obrigatórios (script `003`); novos FLX-23 a FLX-25 executados num servidor PostgreSQL temporário e FLX-26 (gatilho) pendente; SYN-09 passa a citar o script `004` |
| 1.10 | 07/10/2026 | Swagger organizado em grupos (novo GER-06); FluxID de análise no Docker; dump em `sql/fluxid/FluxID.sql`; suíte com 87 casos |
| 2.0 | 10/10/2026 | Modelo enxuto: nova seção 0 com o plano atual (casos V2-*), suíte reescrita com 71 casos e simulador com 23 verificações, os dois com recebedor de teste no lugar do Supabase. As seções 6 a 13 ficam como histórico |
| 1.12 | 07/10/2026 | Simulador do lacre (seção 10.7, SIM-01 a SIM-09); ASC-13 revisto (série repetida aceita; achado A3) |
| 1.11 | 07/10/2026 | Integração Oxide ⇄ FluxID implementada: SYN-01 a SYN-16 revistos com as regras aprovadas, novos SYN-17 a SYN-24 e INT-01 a INT-07; BD-01 e BD-02 com `sync_logs`; página `/api-docs-fluxid` com a proposta da API do frontend (GER-07, GER-08); suíte com 96 casos. Teste formal da IA em 07/10/2026, sem falhas |