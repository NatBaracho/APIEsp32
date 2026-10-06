import Database from "better-sqlite3";
import path from "path";

// Caminho do banco
const databasePath = path.resolve(process.cwd(), "oxide.db");

// Cria conexão com tipo explícito para evitar erro de exportação em TS
const db: Database.Database = new Database(databasePath);

// Habilita Foreign Keys
db.pragma("foreign_keys = ON");

const statusTableExists = db
  .prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?")
  .get("table", "status");

if (!statusTableExists) {
  db.exec(`
    CREATE TABLE status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT
    )
  `);
}

const statusSeeds: Array<[string, string, string]> = [
  ["ACTIVE", "Ativo", "Dispositivo ativo"],
  ["INACTIVE", "Desativado", "Dispositivo inativo"],
  ["LOCKED", "Travado", "Lacre travado"],
  ["UNLOCKED", "Destravado", "Lacre destravado"],
  ["BROKEN", "Rompido", "Lacre rompido"]
];
const existingStatusCodes = new Set(
  (db.prepare("SELECT code FROM status").all() as Array<{ code: string }>)
    .map(status => status.code)
);
const missingStatuses = statusSeeds.filter(
  ([code]) => !existingStatusCodes.has(code)
);

if (missingStatuses.length > 0) {
  const insertStatus = db.prepare(`
    INSERT OR IGNORE INTO status (code, name, description)
    VALUES (?, ?, ?)
  `);
  const seedMissingStatuses = db.transaction(() => {
    for (const status of missingStatuses) {
      insertStatus.run(...status);
    }
  });

  seedMissingStatuses();
}

db.exec(`
  CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDENTE',
    created_at DATETIME NOT NULL,
    executed_at DATETIME,
    error_message TEXT,
    FOREIGN KEY (device_id)
      REFERENCES devices(device_id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT
  )
`);

db.exec(`
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
    FOREIGN KEY (device_id)
      REFERENCES devices(device_id),
    FOREIGN KEY (status_id)
      REFERENCES status(id),
    FOREIGN KEY (severity_id)
      REFERENCES status(id)
  )
`);

function addColumnIfMissing(
  tableName: string,
  columnName: string,
  columnType: string
): void {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  if (!columns.some(column => column.name === columnName)) {
    db.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`
    );
  }
}

addColumnIfMissing("devices", "device_status_id", "INTEGER");
addColumnIfMissing("devices", "valve_status_id", "INTEGER");
addColumnIfMissing("devices", "seal_status_id", "INTEGER");

function normalizeColumnName(
  tableName: string,
  oldName: string,
  newName: string
): void {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  const hasOldColumn = columns.some(
    column => column.name === oldName
  );

  const hasNewColumn = columns.some(
    column => column.name === newName
  );

  if (hasOldColumn && !hasNewColumn) {
    const quotedOldName = oldName
      .replace(/"/g, '""');
    const quotedNewName = newName
      .replace(/"/g, '""');

    db.exec(
      `ALTER TABLE ${tableName} RENAME COLUMN "${quotedOldName}" TO "${quotedNewName}";`
    );
  }
}

normalizeColumnName("events", "messge_tyoe", "message_type");
normalizeColumnName("events", "seel_status", "seal_status");
normalizeColumnName("devices", "firmware_versin ", "firmware_version");
normalizeColumnName("telemetry_queue", "speed_km", "speed_kmh");
normalizeColumnName("telemetry_queue", "Battery_percent", "battery_percent");
normalizeColumnName("telemetry_queue", "gsm-signal", "gsm_signal");
normalizeColumnName("telemetry_queue", "payload_json ", "payload_json");
normalizeColumnName("telemetry_queue", "status ", "status");

function normalizeTelemetryQueueSchema(): void {
  const columns = db
    .prepare("PRAGMA table_info(telemetry_queue)")
    .all() as Array<{ name: string; notnull: number }>;

  if (columns.length === 0) {
    return;
  }

  const columnByName = new Map(
    columns.map(column => [column.name, column])
  );
  const optionalColumns = [
    "lacre_id",
    "cilindro_id",
    "latitude",
    "longitude",
    "speed_kmh",
    "battery_percent",
    "gsm_signal",
    "payload_json"
  ];

  if (
    optionalColumns.every(
      name => columnByName.has(name) && columnByName.get(name)?.notnull === 0
    )
  ) {
    return;
  }

  const fields = [
    "id",
    "message_id",
    "device_id",
    "lacre_id",
    "cilindro_id",
    "latitude",
    "longitude",
    "speed_kmh",
    "battery_percent",
    "gsm_signal",
    "payload_json",
    "last_seen_at",
    "status",
    "attempt_count",
    "last_error"
  ];
  const fallbackByField: Record<string, string> = {
    id: "rowid",
    lacre_id: "NULL",
    cilindro_id: "NULL",
    latitude: "NULL",
    longitude: "NULL",
    speed_kmh: "NULL",
    battery_percent: "NULL",
    gsm_signal: "NULL",
    payload_json: "NULL",
    last_seen_at: "NULL",
    status: "'PENDING'",
    attempt_count: "0",
    last_error: "NULL"
  };
  const sourceExpression = (field: string): string =>
    columnByName.has(field)
      ? `"${field}"`
      : fallbackByField[field] ?? "NULL";

  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE telemetry_queue_migrated (
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
        FOREIGN KEY (device_id) REFERENCES devices(device_id)
      )
    `);
    db.exec(`
      INSERT INTO telemetry_queue_migrated (${fields.join(", ")})
      SELECT ${fields.map(sourceExpression).join(", ")}
      FROM telemetry_queue
    `);
    db.exec("DROP TABLE telemetry_queue");
    db.exec("ALTER TABLE telemetry_queue_migrated RENAME TO telemetry_queue");
  });

  migrate();
}

normalizeTelemetryQueueSchema();

const telemetryQueueColumns = db
  .prepare("PRAGMA table_info(telemetry_queue)")
  .all() as Array<{ name: string }>;

if (
  telemetryQueueColumns.length > 0 &&
  !telemetryQueueColumns.some(column => column.name === "last_seen_at")
) {
  db.exec("ALTER TABLE telemetry_queue ADD COLUMN last_seen_at DATETIME");
}

// Registra o message_id das telemetrias com posição repetida, que não geram
// nova linha em telemetry_queue, para que um reenvio seja detectado (409)
db.exec(`
  CREATE TABLE IF NOT EXISTS telemetry_position_repeats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    telemetry_id INTEGER NOT NULL,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (telemetry_id)
      REFERENCES telemetry_queue(id)
      ON DELETE CASCADE
  )
`);

// Bancos antigos não têm CHECK em devices.active; SQLite não permite
// adicionar CHECK sem recriar a tabela, então a regra é aplicada por trigger
db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_devices_active_insert
  BEFORE INSERT ON devices
  WHEN NEW.active NOT IN (0, 1)
  BEGIN
    SELECT RAISE(ABORT, 'CHECK constraint failed: active IN (0,1)');
  END
`);
db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_devices_active_update
  BEFORE UPDATE OF active ON devices
  WHEN NEW.active NOT IN (0, 1)
  BEGIN
    SELECT RAISE(ABORT, 'CHECK constraint failed: active IN (0,1)');
  END
`);

// Cada dispositivo precisa de uma API Key exclusiva
const duplicatedApiKeys = db
  .prepare(`
    SELECT api_key
    FROM devices
    GROUP BY api_key
    HAVING COUNT(*) > 1
  `)
  .all();

if (duplicatedApiKeys.length === 0) {
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_api_key ON devices(api_key)"
  );
} else {
  console.warn(
    "⚠️ Existem API Keys duplicadas em devices; índice único não criado:",
    duplicatedApiKeys
  );
}

// Verificação inicial
console.log("✅ SQLite conectado:", databasePath);

export default db;
