import { ChildProcess, spawn } from "child_process";
import { createHash, randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { iniciarRecebedor } from "./recebedor";

// npm run simular:massa — teste em massa, sem o equipamento.
// Monta um cenário como o do sistema principal (organizações, clientes,
// unidades com geocerca, veículos, motoristas e cilindros), põe um lacre em
// cada cilindro e faz todos enviarem ao mesmo tempo pela API, enquanto o
// Worker entrega ao recebedor de teste (no lugar do Supabase).
// API e Worker rodam em processos separados, como em produção, e são
// derrubados no meio do teste. Tudo numa pasta temporária: o oxide.db do
// projeto e o banco principal não são tocados.
//
// Ajustes (variáveis de ambiente): MASSA_LACRES, MASSA_PONTOS, MASSA_PARALELO,
// MASSA_PORTA, MASSA_SEMENTE.

const numero = (nome: string, padrao: number): number => {
  const valor = Number(process.env[nome]);
  return Number.isInteger(valor) && valor > 0 ? valor : padrao;
};
const LACRES = numero("MASSA_LACRES", 500);
const PONTOS = numero("MASSA_PONTOS", 24);
const PARALELO = numero("MASSA_PARALELO", 40);
const PORTA = numero("MASSA_PORTA", 3198);
const PROJETO = path.resolve(__dirname, "..", "..");
const BASE = `http://127.0.0.1:${PORTA}`;

// Sorteio com semente: a mesma semente repete o mesmo cenário
let semente = numero("MASSA_SEMENTE", 20261010);
const sorteio = (): number => {
  semente = (semente + 0x6D2B79F5) | 0;
  let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const chance = (p: number): boolean => sorteio() < p;
const entre = (a: number, b: number): number => a + sorteio() * (b - a);
const casas = (valor: number, n: number): number => Number(valor.toFixed(n));
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

// ------------------------------------------------------------------ cenário
interface Unidade { nome: string; cliente: string; latitude: number; longitude: number; raio_m: number }
interface Organizacao { nome: string; deposito: { latitude: number; longitude: number }; unidades: Unidade[]; veiculos: string[]; motoristas: string[] }
interface Passo { rota: string; corpo: Record<string, unknown>; chave: string; esperado: number; id?: string }
interface Lacre {
  device_id: string; chave: string; organizacao: Organizacao; destino: Unidade;
  cilindro: { serie: string; qr: string; nfc: string; gas: string }; veiculo: string; motorista: string;
  passos: Passo[]; chegada: string; violado: boolean;
  comando?: { command_id: string; command_type: string; status: "EXECUTADO" | "ERRO" };
}

const distanciaM = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number => {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

function montarOrganizacoes(): Organizacao[] {
  const centros = [{ latitude: -7.2130, longitude: -39.3150 }, { latitude: -7.2340, longitude: -39.4090 }, { latitude: -3.7320, longitude: -38.5270 }];
  return centros.map((centro, o) => {
    const letra = String.fromCharCode(65 + o);
    const unidades: Unidade[] = [];
    for (let c = 1; c <= 6; c++) {
      for (let u = 1; u <= 2; u++) {
        unidades.push({
          nome: `Unidade ${letra}${c}.${u}`, cliente: `Cliente ${letra}${c}`,
          latitude: casas(centro.latitude + entre(-0.09, 0.09), 6), longitude: casas(centro.longitude + entre(-0.09, 0.09), 6), raio_m: 150
        });
      }
    }
    return {
      nome: `Organização ${letra}`, deposito: centro, unidades,
      veiculos: Array.from({ length: 8 }, (_, i) => `VEI-${letra}-${String(i + 1).padStart(2, "0")}`),
      motoristas: Array.from({ length: 8 }, (_, i) => `Motorista ${letra}${i + 1}`)
    };
  });
}

// Contas do que a API deve fazer, feitas aqui por fora, para comparar no fim
const previsto = {
  respostas: new Map<number, number>(),
  linhas: { TELEMETRIA: 0, EVENTO: 0, ALERTA_DO_LACRE: 0, CONFIRMACAO_COMANDO: 0 },
  automaticos: { BATERIA_BAIXA: 0, GSM_SINAL_FRACO: 0, LACRE_VIOLADO: 0, LACRE_ABERTO_SEM_AUTORIZACAO: 0 }
};

function montarLacre(indice: number, organizacoes: Organizacao[], chaveDoVizinho: () => string): Lacre {
  const organizacao = organizacoes[indice % organizacoes.length]!;
  const letra = organizacao.nome.slice(-1);
  const destino = organizacao.unidades[Math.floor(sorteio() * organizacao.unidades.length)]!;
  const device_id = `DSP-MASSA-${String(indice + 1).padStart(5, "0")}`;
  const chave = `chave-massa-${indice + 1}-${randomBytes(8).toString("hex")}`;
  const serie = `CIL-${letra}-${String(indice + 1).padStart(6, "0")}`;
  const lacre: Lacre = {
    device_id, chave, organizacao, destino,
    cilindro: { serie, qr: `QR-${serie}`, nfc: `NFC-${sha(serie).slice(0, 14).toUpperCase()}`, gas: ["O2 medicinal", "N2O", "CO2", "Argônio"][indice % 4]! },
    veiculo: organizacao.veiculos[indice % organizacao.veiculos.length]!,
    motorista: organizacao.motoristas[indice % organizacao.motoristas.length]!,
    passos: [], chegada: "", violado: chance(0.05)
  };

  const bateriaFraca = chance(0.15);
  const tunel = chance(0.15);
  const semGps = chance(0.15);
  const meio = Math.floor(PONTOS / 2);

  // Estado que a API guarda do dispositivo, acompanhado aqui
  const estado = { temTelemetria: false, latitude: NaN, longitude: NaN, gps: true, lacre: null as string | null, bateria: null as number | null, sinal: null as number | null };
  let bateria = bateriaFraca ? 22 : casas(entre(70, 100), 1);
  let seq = 0;
  const id = (prefixo: string): string => `${prefixo}-${device_id.slice(-5)}-${String(++seq).padStart(3, "0")}`;
  const conta = (status: number): void => { previsto.respostas.set(status, (previsto.respostas.get(status) ?? 0) + 1); };

  const enviar = (tipo: "TELEMETRIA" | "EVENTO" | "ALERTA", corpo: Record<string, unknown>): string => {
    const rota = tipo === "TELEMETRIA" ? "/api/v1/iot/telemetries" : tipo === "EVENTO" ? "/api/v1/iot/events" : "/api/v1/iot/alerts";
    const mensagem = String(tipo === "ALERTA" ? corpo.alert_id : corpo.message_id);
    const gps = corpo.gps_ok !== false;
    const selo = (corpo.seal_status as string | undefined) ?? null;
    const sinal = (corpo.gsm_signal as number | undefined) ?? null;
    const b = corpo.battery_percent as number;

    const repetida = tipo === "TELEMETRIA" && estado.temTelemetria && estado.latitude === corpo.latitude && estado.longitude === corpo.longitude &&
      estado.gps === gps && (selo === null || estado.lacre === selo);
    const esperado = tipo === "ALERTA" ? 201 : repetida ? 200 : 202;
    lacre.passos.push({ rota, corpo, chave, esperado, id: mensagem });
    conta(esperado);
    if (!repetida) previsto.linhas[tipo === "ALERTA" ? "ALERTA_DO_LACRE" : tipo]++;

    if (b < 15 && (estado.bateria === null || estado.bateria >= 15)) previsto.automaticos.BATERIA_BAIXA++;
    if (sinal !== null && sinal < -105 && (estado.sinal === null || estado.sinal >= -105)) previsto.automaticos.GSM_SINAL_FRACO++;
    if (selo !== null && selo !== estado.lacre) {
      if (selo === "BROKEN") previsto.automaticos.LACRE_VIOLADO++;
      if (selo === "UNLOCKED") previsto.automaticos.LACRE_ABERTO_SEM_AUTORIZACAO++;
    }

    if (tipo === "TELEMETRIA" && !repetida) estado.temTelemetria = true;
    estado.latitude = corpo.latitude as number;
    estado.longitude = corpo.longitude as number;
    estado.gps = gps;
    estado.bateria = b;
    if (selo !== null) estado.lacre = selo;
    if (sinal !== null) estado.sinal = sinal;
    return mensagem;
  };
  // Pedido que a API tem de recusar: não muda nada
  const recusado = (rota: string, corpo: Record<string, unknown>, comChave: string, esperado: number): void => {
    lacre.passos.push({ rota, corpo, chave: comChave, esperado });
    conta(esperado);
  };

  let selo = "LOCKED";
  let posicao = { latitude: organizacao.deposito.latitude, longitude: organizacao.deposito.longitude };
  const leitura = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    device_id, latitude: posicao.latitude, longitude: posicao.longitude, battery_percent: bateria, seal_status: selo,
    gsm_signal: -70, satelites: 9, hdop: 0.9, device_state: "EM_TRANSITO", ...extra
  });

  enviar("EVENTO", { message_id: id("EVT"), event_type: "startup", description: `Saída do depósito: ${lacre.veiculo}, ${lacre.motorista}`, ...leitura({ device_state: "LIGANDO" }) });

  for (let p = 1; p <= PONTOS; p++) {
    const f = p / PONTOS;
    posicao = p === PONTOS
      ? { latitude: destino.latitude, longitude: destino.longitude }
      : {
        latitude: casas(organizacao.deposito.latitude + (destino.latitude - organizacao.deposito.latitude) * f + entre(-0.0004, 0.0004), 6),
        longitude: casas(organizacao.deposito.longitude + (destino.longitude - organizacao.deposito.longitude) * f + entre(-0.0004, 0.0004), 6)
      };
    bateria = casas(Math.max(1, bateria - (bateriaFraca ? 1 : 0.3)), 1);
    const sinal = tunel && p >= meio && p < meio + 3 ? -110 : casas(entre(-95, -60), 0);

    if (lacre.violado && p === meio + 1) {
      selo = "BROKEN";
      enviar("EVENTO", { message_id: id("EVT"), event_type: "seal_changed", description: "Lacre rompido em trânsito", ...leitura({ gsm_signal: sinal }) });
    }

    const corpo = { message_id: id("MSG"), ...leitura({ gsm_signal: sinal, speed_kmh: p === PONTOS ? 0 : casas(entre(20, 70), 0) }) };
    const mensagem = enviar("TELEMETRIA", corpo);
    if (p === PONTOS) lacre.chegada = mensagem;

    if (p === 2 && chance(0.2)) lacre.passos.push({ rota: "/api/v1/iot/telemetries", corpo, chave, esperado: (conta(409), 409) });
    if (p === 3 && chance(0.1)) {
      const { battery_percent: _b, ...semBateria } = leitura();
      const { latitude: _l, longitude: _o, ...semPosicao } = leitura();
      recusado("/api/v1/iot/telemetries", { message_id: id("MSG"), ...semBateria }, chave, 400);
      recusado("/api/v1/iot/telemetries", { message_id: id("MSG"), ...semPosicao }, chave, 400);
      recusado("/api/v1/iot/events", { message_id: id("EVT"), ...leitura() }, chave, 400);
    }
    if (p === 4 && chance(0.05)) recusado("/api/v1/iot/telemetries", { message_id: id("MSG"), ...leitura() }, "chave-que-nao-existe", 401);
    if (p === 5 && chance(0.05)) recusado("/api/v1/iot/telemetries", { message_id: id("MSG"), ...leitura() }, chaveDoVizinho(), 403);

    // Sem sinal de GPS: o lacre repete a última posição com gps_ok = false
    if (semGps && p === meio - 2) {
      enviar("TELEMETRIA", { message_id: id("MSG"), ...leitura({ gps_ok: false, satelites: 0 }) });
      enviar("TELEMETRIA", { message_id: id("MSG"), ...leitura({ gps_ok: false, satelites: 0 }) });
      if (chance(0.6)) enviar("ALERTA", { alert_id: id("ALT"), alert_type: "GPS_SEM_SINAL", title: "GPS sem sinal", ...leitura({ gps_ok: false }) });
    }
  }

  // Parado na unidade do cliente: mesma posição, só a data e a hora mudam
  for (let i = 0; i < 2; i++) enviar("TELEMETRIA", { message_id: id("MSG"), ...leitura({ speed_kmh: 0, device_state: "PARADO" }) });
  if (!lacre.violado) {
    selo = "UNLOCKED";
    enviar("EVENTO", { message_id: id("EVT"), event_type: "seal_changed", description: `Entrega em ${destino.nome} (${destino.cliente})`, ...leitura({ device_state: "PARADO" }) });
  }
  enviar("EVENTO", { message_id: id("EVT"), event_type: "entrega_concluida", description: `Cilindro ${serie}`, ...leitura({ device_state: "PARADO" }) });

  if (chance(0.2)) {
    lacre.comando = { command_id: `CMD-MASSA-${device_id.slice(-5)}`, command_type: lacre.violado ? "TRAVAR_VALVULA" : "DESTRAVAR_VALVULA", status: chance(0.1) ? "ERRO" : "EXECUTADO" };
    previsto.linhas.CONFIRMACAO_COMANDO++;
  }
  return lacre;
}

// --------------------------------------------------------------- processos
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

// -------------------------------------------------------------------- envio
const medidas = { tempos: [] as number[], novasTentativas: 0, erros5xx: 0, semConexao: 0, fora: [] as string[], feitos: 0 };

async function pedir(metodo: string, rota: string, corpo: unknown, chave: string): Promise<{ status: number; json: any; tentativas: number }> {
  // O lacre de verdade tenta de novo com o mesmo message_id quando não tem resposta
  for (let tentativa = 1; ; tentativa++) {
    const inicio = Date.now();
    try {
      const init: RequestInit = { method: metodo, headers: { "content-type": "application/json", "x-api-key": chave } };
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
    medidas.novasTentativas++;
    await espera(500);
  }
}

async function percorrer(lacre: Lacre, recebedor: Awaited<ReturnType<typeof iniciarRecebedor>>): Promise<void> {
  for (const passo of lacre.passos) {
    const r = await pedir("POST", passo.rota, passo.corpo, passo.chave);
    // Quando a resposta se perdeu e o lacre tentou de novo, a API já tinha
    // gravado: ela responde 409 e o lacre dá a mensagem por entregue
    const aceito = r.status === passo.esperado || (r.tentativas > 1 && r.status === 409 && [200, 201, 202].includes(passo.esperado));
    if (!aceito && medidas.fora.length < 20) medidas.fora.push(`${lacre.device_id} ${passo.rota} ${passo.id ?? ""}: ${r.status} (esperado ${passo.esperado}) ${JSON.stringify(r.json)}`);
    if (!aceito) medidas.fora.push("");
    medidas.feitos++;
  }

  if (!lacre.comando) return;
  // O operador do sistema principal manda o comando na chegada; o lacre busca e confirma
  recebedor.comandos.push({ command_id: lacre.comando.command_id, device_id: lacre.device_id, command_type: lacre.comando.command_type, created_at: new Date().toISOString() });
  const fim = Date.now() + 120000;
  let achou = false;
  while (!achou && Date.now() < fim) {
    const lista = await pedir("GET", `/api/v1/iot/commands/${lacre.device_id}`, undefined, lacre.chave);
    achou = Array.isArray(lista.json) && lista.json.some((c: any) => c.command_id === lacre.comando!.command_id);
    if (!achou) await espera(500);
  }
  const corpo: Record<string, unknown> = { command_id: lacre.comando.command_id, device_id: lacre.device_id, status: lacre.comando.status };
  if (lacre.comando.status === "ERRO") corpo.error_message = "Válvula não respondeu";
  const c1 = await pedir("POST", "/api/v1/iot/commands/confirm", corpo, lacre.chave);
  const c2 = await pedir("POST", "/api/v1/iot/commands/confirm", corpo, lacre.chave);
  const certo = achou && (c1.status === 200 || (c1.tentativas > 1 && c1.status === 409)) && c2.status === 409;
  if (!certo) medidas.fora.push(`${lacre.device_id} comando ${lacre.comando.command_id}: achou=${achou}, confirmar ${c1.status}, confirmar de novo ${c2.status}`);
}

// --------------------------------------------------------------------- main
async function main(): Promise<number> {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "oxide-massa-"));
  const recebedor = await iniciarRecebedor();
  const ambiente = {
    PORT: String(PORTA), SUPABASE_IOT_URL: recebedor.url, SUPABASE_SERVICE_KEY: recebedor.chave,
    WORKER_INTERVAL_SECONDS: "1", WORKER_CADASTRO_INTERVAL_SECONDS: "5", WORKER_BATCH_SIZE: "200"
  };
  let api: ChildProcess | undefined;
  let worker: ChildProcess | undefined;
  const oxide = (): Database.Database => new Database(path.join(pasta, "oxide.db"), { readonly: true, timeout: 15000 });
  const ler = <T>(sql: string, ...p: unknown[]): T[] => {
    const db = oxide();
    try { return db.prepare(sql).all(...p) as T[]; } finally { db.close(); }
  };

  try {
    etapa("0. Cenário (como o do sistema principal)");
    const organizacoes = montarOrganizacoes();
    const chaves: string[] = [];
    const lacres: Lacre[] = [];
    for (let i = 0; i < LACRES; i++) {
      const lacre = montarLacre(i, organizacoes, () => chaves[Math.max(0, i - 1)] ?? "chave-de-outro");
      // O primeiro não tem vizinho: a chave "de outro" dele não existe (401 no lugar de 403)
      chaves.push(lacre.chave);
      lacres.push(lacre);
    }
    const primeiro = lacres[0]!;
    for (const passo of primeiro.passos.filter(p => p.esperado === 403)) {
      passo.esperado = 401;
      previsto.respostas.set(403, previsto.respostas.get(403)! - 1);
      previsto.respostas.set(401, (previsto.respostas.get(401) ?? 0) + 1);
    }
    const inativos = Array.from({ length: 10 }, (_, i) => ({ device_id: `DSP-MASSA-INATIVO-${i + 1}`, chave: `chave-inativa-${i + 1}-${randomBytes(6).toString("hex")}` }));
    const desconhecidos = Array.from({ length: 10 }, (_, i) => ({ device_id: `DSP-MASSA-FORA-${i + 1}`, chave: `chave-fora-${i + 1}` }));

    for (const l of lacres) recebedor.dispositivos.push({ device_id: l.device_id, api_key_hash: sha(l.chave), active: true, firmware_version: "2.0.0" });
    for (const d of inativos) recebedor.dispositivos.push({ device_id: d.device_id, api_key_hash: sha(d.chave), active: false });

    const totalPedidos = lacres.reduce((n, l) => n + l.passos.length, 0);
    const unidades = organizacoes.reduce((n, o) => n + o.unidades.length, 0);
    console.log(`   Pasta: ${pasta}`);
    console.log(`   ${organizacoes.length} organizações, ${unidades / 2} clientes, ${unidades} unidades com geocerca de 150 m, ${organizacoes.length * 8} veículos e ${organizacoes.length * 8} motoristas`);
    console.log(`   ${LACRES} cilindros, cada um com um lacre; ${PONTOS} pontos por trajeto; ${PARALELO} lacres enviando ao mesmo tempo`);
    console.log(`   ${totalPedidos} pedidos planejados; ${lacres.filter(l => l.violado).length} lacres rompidos; ${lacres.filter(l => l.comando).length} comandos`);

    etapa("1. API e Worker em processos separados; cadastro vem do banco principal");
    api = subir("src/server.ts", pasta, ambiente);
    conferir("API no ar", "responde em até 60 s", (await apiNoAr()) ? "respondeu" : "não respondeu", await apiNoAr(1000));
    worker = subir("src/worker/index.ts", pasta, ambiente);
    const prazoCadastro = Date.now() + 60000;
    let cadastrados = 0;
    while (Date.now() < prazoCadastro && cadastrados < LACRES + inativos.length) {
      await espera(500);
      cadastrados = ler<{ n: number }>("SELECT count(*) AS n FROM devices")[0]!.n;
    }
    conferir("Worker traz os dispositivos (só o hash da chave)", `${LACRES + inativos.length}`, `${cadastrados} dispositivos na Oxide`, cadastrados === LACRES + inativos.length);
    const comChave = ler<{ n: number }>("SELECT count(*) AS n FROM devices WHERE api_key NOT LIKE 'sem-chave-em-texto:%'")[0]!.n;
    conferir("Nenhuma chave em texto na Oxide", "0", `${comChave}`, comChave === 0);

    etapa("2. Envio em massa, com quedas no meio");
    const inicio = Date.now();
    const eventos: string[] = [];
    const marca = (texto: string): void => { eventos.push(`${((Date.now() - inicio) / 1000).toFixed(1)} s: ${texto}`); console.log(`   [${eventos[eventos.length - 1]}]`); };
    const quando = async (fracao: number, acao: () => Promise<void>): Promise<void> => {
      while (medidas.feitos < totalPedidos * fracao) await espera(100);
      await acao();
    };
    const quedas = Promise.all([
      quando(0.25, async () => { recebedor.foraDoAr = true; marca("banco principal fora do ar"); await espera(8000); recebedor.foraDoAr = false; marca("banco principal de volta"); }),
      quando(0.50, async () => { await derrubar(worker!); marca("Worker derrubado"); await espera(3000); worker = subir("src/worker/index.ts", pasta, ambiente); marca("Worker religado"); }),
      quando(0.75, async () => { await derrubar(api!); marca("API derrubada"); await espera(2000); api = subir("src/server.ts", pasta, ambiente); await apiNoAr(); marca("API religada"); })
    ]);

    let proximo = 0;
    const esteira = async (): Promise<void> => {
      while (proximo < lacres.length) await percorrer(lacres[proximo++]!, recebedor);
    };
    await Promise.all(Array.from({ length: Math.min(PARALELO, LACRES) }, esteira));
    await quedas;

    // Dispositivo desativado e dispositivo que o banco principal não conhece
    let barrados = 0;
    for (const d of inativos) {
      const r = await pedir("POST", "/api/v1/iot/telemetries", { message_id: `MSG-${d.device_id}`, device_id: d.device_id, latitude: -7.2, longitude: -39.3, battery_percent: 50 }, d.chave);
      if (r.status === 403) barrados++;
    }
    for (const d of desconhecidos) {
      const r = await pedir("POST", "/api/v1/iot/telemetries", { message_id: `MSG-${d.device_id}`, device_id: d.device_id, latitude: -7.2, longitude: -39.3, battery_percent: 50 }, d.chave);
      if (r.status === 401) barrados++;
    }
    const duracao = (Date.now() - inicio) / 1000;
    const erradas = medidas.fora.filter(f => f === "").length + medidas.fora.filter(f => f.includes("comando")).length;
    for (const f of medidas.fora.filter(Boolean).slice(0, 10)) console.log(`   fora do esperado: ${f}`);
    conferir("Toda resposta da API foi a esperada", "0 fora do esperado", `${totalPedidos} pedidos dos lacres; ${erradas} fora do esperado`, erradas === 0);
    conferir("Dispositivo desativado (403) e dispositivo desconhecido (401) barrados", "20", `${barrados}`, barrados === 20);
    const ordenados = [...medidas.tempos].sort((a, b) => a - b);
    const percentil = (p: number): number => ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * p))] ?? 0;
    console.log(`   Duração: ${duracao.toFixed(1)} s; ${(medidas.tempos.length / duracao).toFixed(0)} pedidos por segundo`);
    console.log(`   Tempo de resposta: metade até ${percentil(0.5)} ms; 95% até ${percentil(0.95)} ms; 99% até ${percentil(0.99)} ms; a mais lenta ${ordenados[ordenados.length - 1]} ms`);
    console.log(`   Sem conexão (API derrubada): ${medidas.semConexao}; novas tentativas do lacre: ${medidas.novasTentativas}`);
    conferir("Nenhum erro 500 da API", "0", `${medidas.erros5xx}`, medidas.erros5xx === 0);

    etapa("3. Fila esvaziada pelo Worker");
    const prazoFila = Date.now() + 180000;
    let fila: Array<{ status: string; n: number }> = [];
    do {
      await espera(1000);
      fila = ler("SELECT status, count(*) AS n FROM mensagens GROUP BY status");
    } while (Date.now() < prazoFila && fila.some(f => f.status !== "SYNCED"));
    const situacao = fila.map(f => `${f.status}=${f.n}`).join(", ");
    conferir("Tudo enviado ao banco principal", "só SYNCED", situacao, fila.length === 1 && fila[0]!.status === "SYNCED");
    const tentativas = ler<{ n: number }>("SELECT COALESCE(max(attempt_count), 0) AS n FROM mensagens")[0]!.n;
    conferir("Queda do banco principal não gastou tentativa", "0", `maior número de tentativas = ${tentativas}`, tentativas === 0);

    etapa("4. O que ficou na Oxide");
    const porTipo = new Map(ler<{ tipo: string; n: number }>("SELECT tipo, count(*) AS n FROM mensagens GROUP BY tipo").map(l => [l.tipo, l.n]));
    const auto = new Map(ler<{ t: string; n: number }>("SELECT json_extract(payload_json, '$.alert_type') AS t, count(*) AS n FROM mensagens WHERE message_id LIKE 'AUT-%' GROUP BY t").map(l => [l.t, l.n]));
    const totalAuto = Object.values(previsto.automaticos).reduce((a, b) => a + b, 0);
    conferir("Leituras gravadas", `${previsto.linhas.TELEMETRIA}`, `${porTipo.get("TELEMETRIA") ?? 0}`, porTipo.get("TELEMETRIA") === previsto.linhas.TELEMETRIA);
    conferir("Eventos gravados", `${previsto.linhas.EVENTO}`, `${porTipo.get("EVENTO") ?? 0}`, porTipo.get("EVENTO") === previsto.linhas.EVENTO);
    conferir("Alertas gravados (do lacre + automáticos)", `${previsto.linhas.ALERTA_DO_LACRE} + ${totalAuto}`, `${porTipo.get("ALERTA") ?? 0}`, porTipo.get("ALERTA") === previsto.linhas.ALERTA_DO_LACRE + totalAuto);
    conferir("Confirmações de comando gravadas", `${previsto.linhas.CONFIRMACAO_COMANDO}`, `${porTipo.get("CONFIRMACAO_COMANDO") ?? 0}`, (porTipo.get("CONFIRMACAO_COMANDO") ?? 0) === previsto.linhas.CONFIRMACAO_COMANDO);
    for (const [tipo, n] of Object.entries(previsto.automaticos)) {
      conferir(`Alerta automático ${tipo}`, `${n}`, `${auto.get(tipo) ?? 0}`, (auto.get(tipo) ?? 0) === n);
    }
    const db = oxide();
    const integro = db.pragma("integrity_check", { simple: true }) === "ok" && (db.pragma("foreign_key_check") as unknown[]).length === 0;
    db.close();
    const tamanho = fs.statSync(path.join(pasta, "oxide.db")).size / 1048576;
    conferir("Oxide íntegra depois da carga e das quedas", "ok", `${integro ? "ok" : "com erro"}; arquivo com ${tamanho.toFixed(1)} MB`, integro);

    etapa("5. O que chegou ao banco principal (recebedor de teste)");
    const linhas = ler<{ message_id: string }>("SELECT message_id FROM mensagens");
    const faltando = linhas.filter(l => !recebedor.mensagens.has(l.message_id)).length;
    conferir("Nada perdido e nada a mais", `${linhas.length} dos dois lados`, `Oxide ${linhas.length}; banco principal ${recebedor.mensagens.size}; ${faltando} faltando`, faltando === 0 && recebedor.mensagens.size === linhas.length);
    const esperadas = lacres.flatMap(l => l.passos.filter(p => p.id && [201, 202].includes(p.esperado)).map(p => p.id!));
    const naoChegaram = esperadas.filter(m => !recebedor.mensagens.has(m)).length;
    conferir("Toda mensagem aceita de cada lacre chegou", `${esperadas.length}`, `${esperadas.length - naoChegaram}`, naoChegaram === 0);
    const semData = lacres.filter(l => typeof recebedor.mensagens.get(l.chegada)?.last_seen_at !== "string").length;
    conferir("Posição repetida: a leitura da chegada foi reenviada com a data e a hora novas", `${LACRES} lacres`, `${LACRES - semData}`, semData === 0);
    const semCampos = [...recebedor.mensagens.values()].filter(m => m.type !== "CONFIRMACAO_COMANDO" &&
      (typeof m.latitude !== "number" || typeof m.longitude !== "number" || typeof m.battery_percent !== "number" || typeof m.gps_ok !== "boolean")).length;
    conferir("Toda mensagem tem posição, bateria e gps_ok", "0 sem", `${semCampos} sem`, semCampos === 0);
    const confirmados = lacres.filter(l => l.comando && recebedor.comandos.find(c => c.command_id === l.comando!.command_id)?.confirmado === l.comando.status).length;
    conferir("Comandos confirmados no banco principal", `${previsto.linhas.CONFIRMACAO_COMANDO}`, `${confirmados}`, confirmados === previsto.linhas.CONFIRMACAO_COMANDO);

    // Com o que chegou, o sistema principal consegue aplicar as regras dele
    const doDispositivo = new Map<string, Array<Record<string, unknown>>>();
    for (const m of recebedor.mensagens.values()) {
      const lista = doDispositivo.get(String(m.device_id)) ?? [];
      lista.push(m);
      doDispositivo.set(String(m.device_id), lista);
    }
    let entregas = 0;
    let rompidos = 0;
    for (const l of lacres) {
      const mensagens = doDispositivo.get(l.device_id) ?? [];
      if (mensagens.some(m => m.type === "TELEMETRIA" && m.gps_ok === true && distanciaM(m as any, l.destino) <= l.destino.raio_m)) entregas++;
      if (mensagens.some(m => m.type === "ALERTA" && m.alert_type === "LACRE_VIOLADO")) rompidos++;
    }
    conferir("Geocerca: chegada à unidade do cliente identificada pelos dados", `${LACRES} cilindros`, `${entregas}`, entregas === LACRES);
    conferir("Cilindros com lacre rompido identificados", `${lacres.filter(l => l.violado).length}`, `${rompidos}`, rompidos === lacres.filter(l => l.violado).length);
    for (const o of organizacoes) {
      const dela = lacres.filter(l => l.organizacao === o);
      const total = dela.reduce((n, l) => n + (doDispositivo.get(l.device_id)?.length ?? 0), 0);
      console.log(`   ${o.nome}: ${dela.length} cilindros, ${total} mensagens`);
    }

    fs.writeFileSync(path.join(pasta, "massa-resultado.json"), JSON.stringify({
      lacres: LACRES, pontos: PONTOS, paralelo: PARALELO, totalPedidos, duracao, porSegundo: medidas.tempos.length / duracao,
      tempos: { p50: percentil(0.5), p95: percentil(0.95), p99: percentil(0.99), max: ordenados[ordenados.length - 1] },
      semConexao: medidas.semConexao, novasTentativas: medidas.novasTentativas, erros5xx: medidas.erros5xx, eventos,
      respostasPrevistas: Object.fromEntries(previsto.respostas), linhas: Object.fromEntries(porTipo), automaticos: Object.fromEntries(auto),
      previsto: { linhas: previsto.linhas, automaticos: previsto.automaticos }, noBancoPrincipal: recebedor.mensagens.size, tamanhoMB: tamanho,
      chamadasDoWorker: recebedor.chamadas.length, conforme, falhas
    }, null, 2));
  } catch (erro) {
    conferir("Execução do teste em massa", "sem exceção", (erro as Error).stack ?? String(erro), false);
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
  console.error("Teste em massa interrompido:", erro);
  process.exitCode = 1;
});
