# Regras de Negócio da API e Bancos FluxID e Oxide

Este documento descreve as regras implementadas na API, o schema do SQLite Oxide usado como buffer local e o modelo PostgreSQL principal FluxID identificado no dump `FluxID.sql`. Ele separa o comportamento atual das decisões e integrações ainda pendentes; não representa um contrato para recursos futuros.

## 1. Escopo e execução

- API REST em Node.js, TypeScript e Express.
- Prefixo das rotas versionadas: `/api/v1`.
- Banco principal do projeto: PostgreSQL FluxID.
- Banco local SQLite: `oxide.db` no diretório de trabalho do processo (`process.cwd()`); a Oxide funciona como buffer persistente da API.
- A conexão habilita `PRAGMA foreign_keys = ON`.
- A API utiliza o banco local SQLite (`oxide.db`) como buffer de ingestão. Através desta API e de um Worker (como o `SyncService`, atualmente preparado como estrutura), os dados serão sincronizados com o banco principal PostgreSQL (FluxID).
- O arquivo `FluxID.sql` é um dump PostgreSQL em formato custom, identificado pela assinatura `PGDMP`; apesar da extensão, não é um script SQL texto e deve ser tratado com `pg_restore`.

## 2. Rotas disponíveis

| Método e rota | Regra principal | Sucesso |
| --- | --- | --- |
| `GET /` | Verifica se a API está ativa. | `200` |
| `GET /api/v1/devices` | Lista os registros de dispositivos. | `200` |
| `GET /api/v1/devices/:deviceId` | Consulta um dispositivo pelo identificador. | `200`; `404` se não existir |
| `POST /api/v1/devices` | Cadastra dispositivo. | `201`; `400` sem os campos básicos ou com `active` inválido; `409` com `device_id` ou `api_key` já cadastrados |
| `GET /api/v1/iot/telemetries` | Lista telemetrias por `id` decrescente. | `200` |
| `POST /api/v1/iot/telemetries` | Recebe telemetria. | `202` dado novo; `200` posição repetida; `400` sem IDs ou com valor inválido; `404` dispositivo inexistente; `409` com mensagem repetida |
| `POST /api/v1/iot/events` | Recebe evento. | `202`; `400` inválido; `409` repetido |
| `GET /api/v1/iot/commands/:deviceId` | Lista comandos pendentes do dispositivo. | `200` |
| `POST /api/v1/iot/commands/confirm` | Confirma execução ou erro de comando. | `200`; `400`, `404` ou `409` conforme a falha |
| `POST /api/v1/iot/alerts` | Registra alerta para o dispositivo. | `201`; `400` inválido; `409` duplicado |

Não existe endpoint HTTP para criar/enfileirar comandos, nem para consultar, resolver ou atualizar alertas.

## 3. Autenticação e autorização atuais

O header usado é `X-API-Key`. O middleware genérico busca o dispositivo pela chave (`api_key` é única) e exige que o dispositivo dono da chave esteja ativo.

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
- `api_key` é exclusiva por dispositivo: uma chave já usada retorna `409 API Key já está em uso`. O banco reforça a regra com o índice único `idx_devices_api_key`.
- `active`, quando informado, deve ser `0` ou `1`; outro valor retorna `400`. `firmware_version`, quando informado, deve ser texto.
- A criação de dispositivo não exige API Key.
- Ao receber evento para um `device_id` ainda inexistente, o service cria um dispositivo ativo com API Key `auto-<device_id>` e firmware `unknown`, antes de persistir o evento.
- A criação automática acontece no fluxo de eventos; telemetria não cria dispositivo automaticamente.
- `device_status_id`, `valve_status_id` e `seal_status_id` existem como colunas opcionais, mas não têm FK para `status` nem são preenchidas automaticamente pelo evento.

### 4.2 Telemetrias

- `POST /api/v1/iot/telemetries` exige `message_id` e `device_id` como texto não vazio; os demais valores são opcionais no schema.
- `latitude`, `longitude`, `speed_kmh`, `battery_percent` e `gsm_signal`, quando informados, precisam ser números; `lacre_id`, `cilindro_id`, `payload_json` e `last_seen_at` precisam ser texto. Tipo inválido retorna `400 Campo <nome> com tipo inválido`.
- `seal_status` informa o estado do lacre e, quando enviado, só aceita `LOCKED` (fechado), `UNLOCKED` (aberto) ou `BROKEN` (rompido).
- `attempt_count` enviado pelo ESP32 representa as tentativas de envio do dispositivo; precisa ser inteiro ≥ 0 e é gravado em `device_attempt_count`.
- O `device_id` precisa existir em `devices`; caso contrário a API retorna `404 Dispositivo não encontrado`.
- `message_id` identifica unicamente cada telemetria. Se já existir em `message_id` ou em `last_repeat_message_id`, a API retorna `409 Mensagem duplicada`.
- A tabela persiste os campos de GPS, velocidade, bateria, GSM, lacre, cilindro e payload quando informados. As colunas `status` (`PENDING`) e `attempt_count` (`0`) pertencem ao Worker e são definidas pelo servidor; o `status` enviado pelo cliente é ignorado (fica só em `payload_json`).
- O campo `payload_json` recebe o valor enviado ou, quando omitido, uma serialização do objeto recebido.
- Se a última telemetria do dispositivo tiver latitude, longitude e `seal_status` iguais aos recebidos, com coordenadas numéricas, a API atualiza `last_seen_at` da linha existente, grava o `message_id` recebido em `last_repeat_message_id` e responde `200 Posição já registrada; data e hora atualizadas`, sem inserir outra linha. Um reenvio desse `message_id` retorna `409`.
- Só a repetição mais recente de cada linha é guardada: o reenvio de uma repetição mais antiga é tratado como nova repetição (`200`), sem gerar linha duplicada.
- Mudança do estado do lacre na mesma posição (ex.: `LOCKED` → `BROKEN`) não é repetição: gera nova linha (`202`).
- Como a linha original é mantida, só o registro mais antigo de uma sequência de posições repetidas segue para o banco principal.
- Quando a posição se repete, o timestamp enviado não é usado nessa atualização; o banco grava `CURRENT_TIMESTAMP`.
- Posições diferentes e telemetrias sem coordenadas são inseridas normalmente. A consulta retorna `id` decrescente e não tem paginação.
- A rota exige uma API Key ativa, mas atualmente não valida o ownership do dispositivo indicado no payload.

### 4.3 Eventos

- `POST /api/v1/iot/events` exige `message_id`, `device_id` e `event_type`.
- `event_type` é gravado na coluna `events.message_type`; a API exige que seja informado, mas não restringe o valor a um catálogo fechado.
- `seal_status`, quando informado, só aceita `LOCKED`, `UNLOCKED` ou `BROKEN`.
- `message_id` é único; repetição retorna `409 Mensagem duplicada`.
- Evento novo é salvo com `status = PENDING` e `attempt_count = 0`, mesmo que o cliente envie outros valores. O `attempt_count` do ESP32 (inteiro ≥ 0) é gravado em `device_attempt_count`.
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
| `api_key` | `TEXT NOT NULL`, única pelo índice `idx_devices_api_key`; armazenada atualmente sem hash. |
| `firmware_version` | `TEXT`, opcional. |
| `active` | `INTEGER NOT NULL DEFAULT 1`; só aceita `0` ou `1` (triggers `trg_devices_active_insert`/`_update`); middleware considera ativo apenas o valor `1`. |
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
| `seal_status` | `TEXT`, opcional; `LOCKED`, `UNLOCKED` ou `BROKEN`, validado pela API. |
| `device_attempt_count` | `INTEGER`, opcional; tentativas de envio informadas pelo ESP32. |
| `last_repeat_message_id` | `TEXT`, opcional; `message_id` da última posição repetida, com índice `idx_telemetry_last_repeat_message_id`. |
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
| `attempt_count` | `INTEGER DEFAULT 0`; tentativas de sincronização do Worker. |
| `device_attempt_count` | `INTEGER`, opcional; tentativas de envio informadas pelo ESP32. |
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
- `message_id`, `device_id`, `api_key`, `command_id`, `alert_id` e `status.code` têm restrições de unicidade conforme descrito nas tabelas.
- As FKs de eventos, telemetrias e alertas usam o comportamento padrão do SQLite; comandos usam `ON UPDATE CASCADE` e `ON DELETE RESTRICT`.

## 6. Inicialização e migrações

- A aplicação cria `status`, `commands` e `alerts` quando ausentes e semeia os códigos faltantes de `status`.
- Adiciona `device_status_id`, `valve_status_id` e `seal_status_id` a `devices` quando faltarem.
- Normaliza nomes legados de colunas.
- Se a tabela `telemetry_queue` tiver colunas ou nulabilidade legadas, recria a tabela de forma transacional e copia os registros, preenchendo defaults para campos novos.
- Adiciona `last_seen_at` quando a coluna não existir.
- Adiciona `last_repeat_message_id`, `seal_status` e `device_attempt_count` a `telemetry_queue`, e `device_attempt_count` a `events`, quando faltarem, além do índice `idx_telemetry_last_repeat_message_id`.
- Cria os triggers que restringem `devices.active` a `0`/`1`; bancos antigos não têm o `CHECK` e o SQLite não permite adicioná-lo sem recriar a tabela.
- Cria o índice único `idx_devices_api_key` quando não há chaves duplicadas; se houver, a aplicação sobe normalmente e registra um aviso no console.
- `sync_logs` e `sync_items` não fazem parte do schema atual da `oxide.db`.

## 7. Funcionalidades ainda fora do escopo implementado

- Associação relacional de dispositivo, lacre e cilindro e respectivo histórico.
- Geofence: configuração de áreas e detecção de entrada/saída.
- Geração automática de comandos.
- Worker de sincronização, tabelas operacionais de sync e integração com PostgreSQL.
- Política de severidade de alertas.

## 8. Banco principal PostgreSQL FluxID

- FluxID é o banco PostgreSQL principal; `oxide.db` é o armazenamento local/buffer usado atualmente pela API.
- `FluxID.sql` é um dump PostgreSQL em formato custom (`PGDMP`), não um script SQL texto. Ele deve ser inspecionado/restaurado com `pg_restore`, não com `sqlite3` nem `psql -f`.
- O catálogo do dump identifica o banco `FluxID_db`, PostgreSQL/`pg_dump` 18.6, 214 entradas e as extensões `pgcrypto` e `postgis`.
- A API ainda grava somente no SQLite. A integração e o Worker SQLite → PostgreSQL continuam pendentes.

### 8.1 Tabelas FluxID relevantes

| Tabela PostgreSQL | Campos/regras relevantes para integração |
| --- | --- |
| `organizacoes` | Identificador UUID e dados da organização/tenant. |
| `dispositivos` | `id` UUID, `organizacao_id` obrigatório, `codigo` único, `identificador_hardware` único, `versao_firmware` e `ativo`. Não há coluna `api_key` no DDL do dump. |
| `telemetrias` | `id` UUID, `dispositivo_id` UUID, `message_id` único, `data_coleta` obrigatória e latitude/longitude obrigatórias; inclui velocidade, bateria, GSM e `payload_raw JSONB`. |
| `eventos_lacre` | Evento ligado a `lacre_id` obrigatório; `telemetria_id` opcional; tipo limitado a um catálogo de eventos de lacre. |
| `alertas` | `organizacao_id`, código, tipo, severidade, status e `aberto_em` obrigatórios; lacre/cilindro/evento relacionados são opcionais. Tipo, severidade e status têm `CHECK` com valores permitidos. |
| `lacres`, `cilindros` | Entidades próprias com UUID, organização, código e status com catálogo limitado. |
| `vinculos_dispositivo_lacre` | Relação dispositivo/lacre com início, fim e dados de vínculo/desvínculo, permitindo registrar períodos. |
| `vinculos_cilindro_lacre` | Relação cilindro/lacre com início, fim e dados de instalação/remoção, permitindo registrar períodos. |

O dump não contém tabela `commands`. As tabelas principais usam IDs UUID sem default gerador visível no DDL; novos registros sincronizados precisam de estratégia explícita para gerar ou mapear UUIDs.

### 8.2 Mapeamento preliminar Oxide → FluxID

| Origem Oxide | Destino FluxID | Diferença/decisão necessária |
| --- | --- | --- |
| `devices` | `dispositivos` | `device_id` texto pode corresponder a `codigo` ou `identificador_hardware`; definir a regra. FluxID exige `organizacao_id`, ausente no SQLite. |
| `telemetry_queue` | `telemetrias` | Mapear `device_id` para `dispositivo_id` UUID. FluxID exige `data_coleta`, latitude e longitude não nulas; Oxide aceita coordenadas ausentes e não tem timestamp de coleta equivalente garantido. Definir rejeição, quarentena ou ajuste de schema/política antes de sincronizar essas linhas. |
| `events` | `eventos_lacre` | Só há correspondência direta para eventos de lacre; FluxID exige `lacre_id`, usa outro catálogo de tipos e não tem `message_id` nessa tabela. Definir resolução do lacre e uma chave de idempotência no destino. |
| `alerts` | `alertas` | FluxID exige organização, código, UUID, data de abertura e valores textuais de tipo/severidade/status; Oxide usa IDs inteiros para status/severidade e tipos com nomes diferentes. Definir todos os mapeamentos antes de inserir. |
| `commands` | Sem tabela no dump | Decidir se comandos permanecem locais ou se será criada uma entidade correspondente no PostgreSQL. |
| `telemetry_queue.lacre_id` / `cilindro_id` | Vínculos FluxID | No SQLite esses campos são texto opcional sem FK; não são suficientes para reconstruir os vínculos históricos do FluxID. Usar as tabelas `vinculos_*` com regras temporais próprias. |

Mapeamentos semânticos candidatos de alertas que precisam ser aprovados: `SEAL_BROKEN` → `VIOLACAO_LACRE`, `GEOFENCE_EXIT` → `SAIDA_GEOCERCA`, `LOW_BATTERY` → `BATERIA_BAIXA` e `COMMUNICATION_LOST` → `SEM_COMUNICACAO`. `DEVICE_ERROR` e `COMMAND_FAILURE` não têm valor equivalente explícito no `CHECK` de `alertas.tipo` do dump. As severidades FluxID aceitas são `BAIXA`, `MEDIA`, `ALTA` e `CRITICA`; os estados aceitos são `ABERTO`, `EM_ANALISE` e `ENCERRADO`.

### 8.3 Preparação pendente para iniciar a sincronização

- Restaurar o dump em um banco local de análise separado, sem sobrescrever o banco principal ou dados existentes.
- Obter acesso autorizado ao PostgreSQL: o serviço aceita conexões, mas uma tentativa sem senha retornou `fe_sendauth: no password supplied`. Credenciais devem ser fornecidas diretamente no terminal ou por configuração segura, nunca registradas neste documento.
- Definir `organizacao_id` padrão/por dispositivo e a correspondência entre os identificadores Oxide e os UUIDs FluxID.
- Aprovar políticas para telemetrias sem GPS ou sem timestamp de coleta, eventos sem lacre relacionado, comandos e idempotência/reprocessamento.
- Implementar a sincronização somente depois dessas decisões e validar primeiro em banco local de análise.

Para o script de criação do banco e instruções do DB Browser, consulte [Oxidedb.md](Oxidedb.md). Para payloads do firmware, consulte [ESP32-envio-de-dados.md](ESP32-envio-de-dados.md).