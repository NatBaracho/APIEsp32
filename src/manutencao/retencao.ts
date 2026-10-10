import Database from "better-sqlite3";
import { existsSync } from "fs";
import path from "path";

// npm run retencao — a Oxide é uma fila: o que já chegou ao banco principal
// (SYNCED) pode sair depois de RETENCAO_DIAS (padrão 30). Mensagem que ainda
// não foi enviada nunca é apagada.
//   --arquivadas  inclui as mensagens ARQUIVADA (dados do modelo antigo)
//   --confirmar   apaga de fato; sem ele, só mostra. Faça npm run backup antes

const confirmar = process.argv.includes("--confirmar");
const arquivadas = process.argv.includes("--arquivadas");
const dias = Math.max(1, Number(process.env.RETENCAO_DIAS ?? 30) || 30);
const arquivo = path.resolve(process.cwd(), "oxide.db");

if (!existsSync(arquivo)) {
  console.error(`oxide.db não encontrada em ${process.cwd()}`);
  process.exit(1);
}

const db = new Database(arquivo, { fileMustExist: true });
const regras: Array<{ nome: string; onde: string; params: unknown[] }> = [
  { nome: `mensagens enviadas há mais de ${dias} dias`, onde: "status = 'SYNCED' AND synced_at < datetime('now', ?)", params: [`-${dias} days`] },
  { nome: `comandos concluídos há mais de ${dias} dias`, onde: "", params: [`-${dias} days`] }
];
if (arquivadas) regras.push({ nome: "mensagens arquivadas (modelo antigo)", onde: "status = 'ARQUIVADA'", params: [] });

console.log(`Retenção: ${dias} dias${confirmar ? "" : " (simulação: use --confirmar para apagar)"}`);

db.transaction(() => {
  for (const regra of regras) {
    const tabela = regra.onde === "" ? "commands" : "mensagens";
    const onde = regra.onde === "" ? "status <> 'PENDENTE' AND executed_at < datetime('now', ?)" : regra.onde;
    const n = (db.prepare(`SELECT count(*) AS n FROM ${tabela} WHERE ${onde}`).get(...regra.params) as { n: number }).n;
    if (confirmar && n > 0) db.prepare(`DELETE FROM ${tabela} WHERE ${onde}`).run(...regra.params);
    console.log(`- ${regra.nome}: ${n}${confirmar ? " removida(s)" : " a remover"}`);
  }
})();

if (confirmar) {
  db.exec("VACUUM");
  console.log("Banco compactado (VACUUM).");
}
db.close();
