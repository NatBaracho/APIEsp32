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
| `devices` | Quem pode enviar: código, chave (ou o hash vindo do banco principal), ativo ou não, o **último estado recebido** (contato, posição, GPS, lacre, bateria e sinal), a **ativação** (identificador do lacre, ativo ou não) e o **vínculo atual** (cilindro e cliente) |
| `mensagens` | Fila única: leitura, evento, alerta, confirmação de comando e aviso de ativação, com a mensagem validada em JSON, a hora de chegada e a situação do envio |
| `commands` | Comandos da válvula vindos do banco principal, que o lacre busca e confirma |

### Ativação e vínculo (`devices`)

| Coluna | O que guarda |
| --- | --- |
| `seal_code` | Identificador do lacre, gerado pela API na primeira ativação (`LCR-` e 8 caracteres). Não se repete e nunca muda |
| `activation_status` | `ATIVO` ou `INATIVO` |
| `activated_at`, `deactivated_at` | Datas da ativação e da desativação |
| `binding_id` | Identificador do vínculo no sistema principal |
| `cylinder_code` | Código do cilindro vinculado |
| `customer_code`, `customer_name` | Cliente |
| `bound_at` | Data da vinculação |
| `ended_binding` | Vínculo que o lacre encerrou ao desativar, para ele não voltar |
| `binding_alert` | Alerta de vínculo já aberto para a situação atual, para não repetir |

O cadastro de lacres, cilindros e clientes e o histórico dos vínculos continuam só no sistema principal. A Oxide guarda apenas o vínculo que vale agora.

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

1. uma **cópia de segurança** do arquivo inteiro, ao lado do original e **antes de qualquer mudança**: `oxide.db.bak-antes-da-fila-unica-<data>`. A cópia sai igual ao arquivo antigo;
2. refaz no formato atual as tabelas que continuam e têm definição diferente (`devices` e `commands`), com os mesmos dados. Assim o banco migrado fica igual a um banco novo;
3. passa para `mensagens` tudo o que estava nas filas antigas (`telemetry_queue`, `events` e `alerts`):
   - a leitura que tem posição e bateria é convertida para o formato atual e entra na fila (`PENDING`), para seguir ao banco principal. Se ela já existir lá, o banco principal responde "repetida" e não duplica;
   - o que não tem posição ou bateria fica guardado como `ARQUIVADA`;
4. remove as tabelas que saíram do modelo.

Os dispositivos e os comandos são mantidos. A migração roda uma vez só.

O mesmo vale para um banco já no modelo de três tabelas, mas de uma versão anterior (por exemplo, sem as colunas da ativação e do vínculo): a API faz a cópia `oxide.db.bak-antes-da-atualizacao-<data>` e refaz as tabelas com os mesmos dados. Se uma linha antiga não couber nas regras atuais, a API não sobe e nada é alterado; a cópia de segurança já terá sido feita.

## 4.1 Modo de gravação (WAL) e gravação ao mesmo tempo

A API e o Worker são processos diferentes e gravam no mesmo arquivo.

- **Modo WAL.** O banco anota as mudanças no arquivo `oxide.db-wal` e as passa depois para o `oxide.db`. Quem lê não trava quem grava. Ao lado do banco ficam `oxide.db-wal` e `oxide.db-shm` (os dois fora do Git).
- **Vez de gravar.** Toda operação que grava pede a vez logo no início e espera a do outro processo (até 5 segundos), em vez de falhar.
- **Cópia do banco.** Com a API ligada, copiar só o `oxide.db` à mão pode levar uma cópia incompleta. Use sempre `npm run backup`: ele gera um arquivo só, completo.
- **Pasta sincronizada (OneDrive e parecidos).** O sincronizador pode copiar o `oxide.db` sem os dois arquivos ao lado. Para o banco em uso, prefira uma pasta que não seja sincronizada.

Medida no teste em massa de 10/10/2026 (500 lacres, 15.010 pedidos): 40 pedidos por segundo antes do modo WAL e 588 depois; a resposta mais lenta caiu de 7.258 ms para 220 ms.

# 5. Script SQL de referência

Igual ao que a API cria (`src/database/connection.ts`).

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

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
    last_repeat_message_id TEXT,
    -- Identificador do lacre, gerado pela API na primeira ativação
    seal_code TEXT UNIQUE,
    activation_status TEXT NOT NULL DEFAULT 'INATIVO' CHECK (activation_status IN ('ATIVO', 'INATIVO')),
    activated_at DATETIME,
    deactivated_at DATETIME,
    -- Vínculo atual, mandado pelo sistema principal: cilindro e cliente
    binding_id TEXT,
    cylinder_code TEXT,
    customer_code TEXT,
    customer_name TEXT,
    bound_at DATETIME,
    ended_binding TEXT,
    binding_alert TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_api_key ON devices(api_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_api_key_hash
    ON devices(api_key_hash) WHERE api_key_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS mensagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    tipo TEXT NOT NULL
        CHECK (tipo IN ('TELEMETRIA', 'EVENTO', 'ALERTA', 'CONFIRMACAO_COMANDO', 'ATIVACAO')),
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

# 8. Como ver o que está na Oxide

A Oxide é um arquivo (`oxide.db`): não tem porta nem endereço próprio. Há dois jeitos de ver o que está nela.

**Pela API** (porta 3000), no navegador:

| Endereço | O que mostra | Tabela |
| --- | --- | --- |
| `http://localhost:3000/api/v1/iot/messages` | As últimas mensagens recebidas. Filtros: `type`, `device_id` e `limit` | `mensagens` |
| `http://localhost:3000/api/v1/devices` | Os dispositivos, com o último estado, o identificador do lacre e o vínculo. Nunca mostra a chave | `devices` |
| `http://localhost:3000/api/v1/sync/status` | A fila em números e a última rodada do Worker | `mensagens` |
| `http://localhost:3000/api/v1/sync/problems` | As mensagens que não chegaram ao banco principal | `mensagens` |
| `http://localhost:3000/health` | Resumo da fila e a quantidade de comandos pendentes | `mensagens` e `commands` |

A lista completa dos endpoints está em [Como-o-Sistema-se-Comporta.md](Como-o-Sistema-se-Comporta.md), seção 14.

**Direto no arquivo**, com um programa de SQLite (por exemplo, o DB Browser for SQLite). Com a API ligada, faça uma cópia com `npm run backup` e abra a cópia, que fica na pasta `backups/`; não abra o arquivo em uso para gravar.

# 9. Histórico do documento

| Versão | Data | Mudança |
| --- | --- | --- |
| 1.0 a 1.8 | até 07/10/2026 | Modelo com filas separadas, alertas, lacres, cilindros, vínculos e registro das rodadas do Worker |
| 2.0 | 10/10/2026 | Modelo enxuto: `devices`, `mensagens` e `commands`; migração automática com cópia de segurança |
| 2.1 | 10/10/2026 | Depois do teste do banco e do teste em massa: a migração refaz `devices` e `commands` no formato atual; cópia de segurança antes de qualquer mudança; modo WAL; operações de gravação pedem a vez no início (nova seção 4.1). **Aprovado por Natã da Silva Baracho em 10/10/2026** |
| 2.2 | 10/10/2026 | Ativação e vínculo: colunas novas em `devices` (identificador do lacre, ativação, cilindro e cliente); tipo `ATIVACAO` em `mensagens`; cópia de segurança `bak-antes-da-atualizacao` para banco de versão anterior. **Aprovado por Natã da Silva Baracho em 10/10/2026** |
| 2.3 | 10/10/2026 | Nova seção 8: como ver o que está na Oxide, pela API e direto no arquivo |
