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

// Verificação inicial
console.log("✅ SQLite conectado:", databasePath);

export default db;
