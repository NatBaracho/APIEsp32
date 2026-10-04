# Oxide DB

## Especificação Profissional de Criação do Banco SQLite

**Buffer temporário de ingestão para dispositivos ESP32**

**Versão:** 1.0  
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
- A sincronização com PostgreSQL ainda não está implementada no projeto atual.

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
| status | alerts | 1:N | `alerts.status_id/severity_id → status.id` |

`device_status_id`, `valve_status_id` e `seal_status_id` são colunas opcionais em `devices`; atualmente não possuem constraints de chave estrangeira para `status`.

---

# 5. Descrição das Tabelas

| Tabela | Responsabilidade |
|----------|----------|
| devices | Dispositivos autorizados, API Key, firmware, estado booleano e IDs opcionais de estado |
| status | Catálogo de códigos e descrições de estado |
| telemetry_queue | Fila persistente de GPS, bateria, GSM, payload e `last_seen_at` |
| events | Fila temporária de eventos; `seal_status` representa o estado do lacre |
| commands | Comandos destinados aos dispositivos e estado de execução |
| alerts | Alertas associados a dispositivos, com tipo, estado, severidade e resolução |
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
    status TEXT NOT NULL DEFAULT 'PENDENTE',
    created_at DATETIME NOT NULL,
    executed_at DATETIME,
    error_message TEXT,
    FOREIGN KEY(device_id)
        REFERENCES devices(device_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    status_id INTEGER NOT NULL,
    severity_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    FOREIGN KEY (device_id) REFERENCES devices(device_id),
    FOREIGN KEY (status_id) REFERENCES status(id),
    FOREIGN KEY (severity_id) REFERENCES status(id)
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
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,

    FOREIGN KEY(device_id)
    REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,

    message_type TEXT NOT NULL,

    seal_status TEXT,

    payload_json TEXT,

    status TEXT DEFAULT 'PENDING',

    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,

    FOREIGN KEY(device_id)
    REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

-- events.status tracks synchronization; seal_status tracks the seal state.

COMMIT;
```

O campo da API `event_type` é gravado pela aplicação na coluna `events.message_type`. O endpoint valida `seal_status` para aceitar `LOCKED`, `UNLOCKED` ou `BROKEN`; essa lista é validada na aplicação, não por um `CHECK` na tabela.

Tipos de alerta previstos: `SEAL_BROKEN`, `GEOFENCE_EXIT`, `LOW_BATTERY`, `DEVICE_ERROR`, `COMMAND_FAILURE` e `COMMUNICATION_LOST`. O schema atual não inclui `CHECK` para restringir `alert_type` a essa lista.

> **Pendência de severidade:** `severity_id` referencia `status(id)` conforme o DDL solicitado, mas o catálogo atual contém estados de dispositivo/lacre, não níveis de severidade. Defina os códigos de severidade antes de inserir alertas com severidade validada semanticamente.

## 9. Tabelas não existentes no banco atual

- `sync_logs` e `sync_items`: planejadas para o Worker de sincronização, mas ainda não criadas na Oxide.db atual.
- Não existe uma tabela `telemetries`; o nome real da fila é `telemetry_queue`.
- `POST /api/v1/iot/alerts` cria alertas; ainda não existem rotas de consulta, atualização ou resolução de alertas.

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
```
