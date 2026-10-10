import Database from "better-sqlite3";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "fs";
import path from "path";

// npm run backup — cópia consistente da oxide.db (funciona com a API e o
// Worker ligados) em BACKUP_PASTA (padrão ./backups). Mantém as
// BACKUP_MANTER cópias mais novas (padrão 14)

async function main(): Promise<void> {
  const origem = path.resolve(process.cwd(), "oxide.db");
  if (!existsSync(origem)) throw new Error(`oxide.db não encontrada em ${process.cwd()}`);

  const pasta = path.resolve(process.cwd(), process.env.BACKUP_PASTA ?? "backups");
  const manter = Math.max(1, Number(process.env.BACKUP_MANTER ?? 14) || 14);
  mkdirSync(pasta, { recursive: true });

  const carimbo = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const destino = path.join(pasta, `oxide-${carimbo}.db`);

  const db = new Database(origem, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destino);
  } finally {
    db.close();
  }

  const copia = new Database(destino, { readonly: true });
  const integridade = copia.pragma("integrity_check", { simple: true }) as string;
  copia.close();
  if (integridade !== "ok") throw new Error(`cópia com problema de integridade: ${integridade}`);

  console.log(`Backup criado: ${destino}`);
  console.log(`SHA-256: ${createHash("sha256").update(readFileSync(destino)).digest("hex")}`);

  for (const antigo of readdirSync(pasta).filter(f => /^oxide-.*\.db$/.test(f)).sort().reverse().slice(manter)) {
    rmSync(path.join(pasta, antigo));
    console.log(`Removida cópia antiga: ${antigo}`);
  }
}

main().catch(erro => {
  console.error("Backup falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
