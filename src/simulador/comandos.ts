import { ChildProcess, execFileSync, spawn } from "child_process";
import { createHash, randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { iniciarRecebedor } from "./recebedor";

// npm run simular:comandos — teste em massa da tabela commands.
// O sistema principal cria muitos comandos de válvula; o Worker os traz para
// a Oxide; cada lacre busca os seus, executa e confirma; a confirmação volta
// ao sistema principal. No meio, o banco principal, o Worker e a API caem.
// Tudo numa pasta temporária, com o recebedor de teste no lugar do Supabase:
// o oxide.db do projeto e o banco principal não são tocados.
//
// Ajustes (variáveis de ambiente): COMANDOS_LACRES, COMANDOS_POR_LACRE,
// COMANDOS_PARALELO e COMANDOS_PORTA.

const numero = (nome: string, padrao: number): number => {
  const valor = Number(process.env[nome]);
  return Number.isInteger(valor) && valor > 0 ? valor : padrao;
};
const LACRES = numero("COMANDOS_LACRES", 300);
const POR_LACRE = numero("COMANDOS_POR_LACRE", 10);
const PARALELO = numero("COMANDOS_PARALELO", 40);
const PORTA = numero("COMANDOS_PORTA", 3195);
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

interface Comando { command_id: string; command_type: string; resultado: "EXECUTADO" | "ERRO" }
interface Lacre { device_id: string; chave: string; comandos: Comando[] }

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
    await espera(200);
  }
  return false;
}

const medidas = { tempos: [] as number[], semConexao: 0, erros5xx: 0, feitos: 0, fora: [] as string[] };

// O lacre de verdade tenta de novo quando fica sem resposta
async function pedir(metodo: string, rota: string, corpo: unknown, chave?: string): Promise<{ status: number; json: any; tentativas: number }> {
  for (let tentativa = 1; ; tentativa++) {
    const inicio = Date.now();
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (chave) headers["x-api-key"] = chave;
      const init: RequestInit = { method: metodo, headers };
      if (corpo !== undefined) init.body = JSON.stringify(corpo);
      const res = await fetch(`${BASE}${rota}`, init);
      const json = await res.json().catch(() => null);
      if (res.status < 500) {
        medidas.tempos.push(Date.now() - inicio);
        return { status: res.status, json, tentativas: tentativa };
      }
      medidas.erros5xx++;
    } catch {
      medidas.semConexao++;
    }
    if (tentativa >= 120) return { status: 0, json: null, tentativas: tentativa };
    await espera(500);
  }
}
const anotar = (ok: boolean, texto: string): void => { if (!ok) medidas.fora.push(texto); };

async function main(): Promise<number> {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "oxide-comandos-"));
  const recebedor = await iniciarRecebedor();
  const ambiente = {
    PORT: String(PORTA), SUPABASE_IOT_URL: recebedor.url, SUPABASE_SERVICE_KEY: recebedor.chave,
    WORKER_INTERVAL_SECONDS: "1", WORKER_CADASTRO_INTERVAL_SECONDS: "5", WORKER_BATCH_SIZE: "200",
    // Todos os lacres do teste saem do mesmo endereço: o limite por endereço fica alto
    LIMITE_FALHAS_DE_CHAVE_POR_MINUTO: "1000000"
  };
  const arquivo = path.join(pasta, "oxide.db");
  let api: ChildProcess | undefined;
  let worker: ChildProcess | undefined;
  const ler = <T>(sql: string, ...p: unknown[]): T[] => {
    const db = new Database(arquivo, { readonly: true, timeout: 30000 });
    try { return db.prepare(sql).all(...p) as T[]; } finally { db.close(); }
  };
  const contar = (onde = "1=1"): number => ler<{ n: number }>(`SELECT count(*) AS n FROM commands WHERE ${onde}`)[0]!.n;
  const aguardar = async (medir: () => number, alvo: number, limiteMs: number): Promise<number> => {
    const fim = Date.now() + limiteMs;
    let n = medir();
    while (Date.now() < fim && n !== alvo) {
      await espera(500);
      n = medir();
    }
    return n;
  };

  try {
    etapa("0. Cenário");
    const lacres: Lacre[] = Array.from({ length: LACRES }, (_, i) => {
      const device_id = `DSP-CMD-${String(i + 1).padStart(5, "0")}`;
      return {
        device_id, chave: `chave-cmd-${i + 1}-${randomBytes(8).toString("hex")}`,
        comandos: Array.from({ length: POR_LACRE }, (_, c) => ({
          command_id: `CMD-${device_id.slice(-5)}-${String(c + 1).padStart(3, "0")}`,
          command_type: c % 2 === 0 ? "TRAVAR_VALVULA" : "DESTRAVAR_VALVULA",
          resultado: Math.random() < 0.1 ? "ERRO" as const : "EXECUTADO" as const
        }))
      };
    });
    const totalComandos = LACRES * POR_LACRE;
    const comErro = lacres.reduce((n, l) => n + l.comandos.filter(c => c.resultado === "ERRO").length, 0);
    console.log(`   Pasta: ${pasta}`);
    console.log(`   ${LACRES} lacres, ${POR_LACRE} comandos de válvula para cada um: ${totalComandos} comandos`);
    console.log(`   ${totalComandos - comErro} serão confirmados como EXECUTADO e ${comErro} como ERRO; ${PARALELO} lacres ao mesmo tempo`);
    for (const l of lacres) recebedor.dispositivos.push({ device_id: l.device_id, api_key_hash: sha(l.chave), active: true });

    etapa("1. API e Worker em processos separados; os comandos nascem no sistema principal");
    api = subir("src/server.ts", pasta, ambiente);
    conferir("API no ar", "responde em até 60 s", (await apiNoAr()) ? "respondeu" : "não respondeu", await apiNoAr(1000));
    worker = subir("src/worker/index.ts", pasta, ambiente);
    const prazo = Date.now() + 60000;
    while (Date.now() < prazo && !(fs.existsSync(arquivo) && ler<{ n: number }>("SELECT count(*) AS n FROM devices")[0]!.n === LACRES)) await espera(500);

    // O sistema cria os comandos, com a data de criação em ordem
    const base = Date.now() - totalComandos * 1000;
    let ordem = 0;
    for (let c = 0; c < POR_LACRE; c++) {
      for (const l of lacres) {
        const cmd = l.comandos[c]!;
        recebedor.comandos.push({ command_id: cmd.command_id, device_id: l.device_id, command_type: cmd.command_type, created_at: new Date(base + (ordem++) * 1000).toISOString() });
      }
    }
    // E alguns que a API tem de ignorar
    for (let i = 0; i < 20; i++) recebedor.comandos.push({ command_id: `CMD-TIPO-ERRADO-${i}`, device_id: lacres[i % LACRES]!.device_id, command_type: "REINICIAR" });
    for (let i = 0; i < 20; i++) recebedor.comandos.push({ command_id: `CMD-SEM-LACRE-${i}`, device_id: `DSP-NAO-EXISTE-${i}`, command_type: "TRAVAR_VALVULA" });

    const trazidos = await aguardar(() => contar(), totalComandos, 120000);
    conferir("Worker trouxe todos os comandos para a tabela commands", `${totalComandos}`, `${trazidos}`, trazidos === totalComandos);
    conferir("Todos entraram como PENDENTE", `${totalComandos}`, `${contar("status = 'PENDENTE'")}`, contar("status = 'PENDENTE'") === totalComandos);
    const ignorados = contar("command_id LIKE 'CMD-TIPO-ERRADO-%' OR command_id LIKE 'CMD-SEM-LACRE-%'");
    conferir("Comando de tipo desconhecido ou de dispositivo que não existe ficou de fora", "0 gravados", `${ignorados} gravados`, ignorados === 0);
    await espera(5000);
    conferir("O Worker busca a lista toda a cada rodada e não duplica nenhum comando", `${totalComandos}`, `${contar()} depois de mais 5 rodadas`, contar() === totalComandos);
    const semData = contar("created_at IS NULL OR created_at = ''");
    conferir("Todo comando com a data de criação", "0 sem data", `${semData} sem data`, semData === 0);
    const saude1 = await fetch(`${BASE}/health`).then(r => r.json() as Promise<any>).catch(() => null);
    conferir("O /health mostra os comandos pendentes", `${totalComandos}`, `${saude1?.comandos_pendentes}`, saude1?.comandos_pendentes === totalComandos);

    etapa("2. Cada lacre busca, executa e confirma, com quedas no meio");
    const inicio = Date.now();
    const totalPassos = LACRES;
    const quando = async (fracao: number, acao: () => Promise<void>): Promise<void> => {
      while (medidas.feitos < totalPassos * fracao) await espera(100);
      await acao();
    };
    const marca = (texto: string): void => console.log(`   [${((Date.now() - inicio) / 1000).toFixed(1)} s: ${texto}]`);
    const quedas = Promise.all([
      quando(0.25, async () => { recebedor.foraDoAr = true; marca("banco principal fora do ar"); await espera(6000); recebedor.foraDoAr = false; marca("banco principal de volta"); }),
      quando(0.50, async () => { await derrubar(worker!); marca("Worker derrubado"); await espera(3000); worker = subir("src/worker/index.ts", pasta, ambiente); marca("Worker religado"); }),
      quando(0.75, async () => { await derrubar(api!); marca("API derrubada"); await espera(2000); api = subir("src/server.ts", pasta, ambiente); await apiNoAr(); marca("API religada"); })
    ]);

    const umLacre = async (l: Lacre, indice: number): Promise<void> => {
      const vizinho = lacres[(indice + 1) % LACRES]!;
      const rota = `/api/v1/iot/commands/${l.device_id}`;

      const lista = await pedir("GET", rota, undefined, l.chave);
      const ids = Array.isArray(lista.json) ? lista.json.map((c: any) => c.command_id) : [];
      anotar(lista.status === 200 && ids.length === POR_LACRE, `${l.device_id}: esperava ${POR_LACRE} pendentes, vieram ${ids.length} (${lista.status})`);
      anotar(ids.join(",") === l.comandos.map(c => c.command_id).join(","), `${l.device_id}: comandos fora da ordem de criação`);
      anotar(!Array.isArray(lista.json) || lista.json.every((c: any) => c.device_id === l.device_id && c.status === "PENDENTE" &&
        ["TRAVAR_VALVULA", "DESTRAVAR_VALVULA"].includes(c.command_type)), `${l.device_id}: veio comando de outro dispositivo, já confirmado ou de tipo errado`);

      // Pedidos que a API tem de barrar (em parte dos lacres, para não pesar)
      if (indice % 10 === 0) {
        const semChave = await pedir("GET", rota, undefined);
        const deOutro = await pedir("GET", `/api/v1/iot/commands/${vizinho.device_id}`, undefined, l.chave);
        const statusErrado = await pedir("POST", "/api/v1/iot/commands/confirm", { command_id: l.comandos[0]!.command_id, device_id: l.device_id, status: "FEITO" }, l.chave);
        const comandoDoVizinho = await pedir("POST", "/api/v1/iot/commands/confirm", { command_id: vizinho.comandos[0]!.command_id, device_id: l.device_id, status: "EXECUTADO" }, l.chave);
        const emNomeDoVizinho = await pedir("POST", "/api/v1/iot/commands/confirm", { command_id: vizinho.comandos[0]!.command_id, device_id: vizinho.device_id, status: "EXECUTADO" }, l.chave);
        const inexistente = await pedir("POST", "/api/v1/iot/commands/confirm", { command_id: "CMD-QUE-NAO-EXISTE", device_id: l.device_id, status: "EXECUTADO" }, l.chave);
        anotar(semChave.status === 401, `${l.device_id}: buscar sem chave respondeu ${semChave.status} (esperado 401)`);
        anotar(deOutro.status === 403, `${l.device_id}: buscar os comandos de outro respondeu ${deOutro.status} (esperado 403)`);
        anotar(statusErrado.status === 400, `${l.device_id}: status inválido respondeu ${statusErrado.status} (esperado 400)`);
        anotar(comandoDoVizinho.status === 404, `${l.device_id}: confirmar comando de outro respondeu ${comandoDoVizinho.status} (esperado 404)`);
        anotar(emNomeDoVizinho.status === 403, `${l.device_id}: confirmar em nome de outro respondeu ${emNomeDoVizinho.status} (esperado 403)`);
        anotar(inexistente.status === 404, `${l.device_id}: comando inexistente respondeu ${inexistente.status} (esperado 404)`);
      }

      for (const cmd of l.comandos) {
        const corpo: Record<string, unknown> = { command_id: cmd.command_id, device_id: l.device_id, status: cmd.resultado };
        if (cmd.resultado === "ERRO") corpo.error_message = "Válvula não respondeu";
        const r = await pedir("POST", "/api/v1/iot/commands/confirm", corpo, l.chave);
        // Resposta perdida e nova tentativa: a API já tinha confirmado e responde 409
        anotar(r.status === 200 || (r.tentativas > 1 && r.status === 409), `${l.device_id}: confirmar ${cmd.command_id} respondeu ${r.status}`);
      }

      const denovo = await pedir("POST", "/api/v1/iot/commands/confirm", { command_id: l.comandos[0]!.command_id, device_id: l.device_id, status: "EXECUTADO" }, l.chave);
      anotar(denovo.status === 409, `${l.device_id}: confirmar de novo respondeu ${denovo.status} (esperado 409)`);
      const vazia = await pedir("GET", rota, undefined, l.chave);
      anotar(vazia.status === 200 && Array.isArray(vazia.json) && vazia.json.length === 0, `${l.device_id}: ainda há comando pendente depois de confirmar todos`);
      medidas.feitos++;
    };

    let proximo = 0;
    await Promise.all(Array.from({ length: Math.min(PARALELO, LACRES) }, async () => {
      while (proximo < lacres.length) {
        const i = proximo++;
        await umLacre(lacres[i]!, i);
      }
    }));
    await quedas;
    const duracao = (Date.now() - inicio) / 1000;
    for (const f of medidas.fora.slice(0, 10)) console.log(`   fora do esperado: ${f}`);
    conferir("Toda resposta da API foi a esperada", "0 fora do esperado", `${medidas.tempos.length} pedidos; ${medidas.fora.length} fora do esperado`, medidas.fora.length === 0);
    conferir("Nenhum erro 500 da API", "0", `${medidas.erros5xx}`, medidas.erros5xx === 0);
    const tempos = [...medidas.tempos].sort((a, b) => a - b);
    const p = (q: number): number => tempos[Math.min(tempos.length - 1, Math.floor(tempos.length * q))] ?? 0;
    console.log(`   Duração: ${duracao.toFixed(1)} s; ${(medidas.tempos.length / duracao).toFixed(0)} pedidos por segundo`);
    console.log(`   Tempo de resposta: metade até ${p(0.5)} ms; 95% até ${p(0.95)} ms; 99% até ${p(0.99)} ms; a mais lenta ${tempos[tempos.length - 1]} ms`);
    console.log(`   Sem conexão (API derrubada): ${medidas.semConexao}`);

    etapa("3. O que ficou na tabela commands");
    const porStatus = new Map(ler<{ status: string; n: number }>("SELECT status, count(*) AS n FROM commands GROUP BY status").map(l => [l.status, l.n]));
    conferir("Nenhum comando pendente", "0", `${porStatus.get("PENDENTE") ?? 0}`, (porStatus.get("PENDENTE") ?? 0) === 0);
    conferir("Comandos EXECUTADO", `${totalComandos - comErro}`, `${porStatus.get("EXECUTADO") ?? 0}`, porStatus.get("EXECUTADO") === totalComandos - comErro);
    conferir("Comandos ERRO", `${comErro}`, `${porStatus.get("ERRO") ?? 0}`, (porStatus.get("ERRO") ?? 0) === comErro);
    const semExecucao = contar("executed_at IS NULL");
    conferir("Todo comando com a data da confirmação", "0 sem data", `${semExecucao} sem data`, semExecucao === 0);
    const erroSemMotivo = contar("status = 'ERRO' AND (error_message IS NULL OR error_message = '')");
    const executadoComMotivo = contar("status = 'EXECUTADO' AND error_message IS NOT NULL");
    conferir("Motivo gravado só nos comandos com erro", "0 fora da regra", `${erroSemMotivo + executadoComMotivo} fora da regra`, erroSemMotivo + executadoComMotivo === 0);
    const gravados = new Map(ler<{ command_id: string; status: string; command_type: string; device_id: string }>("SELECT command_id, status, command_type, device_id FROM commands").map(c => [c.command_id, c]));
    let diferentes = 0;
    for (const l of lacres) {
      for (const c of l.comandos) {
        const g = gravados.get(c.command_id);
        if (!g || g.status !== c.resultado || g.command_type !== c.command_type || g.device_id !== l.device_id) diferentes++;
      }
    }
    conferir("Cada comando com o dispositivo, o tipo e o resultado certos", "0 diferentes", `${totalComandos} conferidos; ${diferentes} diferentes`, diferentes === 0);

    etapa("4. A confirmação voltou ao sistema principal");
    const naFila = (): number => ler<{ n: number }>("SELECT count(*) AS n FROM mensagens WHERE status <> 'SYNCED'")[0]!.n;
    const resta = await aguardar(naFila, 0, 180000);
    conferir("Fila esvaziada", "0 na fila", `${resta} na fila`, resta === 0);
    const confirmacoes = ler<{ n: number }>("SELECT count(*) AS n FROM mensagens WHERE tipo = 'CONFIRMACAO_COMANDO'")[0]!.n;
    conferir("Uma mensagem de confirmação para cada comando", `${totalComandos}`, `${confirmacoes}`, confirmacoes === totalComandos);
    let certos = 0;
    for (const l of lacres) {
      for (const c of l.comandos) {
        const m = recebedor.mensagens.get(`CONF-${c.command_id}`);
        const noSistema = recebedor.comandos.find(x => x.command_id === c.command_id);
        if (m?.command_status === c.resultado && m.device_id === l.device_id && noSistema?.confirmado === c.resultado &&
            (c.resultado === "ERRO" ? m.error_message === "Válvula não respondeu" : !("error_message" in m))) certos++;
      }
    }
    conferir("O sistema principal recebeu o resultado certo de cada comando", `${totalComandos}`, `${certos}`, certos === totalComandos);

    etapa("5. Comando já confirmado não volta a ficar pendente");
    // O sistema manda de novo 50 comandos que o lacre já confirmou
    const repetidos = lacres.slice(0, 50).map(l => l.comandos[0]!.command_id);
    for (const id of repetidos) delete recebedor.comandos.find(c => c.command_id === id)!.confirmado;
    await espera(6000);
    const voltaram = contar(`status = 'PENDENTE'`);
    conferir("Comandos reenviados pelo sistema continuam confirmados", "0 pendentes", `${voltaram} pendentes; ${contar()} comandos na tabela`, voltaram === 0 && contar() === totalComandos);
    const umDeles = lacres[0]!;
    const semNada = await pedir("GET", `/api/v1/iot/commands/${umDeles.device_id}`, undefined, umDeles.chave);
    conferir("O lacre não recebe de novo um comando que já confirmou", "lista vazia", `${Array.isArray(semNada.json) ? semNada.json.length : "?"} comando(s)`, Array.isArray(semNada.json) && semNada.json.length === 0);

    etapa("6. Limpeza dos comandos antigos (npm run retencao)");
    await derrubar(worker!);
    worker = undefined;
    const escrita = new Database(arquivo, { timeout: 30000 });
    const antigos = escrita.prepare("UPDATE commands SET executed_at = datetime('now', '-40 days') WHERE command_id IN (SELECT command_id FROM commands ORDER BY id LIMIT 200)").run().changes;
    escrita.prepare("INSERT INTO commands (command_id, device_id, command_type, status, created_at) VALUES ('CMD-PENDENTE-ANTIGO', ?, 'TRAVAR_VALVULA', 'PENDENTE', datetime('now', '-90 days'))").run(umDeles.device_id);
    escrita.close();
    const retencao = (args: string[]): string => execFileSync(process.execPath, ["--require", path.join(PROJETO, "node_modules", "ts-node", "register"), path.join(PROJETO, "src/manutencao/retencao.ts"), ...args], {
      cwd: pasta, encoding: "utf8", env: { ...process.env, TS_NODE_PROJECT: path.join(PROJETO, "tsconfig.json") }
    });
    const simulacao = retencao([]);
    const depoisDaSimulacao = contar();
    retencao(["--confirmar"]);
    conferir("Sem --confirmar, só mostra", `${antigos} a remover e nada apagado`, `${/comandos concluídos há mais de 30 dias: (\d+) a remover/.exec(simulacao)?.[1]} a remover; ${depoisDaSimulacao} na tabela`, simulacao.includes(`: ${antigos} a remover`) && depoisDaSimulacao === totalComandos + 1);
    conferir("Com --confirmar, apaga só os concluídos há mais de 30 dias", `${totalComandos + 1 - antigos} na tabela`, `${contar()} na tabela`, contar() === totalComandos + 1 - antigos);
    conferir("Comando pendente nunca é apagado, por mais antigo que seja", "1", `${contar("command_id = 'CMD-PENDENTE-ANTIGO'")}`, contar("command_id = 'CMD-PENDENTE-ANTIGO'") === 1);

    etapa("7. Banco");
    const db = new Database(arquivo, { readonly: true, timeout: 30000 });
    const integro = db.pragma("integrity_check", { simple: true }) === "ok" && (db.pragma("foreign_key_check") as unknown[]).length === 0;
    db.close();
    conferir("Oxide íntegra depois da carga e das quedas", "ok", integro ? "ok" : "com erro", integro);

    fs.writeFileSync(path.join(pasta, "comandos-resultado.json"), JSON.stringify({
      lacres: LACRES, porLacre: POR_LACRE, totalComandos, comErro, pedidos: medidas.tempos.length, duracao,
      tempos: { p50: p(0.5), p95: p(0.95), p99: p(0.99), max: tempos[tempos.length - 1] }, semConexao: medidas.semConexao, erros5xx: medidas.erros5xx, conforme, falhas
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
