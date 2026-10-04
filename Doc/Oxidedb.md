# Oxide DB

## Especificação Profissional de Criação do Banco SQLite

**Buffer temporário de ingestão para dispositivos ESP32**

**Versão:** 1.0  
**Projeto:** FluxID / Oxide IoT

Inclui instruções de criação, modelo de dados e script SQL completo.

---

# 1. Objetivo do Documento

Este documento descreve como criar o banco SQLite `oxide.db`, explica o papel de cada tabela e fornece um script SQL completo e executável.

O banco atua como buffer temporário entre a Oxide API e o PostgreSQL do FluxID.

---

# 2. Arquitetura

```text
ESP32
   ↓
Oxide API
   ↓
SQLite (oxide.db)
   ↓
Worker de Sincronização
   ↓
PostgreSQL (FluxID)
```

## Fluxo

- O ESP32 envia telemetrias e eventos para a API.
- A API autentica o dispositivo, valida o JSON e grava a mensagem no SQLite.
- O Worker lê registros pendentes e os envia ao PostgreSQL.
- O PostgreSQL é a fonte oficial dos dados.
- O SQLite funciona apenas como fila persistente temporária.

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

> **Importante:** Os campos `started_at` e `finished_at` de `sync_logs` são preenchidos pela API ou Worker. As tabelas de fila não dependem de data enviada pelo ESP32.

> **Por que existe a tabela `status`:** `events.status` representa o processamento da fila (`PENDING`, `PROCESSING`, `SYNCED`, `ERROR`). Os códigos `ACTIVE`/`INACTIVE` representam o dispositivo (`devices.active` igual a `1`/`0`), e `LOCKED`/`UNLOCKED`/`BROKEN` representam o lacre em `events.seal_status`. O catálogo separado guarda os nomes e descrições sem misturar esses conceitos.

---

# 4. Modelo de Dados

## Relacionamentos

| Origem | Destino | Cardinalidade | FK |
|--------|---------|---------------|----|
| devices | telemetries | 1:N | `telemetries.device_id → devices.device_id` |
| devices | events | 1:N | `events.device_id → devices.device_id` |
| sync_logs | sync_items | 1:N | `sync_items.sync_log_id → sync_logs.id` |

> O campo `sync_items.entity_id` é uma referência lógica. Dependendo de `entity_type`, ele aponta para um registro em `telemetries` ou `events`. O SQLite não suporta uma FK polimórfica para duas tabelas diferentes.

---

# 5. Descrição das Tabelas

| Tabela | Responsabilidade |
|----------|----------|
| devices | Dispositivos autorizados, API Key, firmware e estado (`active`: `1` ACTIVE, `0` INACTIVE) |
| status | Catálogo de códigos e descrições de estado |
| telemetries | Fila temporária de GPS, bateria, GSM e payload |
| events | Fila temporária de eventos; `seal_status` representa o estado do lacre |
| sync_logs | Execuções do processo de sincronização |
| sync_items | Itens processados em uma sincronização |

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
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL UNIQUE,
    api_key TEXT NOT NULL,
    firmware_version TEXT,
    active INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0,1))
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

CREATE TABLE IF NOT EXISTS telemetries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    latitude REAL
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude REAL
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    speed_kmh REAL
        CHECK (speed_kmh IS NULL OR speed_kmh >= 0),
    battery_percent REAL
        CHECK (battery_percent IS NULL OR battery_percent BETWEEN 0 AND 100),
    gsm_signal INTEGER,
    payload_json TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','PROCESSING','SYNCED','ERROR')),
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

    event_type TEXT NOT NULL
        CHECK (event_type IN (
            'VIOLATION',
            'OPEN',
            'CLOSE',
            'BATTERY_LOW',
            'GPS_LOST',
            'GPS_RESTORED',
            'TAMPER_DETECTED',
            'DEVICE_RESTART'
        )),

    seal_status TEXT
        CHECK (
            seal_status IS NULL OR
            seal_status IN ('LOCKED','UNLOCKED','BROKEN')
        ),

    payload_json TEXT,

    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (
            status IN (
                'PENDING',
                'PROCESSING',
                'SYNCED',
                'ERROR'
            )
        ),

    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,

    FOREIGN KEY(device_id)
    REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

-- events.status tracks synchronization; seal_status tracks the seal state.

CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    started_at TEXT NOT NULL,

    finished_at TEXT,

    status TEXT NOT NULL
        CHECK (
            status
