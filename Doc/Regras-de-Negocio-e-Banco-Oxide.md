# Regras de Negócio da API e Bancos FluxID e Oxide

Este documento descreve as regras implementadas na API, o schema do SQLite Oxide usado como buffer local e o modelo PostgreSQL principal FluxID identificado no dump `sql/fluxid/FluxID.sql`. Ele separa o comportamento atual das decisões e integrações ainda pendentes; não representa um contrato para recursos futuros.

## 1. Escopo e execução

- API REST em Node.js, TypeScript e Express.
- Prefixo das rotas versionadas: `/api/v1`.
- Banco principal do projeto: PostgreSQL FluxID.
- Banco local SQLite: `oxide.db` no diretório de trabalho do processo (`process.cwd()`); a Oxide funciona como buffer persistente da API.
- A conexão habilita `PRAGMA foreign_keys = ON`.
- A API utiliza o banco local SQLite (`oxide.db`) como buffer de ingestão. Através desta API e de um Worker (como o `SyncService`, atualmente preparado como estrutura), os dados serão sincronizados com o banco principal PostgreSQL (FluxID).
- O arquivo `sql/fluxid/FluxID.sql` é um dump PostgreSQL em formato custom, identificado pela assinatura `PGDMP`; apesar da extensão, não é um script SQL texto e deve ser tratado com `pg_restore`.

## 2. Rotas disponíveis

| Método e rota | Regra principal | Sucesso |
| --- | --- | --- |
| `GET /` | Verifica se a API está ativa. | `200` |
| `GET /api/v1/devices` | Lista os dispositivos, sem a `api_key`. | `200` |
| `GET /api/v1/devices/:deviceId` | Consulta um dispositivo pelo identificador, sem a `api_key`. | `200`; `404` se não existir |
| `POST /api/v1/devices` | Cadastra dispositivo (provisório até o Worker trazer o cadastro oficial do FluxID). | `201`; `400` sem os campos básicos ou com `active` inválido; `409` com `device_id` ou `api_key` já cadastrados |
| `GET /api/v1/iot/telemetries` | Lista telemetrias por `id` decrescente. | `200` |
| `POST /api/v1/iot/telemetries` | Recebe telemetria. | `202` dado novo; `200` posição repetida; `400` sem IDs ou com valor inválido; `403` chave de outro dispositivo; `404` dispositivo não cadastrado; `409` com mensagem repetida |
| `POST /api/v1/iot/events` | Recebe evento. | `202`; `400` inválido; `403` chave de outro dispositivo; `404` dispositivo não cadastrado; `409` repetido |
| `GET /api/v1/iot/commands/:deviceId` | Lista comandos pendentes do dispositivo. | `200` |
| `POST /api/v1/iot/commands/confirm` | Confirma execução ou erro de comando. | `200`; `400`, `404` ou `409` conforme a falha |
| `POST /api/v1/iot/alerts` | Registra alerta para o dispositivo. | `201`; `400` inválido; `409` duplicado |
| `GET/POST /api/v1/seals`, `GET /seals/:sealCode`, `POST /seals/:sealCode/status` | Cadastro e estado de lacres (provisório). | `200`/`201`; `400`; `404`; `409` |
| `GET/POST /api/v1/cylinders`, `GET /cylinders/:cylinderCode`, `POST /cylinders/:cylinderCode/status` | Cadastro e estado de cilindros (provisório). | `200`/`201`; `400`; `404`; `409` |
| `GET/POST /api/v1/assignments/device-seal`, `POST /device-seal/:id/end` | Vínculo dispositivo ↔ lacre e histórico. | `200`/`201`; `400`; `404`; `409` |
| `GET/POST /api/v1/assignments/seal-cylinder`, `POST /seal-cylinder/:id/end` | Vínculo lacre ↔ cilindro e histórico. | `200`/`201`; `400`; `404`; `409` |

Não existe endpoint HTTP para criar/enfileirar comandos, nem para consultar, resolver ou atualizar alertas.

## 3. Autenticação e autorização atuais

O header usado é `X-API-Key`. O middleware genérico busca o dispositivo pela chave e exige que o dispositivo dono da chave esteja ativo. Quando o dispositivo tem `api_key_hash` (vindo do FluxID), a chave só vale se o SHA-256 dela for igual ao hash, e a chave em texto guardada deixa de valer. Sem hash, vale a chave em texto do cadastro provisório (`api_key` é única).

| Rotas | Comportamento de autenticação implementado |
| --- | --- |
| `GET/POST /api/v1/devices` e `GET /api/v1/devices/:deviceId` | Abertas, sem API Key (decisão para a equipe e o montador do lacre testarem). As respostas não mostram a `api_key`. |
| `POST /api/v1/iot/telemetries` e `POST /api/v1/iot/events` | Exigem API Key válida de dispositivo ativo e conferem se ela pertence ao `device_id` do payload. |
| `GET /api/v1/iot/telemetries` | Exige uma API Key válida e retorna as telemetrias de todos os dispositivos (decisão aceita, para acompanhamento dos testes). |
| Rotas de comandos | Exigem API Key válida e conferem se pertence ao `device_id` consultado ou informado na confirmação. |
| `POST /api/v1/iot/alerts` | Exige API Key válida e confere se pertence ao `device_id` do alerta. |
| `GET /api/v1/iot/alerts` e `PATCH /api/v1/iot/alerts/{alert_id}/status` | Abertas e provisórias, para a equipe e o gestor, até o controle por perfil. |
| `GET /api/v1/sync/status`, `GET /api/v1/sync/problems`, `POST /api/v1/sync/retry` | Abertas e provisórias: acompanhamento do Worker e nova tentativa de um item parado. |

Respostas do middleware: `401` para chave ausente ou inválida; `403` para dispositivo inativo ou chave que não pertence ao dispositivo-alvo; `404` quando o dispositivo-alvo de uma rota protegida não existe.

### Observações de segurança

- As rotas de dispositivos são abertas por decisão do responsável; para não expor credenciais, as respostas de `GET` não incluem `api_key` (entrega A, 06/10/2026).
- `POST /api/v1/devices` não exige credencial administrativa e a listagem de telemetrias é geral; são decisões aceitas enquanto a API roda em ambiente de testes. Antes de produção, reavaliar.
- Chaves do cadastro provisório ficam em texto; chaves do cadastro oficial vêm do FluxID só como hash (SHA-256) e são comparadas em tempo constante. Dispositivo criado pelo Worker recebe uma chave em texto aleatória e inutilizável. Não há rotação, rate limiting nem trilha de auditoria implementados.

## 4. Regras de negócio por recurso

### 4.1 Dispositivos

- `device_id` identifica unicamente o dispositivo; o SQLite aplica `UNIQUE`.
- `POST /api/v1/devices` exige `device_id` e `api_key`; `firmware_version` é opcional.
- Um dispositivo criado pela rota recebe `active = 1` quando não for informado e tem os campos de status opcionais inicialmente nulos.
- A tentativa de cadastrar novamente o mesmo `device_id` retorna `409 Dispositivo duplicado`.
- `api_key` é exclusiva por dispositivo: uma chave já usada retorna `409 API Key já está em uso`. O banco reforça a regra com o índice único `idx_devices_api_key`.
- `active`, quando informado, deve ser `0` ou `1`; outro valor retorna `400`. `firmware_version`, quando informado, deve ser texto.
- A criação de dispositivo não exige API Key.
- O cadastro oficial de dispositivo, lacre e cilindro fica no FluxID. O Worker traz esse cadastro (com o hash da chave) a cada 5 minutos; o FluxID prevalece sobre a cópia local, e nada é apagado. `POST /api/v1/devices` continua como cadastro provisório para testes sem o FluxID.
- As respostas de `GET /api/v1/devices` não mostram `api_key` nem `api_key_hash`.
- Não há criação automática: telemetria ou evento de um `device_id` não cadastrado retorna `404 Dispositivo não encontrado`.
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
- A rota exige a API Key do próprio dispositivo indicado no payload; chave de outro dispositivo retorna `403`.

### 4.3 Eventos

- `POST /api/v1/iot/events` exige `message_id`, `device_id` e `event_type`.
- `event_type` é gravado na coluna `events.message_type`; a API exige que seja informado, mas não restringe o valor a um catálogo fechado.
- `seal_status`, quando informado, só aceita `LOCKED`, `UNLOCKED` ou `BROKEN`.
- `message_id` é único; repetição retorna `409 Mensagem duplicada`.
- Evento novo é salvo com `status = PENDING` e `attempt_count = 0`, mesmo que o cliente envie outros valores. O `attempt_count` do ESP32 (inteiro ≥ 0) é gravado em `device_attempt_count`.
- O campo `events.status` representa processamento da fila, não o estado do dispositivo ou do lacre.
- O dispositivo precisa estar cadastrado; caso contrário a API retorna `404` (sem criação automática).
- A rota exige a API Key do próprio `device_id` do evento; chave de outro dispositivo retorna `403`.

### 4.4 Comandos

- `GET /api/v1/iot/commands/:deviceId` retorna somente comandos `PENDENTE`, em ordem crescente de `id`.
- A consulta só é autorizada com a API Key do próprio `deviceId`.
- `POST /api/v1/iot/commands/confirm` exige `command_id`, `device_id` e `status` igual a `EXECUTADO` ou `ERRO`.
- `error_message` é opcional, mas precisa ser texto quando enviado.
- Só um comando pertencente ao dispositivo informado e ainda `PENDENTE` pode ser confirmado.
- Ao confirmar, o banco grava o status e `executed_at = CURRENT_TIMESTAMP`; `error_message` é gravado ou fica nulo.
- Comando inexistente para o dispositivo retorna `404`; comando já confirmado retorna `409`.
- Tipos de comando aceitos: `TRAVAR_VALVULA` e `DESTRAVAR_VALVULA`. O banco rejeita comando `PENDENTE` com outro tipo; comandos já executados ou com erro podem guardar tipos antigos (histórico).
- A criação de comandos não tem rota HTTP, por decisão de segurança (uma rota aberta permitiria destravar válvulas). Os comandos são criados pelo sistema: hoje direto no banco; no futuro, pelos comandos automáticos.
- Os comandos ficam só na Oxide; a tabela correspondente no FluxID será decidida na fase do Worker.

### 4.5 Alertas

- `POST /api/v1/iot/alerts` exige `alert_id`, `device_id`, `alert_type` e `title`; `severity` e `description` são opcionais.
- Os tipos aceitos são os 28 códigos em português do catálogo [Tipos-de-Erro.md](Tipos-de-Erro.md); outro valor retorna `400`, e o banco também recusa (`CHECK`). Transição: os nomes antigos `SEAL_BROKEN`, `GEOFENCE_EXIT`, `LOW_BATTERY`, `DEVICE_ERROR`, `COMMAND_FAILURE` e `COMMUNICATION_LOST` continuam aceitos e são gravados em português (`LACRE_VIOLADO`, `SAIDA_GEOCERCA`, `BATERIA_BAIXA`, `DISPOSITIVO_FALHA`, `COMANDO_FALHOU`, `SEM_COMUNICACAO`).
- `severity` aceita `BAIXA`, `MEDIA`, `ALTA` ou `CRITICA`, os mesmos valores de `alertas.severidade` no FluxID; outro valor retorna `400`. Sem `severity`, vale a severidade sugerida no catálogo (ex.: `LACRE_VIOLADO` → `CRITICA`; `SEM_COMUNICACAO` e `COMANDO_FALHOU` → `ALTA`; `DISPOSITIVO_FALHA` → `MEDIA`; `BATERIA_BAIXA` → `BAIXA`).
- `status` do alerta usa os valores do FluxID (`ABERTO`, `EM_ANALISE`, `ENCERRADO`) e nasce sempre `ABERTO`, definido pelo servidor.
- Os campos antigos `status_id` e `severity_id`, se enviados, são ignorados.
- `alert_id` é único; repetição retorna `409 Alerta duplicado`.
- O alerta é associado ao dispositivo e retorna `201` quando criado. `created_at` usa `CURRENT_TIMESTAMP`; `resolved_at` permanece nulo na criação.
- A rota valida que a API Key pertence ao `device_id` informado.
- `GET /api/v1/iot/alerts` lista os alertas (filtros `status` e `device_id`), do mais recente ao mais antigo.
- `PATCH /api/v1/iot/alerts/{alert_id}/status` muda o status: `ABERTO` → `EM_ANALISE` → `ENCERRADO`, ou `ABERTO` → `ENCERRADO`. Encerrar exige `resolved_by` (quem liberou) e `resolution_note` (motivo), e a data é preenchida pelo servidor. `ENCERRADO` é final (`409`): um problema novo gera um alerta novo. As duas rotas são abertas e provisórias, até o controle por perfil do FluxID.
- Os tipos `SAIDA_GEOCERCA` e `SAIDA_ROTA` são aceitos, mas ainda não existe lógica de geofence ou rota que os gere automaticamente.

### 4.6 Associação dispositivo → lacre → cilindro

- O cadastro oficial está no FluxID; a Oxide mantém uma **cópia provisória** (mesmos códigos `LCR-…`/`CIL-…` e mesmos estados) até o Worker sincronizar os dados. As rotas são abertas, como `/devices`.
- Lacre: `seal_code` e `nfc_uid` únicos; nasce `EM_ESTOQUE`; não pode ser cadastrado como `INSTALADO`.
- Cilindro: `cylinder_code` e `serial_number` únicos; nasce `DISPONIVEL`; estado alterado por `POST /cylinders/:cylinderCode/status`.
- Um lacre tem um cilindro ativo e um cilindro um lacre ativo (RN04); um lacre tem um dispositivo ativo e um dispositivo um lacre ativo (RN05). Conflito → `409`; entidade inexistente → `404`.
- `replace: true` faz a **troca** numa transação: encerra os vínculos em conflito com motivo "Substituído por novo vínculo" e cria o novo.
- Encerrar um vínculo preenche `ended_at` e `end_reason`; nada é apagado (RN21). Encerrar de novo → `409`.
- O estado do lacre segue o vínculo com o cilindro: vira `INSTALADO` ao ser instalado (só a partir de `EM_ESTOQUE` ou `REMOVIDO`, senão `409`) e `REMOVIDO` ao sair; lacre `SUSPEITA_VIOLACAO` ou `ROMPIDO` mantém o estado. `INSTALADO` não pode ser definido manualmente, e `EM_ESTOQUE`/`REMOVIDO` não podem ser definidos com cilindro ativo.
- Ao receber telemetria, a API preenche `lacre_id` e `cilindro_id` pelo vínculo ativo do dispositivo (valores do payload são ignorados) e registra em `error_type`, sem gerar alerta: `LACRE_ABERTO_EM_TRANSITO` (lacre `UNLOCKED`/`BROKEN` com cilindro `EM_TRANSITO`), `DISPOSITIVO_SEM_LACRE` ou `LACRE_SEM_CILINDRO`. Eventos registram o mesmo `error_type`.

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
| `lacre_id`, `cilindro_id` | `TEXT`, opcionais; preenchidos pela API com o vínculo ativo do dispositivo no recebimento. |
| `error_type` | `TEXT`, opcional; código do catálogo `Tipos-de-Erro.md` detectado no recebimento. |
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
| `command_type` | `TEXT NOT NULL`; quando `status = 'PENDENTE'`, só `TRAVAR_VALVULA` ou `DESTRAVAR_VALVULA` (`CHECK`). |
| `status` | `TEXT NOT NULL DEFAULT 'PENDENTE'`, `CHECK` em `PENDENTE`, `EXECUTADO`, `ERRO`. |
| `created_at` | `DATETIME NOT NULL`, sem default no schema. |
| `executed_at` | `DATETIME`, opcional. |
| `error_message` | `TEXT`, opcional. |

### `alerts`

| Coluna | Regra |
| --- | --- |
| `id` | Chave primária autoincremental. |
| `alert_id` | `TEXT NOT NULL UNIQUE`. |
| `device_id` | `TEXT NOT NULL`, FK para `devices.device_id`. |
| `alert_type` | `TEXT NOT NULL`, `CHECK` com os 28 códigos do catálogo `Tipos-de-Erro.md`. |
| `severity` | `TEXT NOT NULL`, `CHECK` em `BAIXA`, `MEDIA`, `ALTA`, `CRITICA`. |
| `status` | `TEXT NOT NULL DEFAULT 'ABERTO'`, `CHECK` em `ABERTO`, `EM_ANALISE`, `ENCERRADO`. |
| `title` | `TEXT NOT NULL`. |
| `description` | `TEXT`, opcional. |
| `created_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`. |
| `resolved_at` | `DATETIME`; preenchido pelo servidor ao encerrar. `CHECK`: só alerta `ENCERRADO` tem data, e todo `ENCERRADO` tem. |
| `resolved_by` | `TEXT`; quem encerrou (obrigatório na API ao encerrar). |
| `resolution_note` | `TEXT`; motivo do encerramento (obrigatório na API ao encerrar). |

### `seals` (lacres — cópia provisória do FluxID)

| Coluna | Regra |
| --- | --- |
| `seal_code` | `TEXT NOT NULL UNIQUE` (ex.: `LCR-000001`). |
| `nfc_uid` | `TEXT NOT NULL UNIQUE`. |
| `status` | `TEXT NOT NULL DEFAULT 'EM_ESTOQUE'`, `CHECK` com os estados de `lacres` do FluxID. |
| `created_at`, `updated_at` | `DATETIME`, preenchidos pelo banco. |

### `cylinders` (cilindros — cópia provisória do FluxID)

| Coluna | Regra |
| --- | --- |
| `cylinder_code` | `TEXT NOT NULL UNIQUE` (ex.: `CIL-000001`). |
| `serial_number` | `TEXT NOT NULL UNIQUE`. |
| `status` | `TEXT NOT NULL DEFAULT 'DISPONIVEL'`, `CHECK` com os estados de `cilindros` do FluxID. |
| `created_at`, `updated_at` | `DATETIME`, preenchidos pelo banco. |

### `seal_assignments` (dispositivo ↔ lacre) e `cylinder_assignments` (lacre ↔ cilindro)

| Coluna | Regra |
| --- | --- |
| `device_id` / `seal_code` | FKs para `devices` e `seals` (`seal_assignments`). |
| `seal_code` / `cylinder_code` | FKs para `seals` e `cylinders` (`cylinder_assignments`). |
| `started_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`. |
| `ended_at`, `end_reason` | Preenchidos ao encerrar; vínculo ativo = `ended_at` nulo. |

Índices únicos parciais (`WHERE ended_at IS NULL`) garantem um vínculo ativo por dispositivo, por lacre e por cilindro (RN04, RN05). As FKs usam `ON DELETE RESTRICT`: nada do histórico é apagado (RN21).

### Relacionamentos e integridade

- `devices.device_id` é a referência das FKs de `telemetry_queue`, `events`, `commands` e `alerts`.
- `device_status_id`, `valve_status_id` e `seal_status_id` não possuem FKs no schema atual.
- `lacre_id` e `cilindro_id` na telemetria guardam os códigos do vínculo ativo no momento do recebimento (registro histórico, sem FK).
- `seal_assignments` referencia `devices` e `seals`; `cylinder_assignments` referencia `seals` e `cylinders`, todas com `ON DELETE RESTRICT`.
- `message_id`, `device_id`, `api_key`, `command_id`, `alert_id` e `status.code` têm restrições de unicidade conforme descrito nas tabelas.
- As FKs de eventos, telemetrias e alertas usam o comportamento padrão do SQLite; comandos usam `ON UPDATE CASCADE` e `ON DELETE RESTRICT`.

## 6. Inicialização e migrações

- A aplicação cria `status`, `commands` e `alerts` quando ausentes e semeia os códigos faltantes de `status`.
- Se a tabela `commands` ainda não tiver o catálogo, recria a tabela de forma transacional preservando os comandos: `LOCK_VALVE` → `TRAVAR_VALVULA`, `UNLOCK_VALVE` → `DESTRAVAR_VALVULA`, pendente com tipo desconhecido → `ERRO` "tipo de comando descontinuado".
- Adiciona `device_status_id`, `valve_status_id` e `seal_status_id` a `devices` quando faltarem.
- Normaliza nomes legados de colunas.
- Se a tabela `telemetry_queue` tiver colunas ou nulabilidade legadas, recria a tabela de forma transacional e copia os registros, preenchendo defaults para campos novos.
- Adiciona `last_seen_at` quando a coluna não existir.
- Adiciona `last_repeat_message_id`, `seal_status` e `device_attempt_count` a `telemetry_queue`, e `device_attempt_count` a `events`, quando faltarem, além do índice `idx_telemetry_last_repeat_message_id`.
- Se a tabela `alerts` ainda tiver `status_id`/`severity_id`, recria a tabela de forma transacional com `severity` e `status` em texto, preservando os alertas (severidade pelo tipo; alerta já resolvido vira `ENCERRADO`).
- Cria os triggers que restringem `devices.active` a `0`/`1`; bancos antigos não têm o `CHECK` e o SQLite não permite adicioná-lo sem recriar a tabela.
- Cria o índice único `idx_devices_api_key` quando não há chaves duplicadas; se houver, a aplicação sobe normalmente e registra um aviso no console.
- Cria `seals`, `cylinders`, `seal_assignments` e `cylinder_assignments` com os índices únicos parciais, e adiciona `error_type` a `telemetry_queue` e `events`, quando ausentes.
- `sync_logs` e `sync_items` não fazem parte do schema atual da `oxide.db`.

## 7. Funcionalidades ainda fora do escopo implementado

- Geofence: configuração de áreas e detecção de entrada/saída.
- Geração automática de comandos.
- Teste formal do Worker e da integração com o PostgreSQL (implementados e testados pela IA em 07/10/2026; falta a validação).

## 8. Banco principal PostgreSQL FluxID

- FluxID é o banco PostgreSQL principal; `oxide.db` é o armazenamento local/buffer usado atualmente pela API.
- `FluxID.sql` é um dump PostgreSQL em formato custom (`PGDMP`), não um script SQL texto. Ele deve ser inspecionado/restaurado com `pg_restore`, não com `sqlite3` nem `psql -f`.
- O catálogo do dump identifica o banco `FluxID_db`, PostgreSQL/`pg_dump` 18.6, 214 entradas e as extensões `pgcrypto` e `postgis`.
- A API grava no SQLite; o Worker (`npm run worker`) envia a fila ao FluxID e traz o cadastro oficial de volta. As regras completas estão em [Integracao-Oxide-FluxID.md](Integracao-Oxide-FluxID.md) (v2.0). Teste formal da IA executado em 07/10/2026, sem falhas; falta a validação de Natã da Silva Baracho.

### 8.1 Tabelas FluxID relevantes

| Tabela PostgreSQL | Campos/regras relevantes para integração |
| --- | --- |
| `organizacoes` | Identificador UUID e dados da organização/tenant. |
| `dispositivos` | `id` UUID, `organizacao_id` obrigatório, `codigo` único, `identificador_hardware` único, `versao_firmware` e `ativo`. O `codigo` segue o mesmo padrão do `device_id` da Oxide. A chave de API fica em `api_key_hash` (SHA-256), criada pelo script `sql/fluxid/001_ajustes_estrutura.sql`. |
| `telemetrias` | `id` UUID, `dispositivo_id` UUID, `message_id` único, `data_coleta` obrigatória (hora de chegada, `DEFAULT now()` no `004`) e latitude/longitude obrigatórias; inclui velocidade, bateria, GSM, `payload_raw JSONB` e, desde o `004`, `lacre_id` e `cilindro_id`. Sem posição, a telemetria vai para `telemetrias_quarentena`. |
| `eventos_lacre` | Evento ligado a `lacre_id` obrigatório; `telemetria_id` opcional; tipo limitado a um catálogo de eventos de lacre. Eventos sem estado de lacre vão para `eventos_dispositivo` (`004`). |
| `alertas` | `organizacao_id`, código, tipo, severidade, status e `aberto_em` obrigatórios. Lacre e cilindro obrigatórios, salvo códigos de cadastro (`003`), e o par precisa ter vínculo na data do alerta (gatilho do `004`). Tipo com os códigos do catálogo (`004`). |
| `lacres`, `cilindros` | Entidades próprias com UUID, organização, código e status com catálogo limitado. |
| `vinculos_dispositivo_lacre` | Relação dispositivo/lacre com início, fim e dados de vínculo/desvínculo, permitindo registrar períodos. |
| `vinculos_cilindro_lacre` | Relação cilindro/lacre com início, fim e dados de instalação/remoção, permitindo registrar períodos. |

O dump não contém tabela `commands`. No dump de 23/09/2026 os IDs UUID não tinham valor padrão; o script `001_ajustes_estrutura.sql` acrescenta `DEFAULT gen_random_uuid()` às 21 tabelas, além de `eventos_lacre.message_id`, `dispositivos.api_key_hash`, índice de última posição e `CHECK` de coordenadas (ver `Banco_FluxID.md`, seção 17).

### 8.2 Mapeamento Oxide → FluxID (antes da implementação)

> Tabela histórica, da fase de análise. As decisões foram fechadas (P1 a P8) e o mapeamento implementado está em [Integracao-Oxide-FluxID.md](Integracao-Oxide-FluxID.md), seções 2 a 4.

| Origem Oxide | Destino FluxID | Diferença/decisão necessária |
| --- | --- | --- |
| `devices` | `dispositivos` | `device_id` texto pode corresponder a `codigo` ou `identificador_hardware`; definir a regra. FluxID exige `organizacao_id`, ausente no SQLite. |
| `telemetry_queue` | `telemetrias` | Mapear `device_id` para `dispositivo_id` UUID. FluxID exige `data_coleta`, latitude e longitude não nulas; Oxide aceita coordenadas ausentes e não tem timestamp de coleta equivalente garantido. Definir rejeição, quarentena ou ajuste de schema/política antes de sincronizar essas linhas. |
| `events` | `eventos_lacre` | Só há correspondência direta para eventos de lacre; FluxID exige `lacre_id`, usa outro catálogo de tipos. A idempotência usa `eventos_lacre.message_id` (script 001). Definir a resolução do lacre e os eventos sem estado de lacre. |
| `alerts` | `alertas` | FluxID exige organização, código, UUID, data de abertura e valores textuais de tipo/severidade/status; severidade e status já usam os mesmos valores nas duas bases; os tipos têm nomes diferentes. Definir todos os mapeamentos antes de inserir. |
| `commands` | Sem tabela no dump | Por enquanto ficam só na Oxide (entrega D); criar ou não uma entidade no PostgreSQL será decidido na fase do Worker. |
| `telemetry_queue.lacre_id` / `cilindro_id` | Vínculos FluxID | No SQLite esses campos são texto opcional sem FK; não são suficientes para reconstruir os vínculos históricos do FluxID. Usar as tabelas `vinculos_*` com regras temporais próprias. |

Tipos de alerta: a Oxide já grava os códigos do catálogo `Tipos-de-Erro.md`, e pela decisão P5 o `CHECK` de `alertas.tipo` do FluxID passa a aceitar esses mesmos códigos (script `004`, na entrega do Worker). As severidades FluxID aceitas são `BAIXA`, `MEDIA`, `ALTA` e `CRITICA`; os estados aceitos são `ABERTO`, `EM_ANALISE` e `ENCERRADO`.

### 8.3 Situação da sincronização

O fluxo completo, com as tabelas de conversão, as decisões P1 a P8 e as escolhas de implementação a validar, está em [Integracao-Oxide-FluxID.md](Integracao-Oxide-FluxID.md).

- ✅ Dump restaurado e analisado num servidor PostgreSQL temporário e no Docker (container `fluxid-analise`).
- ✅ `organizacao_id` e UUIDs: obtidos pelo `codigo` do dispositivo, lacre e cilindro no FluxID.
- ✅ Políticas aprovadas (P1 a P8) e implementadas no Worker e no script `004`.
- ✅ A Oxide guarda `api_key_hash` e compara o SHA-256 da `X-API-Key`.
- ✅ Teste formal do Worker pela IA (07/10/2026, sem falhas).
- ⏳ Validação de Natã da Silva Baracho.
- ⏳ Aplicar `001` a `005` no banco principal e gerar um novo dump.
- Credenciais do PostgreSQL: só no `.env` (fora do git), nunca registradas em documento.

Para o script de criação do banco e instruções do DB Browser, consulte [Oxidedb.md](Oxidedb.md). Para payloads do firmware, consulte [ESP32-envio-de-dados.md](ESP32-envio-de-dados.md).