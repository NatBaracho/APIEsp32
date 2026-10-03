import Database from "better-sqlite3";
import path from "path";

// Caminho do banco
const databasePath = path.resolve(
  __dirname,
  "../../oxide.db"
);

// Cria conexão com tipo explícito para evitar erro de exportação em TS
const db: Database.Database = new Database(databasePath);

// Habilita Foreign Keys
db.pragma("foreign_keys = ON");

// Verificação inicial
console.log("✅ SQLite conectado:", databasePath);

export default db;
