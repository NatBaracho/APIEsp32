import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// npm run vigia — acompanha a API, a fila e o Worker e avisa quando algo sai
// do normal. Cada problema é avisado quando aparece e quando se resolve:
// na tela, no arquivo oxide-alertas.log e, se VIGIA_WEBHOOK_URL estiver no
// .env, por um POST nesse endereço (para chegar a um chat ou a um celular).
//   npm run vigia            fica rodando
//   npm run vigia -- --once  confere uma vez e sai (código 1 se há problema)
//
// O vigia lê a Oxide direto (só leitura) e o arquivo da última rodada do
// Worker; da API ele só pergunta se está no ar.

const once = process.argv.includes("--once");
const pasta = process.cwd();
const banco = path.resolve(pasta, "oxide.db");
const registro = path.resolve(pasta, "oxide-alertas.log");

function numero(nome: string, padrao: number): number {
  const valor = Number(process.env[nome]);
  return Number.isFinite(valor) && valor >= 0 && (process.env[nome] ?? "").trim() !== "" ? valor : padrao;
}

const config = {
  intervaloS: Math.max(5, numero("VIGIA_INTERVALO_S", 60)),
  api: process.env.VIGIA_API_URL?.trim() || `http://127.0.0.1:${process.env.PORT || 3000}`,
  filaMaxima: numero("VIGIA_FILA_MAXIMA", 5000),
  esperaMaximaMin: numero("VIGIA_ESPERA_MAXIMA_MIN", 30),
  workerParadoMin: numero("VIGIA_WORKER_PARADO_MIN", 5),
  bancoMaximoMB: numero("VIGIA_BANCO_MAXIMO_MB", 1024),
  webhook: process.env.VIGIA_WEBHOOK_URL?.trim() || ""
};

type Problemas = Map<string, string>;

async function conferir(): Promise<Problemas> {
  const problemas: Problemas = new Map();

  const noAr = await fetch(`${config.api}/`, { signal: AbortSignal.timeout(5000) }).then(r => r.ok).catch(() => false);
  if (!noAr) problemas.set("API_FORA_DO_AR", `a API não respondeu em ${config.api}`);

  if (!fs.existsSync(banco)) {
    problemas.set("BANCO_NAO_ENCONTRADO", `oxide.db não encontrada em ${pasta}`);
    return problemas;
  }

  const db = new Database(banco, { readonly: true, fileMustExist: true, timeout: 10000 });
  try {
    const fila = db.prepare(`
      SELECT
        COALESCE(SUM(status IN ('PENDING', 'PROCESSING')), 0) AS esperando,
        COALESCE(SUM(status = 'ERROR' AND next_attempt_at IS NULL), 0) AS paradas,
        CAST((julianday('now') - julianday(min(CASE WHEN status IN ('PENDING', 'PROCESSING') THEN received_at END))) * 1440 AS INTEGER) AS minutos
      FROM mensagens
    `).get() as { esperando: number; paradas: number; minutos: number | null };

    if (fila.esperando > config.filaMaxima) {
      problemas.set("FILA_GRANDE", `${fila.esperando} mensagens esperando o envio (limite ${config.filaMaxima})`);
    }
    if ((fila.minutos ?? 0) > config.esperaMaximaMin) {
      problemas.set("FILA_ATRASADA", `a mensagem mais antiga espera há ${fila.minutos} minutos (limite ${config.esperaMaximaMin})`);
    }
    if (fila.paradas > 0) {
      problemas.set("MENSAGENS_PARADAS", `${fila.paradas} mensagem(ns) parada(s): recusadas pelo banco principal ou sem tentativas. Veja GET /api/v1/sync/problems`);
    }
  } finally {
    db.close();
  }

  const megas = fs.statSync(banco).size / 1048576;
  if (megas > config.bancoMaximoMB) {
    problemas.set("BANCO_GRANDE", `oxide.db com ${megas.toFixed(0)} MB (limite ${config.bancoMaximoMB})`);
  }

  // O Worker grava este arquivo ao fim de cada rodada
  try {
    const rodada = JSON.parse(fs.readFileSync(path.resolve(pasta, "oxide-worker.json"), "utf8")) as { em: string; resultado: { status: string; erro?: string } };
    const minutos = (Date.now() - Date.parse(rodada.em)) / 60000;
    if (minutos > config.workerParadoMin) {
      problemas.set("WORKER_PARADO", `a última rodada do Worker foi há ${minutos.toFixed(0)} minutos`);
    } else if (rodada.resultado.status === "FALHOU") {
      problemas.set("BANCO_PRINCIPAL_FORA_DO_AR", `o Worker não consegue enviar: ${rodada.resultado.erro ?? "sem detalhe"}`);
    }
  } catch {
    problemas.set("WORKER_PARADO", "o Worker ainda não fez nenhuma rodada nesta pasta");
  }

  return problemas;
}

async function avisar(situacao: "ABERTO" | "RESOLVIDO", problema: string, detalhe: string): Promise<void> {
  const quando = new Date().toISOString();
  const linha = `${quando} ${situacao} ${problema}: ${detalhe}`;
  console.log(`${situacao === "ABERTO" ? "🔴" : "🟢"} ${linha}`);
  fs.appendFileSync(registro, `${linha}\n`, "utf8");

  if (!config.webhook) return;
  try {
    await fetch(config.webhook, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ quando, situacao, problema, detalhe, text: `${situacao === "ABERTO" ? "🔴" : "🟢"} Oxide: ${problema} (${situacao}). ${detalhe}` })
    });
  } catch (erro) {
    console.error("Não consegui enviar o aviso ao endereço configurado:", erro instanceof Error ? erro.message : erro);
  }
}

async function main(): Promise<void> {
  let abertos: Problemas = new Map();
  let parar = false;
  process.on("SIGINT", () => { parar = true; });
  process.on("SIGTERM", () => { parar = true; });

  if (!once) console.log(`Vigia: confere a cada ${config.intervaloS} s; avisos em ${registro}${config.webhook ? " e no endereço configurado" : ""}`);

  do {
    const agora = await conferir();
    for (const [problema, detalhe] of agora) {
      if (!abertos.has(problema)) await avisar("ABERTO", problema, detalhe);
    }
    for (const [problema, detalhe] of abertos) {
      if (!agora.has(problema)) await avisar("RESOLVIDO", problema, detalhe);
    }
    abertos = agora;

    if (once) {
      if (agora.size === 0) console.log("Vigia: tudo certo");
      process.exitCode = agora.size === 0 ? 0 : 1;
      return;
    }
    for (let s = 0; s < config.intervaloS && !parar; s++) await new Promise(resolve => setTimeout(resolve, 1000));
  } while (!parar);
}

main().catch(erro => {
  console.error("Vigia parou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
