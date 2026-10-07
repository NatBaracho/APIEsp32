import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

// Ambiente isolado da simulação: pasta temporária com um oxide.db novo
// (criado pelo script do Doc/Oxidedb.md) e conexão SÓ com o FluxID de
// análise no Docker. O oxide.db do projeto e o banco principal não são tocados.

export interface Ambiente {
  pasta: string;
  porta: number;
  fluxidUrl: string;
  rodada: string;
}

const PORTA_DOCKER = "54329";

export function validarFluxid(url: string | undefined): string {
  if (!url) {
    throw new Error("FLUXID_DATABASE_URL não definida (.env). Use a conexão do FluxID de análise no Docker.");
  }

  const destino = new URL(url);
  const local = destino.hostname === "127.0.0.1" || destino.hostname === "localhost";

  if (!local || destino.port !== PORTA_DOCKER) {
    throw new Error(
      `Por segurança, o simulador só roda contra o FluxID de análise no Docker (127.0.0.1:${PORTA_DOCKER}). ` +
      `A conexão do .env aponta para ${destino.hostname}:${destino.port || "5432"}.`
    );
  }

  return url;
}

// Identificador curto da rodada: entra nos códigos (ex.: LCR-SA1B2-01), para
// várias rodadas convivem no mesmo FluxID de análise sem colidir
export function novaRodada(): string {
  return (Date.now() % 1679616).toString(36).toUpperCase().padStart(4, "0");
}

export function prepararAmbiente(projeto: string, porta: number, fluxidUrl: string): Ambiente {
  const rodada = novaRodada();
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), `fluxid-simulacao-${rodada}-`));

  // Script SQL completo do Oxidedb.md (o mesmo do teste BD-14)
  const doc = fs.readFileSync(path.join(projeto, "Doc", "Oxidedb.md"), "utf8");
  const inicio = doc.indexOf("# 8. Script SQL Completo");
  const bloco = doc.slice(inicio).match(/```sql\r?\n([\s\S]*?)```/);

  if (inicio < 0 || !bloco?.[1]) {
    throw new Error("Script SQL não encontrado em Doc/Oxidedb.md");
  }

  const banco = new Database(path.join(pasta, "oxide.db"));
  banco.exec(bloco[1]);
  banco.close();

  return { pasta, porta, fluxidUrl, rodada };
}
