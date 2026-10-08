import Database from "better-sqlite3";
import path from "path";
import { alertTypes, legacyAlertTypes } from "../models/Alert";

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

// Comando PENDENTE (o que o ESP32 vai executar) só aceita tipos do catálogo;
// o histórico (EXECUTADO/ERRO) pode guardar tipos anteriores ao catálogo
function commandsTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command_id TEXT NOT NULL UNIQUE,
      device_id TEXT NOT NULL,
      command_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDENTE'
        CHECK (status IN ('PENDENTE', 'EXECUTADO', 'ERRO')),
      created_at DATETIME NOT NULL,
      executed_at DATETIME,
      error_message TEXT,
      CHECK (
        status <> 'PENDENTE'
        OR command_type IN ('TRAVAR_VALVULA', 'DESTRAVAR_VALVULA')
      ),
      FOREIGN KEY (device_id)
        REFERENCES devices(device_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
    )
  `;
}

const commandsTable = db
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'commands'")
  .get() as { sql: string } | undefined;

if (!commandsTable) {
  db.exec(commandsTableSql("commands"));
} else if (!commandsTable.sql.includes("TRAVAR_VALVULA")) {
  // Tabela anterior ao catálogo: recria com as regras, preservando os
  // comandos. Nomes antigos em inglês viram os do catálogo; pendente com
  // tipo desconhecido vira ERRO (o tipo original é mantido no histórico)
  const migrateCommands = db.transaction(() => {
    db.exec(commandsTableSql("commands_migrated"));
    db.exec(`
      INSERT INTO commands_migrated (
        id, command_id, device_id, command_type, status,
        created_at, executed_at, error_message
      )
      SELECT
        id,
        command_id,
        device_id,
        CASE command_type
          WHEN 'LOCK_VALVE' THEN 'TRAVAR_VALVULA'
          WHEN 'UNLOCK_VALVE' THEN 'DESTRAVAR_VALVULA'
          ELSE command_type
        END,
        CASE
          WHEN status = 'PENDENTE'
            AND command_type NOT IN (
              'LOCK_VALVE', 'UNLOCK_VALVE', 'TRAVAR_VALVULA', 'DESTRAVAR_VALVULA'
            )
          THEN 'ERRO'
          ELSE status
        END,
        created_at,
        executed_at,
        CASE
          WHEN status = 'PENDENTE'
            AND command_type NOT IN (
              'LOCK_VALVE', 'UNLOCK_VALVE', 'TRAVAR_VALVULA', 'DESTRAVAR_VALVULA'
            )
          THEN 'tipo de comando descontinuado'
          ELSE error_message
        END
      FROM commands
    `);
    db.exec("DROP TABLE commands");
    db.exec("ALTER TABLE commands_migrated RENAME TO commands");
  });

  migrateCommands();
}

const alertTypeList = alertTypes.map(type => `'${type}'`).join(", ");

// alert_type só aceita os códigos do catálogo Tipos-de-Erro.md; alerta
// ENCERRADO sempre tem data de encerramento (e só ele tem)
function alertsTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id TEXT NOT NULL UNIQUE,
      device_id TEXT NOT NULL,
      alert_type TEXT NOT NULL
        CHECK (alert_type IN (${alertTypeList})),
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
      FOREIGN KEY (device_id)
        REFERENCES devices(device_id)
    )
  `;
}

const alertsTableExists = db
  .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'alerts'")
  .get();

if (!alertsTableExists) {
  db.exec(alertsTableSql("alerts"));
}

// Bancos anteriores guardavam status_id/severity_id apontando para a tabela
// status (estados de dispositivo/lacre). Recria a tabela com severity e status
// em texto, nos valores do FluxID, preservando os alertas existentes
function migrateLegacyAlerts(): void {
  const columns = db
    .prepare("PRAGMA table_info(alerts)")
    .all() as Array<{ name: string }>;

  if (!columns.some(column => column.name === "severity_id")) {
    return;
  }

  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE alerts_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_id TEXT NOT NULL UNIQUE,
        device_id TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL
          CHECK (severity IN ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),
        status TEXT NOT NULL DEFAULT 'ABERTO'
          CHECK (status IN ('ABERTO', 'EM_ANALISE', 'ENCERRADO')),
        title TEXT NOT NULL,
        description TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        FOREIGN KEY (device_id)
          REFERENCES devices(device_id)
      )
    `);
    db.exec(`
      INSERT INTO alerts_migrated (
        id, alert_id, device_id, alert_type, severity, status,
        title, description, created_at, resolved_at
      )
      SELECT
        id,
        alert_id,
        device_id,
        alert_type,
        CASE alert_type
          WHEN 'SEAL_BROKEN' THEN 'CRITICA'
          WHEN 'GEOFENCE_EXIT' THEN 'ALTA'
          WHEN 'COMMAND_FAILURE' THEN 'ALTA'
          WHEN 'LOW_BATTERY' THEN 'BAIXA'
          ELSE 'MEDIA'
        END,
        CASE WHEN resolved_at IS NULL THEN 'ABERTO' ELSE 'ENCERRADO' END,
        title,
        description,
        created_at,
        resolved_at
      FROM alerts
    `);
    db.exec("DROP TABLE alerts");
    db.exec("ALTER TABLE alerts_migrated RENAME TO alerts");
  });

  migrate();
}

migrateLegacyAlerts();

// Tabela anterior ao catálogo em português: recria com as regras novas,
// convertendo os tipos em inglês. Tipo desconhecido vira DISPOSITIVO_FALHA,
// com o tipo original registrado na descrição
function migrateAlertTypes(): void {
  const alertsTable = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'alerts'")
    .get() as { sql: string };

  if (alertsTable.sql.includes("LACRE_VIOLADO")) {
    return;
  }

  const legacyCases = Object.entries(legacyAlertTypes)
    .map(([legacy, type]) => `WHEN '${legacy}' THEN '${type}'`)
    .join(" ");
  const knownTypes = `${alertTypeList}, ${Object.keys(legacyAlertTypes)
    .map(type => `'${type}'`)
    .join(", ")}`;

  const migrate = db.transaction(() => {
    db.exec(alertsTableSql("alerts_migrated"));
    db.exec(`
      INSERT INTO alerts_migrated (
        id, alert_id, device_id, alert_type, severity, status,
        title, description, created_at, resolved_at
      )
      SELECT
        id,
        alert_id,
        device_id,
        CASE
          WHEN alert_type IN (${alertTypeList}) THEN alert_type
          ELSE CASE alert_type ${legacyCases} ELSE 'DISPOSITIVO_FALHA' END
        END,
        severity,
        status,
        title,
        CASE
          WHEN alert_type IN (${knownTypes}) THEN description
          ELSE TRIM(COALESCE(description, '') || ' [tipo original: ' || alert_type || ']')
        END,
        created_at,
        CASE
          WHEN status = 'ENCERRADO' THEN COALESCE(resolved_at, CURRENT_TIMESTAMP)
          ELSE NULL
        END
      FROM alerts
    `);
    db.exec("DROP TABLE alerts");
    db.exec("ALTER TABLE alerts_migrated RENAME TO alerts");
  });

  migrate();
}

migrateAlertTypes();

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

// Adicionadas depois da normalização, que recria telemetry_queue sem elas.
// last_repeat_message_id: message_id da última posição repetida, para que
// um reenvio dela seja detectado (409) sem criar nova linha
addColumnIfMissing("telemetry_queue", "last_repeat_message_id", "TEXT");
addColumnIfMissing("telemetry_queue", "seal_status", "TEXT");
addColumnIfMissing("telemetry_queue", "device_attempt_count", "INTEGER");
addColumnIfMissing("events", "device_attempt_count", "INTEGER");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_telemetry_last_repeat_message_id
  ON telemetry_queue(last_repeat_message_id)
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

// Associação dispositivo → lacre → cilindro (entrega B). Cópia provisória do
// cadastro e dos vínculos do FluxID, nos mesmos códigos e estados, até o
// Worker passar a sincronizá-los. Vínculos nunca são apagados (RN21):
// encerrar = preencher ended_at
db.exec(`
  CREATE TABLE IF NOT EXISTS seals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seal_code TEXT NOT NULL UNIQUE,
    nfc_uid TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'EM_ESTOQUE'
      CHECK (status IN (
        'EM_ESTOQUE', 'INSTALADO', 'SUSPEITA_VIOLACAO', 'ROMPIDO',
        'REMOVIDO', 'DANIFICADO', 'INUTILIZADO'
      )),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

// O cilindro é identificado pelo código (e chega-se a ele pelo lacre). O
// número de série é único só dentro da mesma empresa, regra que fica com o
// FluxID: duas empresas podem ter cilindros com a mesma série
function cylindersTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cylinder_code TEXT NOT NULL UNIQUE,
    serial_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DISPONIVEL'
      CHECK (status IN (
        'DISPONIVEL', 'EM_TRANSITO', 'COM_CLIENTE',
        'MANUTENCAO', 'EXTRAVIADO', 'INATIVO'
      )),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
}

const cylindersTable = db
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cylinders'")
  .get() as { sql: string } | undefined;

if (!cylindersTable) {
  db.exec(cylindersTableSql("cylinders"));
} else if (/serial_number\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(cylindersTable.sql)) {
  // Bancos anteriores: recria sem a série única, preservando os cilindros.
  // As chaves estrangeiras ficam desligadas só durante a troca (os vínculos
  // apontam para o código, que não muda) e são conferidas antes de confirmar
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(cylindersTableSql("cylinders_migrated"));
      db.exec(`
        INSERT INTO cylinders_migrated (id, cylinder_code, serial_number, status, created_at, updated_at)
        SELECT id, cylinder_code, serial_number, status, created_at, updated_at FROM cylinders
      `);
      db.exec("DROP TABLE cylinders");
      db.exec("ALTER TABLE cylinders_migrated RENAME TO cylinders");

      if (db.prepare("PRAGMA foreign_key_check").all().length > 0) {
        throw new Error("Migração de cylinders deixaria vínculos sem cilindro");
      }
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

db.exec("CREATE INDEX IF NOT EXISTS idx_cylinders_serial_number ON cylinders (serial_number)");

db.exec(`
  CREATE TABLE IF NOT EXISTS seal_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    seal_code TEXT NOT NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    end_reason TEXT,
    FOREIGN KEY (device_id)
      REFERENCES devices(device_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (seal_code)
      REFERENCES seals(seal_code) ON UPDATE CASCADE ON DELETE RESTRICT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS cylinder_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seal_code TEXT NOT NULL,
    cylinder_code TEXT NOT NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    end_reason TEXT,
    FOREIGN KEY (seal_code)
      REFERENCES seals(seal_code) ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (cylinder_code)
      REFERENCES cylinders(cylinder_code) ON UPDATE CASCADE ON DELETE RESTRICT
  )
`);

// Um vínculo ativo por vez (RN04, RN05), como os índices parciais do FluxID
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS uq_seal_assignment_device_active
    ON seal_assignments (device_id) WHERE ended_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_seal_assignment_seal_active
    ON seal_assignments (seal_code) WHERE ended_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_cylinder_assignment_seal_active
    ON cylinder_assignments (seal_code) WHERE ended_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_cylinder_assignment_cylinder_active
    ON cylinder_assignments (cylinder_code) WHERE ended_at IS NULL;
`);

// Código do catálogo Tipos-de-Erro.md registrado no recebimento, sem gerar
// alerta (ex.: DISPOSITIVO_SEM_LACRE, LACRE_SEM_CILINDRO)
addColumnIfMissing("telemetry_queue", "error_type", "TEXT");
addColumnIfMissing("events", "error_type", "TEXT");

// Integração com o FluxID (Worker). next_attempt_at: quando a linha pode
// ser tentada de novo (5 tentativas com espera crescente, decisão P6)
addColumnIfMissing("telemetry_queue", "next_attempt_at", "DATETIME");
addColumnIfMissing("events", "next_attempt_at", "DATETIME");

// Alerta: status de negócio (ABERTO...) é separado do status da
// sincronização; mudar o alerta (analisar/encerrar) o reenvia ao FluxID
addColumnIfMissing("alerts", "sync_status", "TEXT NOT NULL DEFAULT 'PENDING'");
addColumnIfMissing("alerts", "sync_attempt_count", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("alerts", "sync_last_error", "TEXT");
addColumnIfMissing("alerts", "sync_next_attempt_at", "DATETIME");

// Chave do dispositivo vinda do FluxID só como hash (SHA-256 em
// hexadecimal). Quando existe, a chave em texto deixa de valer
addColumnIfMissing("devices", "api_key_hash", "TEXT");
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_api_key_hash
  ON devices(api_key_hash) WHERE api_key_hash IS NOT NULL
`);

// Vínculos trazidos do FluxID: id do vínculo lá, para atualizar o mesmo
// registro nas próximas sincronizações
addColumnIfMissing("seal_assignments", "fluxid_id", "TEXT");
addColumnIfMissing("cylinder_assignments", "fluxid_id", "TEXT");
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS uq_seal_assignment_fluxid
    ON seal_assignments (fluxid_id) WHERE fluxid_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_cylinder_assignment_fluxid
    ON cylinder_assignments (fluxid_id) WHERE fluxid_id IS NOT NULL;
`);

// Registro de cada rodada do Worker (o que foi enviado, o que falhou)
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    status TEXT NOT NULL DEFAULT 'RUNNING'
      CHECK (status IN ('RUNNING', 'OK', 'PARCIAL', 'FALHOU')),
    log_message TEXT
  )
`);

// Verificação inicial
console.log("✅ SQLite conectado:", databasePath);

export default db;
