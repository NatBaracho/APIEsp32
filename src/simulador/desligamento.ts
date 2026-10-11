import { ChildProcess, spawn } from "child_process";
import { createHash, randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { iniciarRecebedor } from "./recebedor";

// npm run simular:desligamento — a API e o Worker são derrubados à força,
// muitas vezes, no meio das gravações. Depois de cada queda o banco é
// conferido; no fim, toda mensagem que a API confirmou ao lacre tem de estar
// guardada e chegar ao banco principal, sem duplicar.
//
// O que este teste é: o processo é encerrado sem aviso (como travar ou ser
// fechado pelo sistema). O que ele não é: corte de energia de verdade, em
// que o próprio sistema operacional para. Para esse caso a Oxide grava em
// modo WAL com synchronous = FULL, mas só um teste com o equipamento prova.
//
// Ajustes (variáveis de ambiente): DESLIGAMENTOS, DESLIGAMENTO_LACRES e
// DESLIGAMENTO_PORTA.

const numero = (nome: string, padrao: number): number => {
  const valor = Number(process.env[nome]);
  return Number.isInteger(valor) && valor > 0 ? valor : padrao;
};
const QUEDAS = numero("DESLIGAMENTOS", 20);
const LACRES = numero("DESLIGAMENTO_LACRES", 30);
const PORTA = numero("DESLIGAMENTO_PORTA", 3194);
const PROJETO = path.resolve(__dirname, "..", "..");
const BASE = `http://127.0.0.1:${PORTA}`;

const espera = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const sha = (texto: string): string => createHash("sha256").update(texto).digest("hex");

let conforme = 0;
let falhas = 0;
function etapa(titulo: string): void {
  console.log(`\n=== ${titulo} ===`);
}
function conferir(o_que: string, esperado: string, obtido: string, ok: boolean): void {
  ok ? conforme++ : falhas++;
  console.log(`${ok ? "✅" : "❌"} ${o_que} — ${obtido}${ok ? "" : ` (esperado: ${esperado})`}`);
}

function subir(script: string, pasta: string, env: Record<string, string>): ChildProcess {
  const filho = spawn(process.execPath, ["--require", path.join(PROJETO, "node_modules", "ts-node", "register"), path.join(PROJETO, script)], {
    cwd: pasta, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, TS_NODE_PROJECT: path.join(PROJETO, "tsconfig.json"), ...env }
  });
  const registro = fs.createWriteStream(path.join(pasta, `${path.basename(path.dirname(script))}-${path.basename(script, ".ts")}.log`), { flags: "a" });
  filho.stdout?.pipe(registro);
  filho.stderr?.pipe(registro);
  return filho;
}
const derrubar = (filho: ChildProcess): Promise<void> => new Promise(resolve => {
  if (filho.exitCode !== null) return resolve();
  filho.once("exit", () => resolve());
  filho.kill();
});
async function apiNoAr(limiteMs = 60000): Promise<boolean> {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (await fetch(`${BASE}/`).then(r => r.ok).catch(() => false)) return true;
    await espera(100);
  }
  return false;
}

async function main(): Promise<number> {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "oxide-desligamento-"));
  const recebedor = await iniciarRecebedor();
  const ambiente = {
    PORT: String(PORTA), SUPABASE_IOT_URL: recebedor.url, SUPABASE_SERVICE_KEY: recebedor.chave,
    WORKER_INTERVAL_SECONDS: "1", WORKER_CADASTRO_INTERVAL_SECONDS: "5",
    // Todos os lacres do teste saem do mesmo endereço e sem pausa
    LIMITE_MENSAGENS_POR_MINUTO: "1000000", LIMITE_FALHAS_DE_CHAVE_POR_MINUTO: "1000000"
  };
  const arquivo = path.join(pasta, "oxide.db");
  let api: ChildProcess | undefined;
  let worker: ChildProcess | undefined;
  const abrir = (): Database.Database => new Database(arquivo, { readonly: true, timeout: 30000 });

  try {
    etapa("0. Cenário");
    console.log(`   Pasta: ${pasta}`);
    console.log(`   ${LACRES} lacres enviando sem parar; a API é derrubada à força ${QUEDAS} vezes e o Worker, ${Math.floor(QUEDAS / 2)}`);
    const lacres = Array.from({ length: LACRES }, (_, i) => ({ device_id: `DSP-DESL-${String(i + 1).padStart(3, "0")}`, chave: `chave-desl-${i + 1}-${randomBytes(8).toString("hex")}`, seq: 0 }));
    for (const l of lacres) recebedor.dispositivos.push({ device_id: l.device_id, api_key_hash: sha(l.chave), active: true });

    api = subir("src/server.ts", pasta, ambiente);
    await apiNoAr();
    worker = subir("src/worker/index.ts", pasta, ambiente);
    const prazo = Date.now() + 60000;
    let cadastrados = 0;
    while (Date.now() < prazo && cadastrados < LACRES) {
      await espera(500);
      const db = abrir();
      cadastrados = (db.prepare("SELECT count(*) AS n FROM devices").get() as { n: number }).n;
      db.close();
    }
    conferir("Dispositivos cadastrados", `${LACRES}`, `${cadastrados}`, cadastrados === LACRES);

    etapa("1. Lacres enviando, com a API e o Worker derrubados à força");
    const confirmadas = new Set<string>();
    const medidas = { semResposta: 0, respostas409: 0, outras: 0 };
    let enviando = true;
    const lacreEnvia = async (l: typeof lacres[number]): Promise<void> => {
      while (enviando) {
        const id = `MSG-${l.device_id.slice(-3)}-${++l.seq}`;
        const corpo = JSON.stringify({ message_id: id, device_id: l.device_id, latitude: -7.2 - l.seq / 100000, longitude: -39.3, battery_percent: 80, seal_status: "LOCKED" });
        // O lacre insiste com a mesma mensagem até ter resposta
        for (;;) {
          const status = await fetch(`${BASE}/api/v1/iot/telemetries`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": l.chave }, body: corpo, signal: AbortSignal.timeout(10000) })
            .then(r => r.status).catch(() => 0);
          if (status === 202 || status === 409) {
            if (status === 409) medidas.respostas409++;
            confirmadas.add(id);
            break;
          }
          if (status === 0) medidas.semResposta++;
          else { medidas.outras++; break; }
          if (!enviando) return;
          await espera(100);
        }
      }
    };
    const envios = Promise.all(lacres.map(lacreEnvia));

    let bancoRuim = 0;
    let naoReligou = 0;
    for (let q = 1; q <= QUEDAS; q++) {
      await espera(500 + Math.random() * 2000);
      await derrubar(api);
      // Com a API parada, o banco tem de abrir e estar inteiro
      const db = abrir();
      if (db.pragma("integrity_check", { simple: true }) !== "ok") bancoRuim++;
      db.close();
      if (q % 2 === 0) {
        await derrubar(worker);
        worker = subir("src/worker/index.ts", pasta, ambiente);
      }
      api = subir("src/server.ts", pasta, ambiente);
      if (!(await apiNoAr())) naoReligou++;
      if (q % 5 === 0) console.log(`   ${q} quedas: ${confirmadas.size} mensagens confirmadas até aqui`);
    }
    await espera(2000);
    enviando = false;
    await envios;

    conferir("A API religou depois de todas as quedas", "0 falhas", `${naoReligou} falhas em ${QUEDAS} quedas`, naoReligou === 0);
    conferir("O banco abriu íntegro depois de cada queda", "0 problemas", `${bancoRuim} problemas em ${QUEDAS} conferências`, bancoRuim === 0);
    console.log(`   ${confirmadas.size} mensagens confirmadas pela API; ${medidas.semResposta} envios sem resposta (API derrubada); ${medidas.respostas409} respostas 409 depois de reenviar`);
    conferir("Nenhuma resposta inesperada da API", "0", `${medidas.outras}`, medidas.outras === 0);

    etapa("2. O que a API confirmou está guardado");
    const db = abrir();
    const gravadas = new Set((db.prepare("SELECT message_id FROM mensagens WHERE tipo = 'TELEMETRIA'").all() as Array<{ message_id: string }>).map(l => l.message_id));
    const total = (db.prepare("SELECT count(*) AS n FROM mensagens").get() as { n: number }).n;
    const distintas = (db.prepare("SELECT count(DISTINCT message_id) AS n FROM mensagens").get() as { n: number }).n;
    db.close();
    const perdidas = [...confirmadas].filter(id => !gravadas.has(id)).length;
    conferir("Toda mensagem confirmada ao lacre está na Oxide", "0 perdidas", `${confirmadas.size} confirmadas; ${perdidas} perdidas`, perdidas === 0);
    conferir("Nenhuma mensagem duplicada", `${total} linhas, ${total} códigos`, `${total} linhas, ${distintas} códigos diferentes`, total === distintas);
    // Mensagem gravada cuja resposta se perdeu na queda: o lacre a reenviou e recebeu 409
    console.log(`   ${gravadas.size - confirmadas.size} mensagem(ns) gravada(s) na hora da queda e ainda sem confirmação quando o teste parou`);

    etapa("3. Tudo chega ao banco principal");
    const fim = Date.now() + 180000;
    let resta = -1;
    while (Date.now() < fim && resta !== 0) {
      await espera(1000);
      const d = abrir();
      resta = (d.prepare("SELECT count(*) AS n FROM mensagens WHERE status <> 'SYNCED'").get() as { n: number }).n;
      d.close();
    }
    conferir("Fila esvaziada", "0 na fila", `${resta} na fila`, resta === 0);
    const naoChegaram = [...confirmadas].filter(id => !recebedor.mensagens.has(id)).length;
    conferir("Toda mensagem confirmada chegou ao banco principal", "0 faltando", `${naoChegaram} faltando`, naoChegaram === 0);
    conferir("Mesma quantidade dos dois lados", `${total}`, `Oxide ${total}; banco principal ${recebedor.mensagens.size}`, recebedor.mensagens.size === total);
    const ultimo = abrir();
    const integro = ultimo.pragma("integrity_check", { simple: true }) === "ok" && (ultimo.pragma("foreign_key_check") as unknown[]).length === 0;
    const modo = ultimo.pragma("journal_mode", { simple: true });
    ultimo.close();
    conferir("Banco íntegro no fim, ainda em modo WAL", "ok, wal", `${integro ? "ok" : "com erro"}, ${modo}`, integro && modo === "wal");
  } catch (erro) {
    conferir("Execução do teste", "sem exceção", (erro as Error).stack ?? String(erro), false);
  } finally {
    if (worker) await derrubar(worker);
    if (api) await derrubar(api);
    await recebedor.fechar();
  }

  console.log(`\nResultado: ${conforme} de ${conforme + falhas} verificações conforme; ${falhas} falha(s).`);
  console.log(`Pasta do teste: ${pasta}`);
  return falhas === 0 ? 0 : 1;
}

main().then(codigo => { process.exitCode = codigo; }).catch(erro => {
  console.error("Teste interrompido:", erro);
  process.exitCode = 1;
});
