# API Oxide (ESP32) — Desenvolvimento

Este documento tem três partes:

- **Parte 1 — Como a API funciona:** guia para a equipe. Explica o papel de cada parte, como o lacre se conecta, o que a API faz com cada mensagem e onde cada dado fica.
- **Parte 2 — Histórico de desenvolvimento e testes:** registro do que foi construído, dos erros corrigidos e dos testes executados (material da tese). A numeração original das seções foi mantida para que as referências dos relatórios continuem válidas.
- **Parte 3 — Histórico de PRs por funcionalidade:** o que cada pull request mudou, separado em API, Oxide, FluxID e Worker.

Documentos relacionados:

- [Guia-Firmware-Lacre-IoT.md](Guia-Firmware-Lacre-IoT.md): o contrato entre o lacre e a API (o que enviar, quando, respostas, fila sem rede e C++).
- [Contrato-Entrega-Supabase.md](Contrato-Entrega-Supabase.md): o que a API envia ao banco principal e o que espera de volta.
- [Oxidedb.md](Oxidedb.md): o banco local, com as três tabelas.
- [Regras-de-Negocio-e-Banco-Oxide.md](Regras-de-Negocio-e-Banco-Oxide.md): as regras de cada rota.
- [Tipos-de-Erro.md](Tipos-de-Erro.md): catálogo dos códigos de alerta.
- [Doc_tese/PlanoDeTeste.md](Doc_tese/PlanoDeTeste.md) e [Doc_tese/RoteiroDeTeste.md](Doc_tese/RoteiroDeTeste.md): como a API é testada.
- Swagger, com a API rodando: `http://<IP_DA_API>:3000/api-docs`.

Referência histórica (o banco principal seria o FluxID em PostgreSQL; hoje é o Supabase): [Banco_FluxID.md](Banco_FluxID.md), [Integracao-Oxide-FluxID.md](Integracao-Oxide-FluxID.md), [Contrato-API-Frontend.md](Contrato-API-Frontend.md) e [ESP32-envio-de-dados.md](ESP32-envio-de-dados.md).

---

# Parte 1 — Como a API funciona

## 1.1 O papel de cada parte

```text
Lacre (ESP32: GPS + rede + sensor do lacre)
   ↓  HTTP + JSON, com a chave do dispositivo
API (Node.js + TypeScript): confere a chave, valida e interpreta
   ↓
Oxide (SQLite, oxide.db): fila local, com 3 tabelas
   ↓  ↑ (dispositivos e comandos)
Worker (npm run worker)
   ↓  API REST, por uma função de recebimento
Supabase: banco principal, usado pelo frontend
```

### Quem faz o quê: API, Oxide, Worker e banco principal

| Parte | O que é |
| --- | --- |
| **API** | O programa Node.js + TypeScript (`src/`) que conversa com o lacre |
| **Oxide** | O banco local `oxide.db` (SQLite), usado pela API como fila |
| **Worker** | Programa que leva a fila ao banco principal e traz de lá os dispositivos e os comandos (`src/worker/`, `npm run worker`) |
| **Banco principal** | O Supabase do projeto do frontend (`fluxid_integra2026`), mantido pelo professor Alisson |

**API — faz hoje**
- Recebe por HTTP as leituras, os eventos, os alertas e as confirmações de comando do lacre.
- Autentica cada dispositivo pela `X-API-Key`, que precisa ser do próprio `device_id`. Dispositivo vindo do banco principal é conferido pelo hash da chave.
- Exige **posição e bateria** em toda leitura, evento e alerta. Sem sinal de GPS, aceita a última posição conhecida com `gps_ok: false`.
- Evita duplicidade pelo `message_id` e não grava de novo uma posição repetida: só atualiza a data e a hora.
- Abre sozinha os alertas que saem da própria mensagem: bateria baixa, sinal fraco e lacre aberto ou rompido. Cada um abre uma vez, na mudança.
- Entrega ao lacre os comandos da válvula e recebe a confirmação.
- Mostra as últimas mensagens (`GET /iot/messages`), a situação da fila (`/sync/*`) e a saúde (`GET /health`).

**API — não faz** (é do sistema principal)
- Não atende o frontend.
- Não guarda lacre, cilindro, cliente nem vínculos.
- Não aplica regras de rota, de geocerca nem de tempo sem comunicar.
- Não trata alertas (analisar, justificar, encerrar).

**Oxide — faz hoje**
- É a **fila local**: a tabela `mensagens` guarda tudo o que o lacre manda até o Worker entregar. Se o banco principal estiver fora do ar, nada se perde.
- Guarda os dispositivos autorizados (`devices`), com o último estado recebido de cada um, e os comandos (`commands`).
- É criada e migrada sozinha quando a API inicia. Um banco do modelo antigo ganha uma cópia de segurança antes de mudar ([Oxidedb.md](Oxidedb.md), seção 4).

**Worker — faz hoje**
- Envia a fila ao banco principal em lotes, pela API REST, e marca cada mensagem conforme a resposta.
- Tentativas: envio inicial e mais 5, esperando 1 min, 5 min, 15 min, 1 h e 6 h; depois deixa a mensagem parada para o gestor. Banco principal fora do ar não gasta tentativa.
- Traz do banco principal a lista de dispositivos, com o hash da chave (a cada 5 min), e os comandos pendentes (a cada rodada).

**Banco principal (Supabase) — faz**
- Guarda o cadastro oficial e tudo o que é de negócio: empresas, pessoas, cilindros, clientes, geocercas, frota e, na parte do lacre, dispositivos, posições, alertas e comandos.
- Recebe as mensagens por uma função de recebimento, conforme [Contrato-Entrega-Supabase.md](Contrato-Entrega-Supabase.md). **Essa função e as tabelas do lacre ainda não estão no repositório do frontend.**

## 1.2 Como o lacre se conecta

| Item | Valor |
| --- | --- |
| Protocolo | HTTP com JSON |
| Endereço | `http://<IP_DA_API>:3000/api/v1` |
| Autenticação | Cabeçalho `X-API-Key` com a chave do dispositivo |
| Identificação | `device_id` no corpo de toda mensagem |

O contrato completo, com exemplos em C++ no estilo do firmware, está em [Guia-Firmware-Lacre-IoT.md](Guia-Firmware-Lacre-IoT.md).

## 1.3 Cadastro do dispositivo

- **Oficial:** feito no sistema principal. O Worker copia a lista para a Oxide a cada 5 minutos, com o hash da chave.
- **Provisório, para testes de bancada:**

  ```http
  POST http://<IP_DA_API>:3000/api/v1/devices
  Content-Type: application/json

  { "device_id": "DSP-TESTE-01", "api_key": "chave-de-teste-01", "firmware_version": "1.0.0" }
  ```

Não existe criação automática: mensagem de dispositivo não cadastrado responde `404`.

## 1.4 Rotas usadas pelo lacre

| Rota | Para quê | Campos obrigatórios |
| --- | --- | --- |
| `POST /iot/telemetries` | Leitura periódica | `message_id`, `device_id`, `latitude`, `longitude`, `battery_percent` |
| `POST /iot/events` | Algo aconteceu | os mesmos e `event_type` |
| `POST /iot/alerts` | Problema identificado pelo lacre | `alert_id`, `device_id`, `alert_type`, `title`, `latitude`, `longitude`, `battery_percent` |
| `GET /iot/commands/{deviceId}` | Buscar comandos pendentes | — |
| `POST /iot/commands/confirm` | Confirmar o comando | `command_id`, `device_id`, `status` |

### Leitura — exemplo

```json
{
  "message_id": "MSG-DSP000001-000123",
  "device_id": "DSP-000001",
  "latitude": -7.209194,
  "longitude": -39.306367,
  "gps_ok": true,
  "battery_percent": 87,
  "seal_status": "LOCKED",
  "satelites": 9,
  "hdop": 0.9
}
```

## 1.5 O que o firmware faz com cada resposta

| Resposta | Significado | O que o firmware faz |
| --- | --- | --- |
| `200`, `201`, `202` | Recebido | Apagar da fila local e seguir |
| `409` | Já recebido antes | Tratar como sucesso; não reenviar |
| `400` | Corpo inválido (ex.: sem posição ou sem bateria) | Não reenviar; é erro do firmware |
| `401`, `403`, `404` | Chave errada, de outro dispositivo, dispositivo desativado ou não cadastrado | Não insistir; avisar a equipe |
| `500` ou sem resposta | Problema no servidor ou na rede | Reenviar a mesma mensagem, com o mesmo `message_id` |

## 1.6 Regras do `message_id` e do reenvio

- `message_id` é único por mensagem; no alerta, o `alert_id` faz esse papel.
- Reenvio usa o mesmo `message_id`. A API responde `409` e não grava de novo.
- Leitura com a mesma posição e o mesmo estado do lacre da anterior responde `200`: a API atualiza a leitura anterior e não cria outra.

## 1.7 Ciclo de comandos

```text
Sistema principal cria o comando
   ↓  Worker traz (a cada rodada)
Oxide: commands (PENDENTE)
   ↓  lacre busca: GET /iot/commands/{deviceId}
Lacre executa
   ↓  lacre confirma: POST /iot/commands/confirm (EXECUTADO ou ERRO)
Oxide: comando concluído + mensagem CONFIRMACAO_COMANDO na fila
   ↓  Worker envia
Sistema principal fica sabendo do resultado
```

## 1.8 Onde cada dado fica

| Dado | Onde |
| --- | --- |
| Mensagem do lacre, já validada | `mensagens.payload_json` (o mesmo JSON que vai para o banco principal) |
| Tipo da mensagem | `mensagens.tipo`: `TELEMETRIA`, `EVENTO`, `ALERTA` ou `CONFIRMACAO_COMANDO` |
| Hora de chegada | `mensagens.received_at` |
| Situação do envio | `mensagens.status`, `attempt_count`, `last_error`, `next_attempt_at` e `synced_at` |
| Último estado do lacre | `devices.last_*` (contato, posição, GPS, lacre, bateria e sinal) |
| Comando e resultado | `commands` |
| Última rodada do Worker | arquivo `oxide-worker.json`, ao lado do banco |

### Estados da fila

| Estado | Significado |
| --- | --- |
| `PENDING` | Pronta para enviar |
| `PROCESSING` | Sendo enviada |
| `SYNCED` | Gravada no banco principal |
| `ERROR` com próxima tentativa | Falhou; nova tentativa marcada |
| `ERROR` sem próxima tentativa | Parada: precisa do gestor |
| `ARQUIVADA` | Veio do modelo antigo sem posição ou bateria; não é enviada |

### Rodar o Worker

1. Copie `.env.example` para `.env` e preencha `SUPABASE_IOT_URL` e `SUPABASE_SERVICE_KEY`. A chave fica só no `.env`, que não vai para o Git.
2. Em outro terminal, ao lado da API: `npm run worker` (Ctrl+C encerra ao fim da rodada) ou `npm run worker -- --once` (uma rodada).
3. Acompanhe em `GET /api/v1/sync/status` e `GET /health`.

### Simular um lacre (`npm run simular`)

Faz o percurso completo de um lacre e confere cada passo:
- cadastro vindo do banco principal;
- leituras com posição e bateria, e as recusas sem elas;
- posição repetida e mensagem duplicada;
- GPS sem sinal;
- alertas automáticos;
- banco principal fora do ar e reenvio sem duplicar;
- comando da válvula e confirmação.

Roda numa pasta temporária, com uma `oxide.db` nova, a própria API na porta 3199 e um **recebedor de teste** no lugar do Supabase. O `oxide.db` do projeto não é tocado, e a sua API pode continuar rodando.

### Saúde, backup e retenção

| Comando ou rota | Para quê |
| --- | --- |
| `GET /health` | Situação da API, da fila e do Worker. Responde 200 ou 503 |
| `npm run backup` | Cópia consistente da `oxide.db` em `backups/`; mantém as 14 mais novas |
| `npm run retencao` | Mostra o que sairia: só o que **já foi enviado** há mais de 30 dias. Para apagar: `npm run retencao -- --confirmar` |

## 1.9 O que ainda não existe

- Teste contra o Supabase de verdade: depende da função de recebimento e das tabelas do lacre no projeto do frontend.
- Envio HTTP ligado no firmware (o contrato está no guia do firmware 2.0) e a leitura da bateria no lacre.
- Controle por perfil nas rotas abertas da equipe (`/devices`, `/iot/messages` e `/sync`).
- HTTPS e limite de requisições.

## 1.10 Estado atual

- API, fila única e Worker implementados e testados pela IA em 10/10/2026: suíte com 71/71 e simulador com 23/23, contra um recebedor de teste. **Aprovado por Natã da Silva Baracho em 10/10/2026** (seção 7.26).
- O banco principal passou a ser o Supabase. O FluxID em PostgreSQL ficou como banco de teste.
- Próximos passos:
  - o professor Alisson cria a função de recebimento e passa o endereço;
  - o Simão liga o envio no firmware;
  - primeiro teste de ponta a ponta com o Supabase.

---

# Parte 2 — Histórico de desenvolvimento e testes

Registro em ordem cronológica. Descreve o estado da API **no momento de cada registro**; quando um comportamento mudou depois, há uma nota indicando a mudança. Para o comportamento atual, use a Parte 1.

## 2.1 Estrutura do código (referência para quem mantém a API)

| Pasta/arquivo | Conteúdo |
| --- | --- |
| `src/server.ts` | Inicializa o Express, registra rotas, Swagger e o tratamento de erros |
| `src/database/connection.ts` | Conexão `better-sqlite3`, criação de tabelas e migrações automáticas |
| `src/Middleware/` | `apiKeyMiddleware.ts` (chave válida, chave do próprio dispositivo) e `Errohandler.ts` |
| `src/routes/` | Rotas de dispositivos, telemetria, eventos, comandos, alertas e associação (`assetRoutes.ts`: lacres, cilindros e vínculos) |
| `src/controllers/` | Validação do payload e montagem das respostas HTTP |
| `src/services/` | Regras de negócio (duplicidade, posição repetida, cadastro) |
| `src/repositories/` | Consultas SQL de cada tabela (inclui `SealRepository`, `CylinderRepository` e `AssignmentRepository`) |
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

### 7.15 Entrega C — severidade dos alertas e faixa de coordenadas (06/10/2026)
Decisões de Natã da Silva Baracho:

| Achado | Decisão | Implementação |
| --- | --- | --- |
| ALT-12: `severity_id` e `status_id` apontavam para a tabela `status`, que só tem estados de dispositivo/lacre | Severidade e status em texto, com os mesmos valores do FluxID | Colunas `severity` (`BAIXA`, `MEDIA`, `ALTA`, `CRITICA`) e `status` (`ABERTO`, `EM_ANALISE`, `ENCERRADO`) com `CHECK`; severidade padrão por tipo; status sempre `ABERTO` na criação |
| Firmware antigo envia `status_id`/`severity_id` | Não quebrar o ESP32 | Campos ignorados |
| Bancos com a tabela `alerts` antiga | Preservar os alertas | Migração automática e transacional em `connection.ts` |
| TEL-13: coordenadas fora da faixa aceitas | Rejeitar | `400` para latitude fora de -90 a 90, longitude fora de -180 a 180 ou só uma das duas; `0,0` continua aceito |

Compilação aprovada, suíte com 55/55 (três casos novos e um substituído), migração testada com alertas antigos gravados e Roteiro de Teste v1.5 executado por completo no `oxide.db` real, com checksum idêntico antes e depois. Validação registrada em [Relatorio-de-Teste-2026-10-06-19h28.md](Doc_tese/Relatorio-de-Teste-2026-10-06-19h28.md), **aprovada por Natã da Silva Baracho**.

### 7.16 Entrega E — banco FluxID e plano de integração (06/10/2026)
- Análise do dump `FluxID.sql` e do `Banco_FluxID.md`: estrutura coerente com as regras de negócio, documento desatualizado em contagens, valores aceitos e índices, e massa de testes com incoerências de negócio e nomes de empresas reais.
- Decisões de Natã da Silva Baracho: scripts versionados em `sql/fluxid/` (001 estrutura, 002 massa), chave do dispositivo guardada como hash no FluxID, nomes fictícios Alfa e Beta Gases, correção dos cilindros reprovados e dos lacres violados, ativos livres para a Beta e matriz de perfis e permissões.
- Validação: servidor PostgreSQL 18.6 temporário, separado do banco principal (o Docker ficou para depois, por exigir habilitar a virtualização na BIOS; passou a funcionar em 07/10/2026, seção 7.22). Dump restaurado sem erros; scripts executados duas vezes (a segunda sem alterações); coerência e regras novas conferidas; servidor apagado ao final.
- Documentos: `Banco_FluxID.md` v3.1 e novo `Integracao-Oxide-FluxID.md`, com as tabelas de conversão e as decisões pendentes P1 a P8 para o Worker.
- Validação registrada em [Relatorio-de-Teste-2026-10-06-20h00.md](Doc_tese/Relatorio-de-Teste-2026-10-06-20h00.md), **aprovada por Natã da Silva Baracho**.
- Ocorrência no envio: logo após o merge do PR #4, um revert (PR #5) foi mesclado sem intenção e desfez a entrega na `main`. O conteúdo foi reaplicado sem nenhuma alteração por um novo pull request, conferido como idêntico ao aprovado.

### 7.17 Entrega D — catálogo de comandos e tipos de erro (06/10/2026)
Decisões de Natã da Silva Baracho:

| Tema | Decisão | Implementação |
| --- | --- | --- |
| Tipos de comando | Só `TRAVAR_VALVULA` e `DESTRAVAR_VALVULA` | `models/Command.ts` e `CHECK` na tabela `commands` |
| Regra no banco | Comando `PENDENTE` só com tipo do catálogo; histórico pode guardar tipos antigos; status só `PENDENTE`, `EXECUTADO`, `ERRO` | `CHECK` com migração automática e transacional |
| Comandos antigos | `LOCK_VALVE` → `TRAVAR_VALVULA`; `UNLOCK_VALVE` → `DESTRAVAR_VALVULA`; pendente desconhecido → `ERRO` "tipo de comando descontinuado" | Migração em `connection.ts` |
| Criação de comandos | Sem rota aberta (risco de destravar válvula) | Criação pelo banco até os comandos automáticos |
| Onde ficam | Só na Oxide | Tabela no FluxID decidida na fase do Worker |
| Tipos de erro | Catálogo único de ocorrências operacionais, em português | Novo `Doc/Tipos-de-Erro.md` v1.0 com 27 códigos, regras de posição e trânsito e fluxo da saída de rota |

Regras de operação definidas no catálogo: o lacre não sai de 10 m do destino final; o cilindro não sai da rota sem desvio justificado antes ou programado (alerta ao motorista e ao gestor, justificativa do motorista, liberação só pelo gestor); em trânsito o lacre fica sempre fechado. Decidido também que o `alert_type` da Oxide passará a usar os códigos em português.

Compilação aprovada, suíte com 57/57 (dois casos novos), migração testada com comandos antigos e Roteiro de Teste v1.6 executado por completo no `oxide.db` real, com checksum idêntico antes e depois. Validação registrada em [Relatorio-de-Teste-2026-10-06-20h35.md](Doc_tese/Relatorio-de-Teste-2026-10-06-20h35.md), **aprovada por Natã da Silva Baracho**.

### 7.18 Entrega B — associação dispositivo → lacre → cilindro (06/10/2026)
Decisões de Natã da Silva Baracho:

| Tema | Decisão | Implementação |
| --- | --- | --- |
| Onde a associação vive | Cópia provisória na Oxide, nos mesmos códigos e estados do FluxID | Tabelas `seals`, `cylinders`, `seal_assignments`, `cylinder_assignments` |
| Regras | RN04, RN05; conflito `409`; nada apagado (RN21) | Índices únicos parciais `ended_at IS NULL`; encerrar = preencher `ended_at` e `end_reason` |
| Troca | `replace: true` encerra e cria na mesma operação | Transação em `AssignmentService` |
| Estado do lacre | Segue o vínculo: `INSTALADO` ao instalar (só de `EM_ESTOQUE`/`REMOVIDO`), `REMOVIDO` ao sair | `AssignmentService` e `SealService` |
| Rotas | Abertas e provisórias, como `/devices` | `/seals`, `/cylinders`, `/assignments`, no Swagger (grupo "Associação") |
| Telemetria | `lacre_id`/`cilindro_id` sempre do vínculo ativo | `TelemetryService` |
| Erros do catálogo | Só registrar, sem alerta | Coluna `error_type` em `telemetry_queue` e `events`; novo código `DISPOSITIVO_SEM_LACRE` |

Compilação aprovada, suíte com 71/71 (14 casos novos) executada duas vezes seguidas e Roteiro de Teste v1.7 executado por completo no `oxide.db` real: as 67 respostas anteriores idênticas à rodada da entrega D e as 17 da nova seção 5.9 conforme, com checksum idêntico antes e depois. Validação registrada em [Relatorio-de-Teste-2026-10-06-21h31.md](Doc_tese/Relatorio-de-Teste-2026-10-06-21h31.md), **aprovada por Natã da Silva Baracho**.

### 7.19 Decisões P1 a P8 da integração com o FluxID (06/10/2026)
Natã da Silva Baracho fechou as decisões pendentes do plano de integração (seção 5 de [Integracao-Oxide-FluxID.md](Integracao-Oxide-FluxID.md), v1.1):

- **P1:** a Oxide não envia data; o FluxID grava sempre a hora de chegada.
- **P2:** telemetria sem GPS vai para uma quarentena separada no FluxID, só armazenada. A tabela principal continua exigindo posição, porque alimenta o mapa do dashboard.
- **P3:** evento sem lacre vinculado espera o vínculo.
- **P4:** eventos sem estado de lacre vão para uma tabela de eventos do dispositivo.
- **P5:** o FluxID aceita todos os códigos do catálogo de erros como tipo de alerta.
- **P6:** o Worker faz 5 tentativas com espera crescente e depois deixa o dado para o gestor.
- **P7:** a API Oxide gera o alerta e o código.
- **P8:** o Worker só marca suspeita de violação, e o gestor confirma.
- O alerta aparece no mapa na posição atual do lacre.

Nenhum código foi alterado: as decisões orientam a entrega do Worker. Registro conferido por questionário (6/6 sim), **aprovado por Natã da Silva Baracho** em 06/10/2026.

### 7.20 Alertas em português, análise e encerramento (06/10/2026)
Decisões de Natã da Silva Baracho:

| Tema | Decisão | Implementação |
| --- | --- | --- |
| Tipos aceitos | Os 28 códigos do catálogo `Tipos-de-Erro.md` (mesma lista do FluxID, P5) | `alertTypes` em `models/Alert.ts`; `CHECK` em `alerts.alert_type` |
| Transição | Nomes antigos em inglês aceitos e gravados em português, até nova decisão | `normalizeAlertType` |
| Severidade padrão | A sugerida no catálogo (`SEM_COMUNICACAO` passa de `MEDIA` para `ALTA`) | `defaultSeverityByType` |
| Alertas já gravados | Migração automática; tipo desconhecido vira `DISPOSITIVO_FALHA` com o original na descrição | `migrateAlertTypes` em `connection.ts` |
| Analisar e encerrar | `PATCH /iot/alerts/{alert_id}/status`; `ABERTO` → `EM_ANALISE` → `ENCERRADO` ou direto; `ENCERRADO` é final; encerrar exige `resolved_by` e `resolution_note` | `AlertService`; colunas novas; `CHECK` de `ENCERRADO` com data |
| Listagem | `GET /iot/alerts` com filtros `status` e `device_id` | `AlertRepository.list` |
| Acesso | Rotas abertas e provisórias, como `/devices` | `alertRoutes.ts` |

Compilação aprovada, suíte com 86/86 (15 casos novos) em quatro rodadas, migração testada em cópias do banco (formato anterior à entrega C e formato das entregas C a B), BD-14 com 86/86 num banco criado só pelo script do `Oxidedb.md` e Roteiro de Teste v1.8 completo no `oxide.db` real, com checksum idêntico antes e depois e as demais seções idênticas à rodada da entrega B. Validação registrada em [Relatorio-de-Teste-2026-10-06-23h40.md](Doc_tese/Relatorio-de-Teste-2026-10-06-23h40.md), **aprovada por Natã da Silva Baracho**.

### 7.21 FluxID: alerta sempre ligado ao lacre e ao cilindro (07/10/2026)
Decisão de Natã da Silva Baracho, só no banco FluxID (a Oxide não muda): todo alerta tem **cilindro e lacre obrigatórios**, os do vínculo válido no momento do alarme (`aberto_em`). Exceções, só para códigos de cadastro: sem cilindro, `LACRE_SEM_CILINDRO`, `DISPOSITIVO_SEM_LACRE`, `DISPOSITIVO_NAO_CADASTRADO` e `CHAVE_INVALIDA`; sem lacre, só os três últimos. Motivo: o par lacre + cilindro gravado no alerta permite à auditoria descobrir se o lacre está num cilindro que não é o do cliente.

O script `sql/fluxid/003_alertas_cilindro_obrigatorio.sql` preenche os alertas sem cilindro pelo vínculo da data, para tudo se sobrar algum alerta fora da regra e cria o `CHECK`. Foi validado num PostgreSQL 18.6 temporário (porta 54329, porque a 55432 caiu numa faixa reservada do Windows): os 10 alertas de teste foram preenchidos, a segunda execução não alterou nada, as regras foram confirmadas e a parada segura não alterou nada. O script das decisões P1 a P8 passa a ser o `004`. Validação registrada em [Relatorio-de-Teste-2026-10-07-00h15.md](Doc_tese/Relatorio-de-Teste-2026-10-07-00h15.md), **aprovada por Natã da Silva Baracho**.

### 7.22 Swagger em grupos e FluxID no Docker (07/10/2026)
- **Swagger:** as rotas antigas não tinham grupo e apareciam em "default", ao lado do grupo "Associação". Decisão de Natã da Silva Baracho: 8 grupos com uma frase de explicação cada (Dispositivos, Telemetria, Eventos, Comandos, Alertas, Lacres, Cilindros e Vínculos) e um teste na suíte que barra rota sem grupo (GER-06). Só documentação: nenhuma rota mudou de comportamento.
- **Docker:** com a virtualização habilitada, o Docker Desktop passou a funcionar. O FluxID de análise roda no container `fluxid-analise` (imagem `postgis/postgis:18-3.6`, porta `127.0.0.1:54329`, senha gerada na hora e não registrada), com o banco `FluxID_original` (dump sem alteração) e o `FluxID_db` (dump + `001`, `002` e `003`), para consulta no pgAdmin. Os três scripts deram o mesmo resultado do servidor temporário.
- **Dump:** o `FluxID.sql` passou da raiz para `sql/fluxid/FluxID.sql`, junto dos scripts (conteúdo idêntico, mesmo SHA-256).

Compilação aprovada, suíte com 87/87 em duas rodadas e teste negativo da regra de grupos. Validação registrada em [Relatorio-de-Teste-2026-10-07-00h45.md](Doc_tese/Relatorio-de-Teste-2026-10-07-00h45.md), **aprovada por Natã da Silva Baracho**.

### 7.23 Integração Oxide ⇄ FluxID: Worker, chave por hash e estruturas do frontend (07/10/2026)
Pedido de Natã da Silva Baracho: deixar pronto tudo do lacre e da integração da API com os dois bancos, com o `FluxID_db` como banco definitivo; replicar no FluxID o que o frontend usa, integrado com a Oxide; atualizar os documentos e gerar um relatório para validação. O teste formal da IA foi adiantado para a mesma madrugada (Roteiro v1.10 completo, sem falhas).

| Parte | O que foi feito |
| --- | --- |
| FluxID, script `004` | Decisões P1 a P8 no banco: datas automáticas, lacre e cilindro na telemetria, quarentena, eventos do dispositivo, tipos de alerta do catálogo, colunas da Oxide nos alertas e gatilho do par lacre + cilindro (FLX-26) |
| FluxID, script `005` | Estruturas do frontend: tipos e identificadores de cilindro, laudo e retificação do teste hidrostático, histórico imutável do cilindro alimentado pela Oxide |
| Worker (`src/worker/`) | Envio de telemetria, eventos e alertas; tentativas; espera do P3; cadastro de volta (dispositivos, lacres, cilindros, vínculos, hash) |
| API | Chave por hash; alerta volta à fila ao mudar de status; rotas `/api/v1/sync/*`; grupo "Sincronização" no Swagger |
| Oxide | Colunas `next_attempt_at`, `sync_*` nos alertas, `api_key_hash`, `fluxid_id`; tabela `sync_logs` |
| Testes | 7 casos novos na suíte (94 no total) |

Verificação técnica da IA (não substitui o teste formal): compilação; suíte 94/94 em duas rodadas e num banco criado só pelo script do `Oxidedb.md`; scripts `001` a `005` em banco novo no Docker, com nova execução sem mudança; Worker contra o FluxID do Docker, com uma cópia do `oxide.db`. Teste formal (Roteiro v1.10 completo) sem falhas. Detalhes em [Relatorio-de-Teste-2026-10-07-01h30.md](Doc_tese/Relatorio-de-Teste-2026-10-07-01h30.md). Questionário com 15/15 sim: **aprovada por Natã da Silva Baracho** em 07/10/2026.

### 7.24 Simulador do lacre e série do cilindro (07/10/2026)
Pedido de Natã da Silva Baracho: simular um lacre de ponta a ponta e um operador do sistema, com todos os erros e alertas, fila e GPS sem sinal.

- **Simulador** (`src/simulador/`, `npm run simular`, CSV em `simulador/`):
  - roda num `oxide.db` novo e numa API própria, contra o FluxID de análise no Docker, e recusa outro banco;
  - geocerca e rota automáticas e o operador pelo frontend ficaram para depois (combinado).
- **Achado A3**, corrigido com a aprovação de Natã: "a API deve identificar pelo identificador do lacre".
  - O problema: na Oxide, a série do cilindro era única no banco inteiro; no FluxID, é única só dentro da empresa. Na segunda rodada da simulação, os cilindros de uma empresa nova com as mesmas séries não chegaram à Oxide.
  - A correção: na Oxide, a série deixa de ser única. O cilindro continua identificado pelo código e encontrado pelo lacre. A tabela `cylinders` é recriada preservando os dados.
  - O cadastro provisório `POST /api/v1/cylinders` passa a aceitar série repetida; o código repetido continua com `409`.
- **Testes:**
  - simulação com 58/58 em duas rodadas seguidas;
  - migração testada numa cópia no formato antigo;
  - suíte 96/96;
  - Roteiro v1.10 completo no `oxide.db` real, com as mesmas 98 respostas HTTP e checksum idêntico.

Relatório: [Relatorio-de-Teste-2026-10-07-18h45.md](Doc_tese/Relatorio-de-Teste-2026-10-07-18h45.md). Questionário 7/7 sim: **aprovado por Natã da Silva Baracho** em 07/10/2026.

### 7.25 Sistema completo sobre o FluxID e documentação final (07 a 09/10/2026)
- **Sistema completo (07/10):** a pedido de Natã, a IA implementou numa branch o script `006` do FluxID, uma API para o frontend (`/api/v1/app`), alertas automáticos (incluindo rota e geocerca) e rotinas de manutenção. Os testes da IA passaram (108/108, 45/45 e 65/65). **A branch não entrou na `main`:** na avaliação seguinte, a equipe descobriu que o banco principal é o Supabase do frontend e que a API não atenderia o frontend. O trabalho ficou guardado no GitHub como `arquivo/sistema-completo`. Relatório: `Relatorio-de-Teste-2026-10-07-23h45.md`, nessa branch.
- **Documentação final (08/10, PR #19):** pasta `DocumentacaoFinal/` com 19 registros de uso de IA e validação humana (Template 7 do evento INTEGRA 2026), um por parte do projeto.

### 7.26 Oxide enxuta, fila única e envio ao Supabase (10/10/2026)
Decisões de Natã da Silva Baracho, com as respostas do professor Alisson:

| # | Decisão |
| --- | --- |
| 1 | O banco principal é o Supabase do projeto `fluxid_integra2026`. O FluxID em PostgreSQL fica só como teste |
| 2 | A API não atende o frontend. Ela recebe os dados do lacre, interpreta e envia ao banco principal |
| 3 | O envio é pela API REST do Supabase, com a chave `service_role`, por uma função de recebimento |
| 4 | A Oxide fica com uma fila mínima: de 11 para 3 tabelas |
| 5 | As rotas do lacre continuam as mesmas |
| 6 | Posição e bateria são obrigatórias em toda mensagem. Sem sinal de GPS, vale a última posição com `gps_ok: false` |
| 7 | Regras automáticas: só as que saem da própria mensagem (bateria, sinal e lacre). Rota, geocerca e tempo ficam no sistema principal |
| 8 | Os comandos da válvula e o cadastro dos dispositivos vêm do banco principal |

O que foi feito:
- **Oxide:** tabelas `devices`, `mensagens` (fila única) e `commands`. Migração automática do modelo antigo, com cópia de segurança e remoção das tabelas que saíram. A leitura antiga com posição e bateria segue para o banco principal; o resto fica como `ARQUIVADA`.
- **API:** validação comum de posição e bateria; `gps_ok`; `satelites`, `hdop` e `device_state` aceitos; alertas automáticos abertos na mudança de estado; `GET /iot/messages`; `GET /health`.
- **Worker:** envio em lotes por HTTP, com resultado por mensagem (`stored`, `duplicate`, `rejected`); cadastro de dispositivos e comandos trazidos do banco principal.
- **Removido:** rotas de lacres, cilindros e vínculos; análise e encerramento de alertas; envio ao FluxID; a página da proposta da API do frontend; a dependência `pg`.
- **Manutenção:** `npm run backup` e `npm run retencao`.
- **Documentos:** novo `Contrato-Entrega-Supabase.md`; guia do firmware 2.0, feito a partir do repositório `fluxid-firmware`; `Oxidedb.md` 2.0; regras 2.0.
- **Documentação final do evento:** novo registro 20 em `DocumentacaoFinal/` (Oxide enxuta e envio ao Supabase) e registro 19 atualizado com as respostas do professor Alisson. A pasta passa a ter 20 registros.

Achado: a suíte antiga precisava de uma cópia da `oxide.db` real para rodar. A nova roda numa pasta temporária, com banco novo, e não toca no banco do projeto.

Testes:
- compilação sem erros;
- suíte nova com 71/71;
- simulador novo com 23/23;
- migração testada numa cópia da `oxide.db` real: 1 leitura completa na fila, 17 mensagens sem posição ou bateria arquivadas, 3 dispositivos mantidos e banco íntegro; o original ficou intacto (checksum igual).

**O que não pôde ser testado:** o envio ao Supabase de verdade. A função de recebimento e as tabelas do lacre ainda não estão no repositório do frontend; os testes usaram um recebedor de teste que segue o contrato.

Ajustes pedidos na validação e já feitos:
- as mensagens antigas completas **são enviadas** ao banco principal (antes ficariam todas arquivadas);
- na posição repetida, **só a data e a hora** são atualizadas (antes, também a bateria e o sinal).

Relatório: [Relatorio-de-Teste-2026-10-10-12h40.md](Doc_tese/Relatorio-de-Teste-2026-10-10-12h40.md). Questionário respondido: **aprovado por Natã da Silva Baracho em 10/10/2026**, com duas confirmações pendentes (o código do alerta de lacre aberto e o envio do contrato ao professor Alisson).

## 9. Suíte de testes automatizados (`npm test`)

A suíte `tests/api.test.ts` foi reescrita em 10/10/2026 para o modelo enxuto e cobre 71 casos. Ela roda numa pasta temporária, com uma `oxide.db` nova e um recebedor de teste no lugar do Supabase.

1. **Geral, documentação e banco:** `/`, Swagger, regra de que toda rota tem um grupo, banco com só 3 tabelas e rota antiga removida.
2. **Dispositivos:** cadastro provisório, duplicidades (`409`), validações (`400`) e respostas sem a chave.
3. **Autenticação:** sem chave e chave inválida (`401`), dispositivo inativo e chave de outro dispositivo (`403`), dispositivo não cadastrado (`404`) e cabeçalho em minúsculas.
4. **Telemetria:** leitura válida; campos obrigatórios (posição e bateria); tipos e faixas; `gps_ok`; JSON malformado; `message_id` repetido; posição repetida; posição nova; GPS sem sinal; campos da fila protegidos; listagem de mensagens.
5. **Eventos:** `event_type` obrigatório, posição e bateria obrigatórias, duplicidade e chave.
6. **Alertas enviados pelo lacre:** tipo do catálogo, severidade, título, posição e bateria, nome antigo convertido e duplicidade.
7. **Alertas automáticos:** bateria baixa, sinal fraco e lacre aberto ou rompido, cada um aberto só na mudança; evento também dispara; último estado do dispositivo.
8. **Worker:** configuração obrigatória; banco principal fora do ar e chave recusada sem gastar tentativa; mensagem aceita, recusada e sem resposta; parada depois da sexta falha; nova tentativa pelo gestor; reenvio sem duplicar; posição repetida reenviada; lotes; situação da fila.
9. **Cadastro e comandos do banco principal:** dispositivo só com o hash; troca de chave; dispositivo desativado; comando trazido, buscado e confirmado; avisos; regras do banco.
10. **Saúde:** `/health` com 200 e com 503.
11. **Migração e manutenção:** banco do modelo antigo, backup e retenção.

A suíte anterior (96 casos, modelo com filas separadas e envio ao FluxID) está no histórico do Git até o PR #19.

### Correção no cadastro de dispositivos (fase inicial)
- Problema: quando `active` era omitido, o valor chegava como `undefined`, virava `NULL` e violava o `NOT NULL` (erro `500`).
- Correção: valores padrão `device.active ?? 1` e `device.firmware_version ?? null`.

---

# Parte 3 — Histórico de PRs por funcionalidade

Os PRs até o #19 foram mesclados na `main` entre 06 e 09/10/2026, com validação **aprovada por Natã da Silva Baracho**. O #20 (Oxide enxuta) foi **aprovado por Natã da Silva Baracho** em 10/10/2026. Esta parte e a seção "Quem faz o quê" (1.1) foram conferidas por questionário (6/6 sim) e **aprovadas por Natã da Silva Baracho** em 06/10/2026. O PR que mexeu em mais de uma parte aparece em cada grupo, só com o que mudou naquela parte. A cada novo PR, esta parte é atualizada.

## 3.1 API

| PR | Entrega | O que mudou na API |
| --- | --- | --- |
| #1 | Revisão do plano de teste | Posição repetida → `200` sem nova linha; reenvio dessa posição → `409`; novo `seal_status`; `attempt_count` do ESP32 gravado à parte; `api_key` exclusiva (`409`); `active` só 0 ou 1; tipos inválidos → `400`; dispositivo inexistente → `404` (antes `500`); dependência `sqlite3` removida |
| #2 | A — Segurança | `GET /devices` sem `api_key`; telemetria e eventos exigem a chave do próprio dispositivo (`403`); evento não cria mais dispositivo (`404`) |
| #3 | C — Severidade e coordenadas | Alerta com `severity` (`BAIXA` a `CRITICA`, padrão por tipo) e `status` sempre `ABERTO`; campos antigos ignorados; latitude e longitude fora da faixa ou incompletas → `400` |
| #7 | D — Catálogo de comandos | Comandos só `TRAVAR_VALVULA` e `DESTRAVAR_VALVULA`; leitura e confirmação pelo ESP32 sem mudança; sem rota aberta para criar comando |
| #8 | B — Associação | Rotas `/seals`, `/cylinders` e `/assignments` (abertas e provisórias); troca com `replace`; telemetria recebe lacre e cilindro do vínculo ativo; `error_type` registrado no recebimento |
| #12 | Alertas em português | `alert_type` com os 28 códigos do catálogo (nomes antigos convertidos); severidade padrão do catálogo; `GET /iot/alerts` com filtros; `PATCH /iot/alerts/{alert_id}/status` para analisar e encerrar, com quem e motivo |
| #14 | Swagger em grupos | 8 grupos com explicação (Dispositivos, Telemetria, Eventos, Comandos, Alertas, Lacres, Cilindros, Vínculos), sem grupo "default"; teste que barra rota sem grupo |
| #15 | Integração Oxide ⇄ FluxID | Chave por hash; alerta volta à fila ao mudar de status; rotas `/sync/*` e grupo "Sincronização" |
| #17 | Simulador e série do cilindro | Cadastro provisório de cilindro aceita série repetida (o código continua único); simulador `npm run simular` |
| #20 | Oxide enxuta e envio ao Supabase | Posição e bateria obrigatórias em toda mensagem; `gps_ok`; alertas automáticos da própria mensagem; `GET /iot/messages` e `GET /health`; saem as rotas de lacres, cilindros, vínculos e de análise de alertas e a página da proposta do frontend |

## 3.2 Oxide (`oxide.db`)

| PR | Entrega | O que mudou no banco local |
| --- | --- | --- |
| #1 | Revisão do plano de teste | Colunas `last_repeat_message_id`, `seal_status` e `device_attempt_count`; índice único da `api_key`; triggers do `active` |
| #3 | C — Severidade e coordenadas | Tabela `alerts` com `severity` e `status` em texto e `CHECK`; migração automática dos alertas antigos |
| #7 | D — Catálogo de comandos | `CHECK` do catálogo e do status em `commands`; migração de `LOCK_VALVE`/`UNLOCK_VALVE` e de pendentes desconhecidos |
| #8 | B — Associação | Tabelas `seals`, `cylinders`, `seal_assignments` e `cylinder_assignments`, com índices de vínculo ativo único e `ON DELETE RESTRICT`; coluna `error_type` em telemetria e eventos; `Oxidedb.md` v1.5 validado |
| #12 | Alertas em português | `alerts` com `CHECK` do catálogo em `alert_type`, colunas `resolved_by` e `resolution_note` e `CHECK` de `ENCERRADO` com data; migração automática dos tipos em inglês; `Oxidedb.md` v1.6 validado |
| #15 | Integração Oxide ⇄ FluxID | `next_attempt_at` na telemetria e nos eventos; `sync_*` nos alertas; `devices.api_key_hash`; `fluxid_id` nos vínculos; tabela `sync_logs`; `Oxidedb.md` v1.7 |
| #17 | Simulador e série do cilindro | `cylinders.serial_number` sem `UNIQUE` (série única só por empresa, no FluxID); migração preservando os dados; `Oxidedb.md` v1.8 |
| #20 | Oxide enxuta e envio ao Supabase | De 11 para 3 tabelas (`devices`, `mensagens`, `commands`); migração com cópia de segurança (leituras antigas completas seguem para o banco principal; as demais ficam arquivadas); backup e retenção; `Oxidedb.md` v2.0 |

## 3.3 FluxID

| PR | Entrega | O que mudou no FluxID |
| --- | --- | --- |
| #3 | C — Severidade e coordenadas | A Oxide passou a usar os mesmos valores de severidade e status de alerta do FluxID |
| #4 | E — Banco FluxID | Análise do dump; scripts `001` (UUID automático, índice da última posição, `message_id` em eventos, `api_key_hash`, faixa de coordenadas) e `002` (massa de testes com Alfa e Beta, cilindros e lacres coerentes, RBAC); `Banco_FluxID.md` v3.1. Validados num PostgreSQL temporário; ainda não aplicados no `FluxID_db` |
| #5 e #6 | E — Correção | O #5 desfez a entrega E sem querer (botão "Revert"); o #6 a reaplicou com conteúdo idêntico |
| #7 | D — Catálogo de erros | `Tipos-de-Erro.md`: catálogo em português com o equivalente de cada código no FluxID |
| #8 | B — Associação | A cópia provisória da Oxide segue os mesmos códigos e estados de lacres, cilindros e vínculos do FluxID |
| #9 | Decisões P1 a P8 | Data gravada na chegada, quarentena para telemetria sem GPS, tabela de eventos do dispositivo, tipos de alerta do catálogo (script `004` futuro) |
| #12 | Alertas em português | A Oxide já usa os mesmos códigos de alerta que o FluxID vai aceitar (P5); `resolved_by` e `resolution_note` correspondem a `alertas.encerrado_por` e ao motivo do encerramento |
| #13 | Alerta com cilindro e lacre | Script `003`: cilindro e lacre obrigatórios em `alertas` (salvo códigos de cadastro), com preenchimento dos 10 alertas de teste pelo vínculo da data e parada segura; validado em servidor temporário |
| #14 | Docker e dump | FluxID de análise no Docker (container `fluxid-analise`, PostGIS 18), com `001`, `002` e `003` aplicados; dump movido para `sql/fluxid/FluxID.sql` |
| #15 | Integração Oxide ⇄ FluxID | Script `004` (P1 a P8, gatilho FLX-26) e `005` (estruturas do frontend, histórico do cilindro integrado com a Oxide) |
| #17 | Simulador | O simulador usa o FluxID de análise: operador (cadastro unitário, em massa por CSV, rota como entrega) e conferência dos dados que chegam |
| #19 | Documentação final | Registros de uso de IA (Template 7) sobre o banco FluxID, entre as demais partes do projeto |
| #20 | Oxide enxuta e envio ao Supabase | O FluxID em PostgreSQL deixa de ser o destino e vira banco de teste; os documentos dele ficam como referência histórica. O banco principal é o Supabase |

## 3.4 Worker

Implementado e aprovado em 07/10/2026 (PR #15). O que levou até ele:

| PR | Entrega | O que foi preparado ou feito |
| --- | --- | --- |
| #1 | Revisão do plano de teste | `status` e `attempt_count` da fila ficam reservados ao Worker (o ESP32 usa `device_attempt_count`) |
| #4 | E — Banco FluxID | `Integracao-Oxide-FluxID.md`: fluxo, identificação e conversão de cada dado; chave por hash |
| #8 | B — Associação | Mapeamento dos vínculos da Oxide para os do FluxID |
| #9 | Decisões P1 a P8 | Regras do Worker: data, quarentena, espera de vínculo, eventos do dispositivo, tipos de alerta, 5 tentativas, código do alerta e suspeita de violação |
| #12 | Alertas em português | O tipo do alerta passa direto, sem conversão; falta mapear `resolved_by` (texto) para o usuário do FluxID |
| #13 | Alerta com cilindro e lacre | O Worker busca o lacre e o cilindro do vínculo válido na data do alerta; sem vínculo, o alerta fica em erro na Oxide para o gestor |
| #15 | Integração Oxide ⇄ FluxID | Worker completo (`src/worker/`, `npm run worker`): envio da fila, tentativas, espera do P3, cadastro de volta com o hash da chave |
| #17 | Simulador | O simulador exercita o Worker de ponta a ponta: cadastro sem conflitos, fila, FluxID fora do ar, espera do vínculo e reenvio |
| #20 | Oxide enxuta e envio ao Supabase | Worker reescrito: envia a fila única por HTTP à função de recebimento do Supabase, com resultado por mensagem, e traz os dispositivos e os comandos; simulador novo com recebedor de teste |
