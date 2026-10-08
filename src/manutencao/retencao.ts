import Database from "better-sqlite3";
import { existsSync } from "fs";
import path from "path";

// npm run retencao — a Oxide é uma fila: o que já foi sincronizado com o
// FluxID (SYNCED) pode sair depois de RETENCAO_DIAS (padrão 30). Nada que
// ainda não chegou ao FluxID é apagado. Alertas, comandos, cadastro e
// vínculos nunca são apagados aqui.
// Sem --confirmar só mostra o que seria removido. Faça npm run backup antes.

const confirmar = process.argv.includes("--confirmar");
const dias = Math.max(1, Number(process.env.RETENCAO_DIAS ?? 30) || 30);
const arquivo = path.resolve(process.cwd(), "oxide.db");
if (!existsSync(arquivo)) {
  console.error(`oxide.db não encontrada em ${process.cwd()}`);
  process.exit(1);
}

const db = new Database(arquivo, { fileMustExist: true });
const limite = `-${dias} days`;

// received_at = hora de chegada; linhas sem essa data (anteriores à
// coluna) nunca entram na limpeza
const regras: Array<{ nome: string; contar: string; apagar: string; params: unknown[] }> = [
  {
    nome: "telemetrias sincronizadas",
    contar: "SELECT count(*) AS n FROM telemetry_queue WHERE status = 'SYNCED' AND received_at < datetime('now', ?) AND COALESCE(last_seen_at, received_at) < datetime('now', ?)",
    apagar: "DELETE FROM telemetry_queue WHERE status = 'SYNCED' AND received_at < datetime('now', ?) AND COALESCE(last_seen_at, received_at) < datetime('now', ?)",
    params: [limite, limite]
  },
  {
    nome: "eventos sincronizados",
    contar: "SELECT count(*) AS n FROM events WHERE status = 'SYNCED' AND received_at < datetime('now', ?)",
    apagar: "DELETE FROM events WHERE status = 'SYNCED' AND received_at < datetime('now', ?)",
    params: [limite]
  },
  {
    nome: "registros de rodadas do Worker (sync_logs)",
    contar: "SELECT count(*) AS n FROM sync_logs WHERE started_at < datetime('now', ?)",
    apagar: "DELETE FROM sync_logs WHERE started_at < datetime('now', ?)",
    params: [limite]
  }
];

console.log(`Retenção: ${dias} dias${confirmar ? "" : " (simulação: use --confirmar para apagar)"}`);

const executar = db.transaction(() => {
  for (const regra of regras) {
    const n = (db.prepare(regra.contar).get(...regra.params) as { n: number }).n;
    if (confirmar && n > 0) db.prepare(regra.apagar).run(...regra.params);
    console.log(`- ${regra.nome}: ${n}${confirmar ? " removido(s)" : " a remover"}`);
  }
});
executar();

if (confirmar) {
  db.exec("VACUUM");
  console.log("Banco compactado (VACUUM).");
}
db.close();
