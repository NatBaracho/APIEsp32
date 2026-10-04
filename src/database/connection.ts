import Database from "better-sqlite3";
import path from "path";

// Caminho do banco
const databasePath = path.resolve(process.cwd(), "oxide.db");

// Cria conexão com tipo explícito para evitar erro de exportação em TS
const db: Database.Database = new Database(databasePath);

// Habilita Foreign Keys
db.pragma("foreign_keys = ON");

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

// Verificação inicial
console.log("✅ SQLite conectado:", databasePath);

export default db;
