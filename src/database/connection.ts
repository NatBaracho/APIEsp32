import Database from "better-sqlite3";
import path from "path";

// Oxide: fila local da API (oxide.db), com três tabelas.
//   devices   - quem pode enviar (chave do lacre) e o último estado conhecido
//   mensagens - fila única de tudo o que o lacre manda, até chegar ao Supabase
//   commands  - comandos da válvula que o lacre busca e confirma
// Lacre, cilindro, vínculos, alertas e histórico ficam só no banco principal.

const databasePath = path.resolve(process.cwd(), "oxide.db");
const db: Database.Database = new Database(databasePath);

db.pragma("foreign_keys = ON");

const tabelaExiste = (nome: string): boolean =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome));

const colunasDe = (tabela: string): string[] =>
  (db.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>).map(c => c.name);

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL UNIQUE,
    api_key TEXT NOT NULL,
    -- SHA-256 da chave, vindo do banco principal; quando existe, a chave em texto deixa de valer
    api_key_hash TEXT,
    firmware_version TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    -- Último estado recebido: base da posição repetida e dos alertas automáticos
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
    CHECK (status <> 'PENDENTE' OR command_type IN ('TRAVAR_VALVULA', 'DESTRAVAR_VALVULA')),
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
      ON UPDATE CASCADE ON DELETE RESTRICT
  );
`);

// Banco criado por uma versão anterior: acrescenta o que falta em devices
const colunasNovas: Array<[string, string]> = [
  ["api_key_hash", "TEXT"], ["last_contact_at", "DATETIME"], ["last_latitude", "REAL"],
  ["last_longitude", "REAL"], ["last_gps_ok", "INTEGER"], ["last_seal_status", "TEXT"],
  ["last_battery_percent", "REAL"], ["last_signal", "INTEGER"],
  ["last_telemetry_message_id", "TEXT"], ["last_repeat_message_id", "TEXT"]
];
const colunasDevices = new Set(colunasDe("devices"));
for (const [coluna, tipo] of colunasNovas) {
  if (!colunasDevices.has(coluna)) db.exec(`ALTER TABLE devices ADD COLUMN ${coluna} ${tipo}`);
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_api_key_hash
    ON devices(api_key_hash) WHERE api_key_hash IS NOT NULL;
`);
const chavesRepetidas = db.prepare("SELECT api_key FROM devices GROUP BY api_key HAVING COUNT(*) > 1").all();
if (chavesRepetidas.length === 0) {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_api_key ON devices(api_key)");
} else {
  console.warn("⚠️ Existem API Keys duplicadas em devices; índice único não criado");
}

// Migração do modelo antigo (filas separadas, lacres, cilindros, vínculos).
// 1. Cópia de segurança do arquivo inteiro, antes de qualquer mudança.
// 2. O que estava nas filas antigas vai para mensagens como ARQUIVADA: fica
//    guardado, mas não é enviado ao banco principal (eram dados de teste).
// 3. As tabelas que saíram do modelo são removidas.
const tabelasAntigas = [
  "cylinder_assignments", "seal_assignments", "seals", "cylinders",
  "alerts", "events", "telemetry_queue", "sync_logs", "sync_items", "status"
].filter(tabelaExiste);

if (tabelasAntigas.length > 0) {
  const carimbo = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const copia = `${databasePath}.bak-antes-da-fila-unica-${carimbo}`;
  db.prepare("VACUUM INTO ?").run(copia);
  console.log(`📦 Modelo antigo encontrado. Cópia de segurança: ${copia}`);

  const filas: Array<[string, string, string]> = [
    ["telemetry_queue", "message_id", "TELEMETRIA"],
    ["events", "message_id", "EVENTO"],
    ["alerts", "alert_id", "ALERTA"]
  ];

  db.pragma("foreign_keys = OFF");
  db.transaction(() => {
    for (const [tabela, chave, tipo] of filas) {
      if (!tabelasAntigas.includes(tabela)) continue;
      const pares = colunasDe(tabela).map(c => `'${c}', "${c}"`).join(", ");
      const guardadas = db.prepare(`
        INSERT OR IGNORE INTO mensagens (message_id, device_id, tipo, payload_json, status)
        SELECT ${chave}, device_id, '${tipo}', json_object(${pares}), 'ARQUIVADA'
        FROM ${tabela}
        WHERE device_id IN (SELECT device_id FROM devices)
      `).run().changes;
      console.log(`   ${tabela}: ${guardadas} linha(s) guardada(s) como ARQUIVADA`);
    }
    for (const tabela of tabelasAntigas) db.exec(`DROP TABLE ${tabela}`);
    for (const coluna of ["device_status_id", "valve_status_id", "seal_status_id"]) {
      if (colunasDevices.has(coluna)) db.exec(`ALTER TABLE devices DROP COLUMN ${coluna}`);
    }
  })();
  db.pragma("foreign_keys = ON");
  console.log(`   Tabelas removidas: ${tabelasAntigas.join(", ")}`);
}

console.log("✅ SQLite conectado:", databasePath);

export default db;
