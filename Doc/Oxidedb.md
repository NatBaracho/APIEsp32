# Oxide DB

## Banco local da API do lacre (SQLite)

**Versão:** 2.0 — 10/10/2026 — **aprovado por Natã da Silva Baracho em 10/10/2026**
**Projeto:** FluxID / Oxide IoT

A Oxide (`oxide.db`) é a **fila local** da API: guarda o que o lacre envia até chegar ao banco principal (Supabase). Desde a versão 2.0 ela tem só **três tabelas**.

---

# 1. O que mudou na versão 2.0

| Antes (11 tabelas) | Agora (3 tabelas) |
| --- | --- |
| `telemetry_queue`, `events`, `alerts` | `mensagens`: uma fila única para tudo o que o lacre manda |
| `seals`, `cylinders`, `seal_assignments`, `cylinder_assignments` | Saíram. Lacre, cilindro e vínculos ficam só no banco principal |
| `status`, `sync_logs` | Saíram. O resultado da última rodada do Worker fica no arquivo `oxide-worker.json` |
| `devices`, `commands` | Continuam |

# 2. Fluxo

```text
Lacre ──► API (valida) ──► mensagens (fila) ──► Worker ──► Supabase
                              ▲                   │
            devices e commands ◄── cadastro e comandos do Supabase
```

# 3. Tabelas

| Tabela | Para quê |
| --- | --- |
| `devices` | Quem pode enviar: código, chave (ou o hash vindo do banco principal), ativo ou não, e o **último estado recebido** (contato, posição, GPS, lacre, bateria e sinal) |
| `mensagens` | Fila única: leitura, evento, alerta e confirmação de comando, com a mensagem validada em JSON, a hora de chegada e a situação do envio |
| `commands` | Comandos da válvula vindos do banco principal, que o lacre busca e confirma |

### Situação de uma mensagem (`mensagens.status`)

| Valor | Significado |
| --- | --- |
| `PENDING` | Pronta para enviar |
| `PROCESSING` | Sendo enviada. Se o Worker parar no meio, volta para a fila sem gastar tentativa |
| `SYNCED` | Gravada no banco principal |
| `ERROR` com `next_attempt_at` | Falhou; nova tentativa marcada (1 min, 5 min, 15 min, 1 h e 6 h) |
| `ERROR` sem `next_attempt_at` | Parada: recusada pelo banco principal ou sem tentativas. Precisa do gestor |
| `ARQUIVADA` | Veio do modelo antigo **sem posição ou sem bateria**. Fica guardada, mas não é enviada, porque o banco principal exige as duas |

# 4. Criação e migração

**As tabelas são criadas pela própria API ao iniciar.** Não é preciso rodar script.

Se a API encontrar um banco no modelo antigo, ela faz, nesta ordem:

1. uma **cópia de segurança** do arquivo inteiro, ao lado do original: `oxide.db.bak-antes-da-fila-unica-<data>`;
2. passa para `mensagens` tudo o que estava nas filas antigas (`telemetry_queue`, `events` e `alerts`):
   - a leitura que tem posição e bateria é convertida para o formato atual e entra na fila (`PENDING`), para seguir ao banco principal. Se ela já existir lá, o banco principal responde "repetida" e não duplica;
   - o que não tem posição ou bateria fica guardado como `ARQUIVADA`;
3. remove as tabelas que saíram do modelo e as três colunas antigas de `devices` que não eram usadas.

Os dispositivos e os comandos são mantidos. A migração roda uma vez só.

# 5. Script SQL de referência

Igual ao que a API cria (`src/database/connection.ts`).

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL UNIQUE,
    api_key TEXT NOT NULL,
    -- SHA-256 da chave, vindo do banco principal; quando existe, a chave em texto deixa de valer
    api_key_hash TEXT,
    firmware_version TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    -- Último estado recebido do lacre
    last_contact_at DATETIME,
    last_latitude REAL,
    last_longitude REAL,
    last_gps_ok INTEGER,
    last_seal_status TEXT,
    last_battery_percent REAL,
    last_signal INTEGER,
    last_telemetry_message_id TEXT,
    last_repeat_message_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_api_key ON devices(api_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_api_key_hash
    ON devices(api_key_hash) WHERE api_key_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS mensagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    tipo TEXT NOT NULL
        CHECK (tipo IN ('TELEMETRIA', 'EVENTO', 'ALERTA', 'CONFIRMACAO_COMANDO')),
    -- A mensagem já validada, no formato que vai para o banco principal
    payload_json TEXT NOT NULL,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'SYNCED', 'ERROR', 'ARQUIVADA')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at DATETIME,
    synced_at DATETIME,
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_mensagens_fila ON mensagens (status, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS idx_mensagens_device ON mensagens (device_id, id);

CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDENTE'
        CHECK (status IN ('PENDENTE', 'EXECUTADO', 'ERRO')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    executed_at DATETIME,
    error_message TEXT,
    -- Comando pendente só com tipo do catálogo; o histórico pode guardar tipos antigos
    CHECK (status <> 'PENDENTE' OR command_type IN ('TRAVAR_VALVULA', 'DESTRAVAR_VALVULA')),
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
```

# 6. Manutenção

| Comando | O que faz |
| --- | --- |
| `npm run backup` | Cópia consistente em `backups/` (pode rodar com a API ligada), conferida com `integrity_check`. Mantém as 14 mais novas |
| `npm run retencao` | Mostra o que sairia: mensagens **já enviadas** há mais de 30 dias e comandos concluídos há mais de 30 dias |
| `npm run retencao -- --confirmar` | Apaga de fato. Faça o backup antes |
| `npm run retencao -- --arquivadas --confirmar` | Apaga também as mensagens `ARQUIVADA` (antigas, sem posição ou bateria) |

Mensagem que ainda não chegou ao banco principal nunca é apagada.

# 7. Verificação

```sql
SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
-- esperado: commands, devices, mensagens (e sqlite_sequence)

SELECT tipo, status, count(*) FROM mensagens GROUP BY tipo, status;
PRAGMA integrity_check;
PRAGMA foreign_key_check;
```

# 8. Histórico do documento

| Versão | Data | Mudança |
| --- | --- | --- |
| 1.0 a 1.8 | até 07/10/2026 | Modelo com filas separadas, alertas, lacres, cilindros, vínculos e registro das rodadas do Worker |
| 2.0 | 10/10/2026 | Modelo enxuto: `devices`, `mensagens` e `commands`; migração automática com cópia de segurança |
