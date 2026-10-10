import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { iniciarRecebedor } from "./recebedor";

// npm run simular — percurso completo de um lacre, sem o equipamento.
// Roda numa pasta temporária, com uma oxide.db nova, a própria API e um
// recebedor de teste no lugar do Supabase. O oxide.db do projeto e o banco
// principal não são tocados.

const PORTA = Number(process.env.SIMULADOR_PORT ?? 3199);
let conforme = 0;
let falhas = 0;

function etapa(titulo: string): void {
  console.log(`\n=== ${titulo} ===`);
}

function conferir(o_que: string, esperado: string, obtido: string, ok: boolean): void {
  ok ? conforme++ : falhas++;
  console.log(`${ok ? "✅" : "❌"} ${o_que} — ${obtido}${ok ? "" : ` (esperado: ${esperado})`}`);
}

async function main(): Promise<number> {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "oxide-simulacao-"));
  const recebedor = await iniciarRecebedor();
  process.chdir(pasta);
  process.env.PORT = String(PORTA);
  process.env.SUPABASE_IOT_URL = recebedor.url;
  process.env.SUPABASE_SERVICE_KEY = recebedor.chave;

  // Só depois do chdir: a Oxide aberta é a da pasta temporária
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { server } = require("../server") as typeof import("../server");
  const db = (require("../database/connection") as typeof import("../database/connection")).default;
  const { runCycle } = require("../worker/runner") as typeof import("../worker/runner");
  const { loadWorkerConfig } = require("../worker/config") as typeof import("../worker/config");
  /* eslint-enable @typescript-eslint/no-require-imports */

  const base = `http://127.0.0.1:${PORTA}`;
  const config = loadWorkerConfig();
  const worker = (cadastro = false) => runCycle(config, { withCadastro: cadastro });
  const chamar = async (metodo: string, rota: string, corpo?: unknown, chave?: string) => {
    const init: RequestInit = { method: metodo, headers: { "content-type": "application/json", ...(chave ? { "x-api-key": chave } : {}) } };
    if (corpo !== undefined) init.body = JSON.stringify(corpo);
    const res = await fetch(`${base}${rota}`, init);
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };

  const DISP = "DSP-SIM-001";
  const CHAVE = "chave-do-lacre-simulado";
  const pos = { latitude: -7.2305, longitude: -39.3150 };
  let n = 0;
  const leitura = (extra: Record<string, unknown> = {}) =>
    ({ message_id: `MSG-SIM-${String(++n).padStart(3, "0")}`, device_id: DISP, ...pos, battery_percent: 95, seal_status: "LOCKED", ...extra });

  try {
    etapa("0. Ambiente");
    console.log(`   Pasta: ${pasta}`);
    console.log(`   API na porta ${PORTA}; recebedor de teste no lugar do Supabase`);
    const tabelas = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map(t => t.name);
    conferir("Tabelas da Oxide", "commands, devices, mensagens", tabelas.join(", "), tabelas.join(",") === "commands,devices,mensagens");

    etapa("1. Cadastro do dispositivo vem do banco principal");
    recebedor.dispositivos.push({ device_id: DISP, api_key_hash: createHash("sha256").update(CHAVE).digest("hex"), active: true, firmware_version: "1.0.0" });
    const semCadastro = await chamar("POST", "/api/v1/iot/telemetries", leitura(), CHAVE);
    conferir("Lacre ainda não cadastrado na Oxide", "401", String(semCadastro.status), semCadastro.status === 401);
    const r1 = await worker(true);
    conferir("Worker traz o cadastro (só o hash da chave)", "1 criado", `${r1.dispositivos?.criados} criado(s), rodada ${r1.status}`, r1.dispositivos?.criados === 1);
    const lista = await chamar("GET", `/api/v1/devices/${DISP}`);
    conferir("Dispositivo consultado sem mostrar a chave", "200 sem api_key", `${lista.status}; campos: ${Object.keys(lista.json ?? {}).filter(k => k.includes("key")).join(",") || "nenhum com chave"}`, lista.status === 200 && !("api_key" in lista.json) && !("api_key_hash" in lista.json));

    etapa("2. Lacre ativo: leituras com posição e bateria");
    const t1 = await chamar("POST", "/api/v1/iot/telemetries", leitura(), CHAVE);
    conferir("Primeira leitura", "202", `${t1.status} ${t1.json?.message}`, t1.status === 202);
    const semBateria = await chamar("POST", "/api/v1/iot/telemetries", { message_id: "MSG-SIM-SB", device_id: DISP, ...pos }, CHAVE);
    conferir("Leitura sem bateria", "400", `${semBateria.status} ${semBateria.json?.message}`, semBateria.status === 400);
    const semPosicao = await chamar("POST", "/api/v1/iot/telemetries", { message_id: "MSG-SIM-SP", device_id: DISP, battery_percent: 90 }, CHAVE);
    conferir("Leitura sem latitude e longitude", "400", `${semPosicao.status} ${semPosicao.json?.message}`, semPosicao.status === 400);
    const chaveErrada = await chamar("POST", "/api/v1/iot/telemetries", leitura(), "chave-errada");
    conferir("Chave errada", "401", String(chaveErrada.status), chaveErrada.status === 401);

    etapa("3. Trajeto, posição repetida e duplicidade");
    for (const p of [{ latitude: -7.2250, longitude: -39.3120 }, { latitude: -7.2180, longitude: -39.3090 }]) {
      const t = await chamar("POST", "/api/v1/iot/telemetries", leitura({ ...p, speed_kmh: 40 }), CHAVE);
      conferir(`Posição ${p.latitude}, ${p.longitude}`, "202", String(t.status), t.status === 202);
    }
    const repetida = await chamar("POST", "/api/v1/iot/telemetries", leitura({ latitude: -7.2180, longitude: -39.3090, battery_percent: 93 }), CHAVE);
    conferir("Mesma posição de novo (parado)", "200, sem linha nova", `${repetida.status} ${repetida.json?.message}`, repetida.status === 200);
    const dup = leitura({ latitude: -7.2120, longitude: -39.3070 });
    const d1 = await chamar("POST", "/api/v1/iot/telemetries", dup, CHAVE);
    const d2 = await chamar("POST", "/api/v1/iot/telemetries", dup, CHAVE);
    conferir("Mesmo message_id reenviado", "202 e depois 409", `${d1.status} e ${d2.status}`, d1.status === 202 && d2.status === 409);

    etapa("4. GPS sem sinal: última posição conhecida com gps_ok = false");
    const semGps = await chamar("POST", "/api/v1/iot/telemetries", leitura({ latitude: -7.2120, longitude: -39.3070, gps_ok: false }), CHAVE);
    conferir("Leitura sem sinal de GPS", "202", String(semGps.status), semGps.status === 202);

    etapa("5. Alertas automáticos (saem da própria mensagem)");
    await chamar("POST", "/api/v1/iot/telemetries", leitura({ latitude: -7.2100, longitude: -39.3065, battery_percent: 9 }), CHAVE);
    await chamar("POST", "/api/v1/iot/telemetries", leitura({ latitude: -7.2095, longitude: -39.3064, battery_percent: 8 }), CHAVE);
    const alertasDe = (tipo: string): number => (db.prepare("SELECT count(*) AS n FROM mensagens WHERE tipo = 'ALERTA' AND json_extract(payload_json, '$.alert_type') = ?").get(tipo) as { n: number }).n;
    conferir("Bateria abaixo de 15%", "1 alerta BATERIA_BAIXA (não repete na leitura seguinte)", `${alertasDe("BATERIA_BAIXA")} alerta(s)`, alertasDe("BATERIA_BAIXA") === 1);
    const rompeu = await chamar("POST", "/api/v1/iot/events", { message_id: "EVT-SIM-001", device_id: DISP, event_type: "seal_changed", seal_status: "BROKEN", latitude: -7.2095, longitude: -39.3064, battery_percent: 8 }, CHAVE);
    conferir("Evento: lacre rompido", "202 e 1 alerta LACRE_VIOLADO", `${rompeu.status}; ${alertasDe("LACRE_VIOLADO")} alerta(s)`, rompeu.status === 202 && alertasDe("LACRE_VIOLADO") === 1);
    const doLacre = await chamar("POST", "/api/v1/iot/alerts", { alert_id: "ALT-SIM-001", device_id: DISP, alert_type: "GPS_INATIVO", title: "GPS não responde", latitude: -7.2095, longitude: -39.3064, gps_ok: false, battery_percent: 8 }, CHAVE);
    conferir("Alerta enviado pelo próprio lacre", "201 com a severidade do catálogo", `${doLacre.status} ${doLacre.json?.alert?.severity}`, doLacre.status === 201 && doLacre.json?.alert?.severity === "ALTA");

    etapa("6. Fila: banco principal fora do ar e reenvio");
    const antes = (await chamar("GET", "/api/v1/sync/status")).json.fila;
    console.log(`   Fila antes do envio: ${JSON.stringify(antes)}`);
    recebedor.foraDoAr = true;
    const fora = await worker();
    const tentativas = (db.prepare("SELECT COALESCE(max(attempt_count), 0) AS n FROM mensagens").get() as { n: number }).n;
    conferir("Banco principal fora do ar", "rodada FALHOU, nada perdido, nenhuma tentativa gasta", `${fora.status}; maior número de tentativas = ${tentativas}`, fora.status === "FALHOU" && tentativas === 0);
    recebedor.foraDoAr = false;
    const envio = await worker();
    conferir("Banco principal de volta", "tudo enviado", `rodada ${envio.status}; ${envio.enviadas} enviada(s); ${recebedor.mensagens.size} no banco principal`, envio.status === "OK" && envio.enviadas === antes.pendentes && recebedor.mensagens.size === antes.pendentes);
    db.prepare("UPDATE mensagens SET status = 'PENDING'").run();
    const denovo = await worker();
    conferir("Reenvio de tudo de novo", "nada duplicado", `${denovo.enviadas} reenviada(s); ${recebedor.mensagens.size} no banco principal`, recebedor.mensagens.size === antes.pendentes);

    etapa("7. Comando da válvula criado no sistema principal");
    recebedor.comandos.push({ command_id: "CMD-SIM-001", device_id: DISP, command_type: "TRAVAR_VALVULA" });
    const rc = await worker();
    conferir("Worker traz o comando", "1 comando novo", `${rc.comandos_novos}`, rc.comandos_novos === 1);
    const pendentes = await chamar("GET", `/api/v1/iot/commands/${DISP}`, undefined, CHAVE);
    conferir("Lacre busca o comando", "TRAVAR_VALVULA", pendentes.json?.[0]?.command_type ?? "nenhum", pendentes.json?.[0]?.command_type === "TRAVAR_VALVULA");
    const conf = await chamar("POST", "/api/v1/iot/commands/confirm", { command_id: "CMD-SIM-001", device_id: DISP, status: "EXECUTADO" }, CHAVE);
    await worker();
    conferir("Lacre confirma e o sistema principal fica sabendo", "200 e EXECUTADO", `${conf.status}; no banco principal: ${recebedor.comandos[0]?.confirmado}`, conf.status === 200 && recebedor.comandos[0]?.confirmado === "EXECUTADO");

    etapa("8. O que ficou nos dois lados");
    const porTipo = db.prepare("SELECT tipo, count(*) AS n FROM mensagens GROUP BY tipo ORDER BY tipo").all() as Array<{ tipo: string; n: number }>;
    console.log(`   Oxide (fila): ${porTipo.map(t => `${t.tipo}=${t.n}`).join(", ")}`);
    console.log(`   Banco principal (recebedor): ${recebedor.mensagens.size} mensagens`);
    const saude = await chamar("GET", "/health");
    conferir("Saúde da API", "200 OK", `${saude.status} ${saude.json?.status}; fila: ${JSON.stringify(saude.json?.fila)}`, saude.status === 200 && saude.json?.fila?.pendentes === 0);
  } catch (erro) {
    conferir("Execução da simulação", "sem exceção", (erro as Error).stack ?? String(erro), false);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await recebedor.fechar();
  }

  console.log(`\nResultado: ${conforme} de ${conforme + falhas} verificações conforme; ${falhas} falha(s).`);
  console.log(`Banco da simulação: ${path.join(pasta, "oxide.db")}`);
  return falhas === 0 ? 0 : 1;
}

main().then(codigo => { process.exitCode = codigo; }).catch(erro => {
  console.error("Simulação interrompida:", erro);
  process.exitCode = 1;
});
