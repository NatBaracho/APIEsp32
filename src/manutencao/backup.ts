import Database from "better-sqlite3";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "fs";
import path from "path";

// npm run backup — cópia consistente da oxide.db (backup online do SQLite,
// funciona com a API e o Worker ligados) em BACKUP_PASTA (padrão ./backups).
// Mantém as BACKUP_MANTER cópias mais novas (padrão 14)

async function main(): Promise<void> {
  const origem = path.resolve(process.cwd(), "oxide.db");
  if (!existsSync(origem)) throw new Error(`oxide.db não encontrada em ${process.cwd()}`);

  const pasta = path.resolve(process.cwd(), process.env.BACKUP_PASTA ?? "backups");
  const manter = Math.max(1, Number(process.env.BACKUP_MANTER ?? 14) || 14);
  mkdirSync(pasta, { recursive: true });

  const agora = new Date();
  const doisDigitos = (n: number): string => String(n).padStart(2, "0");
  const nome = `oxide-${agora.getFullYear()}-${doisDigitos(agora.getMonth() + 1)}-${doisDigitos(agora.getDate())}-${doisDigitos(agora.getHours())}h${doisDigitos(agora.getMinutes())}${doisDigitos(agora.getSeconds())}.db`;
  const destino = path.join(pasta, nome);

  const db = new Database(origem, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destino);
  } finally {
    db.close();
  }

  // Confere a cópia: abre e roda integrity_check
  const copia = new Database(destino, { readonly: true });
  const integridade = (copia.pragma("integrity_check", { simple: true }) as string);
  copia.close();
  if (integridade !== "ok") throw new Error(`cópia com problema de integridade: ${integridade}`);

  const sha = createHash("sha256").update(readFileSync(destino)).digest("hex");
  console.log(`Backup criado: ${destino}`);
  console.log(`SHA-256: ${sha}`);

  const antigos = readdirSync(pasta).filter(f => /^oxide-.*\.db$/.test(f)).sort().reverse().slice(manter);
  for (const arquivo of antigos) {
    rmSync(path.join(pasta, arquivo));
    console.log(`Removida cópia antiga: ${arquivo}`);
  }
}

main().catch(erro => {
  console.error("Backup falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
