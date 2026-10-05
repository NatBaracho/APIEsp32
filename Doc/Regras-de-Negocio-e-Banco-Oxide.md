# Regras de Negócio da API e Banco SQLite Oxide

Este documento descreve o comportamento implementado atualmente na API e no banco local `oxide.db`. Ele diferencia regras existentes de funcionalidades planejadas; não representa um contrato para recursos ainda não implementados.

## 1. Escopo e execução

- API REST em Node.js, TypeScript e Express.
- Prefixo das rotas versionadas: `/api/v1`.
- Banco local SQLite: `oxide.db` no diretório de trabalho do processo (`process.cwd()`).
- A conexão habilita `PRAGMA foreign_keys = ON`.
- A API atual não sincroniza dados com PostgreSQL. Um serviço chamado `SyncService` está vazio e não há Worker operacional.

## 2. Rotas disponíveis

| Método e rota | Regra principal | Sucesso |
| --- | --- | --- |
| `GET /` | Verifica se a API está ativa. | `200` |
| `GET /api/v1/devices` | Lista os registros de dispositivos. | `200` |
| `GET /api/v1/devices/:deviceId` | Consulta um dispositivo pelo identificador. | `200`; `404` se não existir |
| `POST /api/v1/devices` | Cadastra dispositivo. | `201`; `400` sem os campos básicos; `409` duplicado |
| `GET /api/v1/iot/telemetries` | Lista telemetrias por `id` decrescente. | `200` |
| `POST /api/v1/iot/telemetries` | Recebe telemetria. | `202`; `400` sem IDs; `409` com mensagem repetida |
| `POST /api/v1/iot/events` | Recebe evento. | `202`; `400` inválido; `409` repetido |
| `GET /api/v1/iot/commands/:deviceId` | Lista comandos pendentes do dispositivo. | `200` |
| `POST /api/v1/iot/commands/confirm` | Confirma execução ou erro de comando. | `200`; `400`, `404` ou `409` conforme a falha |
| `POST /api/v1/iot/alerts` | Registra alerta para o dispositivo. | `201`; `400` inválido; `409` duplicado |

Não existe endpoint HTTP para criar/enfileirar comandos, nem para consultar, resolver ou atualizar alertas.

## 3. Autenticação e autorização atuais

O header usado é `X-API-Key`. O middleware genérico procura a chave entre os dispositivos e exige que o dispositivo dono da chave esteja ativo.

| Rotas | Comportamento de autenticação implementado |
| --- | --- |
| `GET/POST /api/v1/devices` e `GET /api/v1/devices/:deviceId` | Não usam middleware de API Key. |
| `GET/POST /api/v1/iot/telemetries` | Exigem uma API Key válida de dispositivo ativo, mas não comparam a chave com o `device_id` do registro. O GET retorna telemetrias de todos os dispositivos. |
| `POST /api/v1/iot/events` | Exige uma API Key válida de dispositivo ativo, mas não compara a chave com o `device_id` do evento. |
| Rotas de comandos | Exigem API Key válida e conferem se pertence ao `device_id` consultado ou informado na confirmação. |
| `POST /api/v1/iot/alerts` | Exige API Key válida e confere se pertence ao `device_id` do alerta. |

Respostas do middleware: `401` para chave ausente ou inválida; `403` para dispositivo inativo ou chave que não pertence ao dispositivo-alvo; `404` quando o dispositivo-alvo de uma rota protegida não existe.

### Observações de segurança

- `GET /api/v1/devices` e `GET /api/v1/devices/:deviceId` retornam o resultado de `SELECT *`, que inclui `api_key`, sem autenticação. O acesso e a projeção desses endpoints precisam ser revistos antes de expor a API fora de um ambiente controlado.
- Telemetria e evento aceitam uma chave ativa sem validar que ela pertence ao `device_id` do payload. Essa diferença em relação a comandos e alertas deve ser tratada como decisão de autorização pendente.
- As chaves são armazenadas como texto e comparadas diretamente. Não há hash, rotação, rate limiting ou trilha de auditoria implementados.

## 4. Regras de negócio por recurso

### 4.1 Dispositivos

- `device_id` identifica unicamente o dispositivo; o SQLite aplica `UNIQUE`.
- `POST /api/v1/devices` exige `device_id` e `api_key`; `firmware_version` é opcional.
- Um dispositivo criado pela rota recebe `active = 1` quando não for informado e tem os campos de status opcionais inicialmente nulos.
- A tentativa de cadastrar novamente o mesmo `device_id` retorna `409 Dispositivo duplicado`.
- A criação de dispositivo não exige API Key.
- Ao receber evento para um `device_id` ainda inexistente, o service cria um dispositivo ativo com API Key `auto-<device_id>` e firmware `unknown`, antes de persistir o evento.
- A criação automática acontece no fluxo de eventos; telemetria não cria dispositivo automaticamente.
- `device_status_id`, `valve_status_id` e `seal_status_id` existem como colunas opcionais, mas não têm FK para `status` nem são preenchidas automaticamente pelo evento.

### 4.2 Telemetrias

- `POST /api/v1/iot/telemetries` exige `message_id` e `device_id`; os demais valores são opcionais no schema.
- `message_id` identifica unicamente cada telemetria. Se já existir, a API retorna `409 Mensagem duplicada`.
- A tabela persiste os campos de GPS, velocidade, bateria, GSM, lacre, cilindro, payload e estado de processamento quando informados.
- O campo `payload_json` recebe o valor enviado ou, quando omitido, uma serialização do objeto recebido.
- Se a última telemetria do dispositivo tiver latitude e longitude iguais às recebidas, e ambas forem números, a API atualiza `last_seen_at` da linha existente e responde `202`, sem inserir outra linha.
- Quando a posição se repete, o timestamp enviado não é usado nessa atualização; o banco grava `CURRENT_TIMESTAMP`.
- Posições diferentes e telemetrias sem coordenadas são inseridas normalmente. A consulta retorna `id` decrescente e não tem paginação.
- A rota exige uma API Key ativa, mas atualmente não valida o ownership do dispositivo indicado no payload.

### 4.3 Eventos

- `POST /api/v1/iot/events` exige `message_id`, `device_id` e `event_type`.
- `event_type` é gravado na coluna `events.message_type`; a API exige que seja informado, mas não restringe o valor a um catálogo fechado.
- `seal_status`, quando informado, só aceita `LOCKED`, `UNLOCKED` ou `BROKEN`.
- `message_id` é único; repetição retorna `409 Mensagem duplicada`.
- Evento novo é salvo com `status = PENDING` e `attempt_count = 0`.
- O campo `events.status` representa processamento da fila, não o estado do dispositivo ou do lacre.
- O service garante a existência do dispositivo criando-o automaticamente quando necessário.
- A rota exige uma API Key ativa, mas não valida que ela pertence ao `device_id` do evento.

### 4.4 Comandos

- `GET /api/v1/iot/commands/:deviceId` retorna somente comandos `PENDENTE`, em ordem crescente de `id`.
- A consulta só é autorizada com a API Key do próprio `deviceId`.
- `POST /api/v1/iot/commands/confirm` exige `command_id`, `device_id` e `status` igual a `EXECUTADO` ou `ERRO`.
- `error_message` é opcional, mas precisa ser texto quando enviado.
- Só um comando pertencente ao dispositivo informado e ainda `PENDENTE` pode ser confirmado.
- Ao confirmar, o banco grava o status e `executed_at = CURRENT_TIMESTAMP`; `error_message` é gravado ou fica nulo.
- Comando inexistente para o dispositivo retorna `404`; comando já confirmado retorna `409`.
- A criação de comandos é feita fora das rotas HTTP atuais; não há endpoint de criação.

### 4.5 Alertas

- `POST /api/v1/iot/alerts` exige `alert_id`, `device_id`, `alert_type`, `status_id`, `severity_id` e `title`; `description` é opcional.
- Os tipos aceitos são `SEAL_BROKEN`, `GEOFENCE_EXIT`, `LOW_BATTERY`, `DEVICE_ERROR`, `COMMAND_FAILURE` e `COMMUNICATION_LOST`.
- `status_id` e `severity_id` precisam ser inteiros positivos existentes em `status.id`.
- `alert_id` é único; repetição retorna `409 Alerta duplicado`.
- O alerta é associado ao dispositivo e retorna `201` quando criado. `created_at` usa `CURRENT_TIMESTAMP`; `resolved_at` permanece nulo na criação.
- A rota valida que a API Key pertence ao `device_id` informado.
- O catálogo atual `status` contém estados de dispositivo/lacre, não uma taxonomia de severidade. A regra atual valida existência do ID, mas não que ele represente uma severidade válida.
- O tipo `GEOFENCE_EXIT` é aceito, mas não existe lógica de geofence que o gere automaticamente.

## 5. Modelo do banco SQLite

Os nomes e constraints abaixo correspondem ao `oxide.db` inspecionado e ao schema mantido pela aplicação. Campos opcionais aceitam `NULL`; `id` é chave primária autoincremental nas tabelas de domínio.

### `devices`

| Coluna | Regra |
| --- | --- |
| `id` | Chave primária. |
| `device_id` | `TEXT NOT NULL UNIQUE`. |
| `api_key` | `TEXT NOT NULL`, armazenada atualmente sem hash. |
| `firmware_version` | `TEXT`, opcional. |
| `active` | `INTEGER NOT NULL DEFAULT 1`; middleware considera ativo apenas o valor `1`. |
| `device_status_id`, `valve_status_id`, `seal_status_id` | `INTEGER`, opcionais e sem FK atualmente. |

### `status`

| Coluna | Regra |
| --- | --- |
| `id` | Chave primária autoincremental. |
| `code` | `TEXT NOT NULL UNIQUE`. |
| `name` | `TEXT NOT NULL`. |
| `description` | `TEXT`, opcional. |

A inicialização insere, se estiverem ausentes, os códigos `ACTIVE`, `INACTIVE`, `LOCKED`, `UNLOCKED` e `BROKEN`. Os IDs são gerados pelo SQLite; não se deve assumir que um código sempre terá o mesmo ID em todo banco.

### `telemetry_queue`

| Coluna | Regra |
| --- | --- |
| `id` | Chave primária autoincremental. |
| `message_id` | `TEXT NOT NULL UNIQUE`. |
| `device_id` | `TEXT NOT NULL`, FK para `devices.device_id`. |
| `lacre_id`, `cilindro_id` | `TEXT`, opcionais, ainda sem FK ou regra de associação. |
| `latitude`, `longitude`, `speed_kmh`, `battery_percent` | `REAL`, opcionais. |
| `gsm_signal` | `INTEGER`, opcional. |
| `payload_json` | `TEXT`, opcional. |
| `last_seen_at` | `DATETIME`, opcional. |
| `status` | `TEXT NOT NULL DEFAULT 'PENDING'`. |
| `attempt_count` | `INTEGER NOT NULL DEFAULT 0`. |
| `last_error` | `TEXT`, opcional. |

### `events`

| Coluna | Regra |
| --- | --- |
| `id` | Chave primária autoincremental. |
| `message_id` | `TEXT NOT NULL UNIQUE`. |
| `device_id` | `TEXT NOT NULL`, FK para `devices.device_id`. |
| `message_type` | `TEXT NOT NULL`; recebe `event_type` da API. |
| `seal_status` | `TEXT`, opcional; domínio validado pela API. |
| `payload_json` | `TEXT`, opcional. |
| `status` | `TEXT DEFAULT 'PENDING'`; estado de processamento. |
| `attempt_count` | `INTEGER DEFAULT 0`. |
| `last_error` | `TEXT`, opcional. |

### `commands`

| Coluna | Regra |
| --- | --- |
| `id` | Chave primária autoincremental. |
| `command_id` | `TEXT NOT NULL UNIQUE`. |
| `device_id` | `TEXT NOT NULL`, FK para `devices.device_id`, `ON UPDATE CASCADE`, `ON DELETE RESTRICT`. |
| `command_type` | `TEXT NOT NULL`. |
| `status` | `TEXT NOT NULL DEFAULT 'PENDENTE'`. |
| `created_at` | `DATETIME NOT NULL`, sem default no schema. |
| `executed_at` | `DATETIME`, opcional. |
| `error_message` | `TEXT`, opcional. |

### `alerts`

| Coluna | Regra |
| --- | --- |
| `id` | Chave primária autoincremental. |
| `alert_id` | `TEXT NOT NULL UNIQUE`. |
| `device_id` | `TEXT NOT NULL`, FK para `devices.device_id`. |
| `alert_type` | `TEXT NOT NULL`; lista aceita é validada pela API, não por `CHECK` SQLite. |
| `status_id`, `severity_id` | `INTEGER NOT NULL`, ambos FK para `status.id`. |
| `title` | `TEXT NOT NULL`. |
| `description` | `TEXT`, opcional. |
| `created_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`. |
| `resolved_at` | `DATETIME`, opcional; não há rota atual para resolução. |

### Relacionamentos e integridade

- `devices.device_id` é a referência das FKs de `telemetry_queue`, `events`, `commands` e `alerts`.
- `alerts.status_id` e `alerts.severity_id` referenciam `status.id`.
- `device_status_id`, `valve_status_id` e `seal_status_id` não possuem FKs no schema atual.
- `lacre_id` e `cilindro_id` na telemetria são texto livre opcional; não representam ainda as associações do roadmap.
- `message_id`, `device_id`, `command_id`, `alert_id` e `status.code` têm restrições de unicidade conforme descrito nas tabelas.
- As FKs de eventos, telemetrias e alertas usam o comportamento padrão do SQLite; comandos usam `ON UPDATE CASCADE` e `ON DELETE RESTRICT`.

## 6. Inicialização e migrações

- A aplicação cria `status`, `commands` e `alerts` quando ausentes e semeia os códigos faltantes de `status`.
- Adiciona `device_status_id`, `valve_status_id` e `seal_status_id` a `devices` quando faltarem.
- Normaliza nomes legados de colunas.
- Se a tabela `telemetry_queue` tiver colunas ou nulabilidade legadas, recria a tabela de forma transacional e copia os registros, preenchendo defaults para campos novos.
- Adiciona `last_seen_at` quando a coluna não existir.
- `sync_logs` e `sync_items` não fazem parte do schema atual da `oxide.db`.

## 7. Funcionalidades ainda fora do escopo implementado

- Associação relacional de dispositivo, lacre e cilindro e respectivo histórico.
- Geofence: configuração de áreas e detecção de entrada/saída.
- Geração automática de comandos.
- Worker de sincronização, tabelas operacionais de sync e integração com PostgreSQL.
- Política de severidade de alertas.

Para o script de criação do banco e instruções do DB Browser, consulte [Oxidedb.md](Oxidedb.md). Para payloads do firmware, consulte [ESP32-envio-de-dados.md](ESP32-envio-de-dados.md).