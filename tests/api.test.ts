// Suíte da API do lacre (npm test).
// Roda numa pasta temporária, com uma oxide.db nova e um recebedor de teste no
// lugar do Supabase: o oxide.db do projeto e o banco principal não são tocados.

import { execFileSync } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { iniciarRecebedor } from "../src/simulador/recebedor";

const PROJETO = path.resolve(__dirname, "..");
const PORTA = Number(process.env.TEST_PORT ?? 3197);
const BASE = `http://127.0.0.1:${PORTA}`;
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "oxide-teste-"));
process.chdir(pasta);
process.env.PORT = String(PORTA);

const resultados: Array<{ nome: string; passou: boolean }> = [];

async function teste(nome: string, corpo: () => Promise<{ passou: boolean; detalhe?: string | undefined }> | { passou: boolean; detalhe?: string | undefined }): Promise<void> {
  let passou = false;
  let detalhe = "";
  try {
    const r = await corpo();
    passou = r.passou;
    detalhe = r.detalhe ?? "";
  } catch (erro) {
    detalhe = `erro: ${erro instanceof Error ? erro.message : String(erro)}`;
  }
  resultados.push({ nome, passou });
  console.log(`${passou ? "✅" : "❌"} ${nome}${detalhe ? ` (${detalhe})` : ""}`);
}

const sha = (texto: string): string => createHash("sha256").update(texto).digest("hex");

// Roda um script do projeto noutra pasta (migração e manutenção)
function rodar(script: string, cwd: string, args: string[] = [], env: Record<string, string> = {}): string {
  return execFileSync(process.execPath, ["--require", path.join(PROJETO, "node_modules", "ts-node", "register"), path.join(PROJETO, script), ...args], {
    cwd, encoding: "utf8", env: { ...process.env, TS_NODE_PROJECT: path.join(PROJETO, "tsconfig.json"), ...env }
  });
}

async function main(): Promise<void> {
  const recebedor = await iniciarRecebedor();
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { server } = require("../src/server") as typeof import("../src/server");
  const db = (require("../src/database/connection") as typeof import("../src/database/connection")).default;
  const { runCycle } = require("../src/worker/runner") as typeof import("../src/worker/runner");
  const { loadWorkerConfig } = require("../src/worker/config") as typeof import("../src/worker/config");
  const openApiSpec = (require("../src/docs/openapi") as typeof import("../src/docs/openapi")).default as any;
  /* eslint-enable @typescript-eslint/no-require-imports */

  const api = async (metodo: string, rota: string, corpo?: unknown, chave?: string, cabecalho = "X-API-Key") => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (chave) headers[cabecalho] = chave;
    const init: RequestInit = { method: metodo, headers };
    if (corpo !== undefined) init.body = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
    const res = await fetch(`${BASE}${rota}`, init);
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const umaLinha = <T>(sql: string, ...p: unknown[]): T => db.prepare(sql).get(...p) as T;
  const total = (onde = "1=1", ...p: unknown[]): number => umaLinha<{ n: number }>(`SELECT count(*) AS n FROM mensagens WHERE ${onde}`, ...p).n;
  const dados = (id: string): any => JSON.parse(umaLinha<{ payload_json: string }>("SELECT payload_json FROM mensagens WHERE message_id = ?", id).payload_json);
  const alertas = (device: string, tipo: string): number =>
    total("device_id = ? AND tipo = 'ALERTA' AND json_extract(payload_json, '$.alert_type') = ?", device, tipo);

  const DEV = "DSP-TEST-1";
  const KEY = "key-test-1";
  const OUTRO = "DSP-TEST-2";
  const OUTRA_KEY = "key-test-2";
  const POS = { latitude: -7.21, longitude: -39.31, battery_percent: 80 };
  const tel = (id: string, extra: Record<string, unknown> = {}, device = DEV, key = KEY) =>
    api("POST", "/api/v1/iot/telemetries", { message_id: id, device_id: device, ...POS, ...extra }, key);

  console.log(`\nSuíte da API do lacre — pasta ${pasta}\n`);

  // ------------------------------------------------------------- [1] geral
  console.log("--- [1] Geral, documentação e banco ---");
  await teste("GET / -> 200", async () => {
    const res = await fetch(`${BASE}/`);
    return { passou: res.status === 200 && (await res.text()).includes("API ESP32 Online") };
  });
  await teste("GET /api-docs/ -> 200 (Swagger)", async () => {
    const res = await fetch(`${BASE}/api-docs/`);
    return { passou: res.status === 200 };
  });
  await teste("Swagger: toda rota tem um grupo declarado", () => {
    const declarados = new Set(openApiSpec.tags.map((t: any) => t.name));
    const semGrupo: string[] = [];
    for (const [rota, ops] of Object.entries<any>(openApiSpec.paths)) {
      for (const [metodo, op] of Object.entries<any>(ops)) {
        if (!op.tags?.length || !op.tags.every((t: string) => declarados.has(t))) semGrupo.push(`${metodo} ${rota}`);
      }
    }
    return { passou: semGrupo.length === 0, detalhe: `${declarados.size} grupos` };
  });
  await teste("Banco novo tem só 3 tabelas: commands, devices e mensagens", () => {
    const tabelas = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[]).map(t => t.name).join(",");
    return { passou: tabelas === "commands,devices,mensagens", detalhe: tabelas };
  });
  await teste("Rota antiga removida (/api/v1/seals) -> 404", async () => {
    const r = await api("GET", "/api/v1/seals");
    return { passou: r.status === 404, detalhe: String(r.status) };
  });

  // ------------------------------------------------------- [2] dispositivos
  console.log("\n--- [2] Dispositivos ---");
  await teste("POST /devices sem campos obrigatórios -> 400", async () => {
    const r = await api("POST", "/api/v1/devices", {});
    return { passou: r.status === 400, detalhe: r.json?.message };
  });
  await teste("POST /devices -> 201 (dois dispositivos de teste e um inativo)", async () => {
    const a = await api("POST", "/api/v1/devices", { device_id: DEV, api_key: KEY, firmware_version: "1.0.0" });
    const b = await api("POST", "/api/v1/devices", { device_id: OUTRO, api_key: OUTRA_KEY });
    const c = await api("POST", "/api/v1/devices", { device_id: "DSP-TEST-OFF", api_key: "key-test-off", active: 0 });
    return { passou: a.status === 201 && b.status === 201 && c.status === 201 };
  });
  await teste("POST /devices com device_id repetido -> 409; com api_key repetida -> 409", async () => {
    const a = await api("POST", "/api/v1/devices", { device_id: DEV, api_key: "outra" });
    const b = await api("POST", "/api/v1/devices", { device_id: "DSP-TEST-9", api_key: KEY });
    return { passou: a.status === 409 && b.status === 409, detalhe: `${a.json?.message} / ${b.json?.message}` };
  });
  await teste("POST /devices com active inválido e firmware_version numérico -> 400", async () => {
    const a = await api("POST", "/api/v1/devices", { device_id: "DSP-TEST-8", api_key: "k8", active: 5 });
    const b = await api("POST", "/api/v1/devices", { device_id: "DSP-TEST-8", api_key: "k8", firmware_version: 10 });
    return { passou: a.status === 400 && b.status === 400 };
  });
  await teste("GET /devices e /devices/:id não mostram api_key nem api_key_hash; inexistente -> 404", async () => {
    const l = await api("GET", "/api/v1/devices");
    const g = await api("GET", `/api/v1/devices/${DEV}`);
    const n = await api("GET", "/api/v1/devices/NAO-EXISTE");
    const limpo = (d: any) => !("api_key" in d) && !("api_key_hash" in d);
    return { passou: l.status === 200 && l.json.every(limpo) && limpo(g.json) && g.json.device_id === DEV && n.status === 404 };
  });

  // ------------------------------------------------------- [3] autenticação
  console.log("\n--- [3] Autenticação ---");
  await teste("Sem X-API-Key -> 401; chave inválida -> 401", async () => {
    const a = await api("POST", "/api/v1/iot/telemetries", { message_id: "M-A1", device_id: DEV, ...POS });
    const b = await tel("M-A2", {}, DEV, "chave-inexistente");
    return { passou: a.status === 401 && b.status === 401 && total("message_id IN ('M-A1','M-A2')") === 0, detalhe: `${a.json?.message} / ${b.json?.message}` };
  });
  await teste("Dispositivo inativo -> 403", async () => {
    const r = await tel("M-A3", {}, "DSP-TEST-OFF", "key-test-off");
    return { passou: r.status === 403, detalhe: r.json?.message };
  });
  await teste("Chave de outro dispositivo -> 403, nada gravado", async () => {
    const r = await tel("M-A4", {}, DEV, OUTRA_KEY);
    return { passou: r.status === 403 && total("message_id = 'M-A4'") === 0, detalhe: r.json?.message };
  });
  await teste("Dispositivo não cadastrado -> 404, sem criação automática", async () => {
    const r = await tel("M-A5", {}, "DSP-FANTASMA", KEY);
    return { passou: r.status === 404 && !umaLinha("SELECT 1 FROM devices WHERE device_id = 'DSP-FANTASMA'"), detalhe: r.json?.message };
  });
  await teste("Cabeçalho em minúsculas (x-api-key) é aceito", async () => {
    const r = await api("POST", "/api/v1/iot/telemetries", { message_id: "M-A6", device_id: OUTRO, ...POS }, OUTRA_KEY, "x-api-key");
    return { passou: r.status === 202 };
  });

  // --------------------------------------------------------- [4] telemetria
  console.log("\n--- [4] Telemetria ---");
  await teste("Leitura válida -> 202, na fila como PENDING, com posição, bateria e gps_ok = true", async () => {
    const r = await tel("M-T1", { seal_status: "LOCKED", speed_kmh: 30, gsm_signal: -70, satelites: 9, hdop: 0.9, attempt_count: 3 });
    const linha = umaLinha<any>("SELECT tipo, status, attempt_count FROM mensagens WHERE message_id = 'M-T1'");
    const d = dados("M-T1");
    return {
      passou: r.status === 202 && linha.tipo === "TELEMETRIA" && linha.status === "PENDING" && linha.attempt_count === 0 &&
        d.latitude === -7.21 && d.battery_percent === 80 && d.gps_ok === true && d.satellites === 9 && d.device_attempt_count === 3 && d.origin === "lacre",
      detalhe: `satelites aceito como satellites; attempt_count do lacre em device_attempt_count`
    };
  });
  await teste("Sem message_id ou sem device_id -> 400", async () => {
    const a = await api("POST", "/api/v1/iot/telemetries", { device_id: DEV, ...POS }, KEY);
    return { passou: a.status === 400, detalhe: a.json?.message };
  });
  await teste("Sem latitude e longitude -> 400; só latitude -> 400", async () => {
    const a = await api("POST", "/api/v1/iot/telemetries", { message_id: "M-T2", device_id: DEV, battery_percent: 80 }, KEY);
    const b = await api("POST", "/api/v1/iot/telemetries", { message_id: "M-T3", device_id: DEV, latitude: -7.2, battery_percent: 80 }, KEY);
    return { passou: a.status === 400 && b.status === 400 && total("message_id IN ('M-T2','M-T3')") === 0, detalhe: a.json?.message };
  });
  await teste("Sem battery_percent -> 400", async () => {
    const r = await api("POST", "/api/v1/iot/telemetries", { message_id: "M-T4", device_id: DEV, latitude: -7.2, longitude: -39.3 }, KEY);
    return { passou: r.status === 400 && total("message_id = 'M-T4'") === 0, detalhe: r.json?.message };
  });
  await teste("Latitude como texto -> 400; fora da faixa -> 400; bateria 150 -> 400", async () => {
    const a = await tel("M-T5", { latitude: "-7.2" });
    const b = await tel("M-T6", { latitude: 95 });
    const c = await tel("M-T7", { battery_percent: 150 });
    return { passou: a.status === 400 && b.status === 400 && c.status === 400, detalhe: `${a.json?.message} | ${b.json?.message} | ${c.json?.message}` };
  });
  await teste("gps_ok que não é true/false, seal_status inválido e attempt_count negativo -> 400", async () => {
    const a = await tel("M-T8", { gps_ok: "nao" });
    const b = await tel("M-T9", { seal_status: "ABERTO" });
    const c = await tel("M-T10", { attempt_count: -1 });
    return { passou: a.status === 400 && b.status === 400 && c.status === 400 };
  });
  await teste("JSON malformado -> 400; corpo vazio -> 400", async () => {
    const a = await api("POST", "/api/v1/iot/telemetries", "{ isto não é json", KEY);
    const b = await api("POST", "/api/v1/iot/telemetries", {}, KEY);
    return { passou: a.status === 400 && b.status === 400, detalhe: `${a.status}/${b.status}` };
  });
  await teste("message_id repetido -> 409, sem linha nova", async () => {
    const r = await tel("M-T1", { latitude: -7.5 });
    return { passou: r.status === 409 && total("message_id = 'M-T1'") === 1, detalhe: r.json?.message };
  });
  await teste("Mesma posição e mesmo lacre -> 200, sem linha nova; data, bateria e sinal atualizados na leitura anterior", async () => {
    const antes = total("device_id = ? AND tipo = 'TELEMETRIA'", DEV);
    const r = await tel("M-T11", { seal_status: "LOCKED", battery_percent: 77, gsm_signal: -80 });
    const d = dados("M-T1");
    return {
      passou: r.status === 200 && total("device_id = ? AND tipo = 'TELEMETRIA'", DEV) === antes && d.battery_percent === 77 && d.gsm_signal === -80 && Boolean(d.last_seen_at),
      detalhe: r.json?.message
    };
  });
  await teste("Reenvio do message_id da posição repetida -> 409", async () => {
    const r = await tel("M-T11", { seal_status: "LOCKED" });
    return { passou: r.status === 409 };
  });
  await teste("Posição nova -> 202 e nova linha", async () => {
    const r = await tel("M-T12", { latitude: -7.22, seal_status: "LOCKED" });
    return { passou: r.status === 202 && total("message_id = 'M-T12'") === 1 };
  });
  await teste("GPS sem sinal: mesma posição com gps_ok = false -> 202 e nova linha com gps_ok false", async () => {
    const r = await tel("M-T13", { latitude: -7.22, seal_status: "LOCKED", gps_ok: false });
    return { passou: r.status === 202 && dados("M-T13").gps_ok === false, detalhe: "última posição conhecida" };
  });
  await teste("status e attempt_count enviados pelo lacre não mudam a fila", async () => {
    const r = await tel("M-T14", { latitude: -7.23, status: "SYNCED", attempt_count: 9 });
    const linha = umaLinha<any>("SELECT status, attempt_count FROM mensagens WHERE message_id = 'M-T14'");
    return { passou: r.status === 202 && linha.status === "PENDING" && linha.attempt_count === 0 };
  });
  await teste("GET /iot/messages lista as últimas mensagens, com filtro por tipo e dispositivo; tipo inválido -> 400", async () => {
    const l = await api("GET", `/api/v1/iot/messages?type=telemetria&device_id=${DEV}&limit=3`);
    const ruim = await api("GET", "/api/v1/iot/messages?type=xyz");
    return { passou: l.status === 200 && l.json.length === 3 && l.json[0].message_id === "M-T14" && l.json.every((m: any) => m.type === "TELEMETRIA" && m.device_id === DEV) && ruim.status === 400 };
  });

  // ------------------------------------------------------------ [5] eventos
  console.log("\n--- [5] Eventos ---");
  const evento = (id: string, extra: Record<string, unknown> = {}, key = KEY) =>
    api("POST", "/api/v1/iot/events", { message_id: id, device_id: DEV, event_type: "startup", latitude: -7.23, longitude: -39.31, battery_percent: 80, ...extra }, key);
  await teste("Evento sem event_type -> 400; sem posição e bateria -> 400", async () => {
    const a = await api("POST", "/api/v1/iot/events", { message_id: "E-1", device_id: DEV, ...POS }, KEY);
    const b = await api("POST", "/api/v1/iot/events", { message_id: "E-2", device_id: DEV, event_type: "startup" }, KEY);
    return { passou: a.status === 400 && b.status === 400 && total("message_id IN ('E-1','E-2')") === 0, detalhe: `${a.json?.message} | ${b.json?.message}` };
  });
  await teste("Evento válido -> 202, gravado como EVENTO com o event_type", async () => {
    const r = await evento("E-3");
    return { passou: r.status === 202 && dados("E-3").event_type === "startup" && umaLinha<any>("SELECT tipo FROM mensagens WHERE message_id = 'E-3'").tipo === "EVENTO" };
  });
  await teste("Evento repetido -> 409; com chave de outro dispositivo -> 403; sem chave -> 401", async () => {
    const a = await evento("E-3");
    const b = await evento("E-4", {}, OUTRA_KEY);
    const c = await api("POST", "/api/v1/iot/events", { message_id: "E-5", device_id: DEV, event_type: "x", ...POS });
    return { passou: a.status === 409 && b.status === 403 && c.status === 401 };
  });
  await teste("Evento com a mesma posição da telemetria não é tratado como posição repetida", async () => {
    const r = await evento("E-6");
    return { passou: r.status === 202 && total("message_id = 'E-6'") === 1 };
  });

  // ------------------------------------------------------------ [6] alertas
  console.log("\n--- [6] Alertas enviados pelo lacre ---");
  const alerta = (id: string, extra: Record<string, unknown> = {}) =>
    api("POST", "/api/v1/iot/alerts", { alert_id: id, device_id: DEV, alert_type: "GPS_INATIVO", title: "GPS não responde", latitude: -7.23, longitude: -39.31, battery_percent: 80, ...extra }, KEY);
  await teste("Tipo fora do catálogo -> 400; severidade inválida -> 400; sem título -> 400", async () => {
    const a = await alerta("A-1", { alert_type: "LIGAR_SIRENE" });
    const b = await alerta("A-2", { severity: "URGENTE" });
    const c = await alerta("A-3", { title: "" });
    const d = await alerta("A-4", { alert_type: "toString" });
    return { passou: [a, b, c, d].every(r => r.status === 400) };
  });
  await teste("Alerta sem posição e bateria -> 400", async () => {
    const r = await api("POST", "/api/v1/iot/alerts", { alert_id: "A-5", device_id: DEV, alert_type: "GPS_INATIVO", title: "x" }, KEY);
    return { passou: r.status === 400, detalhe: r.json?.message };
  });
  await teste("Alerta válido -> 201, com a severidade do catálogo", async () => {
    const r = await alerta("A-6");
    const d = dados("A-6");
    return { passou: r.status === 201 && r.json.alert.severity === "ALTA" && d.alert_type === "GPS_INATIVO" && d.origin === "lacre" && d.latitude === -7.23, detalhe: `severity ${r.json?.alert?.severity}` };
  });
  await teste("Severidade informada é respeitada; nome antigo em inglês é convertido", async () => {
    const a = await alerta("A-7", { severity: "BAIXA" });
    const b = await alerta("A-8", { alert_type: "DEVICE_ERROR" });
    return { passou: a.json?.alert?.severity === "BAIXA" && b.status === 201 && dados("A-8").alert_type === "DISPOSITIVO_FALHA", detalhe: dados("A-8").alert_type };
  });
  await teste("alert_id repetido -> 409", async () => {
    const r = await alerta("A-6");
    return { passou: r.status === 409, detalhe: r.json?.message };
  });

  // ------------------------------------------------ [7] alertas automáticos
  console.log("\n--- [7] Alertas automáticos (saem da própria mensagem) ---");
  const R = "DSP-TEST-R";
  const RK = "key-test-r";
  await api("POST", "/api/v1/devices", { device_id: R, api_key: RK });
  let passo = 0;
  const leitura = (extra: Record<string, unknown>) =>
    api("POST", "/api/v1/iot/telemetries", { message_id: `M-R${++passo}`, device_id: R, latitude: -7.3 - passo / 1000, longitude: -39.4, battery_percent: 90, seal_status: "LOCKED", ...extra }, RK);

  await teste("Primeira leitura normal não abre alerta", async () => {
    await leitura({});
    return { passou: total("device_id = ? AND tipo = 'ALERTA'", R) === 0 };
  });
  await teste("Bateria abaixo de 15% abre BATERIA_BAIXA (origem servidor, com posição e a mensagem de origem)", async () => {
    await leitura({ battery_percent: 10 });
    const linha = umaLinha<any>("SELECT message_id, payload_json FROM mensagens WHERE device_id = ? AND tipo = 'ALERTA'", R);
    const d = JSON.parse(linha.payload_json);
    return {
      passou: alertas(R, "BATERIA_BAIXA") === 1 && /^AUT-/.test(linha.message_id) && d.origin === "servidor" && d.severity === "BAIXA" &&
        d.source_message_id === "M-R2" && typeof d.latitude === "number" && d.battery_percent === 10,
      detalhe: linha.message_id
    };
  });
  await teste("Bateria continua baixa: não repete; recupera e cai de novo: novo alerta", async () => {
    await leitura({ battery_percent: 9 });
    const semRepetir = alertas(R, "BATERIA_BAIXA") === 1;
    await leitura({ battery_percent: 60 });
    await leitura({ battery_percent: 12 });
    return { passou: semRepetir && alertas(R, "BATERIA_BAIXA") === 2, detalhe: `${alertas(R, "BATERIA_BAIXA")} alertas` };
  });
  await teste("Sinal abaixo de -105 dBm abre GSM_SINAL_FRACO uma vez", async () => {
    await leitura({ battery_percent: 60, gsm_signal: -110 });
    await leitura({ battery_percent: 60, gsm_signal: -112 });
    return { passou: alertas(R, "GSM_SINAL_FRACO") === 1 };
  });
  await teste("Lacre UNLOCKED abre LACRE_ABERTO_SEM_AUTORIZACAO; BROKEN abre LACRE_VIOLADO (CRITICA)", async () => {
    await leitura({ battery_percent: 60, seal_status: "UNLOCKED" });
    await leitura({ battery_percent: 60, seal_status: "BROKEN" });
    const sev = JSON.parse(umaLinha<any>("SELECT payload_json FROM mensagens WHERE device_id = ? AND json_extract(payload_json, '$.alert_type') = 'LACRE_VIOLADO'", R).payload_json).severity;
    return { passou: alertas(R, "LACRE_ABERTO_SEM_AUTORIZACAO") === 1 && alertas(R, "LACRE_VIOLADO") === 1 && sev === "CRITICA" };
  });
  await teste("Lacre continua rompido: não repete; fecha (LOCKED) não alerta", async () => {
    await leitura({ battery_percent: 60, seal_status: "BROKEN" });
    await leitura({ battery_percent: 60, seal_status: "LOCKED" });
    return { passou: alertas(R, "LACRE_VIOLADO") === 1 && alertas(R, "LACRE_ABERTO_SEM_AUTORIZACAO") === 1 };
  });
  await teste("Evento com lacre rompido também abre o alerta", async () => {
    await api("POST", "/api/v1/iot/events", { message_id: "E-R1", device_id: R, event_type: "seal_changed", seal_status: "BROKEN", latitude: -7.4, longitude: -39.4, battery_percent: 60 }, RK);
    return { passou: alertas(R, "LACRE_VIOLADO") === 2 };
  });
  await teste("Dispositivo guarda o último estado recebido (contato, posição, bateria e lacre)", async () => {
    const d = (await api("GET", `/api/v1/devices/${R}`)).json;
    return { passou: Boolean(d.last_contact_at) && d.last_latitude === -7.4 && d.last_battery_percent === 60 && d.last_seal_status === "BROKEN" };
  });

  // ----------------------------------------------------- [8] Worker e fila
  console.log("\n--- [8] Worker: envio ao banco principal ---");
  await teste("Sem SUPABASE_IOT_URL e SUPABASE_SERVICE_KEY o Worker não sobe", () => {
    delete process.env.SUPABASE_IOT_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    try {
      loadWorkerConfig();
      return { passou: false };
    } catch (erro) {
      return { passou: /SUPABASE_IOT_URL/.test((erro as Error).message), detalhe: (erro as Error).message };
    }
  });
  process.env.SUPABASE_IOT_URL = recebedor.url;
  process.env.SUPABASE_SERVICE_KEY = recebedor.chave;
  const config = loadWorkerConfig();
  const worker = (cadastro = false) => runCycle(config, { withCadastro: cadastro });

  await teste("Banco principal fora do ar: rodada FALHOU, fila intacta, nenhuma tentativa gasta", async () => {
    const pendentes = total("status = 'PENDING'");
    recebedor.foraDoAr = true;
    const r = await worker();
    recebedor.foraDoAr = false;
    return { passou: r.status === "FALHOU" && total("status = 'PENDING'") === pendentes && total("attempt_count > 0") === 0 && total("status = 'PROCESSING'") === 0, detalhe: r.erro };
  });
  await teste("Chave recusada pelo banco principal (401): rodada FALHOU, nenhuma tentativa gasta", async () => {
    const r = await runCycle({ ...config, destinoKey: "chave-errada" }, { withCadastro: false });
    return { passou: r.status === "FALHOU" && total("attempt_count > 0") === 0, detalhe: r.erro };
  });
  await teste("Envio: mensagens aceitas ficam SYNCED; a recusada para com o motivo; a sem resposta ganha nova tentativa", async () => {
    recebedor.recusar = m => (m.message_id === "E-3" ? "dispositivo sem lacre no cadastro" : null);
    recebedor.semResposta.add("A-6");
    const antes = total("status = 'PENDING'");
    const r = await worker();
    recebedor.recusar = () => null;
    const recusada = umaLinha<any>("SELECT status, next_attempt_at, last_error, attempt_count FROM mensagens WHERE message_id = 'E-3'");
    const muda = umaLinha<any>("SELECT status, next_attempt_at, attempt_count FROM mensagens WHERE message_id = 'A-6'");
    return {
      passou: r.status === "PARCIAL" && r.enviadas === antes - 2 && r.paradas === 1 && r.com_erro === 1 &&
        recusada.status === "ERROR" && recusada.next_attempt_at === null && recusada.last_error === "dispositivo sem lacre no cadastro" &&
        muda.status === "ERROR" && muda.next_attempt_at !== null && muda.attempt_count === 1 &&
        recebedor.mensagens.size === antes - 2 && total("status = 'SYNCED'") === antes - 2,
      detalhe: `${r.enviadas} enviadas, 1 parada, 1 com nova tentativa`
    };
  });
  await teste("O que chegou ao banco principal é a mensagem validada (tipo, origem, posição, bateria)", () => {
    const m = recebedor.mensagens.get("M-T12") as any;
    return { passou: m?.type === "TELEMETRIA" && m.origin === "lacre" && m.device_id === DEV && m.latitude === -7.22 && m.battery_percent === 80 && Boolean(m.received_at) };
  });
  await teste("GET /sync/problems mostra as duas com erro e a situação de cada uma", async () => {
    const r = await api("GET", "/api/v1/sync/problems");
    const porId = Object.fromEntries(r.json.itens.map((i: any) => [i.message_id, i.situacao]));
    return { passou: r.json.itens.length === 2 && /parada/.test(porId["E-3"]) && /nova tentativa/.test(porId["A-6"]), detalhe: JSON.stringify(porId) };
  });
  await teste("Depois da 6ª falha a mensagem para (sem próxima tentativa)", async () => {
    db.prepare("UPDATE mensagens SET attempt_count = 5, next_attempt_at = datetime('now', '-1 minute') WHERE message_id = 'A-6'").run();
    await worker();
    const l = umaLinha<any>("SELECT status, next_attempt_at, attempt_count FROM mensagens WHERE message_id = 'A-6'");
    recebedor.semResposta.clear();
    return { passou: l.status === "ERROR" && l.next_attempt_at === null && l.attempt_count === 6, detalhe: `${l.attempt_count} tentativas` };
  });
  await teste("POST /sync/retry: sem message_id -> 400; inexistente -> 404; com erro -> 200 e a mensagem chega", async () => {
    const a = await api("POST", "/api/v1/sync/retry", {});
    const b = await api("POST", "/api/v1/sync/retry", { message_id: "NAO-EXISTE" });
    const c = await api("POST", "/api/v1/sync/retry", { message_id: "A-6" });
    const d = await api("POST", "/api/v1/sync/retry", { message_id: "E-3" });
    await worker();
    return { passou: a.status === 400 && b.status === 404 && c.status === 200 && d.status === 200 && total("status = 'ERROR'") === 0 && recebedor.mensagens.has("A-6") && recebedor.mensagens.has("E-3") };
  });
  await teste("Reenviar tudo de novo não duplica no banco principal", async () => {
    const noDestino = recebedor.mensagens.size;
    db.prepare("UPDATE mensagens SET status = 'PENDING' WHERE status = 'SYNCED'").run();
    const r = await worker();
    return { passou: r.status === "OK" && recebedor.mensagens.size === noDestino && total("status <> 'SYNCED'") === 0, detalhe: `${r.enviadas} reenviadas, ${noDestino} no destino` };
  });
  await teste("Posição repetida depois do envio devolve a leitura à fila e o banco principal recebe a nova data", async () => {
    const r = await tel("M-T15", { latitude: -7.23 });
    const voltou = umaLinha<any>("SELECT status FROM mensagens WHERE message_id = 'M-T14'").status;
    await worker();
    return { passou: r.status === 200 && voltou === "PENDING" && Boolean((recebedor.mensagens.get("M-T14") as any).last_seen_at) };
  });
  await teste("Lote: mais mensagens que o tamanho do lote são enviadas em várias chamadas", async () => {
    for (let i = 0; i < 5; i++) await tel(`M-L${i}`, { latitude: -7.5 - i / 100 });
    recebedor.chamadas.length = 0;
    const r = await runCycle({ ...config, batchSize: 2 }, { withCadastro: false });
    return { passou: r.enviadas === 5 && recebedor.chamadas.filter(c => c === "push_messages").length === 3, detalhe: "5 mensagens em 3 lotes de até 2" };
  });
  await teste("GET /sync/status traz a fila e a última rodada", async () => {
    const r = await api("GET", "/api/v1/sync/status");
    return { passou: r.status === 200 && r.json.fila.pendentes === 0 && r.json.fila.sincronizadas > 20 && r.json.ultima_rodada?.resultado?.status === "OK" };
  });

  // --------------------------------------- [9] cadastro e comandos do principal
  console.log("\n--- [9] Cadastro e comandos vindos do banco principal ---");
  const H = "DSP-TEST-H";
  const HK = "key-test-hash";
  await teste("Cadastro: dispositivo novo chega só com o hash da chave e autentica com ela", async () => {
    recebedor.dispositivos.push({ device_id: H, api_key_hash: sha(HK), active: true, firmware_version: "2.0.0" });
    const r = await worker(true);
    const d = umaLinha<any>("SELECT api_key, api_key_hash, firmware_version FROM devices WHERE device_id = ?", H);
    const ok = await api("POST", "/api/v1/iot/telemetries", { message_id: "M-H1", device_id: H, ...POS }, HK);
    const texto = await api("POST", "/api/v1/iot/telemetries", { message_id: "M-H2", device_id: H, ...POS }, d.api_key);
    return { passou: r.dispositivos?.criados === 1 && d.api_key_hash === sha(HK) && ok.status === 202 && texto.status === 401, detalhe: "a chave em texto guardada não autentica" };
  });
  await teste("Cadastro: dispositivo que já existia recebe o hash e a chave em texto antiga deixa de valer", async () => {
    recebedor.dispositivos.push({ device_id: OUTRO, api_key_hash: sha("chave-nova-do-principal"), active: true });
    await worker(true);
    const antiga = await api("POST", "/api/v1/iot/telemetries", { message_id: "M-H3", device_id: OUTRO, ...POS, latitude: -7.9 }, OUTRA_KEY);
    const nova = await api("POST", "/api/v1/iot/telemetries", { message_id: "M-H4", device_id: OUTRO, ...POS, latitude: -7.9 }, "chave-nova-do-principal");
    return { passou: antiga.status === 401 && nova.status === 202, detalhe: `antiga ${antiga.status}, nova ${nova.status}` };
  });
  await teste("Cadastro: dispositivo desativado no banco principal -> 403; nada é apagado", async () => {
    recebedor.dispositivos.find(d => d.device_id === H)!.active = false;
    await worker(true);
    const r = await api("POST", "/api/v1/iot/telemetries", { message_id: "M-H5", device_id: H, ...POS }, HK);
    recebedor.dispositivos.find(d => d.device_id === H)!.active = true;
    await worker(true);
    return { passou: r.status === 403 && Boolean(umaLinha("SELECT 1 FROM devices WHERE device_id = ?", DEV)) };
  });
  await teste("Comandos: sem chave -> 401; chave de outro -> 403", async () => {
    const a = await api("GET", `/api/v1/iot/commands/${DEV}`);
    const b = await api("GET", `/api/v1/iot/commands/${DEV}`, undefined, HK);
    return { passou: a.status === 401 && b.status === 403 };
  });
  await teste("Comando criado no banco principal chega ao lacre; tipo desconhecido e dispositivo desconhecido viram aviso", async () => {
    recebedor.comandos.push(
      { command_id: "CMD-T1", device_id: DEV, command_type: "TRAVAR_VALVULA" },
      { command_id: "CMD-T2", device_id: DEV, command_type: "LIGAR_SIRENE" },
      { command_id: "CMD-T3", device_id: "DSP-FANTASMA", command_type: "TRAVAR_VALVULA" });
    const r = await worker();
    await worker();
    const l = await api("GET", `/api/v1/iot/commands/${DEV}`, undefined, KEY);
    return { passou: r.comandos_novos === 1 && r.avisos.length === 2 && r.status === "PARCIAL" && l.json.length === 1 && l.json[0].command_id === "CMD-T1", detalhe: "não duplica na rodada seguinte" };
  });
  await teste("Confirmação: status inválido -> 400; comando inexistente -> 404", async () => {
    const a = await api("POST", "/api/v1/iot/commands/confirm", { command_id: "CMD-T1", device_id: DEV, status: "FEITO" }, KEY);
    const b = await api("POST", "/api/v1/iot/commands/confirm", { command_id: "CMD-NAO", device_id: DEV, status: "EXECUTADO" }, KEY);
    return { passou: a.status === 400 && b.status === 404 };
  });
  await teste("Confirmação com ERRO -> 200, sai dos pendentes e o banco principal recebe o resultado; de novo -> 409", async () => {
    const c = await api("POST", "/api/v1/iot/commands/confirm", { command_id: "CMD-T1", device_id: DEV, status: "ERRO", error_message: "motor travado" }, KEY);
    const de_novo = await api("POST", "/api/v1/iot/commands/confirm", { command_id: "CMD-T1", device_id: DEV, status: "EXECUTADO" }, KEY);
    const pend = await api("GET", `/api/v1/iot/commands/${DEV}`, undefined, KEY);
    await worker();
    const m = recebedor.mensagens.get("CONF-CMD-T1") as any;
    return { passou: c.status === 200 && de_novo.status === 409 && pend.json.length === 0 && m?.command_status === "ERRO" && m.error_message === "motor travado" && recebedor.comandos[0]?.confirmado === "ERRO" };
  });
  await teste("Banco recusa comando PENDENTE com tipo fora do catálogo e status desconhecido", () => {
    const tentar = (sql: string): boolean => { try { db.prepare(sql).run(); return false; } catch { return true; } };
    return {
      passou: tentar(`INSERT INTO commands (command_id, device_id, command_type) VALUES ('CMD-X1', '${DEV}', 'ABRIR_TUDO')`) &&
        tentar(`INSERT INTO commands (command_id, device_id, command_type, status) VALUES ('CMD-X2', '${DEV}', 'TRAVAR_VALVULA', 'FEITO')`)
    };
  });

  // ------------------------------------------------------------- [10] saúde
  console.log("\n--- [10] Saúde ---");
  await teste("GET /health -> 200 com a fila e o Worker, sem mostrar endereço nem chave", async () => {
    const r = await api("GET", "/health");
    const texto = JSON.stringify(r.json);
    return { passou: r.status === 200 && r.json.status === "OK" && typeof r.json.fila.pendentes === "number" && r.json.banco_principal === "CONFIGURADO" && !texto.includes(recebedor.chave) && !texto.includes("127.0.0.1") };
  });
  await teste("GET /health -> 503 quando a última rodada do Worker falhou", async () => {
    recebedor.foraDoAr = true;
    await worker();
    const r = await api("GET", "/health");
    recebedor.foraDoAr = false;
    await worker();
    return { passou: r.status === 503 && r.json.status === "DEGRADADO" && r.json.worker.resultado === "FALHOU" };
  });

  // ------------------------------------------ [11] migração e manutenção
  console.log("\n--- [11] Migração do modelo antigo e manutenção ---");
  await teste("Banco no modelo antigo: cópia de segurança, mensagens antigas ARQUIVADAS e tabelas antigas removidas", () => {
    const antiga = fs.mkdtempSync(path.join(os.tmpdir(), "oxide-antigo-"));
    const velho = new Database(path.join(antiga, "oxide.db"));
    velho.exec(`
      CREATE TABLE devices (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL UNIQUE, api_key TEXT NOT NULL,
        firmware_version TEXT, active INTEGER NOT NULL DEFAULT 1, device_status_id INTEGER, valve_status_id INTEGER, seal_status_id INTEGER);
      CREATE TABLE status (id INTEGER PRIMARY KEY, code TEXT);
      CREATE TABLE telemetry_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT UNIQUE, device_id TEXT, latitude REAL, longitude REAL, status TEXT DEFAULT 'PENDING');
      CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT UNIQUE, device_id TEXT, message_type TEXT, status TEXT);
      CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id TEXT UNIQUE, device_id TEXT, alert_type TEXT, title TEXT);
      CREATE TABLE commands (id INTEGER PRIMARY KEY AUTOINCREMENT, command_id TEXT NOT NULL UNIQUE, device_id TEXT NOT NULL, command_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDENTE', created_at DATETIME NOT NULL, executed_at DATETIME, error_message TEXT);
      CREATE TABLE seals (id INTEGER PRIMARY KEY, seal_code TEXT);
      CREATE TABLE cylinders (id INTEGER PRIMARY KEY, cylinder_code TEXT);
      CREATE TABLE seal_assignments (id INTEGER PRIMARY KEY, device_id TEXT, seal_code TEXT);
      CREATE TABLE cylinder_assignments (id INTEGER PRIMARY KEY, seal_code TEXT, cylinder_code TEXT);
      CREATE TABLE sync_logs (id INTEGER PRIMARY KEY, status TEXT);
      INSERT INTO devices (device_id, api_key) VALUES ('DSP-000001', 'auto-DSP-000001');
      INSERT INTO telemetry_queue (message_id, device_id, latitude, longitude) VALUES ('MSG-OLD-1', 'DSP-000001', -7.1, -39.1), ('MSG-OLD-2', 'DSP-000001', -7.2, -39.2);
      INSERT INTO events (message_id, device_id, message_type) VALUES ('EVT-OLD-1', 'DSP-000001', 'startup');
      INSERT INTO alerts (alert_id, device_id, alert_type, title) VALUES ('ALT-OLD-1', 'DSP-000001', 'LACRE_VIOLADO', 'antigo');
      INSERT INTO commands (command_id, device_id, command_type, created_at) VALUES ('CMD-OLD-1', 'DSP-000001', 'TRAVAR_VALVULA', '2026-10-01 10:00:00');
    `);
    velho.close();

    const saida = rodar("src/database/connection.ts", antiga);
    const novo = new Database(path.join(antiga, "oxide.db"), { readonly: true });
    const tabelas = (novo.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[]).map(t => t.name).join(",");
    const arquivadas = (novo.prepare("SELECT count(*) AS n FROM mensagens WHERE status = 'ARQUIVADA'").get() as any).n;
    const antigaMsg = JSON.parse((novo.prepare("SELECT payload_json FROM mensagens WHERE message_id = 'MSG-OLD-1'").get() as any).payload_json);
    const colunas = (novo.prepare("PRAGMA table_info(devices)").all() as any[]).map(c => c.name);
    const dispositivo = novo.prepare("SELECT api_key FROM devices WHERE device_id = 'DSP-000001'").get() as any;
    const comando = (novo.prepare("SELECT count(*) AS n FROM commands").get() as any).n;
    novo.close();
    const copias = fs.readdirSync(antiga).filter(f => f.includes(".bak-antes-da-fila-unica-"));
    const copia = new Database(path.join(antiga, copias[0]!), { readonly: true });
    const naCopia = (copia.prepare("SELECT count(*) AS n FROM telemetry_queue").get() as any).n;
    copia.close();
    const segundaVez = rodar("src/database/connection.ts", antiga);

    return {
      passou: tabelas === "commands,devices,mensagens" && arquivadas === 4 && antigaMsg.latitude === -7.1 && dispositivo.api_key === "auto-DSP-000001" && comando === 1 &&
        !colunas.includes("device_status_id") && colunas.includes("last_contact_at") && copias.length === 1 && naCopia === 2 &&
        saida.includes("Cópia de segurança") && !segundaVez.includes("Cópia de segurança"),
      detalhe: `${arquivadas} arquivadas; cópia com ${naCopia} telemetrias; segunda execução não repete`
    };
  });
  await teste("npm run backup: cópia íntegra em backups/; mantém só as mais novas", () => {
    const a = rodar("src/manutencao/backup.ts", pasta, [], { BACKUP_MANTER: "1" });
    const arquivos = fs.readdirSync(path.join(pasta, "backups"));
    return { passou: a.includes("Backup criado") && /SHA-256: [0-9a-f]{64}/.test(a) && arquivos.length === 1, detalhe: arquivos[0] };
  });
  await teste("npm run retencao: sem --confirmar só mostra; com --confirmar apaga só o que foi enviado há mais de 30 dias", () => {
    db.prepare("UPDATE mensagens SET synced_at = datetime('now', '-40 days') WHERE message_id IN ('M-T1', 'M-T12')").run();
    const antes = total();
    const simulacao = rodar("src/manutencao/retencao.ts", pasta);
    const depoisDaSimulacao = total();
    const real = rodar("src/manutencao/retencao.ts", pasta, ["--confirmar"]);
    return { passou: /mensagens enviadas há mais de 30 dias: 2 a remover/.test(simulacao) && depoisDaSimulacao === antes && /2 removida/.test(real) && total() === antes - 2 && total("message_id = 'M-T14'") === 1 };
  });

  // ---------------------------------------------------------------- resumo
  const falhas = resultados.filter(r => !r.passou);
  console.log("\n==================================================");
  console.log("  RESULTADO FINAL DOS TESTES:");
  console.log(`   Total de Testes: ${resultados.length}`);
  console.log(`     Passaram:     ${resultados.length - falhas.length}`);
  console.log(`     Falharam:     ${falhas.length}`);
  console.log("==================================================");
  for (const f of falhas) console.log(`  ❌ ${f.nome}`);

  await new Promise<void>(resolve => server.close(() => resolve()));
  await recebedor.fechar();
  db.close();
  process.exitCode = falhas.length ? 1 : 0;
}

main().catch(erro => {
  console.error("Suíte interrompida:", erro);
  process.exit(1);
});
