# Oxide DB

## Especificação Profissional de Criação do Banco SQLite

**Buffer temporário de ingestão para dispositivos ESP32**

**Versão:** 1.6  
**Projeto:** FluxID / Oxide IoT

Inclui instruções de criação, modelo de dados e script SQL completo.

---

# 1. Objetivo do Documento

Este documento descreve o schema atual do banco SQLite `oxide.db`, explica o papel das tabelas existentes e fornece um script de criação compatível com esse schema.

O banco atua como armazenamento local da API e fila persistente. O Worker e as tabelas `sync_logs`/`sync_items` ainda são etapas futuras e não fazem parte do arquivo atual.

---

# 2. Arquitetura

```text
ESP32 / Postman
         ↓
     Oxide API
         ↓
     SQLite
         ⋯
Worker de sincronização (futuro)
```

## Fluxo

- O ESP32 envia telemetrias e eventos para a API.
- A API autentica o dispositivo, valida o JSON e grava a mensagem no SQLite.
- Telemetrias, eventos e comandos são mantidos localmente no SQLite.
- A tabela `commands` armazena comandos destinados aos dispositivos e seus resultados.
- Através desta API e do seu Worker de sincronização futuro, as telemetrias, eventos e comandos armazenados no SQLite serão sincronizados com o banco principal PostgreSQL (FluxID).

---

# 3. Escopo e Decisões

| Decisão | Definição |
|----------|----------|
| Banco | SQLite (`oxide.db`) |
| Uso | Buffer temporário de ingestão IoT |
| Autenticação | API Key por dispositivo |
| Idempotência | `message_id` único |
| Estados | `PENDING`, `PROCESSING`, `SYNCED`, `ERROR` |
| Catálogo de domínio | Tabela `status`, separada dos estados de sincronização |
| Banco oficial | PostgreSQL FluxID |
| Datas | Geradas/controladas pela API ou Worker |

> **Importante:** `sync_logs` e `sync_items` não existem na Oxide.db atual. Seus repositórios e o Worker de sincronização permanecem planejados para uma etapa futura.

> **Por que existe a tabela `status`:** `events.status` representa o processamento da fila (`PENDING`, `PROCESSING`, `SYNCED`, `ERROR`). Os códigos `ACTIVE`/`INACTIVE` representam o dispositivo (`devices.active` igual a `1`/`0`), e `LOCKED`/`UNLOCKED`/`BROKEN` representam o lacre em `events.seal_status`. O catálogo separado guarda os nomes e descrições sem misturar esses conceitos.

---

# 4. Modelo de Dados

## Relacionamentos

| Origem | Destino | Cardinalidade | FK |
|--------|---------|---------------|----|
| devices | telemetry_queue | 1:N | `telemetry_queue.device_id → devices.device_id` |
| devices | events | 1:N | `events.device_id → devices.device_id` |
| devices | commands | 1:N | `commands.device_id → devices.device_id` |
| devices | alerts | 1:N | `alerts.device_id → devices.device_id` |
| devices / seals | seal_assignments | 1:N | `seal_assignments.device_id → devices.device_id`; `seal_assignments.seal_code → seals.seal_code` |
| seals / cylinders | cylinder_assignments | 1:N | `cylinder_assignments.seal_code → seals.seal_code`; `cylinder_assignments.cylinder_code → cylinders.cylinder_code` |

`device_status_id`, `valve_status_id` e `seal_status_id` são colunas opcionais em `devices`; atualmente não possuem constraints de chave estrangeira para `status`.

---

# 5. Descrição das Tabelas

| Tabela | Responsabilidade |
|----------|----------|
| devices | Dispositivos autorizados, API Key, firmware, estado booleano e IDs opcionais de estado |
| status | Catálogo de códigos e descrições de estado |
| telemetry_queue | Fila persistente de GPS, bateria, GSM, estado do lacre (`seal_status`), payload, `last_seen_at`, tentativas de envio do ESP32 (`device_attempt_count`) e `message_id` da última posição repetida (`last_repeat_message_id`) |
| events | Fila temporária de eventos; `seal_status` representa o estado do lacre |
| commands | Comandos destinados aos dispositivos e estado de execução |
| alerts | Alertas associados a dispositivos, com tipo, estado, severidade e resolução |
| seals / cylinders | Lacres e cilindros (cópia provisória do cadastro do FluxID) |
| seal_assignments / cylinder_assignments | Histórico de vínculos dispositivo ↔ lacre e lacre ↔ cilindro; ativo = `ended_at` nulo |
| sync_logs / sync_items | Ainda não existem no banco atual; previstos para o Worker futuro |

---

# 6. Pré-Requisitos

- SQLite 3 instalado ou DB Browser for SQLite
- Permissão de escrita na pasta do banco
- Script salvo em UTF-8
- Backup do banco antes de alterações estruturais

---

# 7. Instruções de Criação

## Opção A — DB Browser for SQLite

1. Abrir DB Browser for SQLite
2. Criar novo banco
3. Salvar como `oxide.db`
4. Abrir a aba **Executar SQL**
5. Colar o script da seção 8
6. Executar
7. Salvar alterações
8. Executar validações da seção 9

---

## Opção B — Terminal

```bash
sqlite3 oxide.db
.read create_oxide_db.sql
.quit
```

---

# 8. Script SQL Completo

```sql
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL UNIQUE,
    api_key TEXT NOT NULL,
    firmware_version TEXT,
    active INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0,1)),
    device_status_id INTEGER,
    valve_status_id INTEGER,
    seal_status_id INTEGER
);

-- Cada dispositivo tem uma API Key exclusiva
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_api_key
    ON devices(api_key);

CREATE TABLE IF NOT EXISTS status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT
);

INSERT OR IGNORE INTO status (code, name, description) VALUES
    ('ACTIVE', 'Ativo', 'Dispositivo ativo'),
    ('INACTIVE', 'Desativado', 'Dispositivo inativo'),
    ('LOCKED', 'Travado', 'Lacre travado'),
    ('UNLOCKED', 'Destravado', 'Lacre destravado'),
    ('BROKEN', 'Rompido', 'Lacre rompido');

CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDENTE'
        CHECK (status IN ('PENDENTE', 'EXECUTADO', 'ERRO')),
    created_at DATETIME NOT NULL,
    executed_at DATETIME,
    error_message TEXT,
    -- Comando pendente só com tipo do catálogo; histórico pode guardar tipos antigos
    CHECK (
        status <> 'PENDENTE'
        OR command_type IN ('TRAVAR_VALVULA', 'DESTRAVAR_VALVULA')
    ),
    FOREIGN KEY(device_id)
        REFERENCES devices(device_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    alert_type TEXT NOT NULL
        CHECK (alert_type IN (
            'LACRE_VIOLADO', 'LACRE_ABERTO_EM_TRANSITO', 'LACRE_ABERTO_SEM_AUTORIZACAO',
            'DISPOSITIVO_SEM_LACRE', 'LACRE_SEM_CILINDRO', 'LACRE_SEM_DISPOSITIVO',
            'LACRE_REVISAO_VENCIDA', 'LACRE_REPROVADO_EM_USO',
            'CILINDRO_SEM_CLIENTE', 'CILINDRO_SEM_LACRE', 'TESTE_HIDROSTATICO_VENCIDO',
            'CILINDRO_REPROVADO_EM_USO',
            'GPS_INATIVO', 'GPS_SEM_SINAL', 'POSICAO_INVALIDA', 'SAIDA_GEOCERCA',
            'SAIDA_ROTA', 'MOVIMENTACAO_SUSPEITA', 'PARADA_PROLONGADA',
            'BATERIA_BAIXA', 'SEM_COMUNICACAO', 'GSM_SINAL_FRACO', 'DISPOSITIVO_FALHA',
            'DISPOSITIVO_NAO_CADASTRADO', 'CHAVE_INVALIDA',
            'COMANDO_FALHOU', 'COMANDO_SEM_RESPOSTA', 'COMANDO_DESCONTINUADO'
        )),
    severity TEXT NOT NULL
        CHECK (severity IN ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),
    status TEXT NOT NULL DEFAULT 'ABERTO'
        CHECK (status IN ('ABERTO', 'EM_ANALISE', 'ENCERRADO')),
    title TEXT NOT NULL,
    description TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    resolved_by TEXT,
    resolution_note TEXT,
    CHECK ((status = 'ENCERRADO') = (resolved_at IS NOT NULL)),
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
);

CREATE TABLE IF NOT EXISTS telemetry_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    lacre_id TEXT,
    cilindro_id TEXT,
    latitude REAL,
    longitude REAL,
    speed_kmh REAL,
    battery_percent REAL,
    gsm_signal INTEGER,
    payload_json TEXT,
    last_seen_at DATETIME,
    seal_status TEXT,
    device_attempt_count INTEGER,
    last_repeat_message_id TEXT,
    error_type TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,

    FOREIGN KEY(device_id)
    REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

-- Busca do message_id da última posição repetida (idempotência)
CREATE INDEX IF NOT EXISTS idx_telemetry_last_repeat_message_id
    ON telemetry_queue(last_repeat_message_id);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,

    message_type TEXT NOT NULL,

    seal_status TEXT,

    payload_json TEXT,

    device_attempt_count INTEGER,

    error_type TEXT,

    status TEXT DEFAULT 'PENDING',

    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,

    FOREIGN KEY(device_id)
    REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

-- events.status tracks synchronization; seal_status tracks the seal state.

-- Associação dispositivo → lacre → cilindro (cópia provisória do FluxID)
CREATE TABLE IF NOT EXISTS seals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seal_code TEXT NOT NULL UNIQUE,
    nfc_uid TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'EM_ESTOQUE'
        CHECK (status IN ('EM_ESTOQUE', 'INSTALADO', 'SUSPEITA_VIOLACAO', 'ROMPIDO',
                          'REMOVIDO', 'DANIFICADO', 'INUTILIZADO')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cylinders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cylinder_code TEXT NOT NULL UNIQUE,
    serial_number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'DISPONIVEL'
        CHECK (status IN ('DISPONIVEL', 'EM_TRANSITO', 'COM_CLIENTE',
                          'MANUTENCAO', 'EXTRAVIADO', 'INATIVO')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seal_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    seal_code TEXT NOT NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    end_reason TEXT,
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (seal_code) REFERENCES seals(seal_code) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS cylinder_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seal_code TEXT NOT NULL,
    cylinder_code TEXT NOT NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    end_reason TEXT,
    FOREIGN KEY (seal_code) REFERENCES seals(seal_code) ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (cylinder_code) REFERENCES cylinders(cylinder_code) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- Um vínculo ativo por vez (RN04, RN05)
CREATE UNIQUE INDEX IF NOT EXISTS uq_seal_assignment_device_active
    ON seal_assignments (device_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_seal_assignment_seal_active
    ON seal_assignments (seal_code) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cylinder_assignment_seal_active
    ON cylinder_assignments (seal_code) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cylinder_assignment_cylinder_active
    ON cylinder_assignments (cylinder_code) WHERE ended_at IS NULL;

COMMIT;
```

Este script já cria `devices.active` com `CHECK (active IN (0,1))`. Bancos criados por versões antigas não têm esse `CHECK`; neles, a aplicação cria na inicialização os triggers `trg_devices_active_insert` e `trg_devices_active_update`, que rejeitam outros valores com a mesma mensagem `CHECK constraint failed`. A aplicação também cria os índices `idx_devices_api_key` e `idx_telemetry_last_repeat_message_id` e adiciona as colunas `seal_status`, `device_attempt_count` e `last_repeat_message_id` (telemetria) e `device_attempt_count` (eventos) quando estão ausentes.

Em `telemetry_queue` e `events`, `status` e `attempt_count` controlam a sincronização feita pelo Worker; `device_attempt_count` guarda as tentativas de envio informadas pelo ESP32.

O campo da API `event_type` é gravado pela aplicação na coluna `events.message_type`. O endpoint valida `seal_status` para aceitar `LOCKED`, `UNLOCKED` ou `BROKEN`; essa lista é validada na aplicação, não por um `CHECK` na tabela.

Tipos de alerta: os códigos em português do catálogo [Tipos-de-Erro.md](Tipos-de-Erro.md), garantidos por `CHECK`. Na transição, a API aceita os nomes antigos em inglês (`SEAL_BROKEN`, `GEOFENCE_EXIT`, `LOW_BATTERY`, `DEVICE_ERROR`, `COMMAND_FAILURE`, `COMMUNICATION_LOST`) e grava o código em português. Alerta `ENCERRADO` sempre tem `resolved_at` (e só ele), com quem encerrou (`resolved_by`) e o motivo (`resolution_note`).

> **Severidade e status do alerta:** usam texto com os mesmos valores do FluxID (`BAIXA`/`MEDIA`/`ALTA`/`CRITICA` e `ABERTO`/`EM_ANALISE`/`ENCERRADO`). Bancos criados antes disso tinham `status_id` e `severity_id` apontando para `status(id)`; a aplicação migra a tabela `alerts` automaticamente, preservando os alertas (severidade pelo tipo; alerta já resolvido vira `ENCERRADO`). Bancos com tipos em inglês também são migrados ao iniciar: os 6 nomes antigos viram os códigos em português e um tipo desconhecido vira `DISPOSITIVO_FALHA`, com o tipo original anotado na descrição.

## 9. Tabelas não existentes no banco atual

- `sync_logs` e `sync_items`: planejadas para o Worker de sincronização, mas ainda não criadas na Oxide.db atual.
- Não existe uma tabela `telemetries`; o nome real da fila é `telemetry_queue`.
- `POST /api/v1/iot/alerts` cria alertas; `GET /api/v1/iot/alerts` lista; `PATCH /api/v1/iot/alerts/{alert_id}/status` passa para `EM_ANALISE` ou `ENCERRADO`.

## 10. Verificação do schema

Após criar ou abrir a base, confira as tabelas e colunas com:

```sql
SELECT name
FROM sqlite_master
WHERE type = 'table'
ORDER BY name;

PRAGMA table_info(devices);
PRAGMA table_info(status);
PRAGMA table_info(commands);
PRAGMA table_info(alerts);
PRAGMA table_info(events);
PRAGMA table_info(telemetry_queue);
PRAGMA index_list(telemetry_queue);
PRAGMA table_info(seals);
PRAGMA table_info(cylinders);
PRAGMA index_list(seal_assignments);
PRAGMA index_list(cylinder_assignments);
PRAGMA index_list(devices);

SELECT name FROM sqlite_master WHERE type = 'trigger';
```
