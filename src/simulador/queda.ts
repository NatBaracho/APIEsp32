import { ChildProcess, spawn } from "child_process";
import { createHash, randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { iniciarRecebedor } from "./recebedor";

// npm run simular:queda — o banco principal fica fora do ar por um tempo
// longo enquanto os lacres continuam enviando. Mostra se a Oxide aguenta
// guardar tudo e quanto tempo a fila leva para esvaziar quando ele volta.
// API e Worker rodam em processos separados, com a configuração padrão do
// Worker. Tudo numa pasta temporária, com o recebedor de teste no lugar do
// Supabase: o oxide.db do projeto e o banco principal não são tocados.
//
// Ajustes (variáveis de ambiente): QUEDA_LACRES, QUEDA_MINUTOS,
// QUEDA_INTERVALO_S (de quanto em quanto tempo cada lacre envia) e QUEDA_PORTA.
// WORKER_BATCH_SIZE e WORKER_INTERVAL_SECONDS, se definidas, valem para o
// Worker do teste: servem para medir a volta com outros tamanhos de lote.

const numero = (nome: string, padrao: number): number => {
  const valor = Number(process.env[nome]);
  return Number.isFinite(valor) && valor > 0 ? valor : padrao;
};
const LACRES = Math.round(numero("QUEDA_LACRES", 600));
const MINUTOS = numero("QUEDA_MINUTOS", 60);
const INTERVALO_S = numero("QUEDA_INTERVALO_S", 10);
const PORTA = Math.round(numero("QUEDA_PORTA", 3196));
const PROJETO = path.resolve(__dirname, "..", "..");
const BASE = `http://127.0.0.1:${PORTA}`;

const espera = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const sha = (texto: string): string => createHash("sha256").update(texto).digest("hex");
const mb = (bytes: number): string => (bytes / 1048576).toFixed(1);
const hora = (): string => new Date().toLocaleTimeString("pt-BR");

let conforme = 0;
let falhas = 0;
function etapa(titulo: string): void {
  console.log(`\n=== ${titulo} ===`);
}
function conferir(o_que: string, esperado: string, obtido: string, ok: boolean): void {
  ok ? conforme++ : falhas++;
  console.log(`${ok ? "✅" : "❌"} ${o_que} — ${obtido}${ok ? "" : ` (esperado: ${esperado})`}`);
}

interface Lacre { device_id: string; chave: string; latitude: number; longitude: number; bateria: number; seq: number; selo: string }

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

// Medidas do minuto corrente e do teste inteiro
const minuto = { tempos: [] as number[], aceitas: 0, recusadas: 0, semResposta: 0 };
const total = { aceitas: 0, recusadas: 0, semResposta: 0, maisLenta: 0, ids: [] as string[] };

async function pedir(rota: string, corpo: unknown, chave: string): Promise<{ status: number; json: any }> {
  const inicio = Date.now();
  try {
    const res = await fetch(`${BASE}${rota}`, {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": chave }, body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(30000)
    });
    const json = await res.json().catch(() => null);
    const ms = Date.now() - inicio;
    minuto.tempos.push(ms);
    total.maisLenta = Math.max(total.maisLenta, ms);
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  }
}

async function main(): Promise<number> {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "oxide-queda-"));
  const recebedor = await iniciarRecebedor();
  const ambiente = { PORT: String(PORTA), SUPABASE_IOT_URL: recebedor.url, SUPABASE_SERVICE_KEY: recebedor.chave };
  const arquivo = path.join(pasta, "oxide.db");
  let api: ChildProcess | undefined;
  let worker: ChildProcess | undefined;
  const ler = <T>(sql: string): T[] => {
    const db = new Database(arquivo, { readonly: true, timeout: 30000 });
    try { return db.prepare(sql).all() as T[]; } finally { db.close(); }
  };
  const tamanho = (): { banco: number; wal: number } => ({
    banco: fs.statSync(arquivo).size,
    wal: fs.existsSync(`${arquivo}-wal`) ? fs.statSync(`${arquivo}-wal`).size : 0
  });
  const naFila = (): number => ler<{ n: number }>("SELECT count(*) AS n FROM mensagens WHERE status <> 'SYNCED'")[0]!.n;
  const saude = async (): Promise<string> => fetch(`${BASE}/health`).then(async r => `${r.status} ${(await r.json() as any).status}`).catch(() => "sem resposta");

  try {
    etapa("0. Cenário");
    console.log(`   Pasta: ${pasta}`);
    console.log(`   ${LACRES} lacres; cada um envia uma leitura a cada ${INTERVALO_S} s (${(LACRES / INTERVALO_S).toFixed(0)} por segundo)`);
    console.log(`   Banco principal fora do ar por ${MINUTOS} minutos; previsão de ${Math.round(LACRES / INTERVALO_S * MINUTOS * 60)} leituras`);
    console.log(`   Worker: rodada a cada ${process.env.WORKER_INTERVAL_SECONDS ?? 10} s, lotes de ${process.env.WORKER_BATCH_SIZE ?? 100} (o padrão é 10 s e 100)`);

    const lacres: Lacre[] = Array.from({ length: LACRES }, (_, i) => ({
      device_id: `DSP-QUEDA-${String(i + 1).padStart(5, "0")}`, chave: `chave-queda-${i + 1}-${randomBytes(8).toString("hex")}`,
      latitude: -7.2 + Math.random() * 0.2, longitude: -39.4 + Math.random() * 0.2, bateria: 60 + Math.random() * 40, seq: 0, selo: ""
    }));
    for (const l of lacres) recebedor.dispositivos.push({ device_id: l.device_id, api_key_hash: sha(l.chave), active: true, firmware_version: "2.0.0" });

    etapa("1. Preparação: cadastro, ativação e vínculo, com o banco principal no ar");
    api = subir("src/server.ts", pasta, ambiente);
    const prazoApi = Date.now() + 60000;
    while (Date.now() < prazoApi && !(await fetch(`${BASE}/`).then(r => r.ok).catch(() => false))) await espera(300);
    // Nesta etapa o Worker roda mais vezes, só para preparar depressa
    worker = subir("src/worker/index.ts", pasta, { ...ambiente, WORKER_INTERVAL_SECONDS: "1", WORKER_CADASTRO_INTERVAL_SECONDS: "3" });
    const aguardar = async (sql: string, alvo: number, limiteMs: number): Promise<number> => {
      const fim = Date.now() + limiteMs;
      let n = 0;
      while (Date.now() < fim && n < alvo) {
        await espera(500);
        n = fs.existsSync(arquivo) ? ler<{ n: number }>(sql)[0]!.n : 0;
      }
      return n;
    };
    const cadastrados = await aguardar("SELECT count(*) AS n FROM devices", LACRES, 90000);
    conferir("Dispositivos cadastrados na Oxide", `${LACRES}`, `${cadastrados}`, cadastrados === LACRES);

    let proximo = 0;
    await Promise.all(Array.from({ length: 30 }, async () => {
      while (proximo < lacres.length) {
        const l = lacres[proximo++]!;
        const r = await pedir("/api/v1/iot/activations", { message_id: `ATV-${l.device_id}`, device_id: l.device_id, status: "ATIVO", latitude: l.latitude, longitude: l.longitude, battery_percent: l.bateria }, l.chave);
        l.selo = String(r.json?.seal_code ?? "");
      }
    }));
    for (const l of lacres) {
      recebedor.dispositivos.find(d => d.device_id === l.device_id)!.binding = {
        binding_id: `VINC-${l.device_id}`, seal_code: l.selo, cylinder_code: `CIL-${l.device_id.slice(-5)}`, customer_code: "CLI-0001", customer_name: "Cliente do teste"
      };
    }
    const vinculados = await aguardar("SELECT count(*) AS n FROM devices WHERE cylinder_code IS NOT NULL", LACRES, 90000);
    conferir("Lacres ativados e vinculados a um cilindro", `${LACRES}`, `${vinculados}`, vinculados === LACRES);
    await aguardar("SELECT count(*) AS n FROM mensagens WHERE status = 'SYNCED'", LACRES, 60000);

    // Daqui em diante o Worker roda como em produção
    await derrubar(worker);
    worker = subir("src/worker/index.ts", pasta, ambiente);
    await espera(3000);
    minuto.tempos = [];

    etapa(`2. Banco principal fora do ar por ${MINUTOS} minutos, com os lacres enviando`);
    recebedor.foraDoAr = true;
    const inicio = Date.now();
    const fimDaQueda = inicio + MINUTOS * 60000;
    console.log(`   Início: ${hora()}. Previsão de volta: ${new Date(fimDaQueda).toLocaleTimeString("pt-BR")}`);
    console.log("   min | aceitas no minuto | recusadas | sem resposta | na fila | banco (MB) | WAL (MB) | metade até | 95% até | mais lenta | saúde");

    let enviando = true;
    const lacreEnvia = async (l: Lacre): Promise<void> => {
      await espera(Math.random() * INTERVALO_S * 1000);
      while (enviando) {
        const proximoEnvio = Date.now() + INTERVALO_S * 1000;
        l.latitude += (Math.random() - 0.5) * 0.002;
        l.longitude += (Math.random() - 0.5) * 0.002;
        l.bateria = Math.max(1, l.bateria - 0.01);
        const id = `MSG-${l.device_id.slice(-5)}-${++l.seq}`;
        const r = await pedir("/api/v1/iot/telemetries", {
          message_id: id, device_id: l.device_id, latitude: Number(l.latitude.toFixed(6)), longitude: Number(l.longitude.toFixed(6)),
          gps_ok: true, battery_percent: Number(l.bateria.toFixed(1)), seal_status: "LOCKED", speed_kmh: 40, gsm_signal: -70, satelites: 9, hdop: 0.9
        }, l.chave);
        if (r.status === 202 || r.status === 200) { minuto.aceitas++; total.aceitas++; total.ids.push(id); }
        else if (r.status === 0) { minuto.semResposta++; total.semResposta++; l.seq--; }
        else { minuto.recusadas++; total.recusadas++; }
        await espera(Math.max(0, proximoEnvio - Date.now()));
      }
    };
    const envios = Promise.all(lacres.map(lacreEnvia));

    const amostras: Array<Record<string, number | string>> = [];
    let tentativasGastas = 0;
    let saudeRuim = 0;
    for (let m = 1; Date.now() < fimDaQueda; m++) {
      await espera(Math.max(0, Math.min(fimDaQueda, inicio + m * 60000) - Date.now()));
      const tempos = [...minuto.tempos].sort((a, b) => a - b);
      const p = (q: number): number => tempos[Math.min(tempos.length - 1, Math.floor(tempos.length * q))] ?? 0;
      const fila = naFila();
      const t = tamanho();
      const s = await saude();
      if (!s.startsWith("503")) saudeRuim++;
      tentativasGastas = Math.max(tentativasGastas, ler<{ n: number }>("SELECT COALESCE(max(attempt_count), 0) AS n FROM mensagens")[0]!.n);
      const amostra = { minuto: m, aceitas: minuto.aceitas, recusadas: minuto.recusadas, semResposta: minuto.semResposta, naFila: fila, bancoMB: mb(t.banco), walMB: mb(t.wal), p50: p(0.5), p95: p(0.95), max: tempos[tempos.length - 1] ?? 0, saude: s };
      amostras.push(amostra);
      console.log(`   ${String(m).padStart(3)} | ${String(amostra.aceitas).padStart(17)} | ${String(amostra.recusadas).padStart(9)} | ${String(amostra.semResposta).padStart(12)} | ${String(fila).padStart(7)} | ${amostra.bancoMB.padStart(10)} | ${amostra.walMB.padStart(8)} | ${String(amostra.p50).padStart(7)} ms | ${String(amostra.p95).padStart(4)} ms | ${String(amostra.max).padStart(7)} ms | ${s}`);
      minuto.tempos = [];
      minuto.aceitas = minuto.recusadas = minuto.semResposta = 0;
    }
    enviando = false;
    await envios;

    const filaNoFim = naFila();
    const noFim = tamanho();
    console.log(`   Fim da queda: ${hora()}`);
    conferir("A API aceitou todas as leituras durante a queda", "0 recusadas e 0 sem resposta", `${total.aceitas} aceitas; ${total.recusadas} recusadas; ${total.semResposta} sem resposta`, total.recusadas === 0 && total.semResposta === 0);
    conferir("Tudo ficou guardado na fila da Oxide", `pelo menos ${total.aceitas}`, `${filaNoFim} mensagens na fila`, filaNoFim >= total.aceitas);
    conferir("A queda não gastou tentativa de nenhuma mensagem", "0", `maior número de tentativas = ${tentativasGastas}`, tentativasGastas === 0);
    conferir("O /health avisou o problema durante toda a queda", "503 em todas as amostras", `${amostras.length - saudeRuim} de ${amostras.length} amostras com 503`, saudeRuim === 0);
    console.log(`   Tamanho do banco no fim da queda: ${mb(noFim.banco)} MB (mais ${mb(noFim.wal)} MB de WAL); resposta mais lenta de todo o período: ${total.maisLenta} ms`);

    etapa("3. Banco principal de volta: a fila esvazia");
    recebedor.foraDoAr = false;
    const volta = Date.now();
    console.log(`   Volta: ${hora()}. Os lacres pararam de enviar, para medir só o esvaziamento`);
    const prazo = volta + 4 * 3600000;
    let resta = filaNoFim;
    let ultimaLinha = volta;
    while (Date.now() < prazo && resta > 0) {
      await espera(5000);
      resta = naFila();
      if (Date.now() - ultimaLinha >= 120000 || resta === 0) {
        console.log(`   ${((Date.now() - volta) / 60000).toFixed(1)} min depois da volta: ${resta} na fila`);
        ultimaLinha = Date.now();
      }
    }
    const esvaziou = (Date.now() - volta) / 1000;
    conferir("A fila esvaziou sozinha", "0 na fila", `${resta} na fila depois de ${(esvaziou / 60).toFixed(1)} minutos (${(filaNoFim / esvaziou).toFixed(0)} mensagens por segundo)`, resta === 0);

    etapa("4. Conferência final");
    const linhas = ler<{ status: string; n: number }>("SELECT status, count(*) AS n FROM mensagens GROUP BY status");
    const totalOxide = linhas.reduce((n, l) => n + l.n, 0);
    conferir("Todas as mensagens marcadas como enviadas", "só SYNCED", linhas.map(l => `${l.status}=${l.n}`).join(", "), linhas.length === 1 && linhas[0]!.status === "SYNCED");
    conferir("Nada perdido e nada a mais", `${totalOxide} dos dois lados`, `Oxide ${totalOxide}; banco principal ${recebedor.mensagens.size}`, recebedor.mensagens.size === totalOxide);
    const faltando = total.ids.filter(id => !recebedor.mensagens.has(id)).length;
    conferir("Toda leitura aceita durante a queda chegou ao banco principal", `${total.ids.length}`, `${total.ids.length - faltando}`, faltando === 0);
    const semCilindro = [...recebedor.mensagens.values()].filter(m => m.type === "TELEMETRIA" && typeof m.cylinder_code !== "string").length;
    conferir("As leituras chegaram com o cilindro do vínculo", "0 sem cilindro", `${semCilindro} sem cilindro`, semCilindro === 0);
    const db = new Database(arquivo, { readonly: true, timeout: 30000 });
    const integro = db.pragma("integrity_check", { simple: true }) === "ok" && (db.pragma("foreign_key_check") as unknown[]).length === 0;
    db.close();
    conferir("Oxide íntegra", "ok", integro ? "ok" : "com erro", integro);
    const s = await saude();
    conferir("O /health voltou ao normal", "200 OK", s, s.startsWith("200"));

    fs.writeFileSync(path.join(pasta, "queda-resultado.json"), JSON.stringify({
      lacres: LACRES, minutos: MINUTOS, intervaloS: INTERVALO_S, aceitas: total.aceitas, recusadas: total.recusadas, semResposta: total.semResposta,
      filaNoFim, bancoMB: mb(noFim.banco), walMB: mb(noFim.wal), maisLentaMs: total.maisLenta, esvaziouEmS: esvaziou, porSegundoNaVolta: filaNoFim / esvaziou,
      totalOxide, noBancoPrincipal: recebedor.mensagens.size, amostras, conforme, falhas
    }, null, 2));
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
