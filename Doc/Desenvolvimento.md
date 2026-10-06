# API Oxide (ESP32) — Desenvolvimento

Este documento tem duas partes:

- **Parte 1 — Como a API funciona:** guia para a equipe, principalmente para quem programa o ESP32 em C++. Explica o papel da Oxide, como o dispositivo se conecta, o que enviar, o que a API responde e onde cada dado fica no banco.
- **Parte 2 — Histórico de desenvolvimento e testes:** registro do que foi construído, dos erros corrigidos e dos testes executados (material da tese). A numeração original das seções foi mantida para que as referências dos relatórios continuem válidas.

Documentos relacionados:

- [ESP32-envio-de-dados.md](ESP32-envio-de-dados.md): payloads de exemplo e código C++ para o firmware.
- [Regras-de-Negocio-e-Banco-Oxide.md](Regras-de-Negocio-e-Banco-Oxide.md): regras detalhadas e schema do SQLite.
- [Oxidedb.md](Oxidedb.md): script de criação do banco.
- [Doc_tese/PlanoDeTeste.md](Doc_tese/PlanoDeTeste.md) e [Doc_tese/RoteiroDeTeste.md](Doc_tese/RoteiroDeTeste.md): como a API é testada.
- Swagger, com a API rodando: `http://<IP_DA_API>:3000/api-docs`.

---

# Parte 1 — Como a API funciona

## 1.1 O papel da Oxide

A Oxide não é apenas uma API. Ela é a **camada de integração, segurança e controle operacional** entre o ESP32 e o FluxID: a ponte entre o mundo físico (dispositivos, lacres e válvulas) e o mundo de negócio (FluxID).

```text
ESP32 (no lacre do cilindro: GPS + modem GSM)
   ↓  HTTP + JSON
Oxide API (Node.js + TypeScript)
   ↓
Oxide DB (SQLite, oxide.db) — fila local
   ↓
Worker (futuro)
   ↓
FluxID (PostgreSQL) — banco principal
```

O que a Oxide faz hoje:

| Função | Como |
| --- | --- |
| Recebe dados do ESP32 | Telemetrias (latitude, longitude, velocidade, bateria, sinal GSM, estado do lacre) e eventos (lacre rompido, reinício, falha de hardware...) |
| Autentica dispositivos | Header `X-API-Key`, conferido contra a tabela `devices`; a chave precisa ser do próprio `device_id` enviado |
| Evita duplicidade | `message_id` é a chave de idempotência: mesma mensagem = mesma operação |
| Mantém fila local | Grava no `oxide.db` (tabelas `telemetry_queue`, `events`, `commands`, `alerts`) até o Worker sincronizar |
| Executa regras operacionais | Valida o payload, detecta duplicidade, controla posições repetidas e atualiza `last_seen_at` |
| Gerencia comandos | O ESP32 consulta comandos pendentes (ex.: travar ou destravar a válvula) e confirma `EXECUTADO` ou `ERRO` |
| Gerencia alertas | `SEAL_BROKEN`, `LOW_BATTERY`, `GEOFENCE_EXIT`, `DEVICE_ERROR`, `COMMAND_FAILURE`, `COMMUNICATION_LOST` |

Próximas fases (ainda não implementadas):

| Fase | Fluxo |
| --- | --- |
| Worker | SQLite → PostgreSQL (FluxID) |
| Geofence | Posição → validação → alerta |
| Segurança ativa | Lacre rompeu → alerta → comando `TRAVAR_VALVULA` |
| Histórico operacional | Dispositivo → lacre → cilindro |

**Resumo:** a Oxide é uma plataforma intermediária de ingestão IoT. Ela autentica dispositivos, recebe telemetrias e eventos, controla comandos e alertas, armazena os dados temporariamente em SQLite e prepara a sincronização com o PostgreSQL do FluxID. Deixou de ser apenas uma API de telemetria e está se tornando o núcleo de controle operacional dos dispositivos.

## 1.2 Como o ESP32 se conecta

| Item | Valor |
| --- | --- |
| Endereço base | `http://<IP_DA_API>:3000/api/v1` |
| Formato | JSON, com o header `Content-Type: application/json` |
| Autenticação | Header `X-API-Key: <chave do dispositivo>` em todas as rotas `/iot/...` |
| Tamanho máximo do corpo | 100 KB (acima disso: `413`) |
| Teste rápido | `GET http://<IP_DA_API>:3000/` responde `API ESP32 Online` |

A chave deve ser a do **próprio** dispositivo informado em `device_id`. Com a chave de outro dispositivo, a API responde `403`.

## 1.3 Antes de enviar: cadastro do dispositivo

O cadastro **oficial** de dispositivo, lacre e cilindro fica no **FluxID**. Enquanto o Worker não traz esse cadastro para a Oxide, o dispositivo é cadastrado **uma vez** direto na Oxide (procedimento provisório):

```http
POST http://<IP_DA_API>:3000/api/v1/devices
Content-Type: application/json

{ "device_id": "DSP-000010", "api_key": "chave-do-lacre-10", "firmware_version": "1.0.0" }
```

- `201`: cadastrado. A mesma `api_key` vai no firmware.
- `409`: `device_id` ou `api_key` já existem.
- Um dispositivo **não cadastrado** recebe `404` em telemetria e eventos. A API **não** cria dispositivos automaticamente.
- `GET /devices` e `GET /devices/:deviceId` são abertos para a equipe consultar, mas **não mostram a `api_key`**. Guarde a chave no momento do cadastro.

## 1.4 Rotas usadas pelo ESP32

| Método e rota | Para quê | Respostas |
| --- | --- | --- |
| `POST /iot/telemetries` | Enviar posição, bateria, sinal e estado do lacre | `202` nova; `200` posição repetida; `400`; `401`; `403`; `404`; `409` |
| `POST /iot/events` | Enviar ocorrências (reinício, falha, mudança do lacre) | `202`; `400`; `401`; `403`; `404`; `409` |
| `GET /iot/commands/:deviceId` | Buscar comandos pendentes | `200` (lista); `401`; `403`; `404` |
| `POST /iot/commands/confirm` | Confirmar execução de um comando | `200`; `400`; `401`; `403`; `404`; `409` |
| `POST /iot/alerts` | Registrar um alerta | `201`; `400`; `401`; `403`; `404`; `409` |

Rotas de apoio para a equipe: `GET /iot/telemetries` (lista as telemetrias de todos os dispositivos, da mais recente para a mais antiga; exige uma chave válida) e `GET/POST /devices`.

### Telemetria — exemplo

```json
{
  "message_id": "MSG-000001",
  "device_id": "DSP-000001",
  "latitude": -7.2091939,
  "longitude": -39.3063666,
  "speed_kmh": 21.98,
  "battery_percent": 57.33,
  "gsm_signal": -64,
  "seal_status": "LOCKED",
  "attempt_count": 1
}
```

- Obrigatórios: `message_id` e `device_id` (texto).
- Números (`latitude`, `longitude`, `speed_kmh`, `battery_percent`, `gsm_signal`) vão como número JSON, **não** como texto.
- `seal_status`: `LOCKED` (fechado), `UNLOCKED` (aberto) ou `BROKEN` (rompido).
- `attempt_count`: quantas vezes o ESP32 já tentou enviar esta mensagem (inteiro ≥ 0).
- **Posição repetida:** se latitude, longitude e `seal_status` forem iguais aos da última telemetria do dispositivo, a API responde `200 "Posição já registrada; data e hora atualizadas"`, atualiza só a data e hora e não cria outra linha. Se o lacre mudar de estado no mesmo lugar (ex.: `LOCKED` → `BROKEN`), é gravada uma linha nova (`202`).

### Evento — exemplo

```json
{ "message_id": "EVT-000001", "device_id": "DSP-000001", "event_type": "seal_changed", "seal_status": "BROKEN", "attempt_count": 1 }
```

- Obrigatórios: `message_id`, `device_id` e `event_type`. O `event_type` é texto livre (ex.: `startup`, `seal_changed`, `hardware_failure`).

## 1.5 O que o firmware faz com cada resposta

| Código | Significado | O que o ESP32 deve fazer |
| --- | --- | --- |
| `202` | Dado novo gravado | Sucesso. A próxima leitura usa um `message_id` novo |
| `200` | Posição já registrada (telemetria) ou consulta/confirmação ok | Sucesso. Não reenviar |
| `201` | Alerta criado | Sucesso |
| `409` | Mensagem já recebida (mesmo `message_id`) ou comando já confirmado | Tratar como **sucesso**. Não reenviar |
| `400` | Payload inválido (campo ausente, tipo errado, valor fora da lista) | **Não reenviar** o mesmo payload; registrar no log. É erro de firmware |
| `401` | `X-API-Key` ausente ou inválida | Conferir a chave configurada. Não insistir |
| `403` | Dispositivo desativado ou chave de outro dispositivo | Conferir `device_id` e chave. Não insistir |
| `404` | Dispositivo não cadastrado (ou comando inexistente) | Cadastrar o dispositivo (seção 1.3). Não insistir |
| `413` | Corpo maior que 100 KB | Reduzir o payload |
| `500`, sem resposta ou tempo esgotado | Falha do servidor ou da rede | **Reenviar** com o **mesmo** `message_id` e `attempt_count + 1`, aguardando um intervalo crescente entre as tentativas |

## 1.6 Regras do `message_id` e do reenvio

- Cada leitura nova recebe um `message_id` **único** para aquele dispositivo. Sugestão: prefixo + sequência guardada na memória não volátil (NVS), para não repetir depois de um reinício.
- O reenvio de **uma mesma leitura** usa o **mesmo** `message_id`. Assim, se a primeira tentativa chegou e só a resposta se perdeu, a API responde `409` e nada é duplicado.
- O `attempt_count` só informa quantas tentativas o ESP32 fez; ele não muda a regra de duplicidade.

## 1.7 Ciclo de comandos

```text
1. ESP32 → GET /iot/commands/DSP-000001        (com a própria X-API-Key)
2. API   → [ { "command_id": "CMD-1", "command_type": "TRAVAR_VALVULA", "status": "PENDENTE", ... } ]
3. ESP32 executa o comando na válvula
4. ESP32 → POST /iot/commands/confirm
           { "command_id": "CMD-1", "device_id": "DSP-000001", "status": "EXECUTADO" }
           ou { ..., "status": "ERRO", "error_message": "motor travado" }
5. API   → 200 "Comando confirmado"   (409 se já estava confirmado)
```

- A lista traz só comandos `PENDENTE`, do mais antigo para o mais novo.
- Hoje os comandos são criados direto no banco (não há rota de criação). Os tipos previstos são `TRAVAR_VALVULA` e `DESTRAVAR_VALVULA`; a lista fechada de tipos será implementada numa próxima entrega.

## 1.8 Onde cada campo fica no banco

### Telemetria → tabela `telemetry_queue`

| Campo enviado | Coluna | Observação |
| --- | --- | --- |
| `message_id` | `message_id` | Único |
| `device_id` | `device_id` | Precisa existir em `devices` |
| `latitude`, `longitude`, `speed_kmh`, `battery_percent`, `gsm_signal` | Mesmo nome | Opcionais |
| `seal_status` | `seal_status` | `LOCKED`, `UNLOCKED`, `BROKEN` |
| `attempt_count` | `device_attempt_count` | Tentativas de envio do ESP32 |
| `last_seen_at` | `last_seen_at` | Opcional, ISO 8601. Na posição repetida, o servidor grava a hora atual (UTC, `AAAA-MM-DD HH:MM:SS`) |
| `lacre_id`, `cilindro_id` | Mesmo nome | Texto livre provisório, até a entrega de associação |
| `payload_json` (ou o corpo inteiro) | `payload_json` | Guarda o JSON original recebido |
| `status` | — | **Ignorado** (fica só em `payload_json`). Não enviar |
| — | `status`, `attempt_count`, `last_error` | Controle do Worker: começa `PENDING` e `0` |
| — | `last_repeat_message_id` | `message_id` da última posição repetida |

### Evento → tabela `events`

| Campo enviado | Coluna |
| --- | --- |
| `message_id`, `device_id`, `seal_status`, `payload_json` | Mesmo nome |
| `event_type` | `message_type` |
| `attempt_count` | `device_attempt_count` |
| — | `status` (`PENDING`), `attempt_count` (`0`), `last_error`: controle do Worker |

### Comandos e alertas

- `commands`: `command_id`, `device_id`, `command_type`, `status` (`PENDENTE` → `EXECUTADO`/`ERRO`), `created_at`, `executed_at`, `error_message`.
- `alerts`: `alert_id`, `device_id`, `alert_type`, `status_id`, `severity_id`, `title`, `description`, `created_at`, `resolved_at`. `status_id` e `severity_id` apontam para a tabela `status` (a lista de severidades ainda será definida).

### Estados da fila

`status` em `telemetry_queue` e `events` é o estado da **sincronização** com o FluxID (`PENDING` → `PROCESSING` → `SYNCED` ou `ERROR`), não o estado do dispositivo ou do lacre. Quando há posições repetidas, só a linha original (a mais antiga) segue para o FluxID.

## 1.9 O que ainda não existe

- Worker de sincronização com o FluxID.
- Cadastro vindo do FluxID (por isso o `POST /devices` provisório).
- Lista fechada de tipos de comando e criação de comandos pela API.
- Lista de severidades dos alertas e validação da faixa de latitude/longitude.
- Geofence, comandos automáticos e associação dispositivo → lacre → cilindro.

## 1.10 Estado atual

- API em funcionamento, validada pela suíte automatizada (`npm test`, 52/52) e pelo Roteiro de Teste completo no `oxide.db` real.
- Próximas entregas, nesta ordem: severidade e coordenadas → catálogo de comandos → associação dispositivo/lacre/cilindro → Worker.
- Pendências conhecidas: firmware do ESP32 precisa enviar `seal_status` e `attempt_count` e tratar as respostas da seção 1.5; `nodemon` com vulnerabilidade apenas em desenvolvimento.

---

# Parte 2 — Histórico de desenvolvimento e testes

Registro em ordem cronológica. Descreve o estado da API **no momento de cada registro**; quando um comportamento mudou depois, há uma nota indicando a mudança. Para o comportamento atual, use a Parte 1.

## 2.1 Estrutura do código (referência para quem mantém a API)

| Pasta/arquivo | Conteúdo |
| --- | --- |
| `src/server.ts` | Inicializa o Express, registra rotas, Swagger e o tratamento de erros |
| `src/database/connection.ts` | Conexão `better-sqlite3`, criação de tabelas e migrações automáticas |
| `src/Middleware/` | `apiKeyMiddleware.ts` (chave válida, chave do próprio dispositivo) e `Errohandler.ts` |
| `src/routes/` | Rotas de dispositivos, telemetria, eventos, comandos e alertas |
| `src/controllers/` | Validação do payload e montagem das respostas HTTP |
| `src/services/` | Regras de negócio (duplicidade, posição repetida, cadastro) |
| `src/repositories/` | Consultas SQL de cada tabela |
| `src/models/` | Tipos de dados |
| `src/docs/openapi.ts` | Especificação do Swagger |
| `tests/api.test.ts` | Suíte automatizada (`npm test`) |

## 4. Observações técnicas iniciais

- O projeto teve ajustes para corrigir imports, nomes de arquivos e inconsistências no schema do SQLite.
- O banco possuía nomes reais de colunas diferentes de algumas convenções iniciais do código, sendo necessário alinhar as queries ao schema real.
- A conexão com SQLite e a API foram validadas com requisições HTTP reais, retornando os status esperados para telemetria e eventos.

## 5. Histórico de erros e correções (fase inicial)

### 5.1 Middleware com caminho incorreto
- Problema: a rota de telemetria e a rota de eventos importavam `../middlewares/apiKeyMiddleware`, mas o diretório real do projeto era `src/Middleware/apiKeyMiddleware.ts`. Isso fazia o código apontar para um arquivo inexistente e quebrava a autenticação.
- Como foi consertado: o import foi ajustado para `../Middleware/apiKeyMiddleware` nos arquivos `src/routes/telemetryRoutes.ts` e `src/routes/eventRoute.ts`.
- Resultado: a autenticação por API key voltou a ser resolvida corretamente.

### 5.2 Falta de import do middleware na rota de eventos
- Problema: o arquivo `src/routes/eventRoute.ts` usava `apiKeyMiddleware` no `router.post(...)`, mas o `import` correspondente não estava presente. Isso gerava erro de referência e a rota não era registrada corretamente.
- Como foi consertado: foi adicionado o import do middleware.
- Resultado: a rota de eventos passou a validar a chave `X-API-Key` antes de processar o payload.

### 5.3 Inconsistência de nomes de colunas no SQLite
- Problema: o código utilizava nomes de colunas diferentes dos que existem no banco. Isso causava falhas em consultas por campos inexistentes e interrompia a persistência de dados.
- Como foi consertado: os repositórios e queries foram alinhados ao schema real do SQLite, incluindo nomes de colunas e valores padrão compatíveis com o banco.
- Resultado: gravações e consultas passaram a funcionar com o padrão real da base.

### 5.4 Erro de chave estrangeira ao receber evento com device inexistente
- Problema: ao criar eventos, a aplicação tentava gravar um registro referente a um `device_id` que ainda não existia no banco, gerando falha de integridade referencial.
- Como foi consertado: foi implementada a criação automática do dispositivo antes de salvar o evento (`ensureDeviceExists`).
- Resultado: a API passou a aceitar eventos mesmo quando o dispositivo ainda não havia sido cadastrado manualmente.
- **Nota (06/10/2026, entrega A):** a criação automática foi removida por segurança (gerava a chave previsível `auto-<device_id>`). Hoje um evento de dispositivo não cadastrado recebe `404`. Ver 7.14.

### 5.5 Problemática de tipagem em `req.params` no `DeviceController`
- Problema: o valor de `req.params.deviceId` poderia ser `undefined` e o código trabalhava com a variável como se fosse sempre string válida.
- Como foi consertado: a leitura do parâmetro foi normalizada em uma variável local e validada com checagem de tipo antes da busca no repositório.
- Resultado: a rota `GET /api/v1/devices/:deviceId` passou a responder corretamente.

### 5.6 Prefixo de API inconsistente
- Problema: as rotas do sistema estavam sendo montadas com prefixos divergentes.
- Como foi consertado: foi padronizado o uso de `API_PREFIX = "/api/v1"` em `src/server.ts`.
- Resultado: a API passou a seguir a convenção `/api/v1/...` de forma consistente.

## 6. Testes da fase inicial (antes da suíte automatizada)

### 6.1 Validação de compilação
- Comando executado: `npx tsc --noEmit`. Resultado: sucesso, sem erros de TypeScript.

### 6.2 Validação do servidor
- Comando executado: `npm start`. Resultado: servidor iniciado corretamente na porta 3000.

### 6.3 Casos de teste executados

| # | Caso | Resultado obtido na época |
| --- | --- | --- |
| 1 | `GET /` | `200 API ESP32 Online` |
| 2 | `GET /api/v1/devices/DSP-000001` | `200` com o dispositivo |
| 3 | `POST /iot/telemetries` válido | `202 Telemetria recebida` |
| 4 | `POST /iot/events` válido | `202 Evento recebido` |
| 5 | `POST /iot/events` com `message_id` duplicado | `409 Mensagem duplicada` |
| 6 | `POST /iot/telemetries` sem `device_id` | `400` |
| 7 | `POST /iot/events` sem `X-API-Key` | `401 API Key obrigatória` |
| 8 | `POST /iot/events` com `X-API-Key` inválida | `401 API Key inválida` |
| 9 | `GET /api-docs` | `200`, Swagger UI |
| 10 | `GET /api-docs/swagger-ui-init.js` | `200`, título `API ESP32`, rotas e `X-API-Key` |
| 11 | `POST /iot/events` sem `event_type` | `400` |
| 12 | `POST /iot/telemetries` sem `device_id` | `400` |
| 13 | `GET /devices` e `GET /devices/DSP-000001` | `200`, sem criar registros |
| 14 | `POST /devices` com `device_id` existente | `409 Dispositivo duplicado` |
| 15 | `POST /iot/events` com `message_id` existente | `409`, nenhuma linha nova |
| 16 | Duas telemetrias com o mesmo `message_id` | `202` e `409`, uma linha |
| 17 | Duplicatas em `devices`, `events`, `telemetry_queue` | Zero |
| 18 | Telemetria com `last_seen_at` | `202`, valor ISO 8601 gravado em `DATETIME` |
| 19 | Duas telemetrias com a mesma posição | Ambas `202`, uma linha. **Hoje:** a repetição responde `200` (ver 7.12) |
| 20 | Duas telemetrias sem coordenadas | Ambas `202`, duas linhas |
| 21 | `GET /iot/telemetries` com e sem chave | `200` decrescente; `401` sem chave |
| 22 | JSON malformado | `400 Requisição inválida` |
| 23 | Evento com `seal_status: LOCKED` | `202`, `status = PENDING` |
| 24 | Evento com `seal_status: closed` | `400`, nenhuma linha |
| 25 | Migração das colunas de status de `devices` | Colunas adicionadas sem recriar a tabela |
| 26 | Schema de `commands` | Default `PENDENTE`, `command_id` único, FK com `CASCADE`/`RESTRICT` |
| 27 | Comandos pendentes e confirmação | `200`, `409` na reconfirmação, `403` com outra chave, `400` status inválido |
| 28 | Schema de `alerts` | `alert_id` único, três FKs |
| 29 | `POST /iot/alerts` | `201`, `409`, `400`, `403` |
| 30 | Alerta `SEAL_BROKEN` | `201`, gravado (em cópia temporária do banco) |

Observação: um corpo JSON literal `null` é rejeitado pelo parser JSON do Express antes de chegar ao controller, com status `400`.

### 6.4 Processo de validação
- Validação assistida por IA: compilação TypeScript, chamadas HTTP e conferência do Swagger.
- Validação humana: revisão e conferência dos resultados por Natã da Silva Baracho. A partir de 06/10/2026, cada entrega tem relatório próprio em `Doc_tese/Relatorio-de-Teste-AAAA-MM-DD-HHhMM.md`, com questionário de validação.

## 7. Evolução da API (erros identificados e correções)

### 7.1 Erro de coluna no SQLite
- Problema: `SqliteError: table events has no column named message_type`. O banco tinha colunas com grafia incorreta (`messge_tyoe`, `seel_status`, `firmware_versin `).
- Correção: migração em `src/database/connection.ts` que renomeia automaticamente as colunas (`messge_tyoe` → `message_type`, `seel_status` → `seal_status`, `firmware_versin ` → `firmware_version`) e `INSERT` alinhado ao schema final.
- Resultado: eventos válidos voltaram a responder `202` em vez de `500`.

### 7.2 Resposta 404 inicial na documentação Swagger
- Problema: a primeira chamada a `GET /api-docs` retornou `404`, porque o processo da porta 3000 era anterior à inclusão do Swagger.
- Correção: reinício da API com `npm start`.
- Resultado: `GET /api-docs` e `GET /api-docs/swagger-ui-init.js` passaram a retornar `200`.

### 7.3 Duplicidade de dispositivo não era informada pelo controller
- Problema: o service detectava o `device_id` existente, mas o endpoint podia responder sucesso.
- Correção: o controller passou a responder `409 Dispositivo duplicado`.

### 7.4 Telemetria não usava o service nem persistia na fila
- Problema: o controller só registrava a mensagem no console; o schema da fila tinha nomes legados e campos opcionais obrigatórios.
- Correção: controller ligado ao service; a inicialização normaliza nomes e migra a tabela preservando linhas e IDs.
- Resultado: primeira chamada `202`, repetida `409`, uma linha por `message_id`.

### 7.5 Inclusão de `last_seen_at` na fila
- A inicialização adiciona `last_seen_at DATETIME` quando a coluna não existe; o Swagger documenta o formato ISO 8601. Omitido, o campo fica `NULL`.

### 7.6 Repetição da última posição
- Regra criada: coordenadas iguais às da última telemetria do dispositivo não geram nova linha; só atualizam `last_seen_at`.
- Resultado na época: a repetição respondia `202`. **Mudou em 06/10/2026:** passou a responder `200`, a considerar também o estado do lacre e a guardar o `message_id` para detectar reenvio (ver 7.11 e 7.12).

### 7.7 Middleware global de erros
- Problema: import com nome errado (`errorHandler` × `Errohandler.ts`) e erros do parser JSON convertidos em `500`.
- Correção: import alinhado; o middleware preserva status HTTP válidos.
- Resultado: JSON malformado retorna `400`.

### 7.8 Catálogo de status para dispositivos e eventos
- A tabela `status` guarda código, nome e descrição de `ACTIVE`, `INACTIVE`, `LOCKED`, `UNLOCKED` e `BROKEN`, separada de `events.status`, que representa a sincronização da fila. Criada e semeada de forma idempotente por `connection.ts`.

### 7.9 Tabela de comandos
- `connection.ts` cria `commands` com FK para `devices.device_id`; default `PENDENTE`, `command_id` único. Na época não havia rota nem repository; depois foram criadas as rotas de consulta e confirmação (`CommandRepository`).

### 7.10 Tabela de alertas
- `connection.ts` cria `alerts` com FK para dispositivo e duas FKs para `status`. Tipos previstos: `SEAL_BROKEN`, `GEOFENCE_EXIT`, `LOW_BATTERY`, `DEVICE_ERROR`, `COMMAND_FAILURE`, `COMMUNICATION_LOST`.
- Pendência: o catálogo `status` não tem severidades, embora `severity_id` aponte para ele.

### 7.11 Correções da revisão do plano de teste (06/10/2026)
A análise do código contra o Plano de Teste encontrou falhas reproduzidas em uma cópia do `oxide.db`:

| Problema | Correção | Resultado |
| --- | --- | --- |
| Reenvio do `message_id` de uma posição repetida respondia `202`, quebrando a idempotência (RN14). | Primeira versão com a tabela `telemetry_position_repeats`; substituída em 7.12 pela coluna `last_repeat_message_id`. | Reenvio retorna `409 Mensagem duplicada`. |
| O cliente definia `status` e `attempt_count` da telemetria (ex.: `SYNCED`), o que faria o Worker ignorar a linha. O mesmo valia para `attempt_count` de eventos. | Repositories gravam sempre `PENDING` e `0`; o campo `status` saiu do exemplo do Swagger. | Valores do cliente ignorados. |
| `POST /devices` aceitava `api_key` já usada por outro dispositivo. | `DeviceService` verifica a chave (`409 API Key já está em uso`) e a inicialização cria `idx_devices_api_key`. O middleware passou a buscar por `findByApiKey`. | Chave duplicada rejeitada. |
| `active` aceitava qualquer valor; o `oxide.db` real não tinha o `CHECK` do script. | Validação no controller (`400`) e triggers que reproduzem o `CHECK`. | `active` fora de `0`/`1` rejeitado na API e no banco. |
| Tipos inválidos (`latitude: true`, `payload_json` objeto) e `device_id` inexistente geravam `500`. | Validação de tipos no controller e verificação do dispositivo no service; violação `UNIQUE` convertida em `409`. | `400` para tipo inválido e `404` para dispositivo inexistente. |

Compilação aprovada e suíte com 46/46 (seis casos novos).

### 7.12 Ajustes definidos na validação (06/10/2026)
Na validação da 7.11, Natã da Silva Baracho recusou a tabela `telemetry_position_repeats` e explicou o papel do ESP32: ele fica no lacre do cilindro, informa se o lacre está fechado, aberto ou rompido e conta as próprias tentativas de envio. Ajustes aprovados:

| Decisão | Implementação |
| --- | --- |
| Guardar o `message_id` da posição repetida sem tabela nova | Coluna `telemetry_queue.last_repeat_message_id` com índice; guarda só a repetição mais recente de cada linha. |
| Avisar o ESP32 que a posição já existe | Resposta `200 Posição já registrada; data e hora atualizadas` (dado novo continua `202`). |
| Estado do lacre na telemetria | Campo `seal_status` (`LOCKED`, `UNLOCKED`, `BROKEN`), validado (`400`) e gravado em coluna própria. |
| Rompimento no mesmo lugar não pode se perder | Só é repetição quando posição **e** `seal_status` são iguais; mudança de estado gera nova linha. |
| Tentativas de envio do ESP32 | `attempt_count` do payload vai para `device_attempt_count` (telemetria e eventos), inteiro ≥ 0; `attempt_count` da fila continua sendo do Worker. |

Compilação aprovada, suíte com 50/50 (quatro casos novos) e Roteiro de Teste v1.2 executado de ponta a ponta. Validação registrada em [Relatorio-de-Teste-2026-10-06-15h14.md](Doc_tese/Relatorio-de-Teste-2026-10-06-15h14.md), **aprovada por Natã da Silva Baracho**.

### 7.13 Teste completo no banco real e remoção do `sqlite3` (06/10/2026)
- Como foi testado: Roteiro de Teste v1.2 executado por completo no `oxide.db` real, com backup antes e restauração depois. O checksum SHA-256 do banco foi igual antes e depois. O FluxID ficou fora desta rodada por decisão do responsável.
- Resultado: compilação sem erros, suíte 50/50, 77 respostas HTTP iguais ao esperado e todas as verificações de banco conforme. A migração das colunas novas funcionou no banco real.
- Achado fora do roteiro: o `npm audit` aponta 3 vulnerabilidades altas no `nodemon` (via `chokidar`/`braces`), ferramenta usada só no `npm run dev`. O conserto automático rebaixaria o `nodemon`, por isso não foi aplicado.
- Correção: a dependência `sqlite3`, que não era usada (a API usa `better-sqlite3`), foi removida. Uma rodada curta repetiu compilação, suíte (50/50) e `npm start` (`GET /` → `200`). Uma instalação do zero (`npm ci`) também foi testada e o `better-sqlite3` carregou normalmente.
- Validação registrada em [Relatorio-de-Teste-2026-10-06-15h49.md](Doc_tese/Relatorio-de-Teste-2026-10-06-15h49.md), **aprovada por Natã da Silva Baracho**.

### 7.14 Entrega A — segurança (06/10/2026)
Decisões de Natã da Silva Baracho, considerando que a API precisa ficar aberta para a equipe e para o montador do lacre testar sem impedimento:

| Achado | Decisão | Implementação |
| --- | --- | --- |
| SEG-01: `GET /devices` expunha `api_key` | Rotas continuam abertas, sem a chave nas respostas | `DeviceService` devolve o dispositivo sem `api_key`; Swagger atualizado |
| AUT-08/09: telemetria e eventos aceitavam chave de outro dispositivo | Exigir a chave do próprio `device_id` | `apiKeyDeviceMiddleware` nas rotas `POST /iot/telemetries` e `POST /iot/events` (`403`) |
| SEG-04: evento criava dispositivo com chave previsível | Remover a criação automática | `ensureDeviceExists` removido; dispositivo não cadastrado recebe `404` |
| SEG-02: `POST /devices` aberto | Manter aberto | Provisório até o Worker trazer o cadastro oficial do FluxID |
| SEG-03: listagem geral de telemetrias | Manter | Equipe acompanha os testes de todos os lacres |

Na mesma entrega, este documento foi reorganizado em duas partes para servir de guia a quem programa o ESP32. Compilação aprovada, suíte com 52/52 (dois casos novos) e Roteiro de Teste v1.4 executado por completo no `oxide.db` real, com checksum idêntico antes e depois. Validação registrada em [Relatorio-de-Teste-2026-10-06-17h35.md](Doc_tese/Relatorio-de-Teste-2026-10-06-17h35.md), **aprovada por Natã da Silva Baracho**.

## 9. Suíte de testes automatizados (`npm test`)

A suíte `tests/api.test.ts` cobre hoje 52 casos de ponta a ponta:

1. **Geral & Documentação:** `/`, `/api-docs/` e `/api-docs/swagger-ui-init.js`.
2. **Dispositivos:** listagem e busca sem `api_key`, `404`, validação `400`, criação `201`, `device_id` duplicado (`409`), `api_key` já usada (`409`) e `active` inválido (`400`).
3. **Autenticação:** `401` sem header, `401` com chave inválida, `403` para dispositivo inativo e `200` com chave válida.
4. **Telemetria:** campos obrigatórios (`400`), payload válido (`202`), `message_id` duplicado (`409`), posição repetida (`200`, sem nova linha), posição nova (nova linha), reenvio de posição repetida (`409`), `attempt_count` em `device_attempt_count`, tipo inválido (`400`), dispositivo inexistente (`404`), chave de outro dispositivo (`403`), `seal_status` inválido (`400`), mudança do lacre na mesma posição (nova linha), `attempt_count` negativo (`400`) e JSON malformado (`400`).
5. **Eventos:** sem chave (`401`), campos obrigatórios (`400`), `seal_status` inválido (`400`), evento válido (`202`), `attempt_count` em `device_attempt_count`, dispositivo não cadastrado (`404`, sem criação), chave de outro dispositivo (`403`) e duplicidade (`409`).
6. **Comandos:** sem chave (`401`), chave de outro dispositivo (`403`), pendentes (`200`), status inválido (`400`), comando inexistente (`404`), confirmação (`200`), reconfirmação (`409`) e lista após confirmação.
7. **Alertas:** sem chave (`401`), chave de outro dispositivo (`403`), tipo inválido (`400`), `status_id` inexistente (`400`), criação (`201`) e duplicidade (`409`).
8. **Limpeza:** remoção dos registros `DSP-TEST%` ao final.

### Correção no cadastro de dispositivos (fase inicial)
- Problema: quando `active` era omitido, o valor chegava como `undefined`, virava `NULL` e violava o `NOT NULL` (erro `500`).
- Correção: valores padrão `device.active ?? 1` e `device.firmware_version ?? null`.
