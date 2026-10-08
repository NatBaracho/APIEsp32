import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import db from "../database/connection";
import { alertTypes } from "../models/Alert";
import { server } from "../server";
import { createFluxidPool } from "../worker/fluxid";
import { runCycle } from "../worker/runner";
import { Ambiente } from "./ambiente";
import {
  CLIENTE, cadastroEmMassa, cadastroUnitario, distanciaMetros, lerCsv, prepararLogin, reimportarMassa, tentar
} from "./operador";
import { Registro } from "./registro";

// Roteiro da simulação. Este módulo só é carregado depois que o processo já
// está na pasta temporária (o oxide.db aberto é o da simulação).

type Resposta = { status: number; json: any };

export async function executar(ambiente: Ambiente, projeto: string): Promise<number> {
  const r = new Registro();
  const base = `http://127.0.0.1:${ambiente.porta}/api/v1`;
  const fluxid = createFluxidPool(ambiente.fluxidUrl);
  const rodada = ambiente.rodada;
  let seq = 0;

  const api = async (metodo: string, rota: string, corpo?: unknown, chave?: string): Promise<Resposta> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (chave) headers["X-API-Key"] = chave;
    const init: RequestInit = { method: metodo, headers };
    if (corpo !== undefined) init.body = JSON.stringify(corpo);
    const res = await fetch(`${base}${rota}`, init);
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const msg = (): string => `MSG-S${rodada}-${String(++seq).padStart(3, "0")}`;
  const evt = (): string => `EVT-S${rodada}-${String(++seq).padStart(3, "0")}`;
  const umValor = async <T>(sql: string, valores: unknown[] = []): Promise<T | undefined> =>
    (await fluxid.query(sql, valores)).rows[0] as T | undefined;
  const linhas = async (sql: string, valores: unknown[] = []): Promise<any[]> => (await fluxid.query(sql, valores)).rows;
  const oxide = <T>(sql: string, ...valores: unknown[]): T => db.prepare(sql).get(...valores) as T;
  const worker = async (cadastro = false) => runCycle(fluxid, { batchSize: 500, withCadastro: cadastro });
  // API do frontend (/api/v1/app), usada pelo operador da simulação
  let token = "";
  const app = async (funcao: string, corpo: Record<string, unknown>): Promise<Resposta> => {
    const res = await fetch(`${base}/app/${funcao}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(corpo)
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  // Trajeto planejado: depósito → três pontos → cliente
  const deposito = { latitude: -7.2305, longitude: -39.3150 };
  const trajeto = [
    { latitude: -7.2250, longitude: -39.3120 },
    { latitude: -7.2180, longitude: -39.3090 },
    { latitude: -7.2120, longitude: -39.3070 }
  ];
  const alertasAutomaticos = async (cilindroId: string): Promise<any[]> =>
    ((await app("query-alerts", { operation: "list", organization_id: orgId, cylinder_id: cilindroId, limit: 100 })).json?.items ?? [])
      .filter((a: any) => String(a.code).startsWith("AUT-"));
  let orgId = "";

  try {
    // ------------------------------------------------------------------ 0
    r.etapa("0. Ambiente");
    r.info(`Rodada ${rodada}; pasta ${ambiente.pasta}`);
    r.info(`API da simulação na porta ${ambiente.porta}; FluxID de análise no Docker`);
    const ping = await fetch(`http://127.0.0.1:${ambiente.porta}/`);
    r.conferir("API da simulação no ar", "200", String(ping.status), ping.status === 200);
    const versao = await umValor<{ v: string }>("SELECT current_setting('server_version') AS v");
    r.conferir("Conexão com o FluxID de análise", "conectado", `PostgreSQL ${versao?.v}`, Boolean(versao));

    // ------------------------------------------------------------------ 1
    r.etapa("1. Operador: cadastro unitário (cliente, endereço, cilindro, lacre, dispositivo, rota)");
    const cad = await cadastroUnitario(fluxid, rodada);
    const p = cad.principal;
    r.conferir("Empresa, operador e cliente com endereço", "cadastrados", `ORG-S${rodada}, USR-S${rodada}, CLI-S${rodada} (raio de ${CLIENTE.raio} m)`, true);
    r.conferir("Conjunto do lacre", "cilindro + lacre + dispositivo vinculados",
      `${p.cilindro.codigo} ⇄ ${p.lacre.codigo} ⇄ ${p.dispositivo.codigo}`, true);
    r.info(`Chave do dispositivo gerada e mostrada uma única vez: ${p.dispositivo.chave.slice(0, 12)}… (o FluxID guarda só o hash)`);
    const entrega = await umValor<{ status: string; itens: string }>(
      "SELECT e.status, count(i.*)::text AS itens FROM entregas e JOIN entrega_itens i ON i.entrega_id = e.id WHERE e.id = $1 GROUP BY e.status", [cad.entregaId]);
    r.conferir("Rota (entrega) até o endereço do cliente", "PENDENTE com 1 cilindro", `${entrega?.status} com ${entrega?.itens} cilindro`, entrega?.status === "PENDENTE" && entrega?.itens === "1");
    const lacreInstalado = await umValor<{ status: string }>("SELECT status FROM lacres WHERE id = $1", [p.lacre.id]);
    r.conferir("Lacre no cilindro", "INSTALADO", lacreInstalado?.status ?? "?", lacreInstalado?.status === "INSTALADO");
    orgId = cad.organizacaoId;
    const senhaRodada = `Sim-${rodada}-${randomBytes(9).toString("base64url")}`;
    const email = await prepararLogin(fluxid, cad, senhaRodada);
    const entrada = await app("session-login", { email, password: senhaRodada });
    token = entrada.json?.session?.access_token ?? "";
    r.conferir("Operador entra pela API do frontend (session-login)", "200 AUTHENTICATED", `${entrada.status} ${entrada.json?.code}`, entrada.status === 200 && Boolean(token));
    const pontosRota = [deposito, ...trajeto, { latitude: CLIENTE.latitude, longitude: CLIENTE.longitude }];
    const rota = await app("manage-deliveries", { operation: "set_route", organization_id: orgId, delivery_id: cad.entregaId, points: pontosRota, margin_meters: 50 });
    r.conferir("Rota até o cliente (manage-deliveries set_route)", `SAVED, ${pontosRota.length} pontos, margem de 50 m`, `${rota.status} ${rota.json?.code}`, rota.json?.code === "SAVED");

    // ------------------------------------------------------------------ 2
    r.etapa("2. Operador: erros de cadastro (o banco recusa)");
    const serieRepetida = await tentar(fluxid,
      "INSERT INTO cilindros (organizacao_id, codigo, numero_serie, tipo, status) VALUES ($1, $2, $3, 'OXIGENIO', 'DISPONIVEL')",
      [cad.organizacaoId, `CIL-S${rodada}-XX`, p.cilindro.serie]);
    r.conferir("Cilindro com número de série repetido", "recusado", serieRepetida ?? "aceito", serieRepetida !== null);
    const lacreRepetido = await tentar(fluxid,
      "INSERT INTO lacres (organizacao_id, codigo, uid_nfc, data_fabricacao, proxima_revisao, status) VALUES ($1, $2, 'NFC-OUTRO', current_date, current_date, 'EM_ESTOQUE')",
      [cad.organizacaoId, p.lacre.codigo]);
    r.conferir("Lacre com código repetido", "recusado", lacreRepetido ?? "aceito", lacreRepetido !== null);
    const segundoLacre = await tentar(fluxid,
      "INSERT INTO vinculos_cilindro_lacre (cilindro_id, lacre_id, data_inicio) SELECT $1, id, now() FROM lacres WHERE codigo = 'LCR-000050'",
      [p.cilindro.id]);
    r.conferir("Segundo lacre ativo no mesmo cilindro (RN04)", "recusado", segundoLacre ?? "aceito", segundoLacre !== null);
    const parErrado = await tentar(fluxid,
      `INSERT INTO alertas (codigo, organizacao_id, lacre_id, cilindro_id, tipo, severidade, status, titulo, aberto_em)
       SELECT $1, $2, $3, id, 'LACRE_VIOLADO', 'CRITICA', 'ABERTO', 'par errado', now() FROM cilindros WHERE codigo = 'CIL-000001'`,
      [`ALT-S${rodada}-PE`, cad.organizacaoId, p.lacre.id]);
    r.conferir("Alerta com lacre em cilindro que não é o dele (auditoria)", "recusado pelo gatilho", parErrado ?? "aceito", parErrado !== null);

    // ------------------------------------------------------------------ 3
    r.etapa("3. Operador: cadastro em massa (CSV)");
    const csv = path.join(projeto, "simulador", "cadastro-em-massa.csv");
    const planilha = lerCsv(csv, rodada);
    const massa = await cadastroEmMassa(fluxid, cad, rodada, planilha);
    const vinculados = massa.filter(c => c.vinculado).length;
    r.conferir("Planilha importada numa transação", `${planilha.length} conjuntos (${planilha.length - 1} vinculados)`,
      `${massa.length} conjuntos (${vinculados} vinculados)`, massa.length === planilha.length && vinculados === planilha.length - 1);
    const reimportacao = await reimportarMassa(fluxid, cad, rodada, planilha);
    const depois = await umValor<{ n: string }>("SELECT count(*)::text AS n FROM cilindros WHERE organizacao_id = $1", [cad.organizacaoId]);
    r.conferir("Importar a mesma planilha de novo", "recusada inteira; nada duplicado",
      `${reimportacao ?? "aceita"}; ${depois?.n} cilindros na empresa`, reimportacao !== null && depois?.n === String(planilha.length + 1));
    const semVinculo = massa.find(c => !c.vinculado)!;
    const outro = massa[0]!;

    // ------------------------------------------------------------------ 4
    r.etapa("4. Worker: cadastro do FluxID chega à Oxide");
    const ciclo1 = await worker(true);
    const disp = oxide<{ active: number; tem_hash: number }>(
      "SELECT active, api_key_hash IS NOT NULL AS tem_hash FROM devices WHERE device_id = ?", p.dispositivo.codigo);
    r.conferir("Dispositivo na Oxide com hash da chave", "ativo, com hash", `active=${disp?.active}, hash=${disp?.tem_hash}`, disp?.active === 1 && disp?.tem_hash === 1);
    const vinc = oxide<{ seal_code: string; cylinder_code: string }>(
      `SELECT s.seal_code, c.cylinder_code FROM seal_assignments s JOIN cylinder_assignments c ON c.seal_code = s.seal_code AND c.ended_at IS NULL
       WHERE s.device_id = ? AND s.ended_at IS NULL`, p.dispositivo.codigo);
    r.conferir("Vínculos na Oxide", `${p.lacre.codigo} / ${p.cilindro.codigo}`, `${vinc?.seal_code} / ${vinc?.cylinder_code}`,
      vinc?.seal_code === p.lacre.codigo && vinc?.cylinder_code === p.cilindro.codigo);
    const conflitos = ciclo1.cadastro && "conflitos" in ciclo1.cadastro ? ciclo1.cadastro.conflitos : ["cadastro não trazido"];
    r.conferir("Cadastro trazido sem conflitos", "0 conflitos", conflitos.length === 0 ? "0 conflitos" : `${conflitos.length}: ${conflitos.slice(0, 2).join("; ")}…`, conflitos.length === 0);
    const massaNaOxide = oxide<{ n: number }>("SELECT count(*) AS n FROM cylinders WHERE cylinder_code LIKE ?", `CIL-S${rodada}-%`);
    r.conferir("Cilindros da empresa copiados para a Oxide", `${massa.length + 1}`, String(massaNaOxide?.n), massaNaOxide?.n === massa.length + 1);

    // ------------------------------------------------------------------ 5
    r.etapa("5. Lacre ativo no depósito");
    const ativo = await api("GET", `/devices/${p.dispositivo.codigo}`);
    r.conferir("Dispositivo ativo", "active = 1", `active = ${ativo.json?.active}`, ativo.json?.active === 1);
    const t1 = await api("POST", "/iot/telemetries", {
      message_id: msg(), device_id: p.dispositivo.codigo, ...deposito, speed_kmh: 0, battery_percent: 98, gsm_signal: -60, seal_status: "LOCKED"
    }, p.dispositivo.chave);
    r.conferir("Primeira posição (lacre fechado)", "202", String(t1.status), t1.status === 202);

    // ------------------------------------------------------------------ 6
    r.etapa("6. Rota: cilindro sai para o cliente (detecção automática de rota e de lacre aberto)");
    const saida = await app("manage-deliveries", { operation: "start", organization_id: orgId, delivery_id: cad.entregaId });
    r.conferir("Saída da entrega pela API do frontend (start)", "STARTED", `${saida.status} ${saida.json?.code}`, saida.json?.code === "STARTED");
    await worker(true);
    const emTransito = oxide<{ status: string }>("SELECT status FROM cylinders WHERE cylinder_code = ?", p.cilindro.codigo);
    r.conferir("Cilindro em trânsito na Oxide", "EM_TRANSITO", emTransito?.status ?? "?", emTransito?.status === "EM_TRANSITO");
    for (const [i, ponto] of trajeto.entries()) {
      const t = await api("POST", "/iot/telemetries", {
        message_id: msg(), device_id: p.dispositivo.codigo, ...ponto, speed_kmh: 40, battery_percent: 95 - i, gsm_signal: -65, seal_status: "LOCKED"
      }, p.dispositivo.chave);
      r.conferir(`Posição ${i + 1} do trajeto`, "202", String(t.status), t.status === 202);
    }
    const ultimo = trajeto[2]!;
    const repetida = await api("POST", "/iot/telemetries", {
      message_id: msg(), device_id: p.dispositivo.codigo, ...ultimo, seal_status: "LOCKED"
    }, p.dispositivo.chave);
    r.conferir("Duplicidade: mesma posição (parado no trânsito)", "200, sem linha nova", `${repetida.status} ${repetida.json?.message ?? ""}`, repetida.status === 200);
    const duplicada = `MSG-S${rodada}-DUP`;
    const d1 = await api("POST", "/iot/telemetries", { message_id: duplicada, device_id: p.dispositivo.codigo, latitude: -7.2110, longitude: -39.3069, seal_status: "LOCKED" }, p.dispositivo.chave);
    const d2 = await api("POST", "/iot/telemetries", { message_id: duplicada, device_id: p.dispositivo.codigo, latitude: -7.2110, longitude: -39.3069, seal_status: "LOCKED" }, p.dispositivo.chave);
    r.conferir("Duplicidade: mesmo message_id reenviado", "202 e depois 409", `${d1.status} e ${d2.status}`, d1.status === 202 && d2.status === 409);

    const semGps1 = await api("POST", "/iot/telemetries", { message_id: msg(), device_id: p.dispositivo.codigo, battery_percent: 92, gsm_signal: -90, seal_status: "LOCKED" }, p.dispositivo.chave);
    const semGps2 = await api("POST", "/iot/telemetries", { message_id: msg(), device_id: p.dispositivo.codigo, battery_percent: 92, gsm_signal: -95, seal_status: "LOCKED" }, p.dispositivo.chave);
    r.conferir("GPS sem sinal (2 leituras sem posição)", "202 e 202 (vão para a quarentena)", `${semGps1.status} e ${semGps2.status}`, semGps1.status === 202 && semGps2.status === 202);

    const abertura = await api("POST", "/iot/events", { message_id: evt(), device_id: p.dispositivo.codigo, event_type: "seal_changed", seal_status: "UNLOCKED" }, p.dispositivo.chave);
    const erroTransito = oxide<{ error_type: string }>("SELECT error_type FROM events WHERE device_id = ? ORDER BY id DESC LIMIT 1", p.dispositivo.codigo);
    r.conferir("Lacre aberto em trânsito (detectado pela API)", "202 e error_type LACRE_ABERTO_EM_TRANSITO",
      `${abertura.status} e ${erroTransito?.error_type}`, abertura.status === 202 && erroTransito?.error_type === "LACRE_ABERTO_EM_TRANSITO");
    const travar = oxide<{ command_id: string }>("SELECT command_id FROM commands WHERE device_id = ? AND command_type = 'TRAVAR_VALVULA' AND status = 'PENDENTE'", p.dispositivo.codigo);
    r.conferir("Travamento automático da válvula", "comando TRAVAR_VALVULA pendente", travar?.command_id ?? "nenhum", Boolean(travar));
    const foraDaRota = { latitude: -7.2160, longitude: -39.2950 };
    const tRota = await api("POST", "/iot/telemetries", { message_id: msg(), device_id: p.dispositivo.codigo, ...foraDaRota, speed_kmh: 35, seal_status: "UNLOCKED" }, p.dispositivo.chave);
    r.conferir("Posição fora da rota", "202", `${tRota.status} (a ${Math.round(distanciaMetros(foraDaRota, trajeto[1]!))} m do trajeto)`, tRota.status === 202);

    // Alertas que o lacre (ESP32) envia durante o trajeto
    const alerta = async (tipo: string, titulo: string, chave = p.dispositivo.chave, dispositivo = p.dispositivo.codigo): Promise<Resposta> =>
      api("POST", "/iot/alerts", { alert_id: `ALT-S${rodada}-${String(++seq).padStart(3, "0")}`, device_id: dispositivo, alert_type: tipo, title: titulo }, chave);
    const gps = await alerta("GPS_SEM_SINAL", "GPS sem sinal no trajeto");
    r.conferir("Alerta GPS_SEM_SINAL (enviado pelo lacre)", "201", `${gps.status} (${gps.json?.alert?.severity})`, gps.status === 201);

    // O Worker envia as posições e roda as regras automáticas
    await worker(false);
    const automaticos6 = await alertasAutomaticos(p.cilindro.id);
    const abertoAuto = automaticos6.find(a => a.type === "LACRE_ABERTO_EM_TRANSITO");
    const rotaAuto = automaticos6.find(a => a.type === "SAIDA_ROTA");
    r.conferir("Alerta automático LACRE_ABERTO_EM_TRANSITO no FluxID", "CRITICA, com lacre e cilindro",
      abertoAuto ? `${abertoAuto.code} ${abertoAuto.severity}; ${abertoAuto.seal?.code} / ${abertoAuto.cylinder?.code}` : "não criado",
      abertoAuto?.severity === "CRITICA" && abertoAuto?.seal?.code === p.lacre.codigo);
    r.conferir("Alerta automático SAIDA_ROTA no FluxID (margem de 50 m)", "ALTA", rotaAuto ? `${rotaAuto.code}: ${rotaAuto.description}` : "não criado", rotaAuto?.severity === "ALTA");

    // ------------------------------------------------------------------ 7
    r.etapa("7. Chegada ao cliente e geocerca de 10 m (detecção automática)");
    const chegada = await app("manage-deliveries", { operation: "finish", organization_id: orgId, delivery_id: cad.entregaId });
    r.conferir("Entrega concluída pela API do frontend (finish: custódia no endereço)", "FINISHED", `${chegada.status} ${chegada.json?.code}`, chegada.json?.code === "FINISHED");
    await new Promise(resolve => setTimeout(resolve, 1100));
    await worker(true);
    const comCliente = oxide<{ status: string }>("SELECT status FROM cylinders WHERE cylinder_code = ?", p.cilindro.codigo);
    r.conferir("Cilindro com o cliente na Oxide", "COM_CLIENTE", comCliente?.status ?? "?", comCliente?.status === "COM_CLIENTE");
    const dentro = { latitude: CLIENTE.latitude + 0.00003, longitude: CLIENTE.longitude };
    const tDentro = await api("POST", "/iot/telemetries", { message_id: msg(), device_id: p.dispositivo.codigo, ...dentro, speed_kmh: 0, seal_status: "LOCKED" }, p.dispositivo.chave);
    const mDentro = distanciaMetros(dentro, CLIENTE);
    r.conferir("Posição dentro da geocerca", `202 e até ${CLIENTE.raio} m`, `${tDentro.status} a ${mDentro.toFixed(1)} m`, tDentro.status === 202 && mDentro <= CLIENTE.raio);
    const fora = { latitude: CLIENTE.latitude + 0.0005, longitude: CLIENTE.longitude + 0.0002 };
    const tFora = await api("POST", "/iot/telemetries", { message_id: msg(), device_id: p.dispositivo.codigo, ...fora, speed_kmh: 5, seal_status: "LOCKED" }, p.dispositivo.chave);
    const mFora = distanciaMetros(fora, CLIENTE);
    r.conferir("Posição fora da geocerca", `202 e mais de ${CLIENTE.raio} m`, `${tFora.status} a ${mFora.toFixed(1)} m`, tFora.status === 202 && mFora > CLIENTE.raio);
    await worker(false);
    const geoAuto = (await alertasAutomaticos(p.cilindro.id)).find(a => a.type === "SAIDA_GEOCERCA");
    r.conferir("Alerta automático SAIDA_GEOCERCA no FluxID", "ALTA", geoAuto ? `${geoAuto.code}: ${geoAuto.description}` : "não criado", geoAuto?.severity === "ALTA");

    // ------------------------------------------------------------------ 8
    r.etapa("8. Violação e erros do dispositivo");
    const violacao = await api("POST", "/iot/events", { message_id: evt(), device_id: p.dispositivo.codigo, event_type: "seal_changed", seal_status: "BROKEN" }, p.dispositivo.chave);
    r.conferir("Evento de violação (lacre rompido)", "202", String(violacao.status), violacao.status === 202);
    const aViolacao = await alerta("LACRE_VIOLADO", "Lacre rompido no cliente");
    r.conferir("Alerta LACRE_VIOLADO", "201 CRITICA", `${aViolacao.status} ${aViolacao.json?.alert?.severity}`, aViolacao.status === 201 && aViolacao.json?.alert?.severity === "CRITICA");
    const reinicio = await api("POST", "/iot/events", { message_id: evt(), device_id: p.dispositivo.codigo, event_type: "startup" }, p.dispositivo.chave);
    r.conferir("Evento do dispositivo (reinício)", "202", String(reinicio.status), reinicio.status === 202);
    for (const [tipo, titulo] of [["BATERIA_BAIXA", "Bateria abaixo do limite"], ["GSM_SINAL_FRACO", "Sinal GSM fraco"], ["DISPOSITIVO_FALHA", "Falha de sensor"]] as const) {
      const a = await alerta(tipo, titulo);
      r.conferir(`Alerta ${tipo}`, "201", `${a.status} (${a.json?.alert?.severity})`, a.status === 201);
    }
    const chaveErrada = await api("POST", "/iot/telemetries", { message_id: msg(), device_id: p.dispositivo.codigo, latitude: -7.2, longitude: -39.3 }, "chave-errada");
    r.conferir("Chave errada", "401", String(chaveErrada.status), chaveErrada.status === 401);
    const chaveDeOutro = await api("POST", "/iot/telemetries", { message_id: msg(), device_id: p.dispositivo.codigo, latitude: -7.2, longitude: -39.3 }, outro.dispositivo.chave);
    r.conferir("Chave de outro lacre", "403", String(chaveDeOutro.status), chaveDeOutro.status === 403);

    // ------------------------------------------------------------------ 9
    r.etapa("9. Todos os alertas do catálogo");
    const jaEnviados = new Set(["GPS_SEM_SINAL", "LACRE_ABERTO_EM_TRANSITO", "SAIDA_ROTA", "SAIDA_GEOCERCA", "LACRE_VIOLADO", "BATERIA_BAIXA", "GSM_SINAL_FRACO", "DISPOSITIVO_FALHA"]);
    let aceitos = 0;
    const restantes = alertTypes.filter(t => !jaEnviados.has(t));
    for (const tipo of restantes) {
      const a = await alerta(tipo, `Simulação do código ${tipo}`);
      if (a.status === 201) aceitos++;
    }
    r.conferir("Demais códigos do catálogo", `${restantes.length} alertas com 201`, `${aceitos} aceitos`, aceitos === restantes.length);
    const antigo = await alerta("SEAL_BROKEN", "Firmware antigo (nome em inglês)");
    r.conferir("Nome antigo em inglês (transição)", "201 gravado como LACRE_VIOLADO", `${antigo.status} ${antigo.json?.alert?.alert_type}`, antigo.json?.alert?.alert_type === "LACRE_VIOLADO");
    const invalido = await alerta("LIGAR_SIRENE", "Fora do catálogo");
    r.conferir("Código fora do catálogo", "400", String(invalido.status), invalido.status === 400);

    // ------------------------------------------------------------------ 10
    r.etapa("10. Fila: espera, FluxID fora do ar, erros e reenvio");
    const local = await api("POST", "/devices", { device_id: `DSP-L${rodada}`, api_key: `key-local-${rodada}`, firmware_version: "1.0.0" });
    const tLocal = await api("POST", "/iot/telemetries", { message_id: msg(), device_id: `DSP-L${rodada}`, latitude: -7.25, longitude: -39.33 }, `key-local-${rodada}`);
    r.conferir("Dispositivo só da Oxide (fora do FluxID) envia", "201 e 202", `${local.status} e ${tLocal.status}`, local.status === 201 && tLocal.status === 202);
    const espera = await api("POST", "/iot/events", { message_id: evt(), device_id: semVinculo.dispositivo.codigo, event_type: "seal_changed", seal_status: "BROKEN" }, semVinculo.dispositivo.chave);
    const erroSemLacre = oxide<{ error_type: string }>("SELECT error_type FROM events WHERE device_id = ? ORDER BY id DESC LIMIT 1", semVinculo.dispositivo.codigo);
    r.conferir("Evento de dispositivo sem lacre", "202 e error_type DISPOSITIVO_SEM_LACRE", `${espera.status} e ${erroSemLacre?.error_type}`, erroSemLacre?.error_type === "DISPOSITIVO_SEM_LACRE");
    const alertaSemLacre = await alerta("BATERIA_BAIXA", "Bateria de dispositivo sem lacre", semVinculo.dispositivo.chave, semVinculo.dispositivo.codigo);
    r.conferir("Alerta de dispositivo sem lacre", "201 na Oxide", String(alertaSemLacre.status), alertaSemLacre.status === 201);

    const fila = await api("GET", "/sync/status");
    r.painel("Fila da Oxide antes do envio (GET /api/v1/sync/status)", (fila.json?.filas ?? []).map((f: any) =>
      `${f.queue.padEnd(10)} pendentes=${f.pendentes} aguardando=${f.aguardando} nova_tentativa=${f.nova_tentativa} parados=${f.parados} sincronizados=${f.sincronizados}`));

    const foraDoAr = createFluxidPool("postgres://x:x@127.0.0.1:54398/x");
    const cicloOff = await runCycle(foraDoAr, { batchSize: 500, withCadastro: false });
    await foraDoAr.end();
    const intacta = oxide<{ n: number }>("SELECT count(*) AS n FROM telemetry_queue WHERE status = 'PENDING' AND attempt_count = 0");
    r.conferir("FluxID fora do ar", "rodada FALHOU, nada perdido, nenhuma tentativa gasta", `${cicloOff.status}; ${intacta?.n} telemetrias continuam PENDING com 0 tentativas`, cicloOff.status === "FALHOU" && (intacta?.n ?? 0) > 0);

    const envio = await worker(false);
    r.info(`Envio: ${JSON.stringify(envio.filas)}`);
    const tempo = oxide<{ n: number }>(`SELECT count(*) AS n FROM telemetry_queue WHERE device_id = ? AND status = 'SYNCED'`, p.dispositivo.codigo);
    r.conferir("Telemetrias do lacre enviadas", "todas SYNCED", `${tempo?.n} SYNCED`, (tempo?.n ?? 0) >= 9);
    const naoCadastrado = oxide<{ status: string; last_error: string; next_attempt_at: string | null }>(
      "SELECT status, last_error, next_attempt_at FROM telemetry_queue WHERE device_id = ?", `DSP-L${rodada}`);
    r.conferir("Telemetria de dispositivo fora do FluxID", "ERROR com nova tentativa", `${naoCadastrado?.status}: ${naoCadastrado?.last_error} (próxima ${naoCadastrado?.next_attempt_at})`,
      naoCadastrado?.status === "ERROR" && naoCadastrado?.next_attempt_at !== null);
    const aguardando = oxide<{ status: string; attempt_count: number; last_error: string }>(
      "SELECT status, attempt_count, last_error FROM events WHERE device_id = ?", semVinculo.dispositivo.codigo);
    r.conferir("Evento do lacre sem vínculo (P3)", "esperando, sem gastar tentativa", `${aguardando?.status}, tentativas=${aguardando?.attempt_count}: ${aguardando?.last_error}`,
      aguardando?.status === "PENDING" && aguardando?.attempt_count === 0);
    const parado = oxide<{ sync_status: string; sync_last_error: string }>(
      "SELECT sync_status, sync_last_error FROM alerts WHERE device_id = ?", semVinculo.dispositivo.codigo);
    r.conferir("Alerta sem lacre na data", "parado para o gestor", `${parado?.sync_status}: ${parado?.sync_last_error}`, parado?.sync_status === "ERROR");

    const qtdAntes = await umValor<{ n: string }>("SELECT count(*)::text AS n FROM telemetrias WHERE dispositivo_id = $1", [p.dispositivo.id]);
    db.prepare("UPDATE telemetry_queue SET status = 'PENDING' WHERE device_id = ?").run(p.dispositivo.codigo);
    await worker(false);
    const qtdDepois = await umValor<{ n: string }>("SELECT count(*)::text AS n FROM telemetrias WHERE dispositivo_id = $1", [p.dispositivo.id]);
    r.conferir("Reenvio de tudo de novo", "nada duplicado no FluxID", `${qtdAntes?.n} → ${qtdDepois?.n} telemetrias`, qtdAntes?.n === qtdDepois?.n);
    const reenviar = await api("POST", "/sync/retry", { queue: "telemetry", key: naoCadastrado ? oxide<{ message_id: string }>("SELECT message_id FROM telemetry_queue WHERE device_id = ?", `DSP-L${rodada}`).message_id : "" });
    r.conferir("Gestor manda tentar de novo (POST /sync/retry)", "200", String(reenviar.status), reenviar.status === 200);

    // ------------------------------------------------------------------ 11
    r.etapa("11. Gestor trata o alerta de violação pela API do frontend (D5)");
    const idViolacao = aViolacao.json?.alert?.alert_id as string;
    const analise = await app("manage-alerts", { operation: "analyze", organization_id: orgId, alert_id: idViolacao });
    const fecha = await app("manage-alerts", { operation: "close", organization_id: orgId, alert_id: idViolacao, resolution_note: "Lacre substituído e cilindro conferido no cliente" });
    const fechado = await umValor<{ status: string; encerrado_por_nome: string; tratado_no_fluxid: boolean }>(
      "SELECT status, encerrado_por_nome, tratado_no_fluxid FROM alertas WHERE codigo = $1", [idViolacao]);
    r.conferir("Encerramento no FluxID com o nome de quem encerrou", "EM_ANALISE, depois ENCERRADO",
      `${analise.json?.alert?.status}, ${fechado?.status} por ${fechado?.encerrado_por_nome}`,
      analise.json?.alert?.status === "EM_ANALISE" && fecha.json?.alert?.status === "ENCERRADO" && fechado?.tratado_no_fluxid === true);
    await worker(false);
    const naOxide = oxide<{ status: string }>("SELECT status FROM alerts WHERE alert_id = ?", idViolacao);
    r.conferir("Worker espelha o encerramento na Oxide", "ENCERRADO", naOxide?.status ?? "?", naOxide?.status === "ENCERRADO");
    const violacao2 = await app("manage-seals", { operation: "confirm_violation", organization_id: orgId, seal_id: p.lacre.id, decision: "confirm", justification: "Rompimento confirmado na vistoria" });
    r.conferir("Gestor confirma a violação (P8)", "SUSPEITA_VIOLACAO → ROMPIDO", `${violacao2.status} ${violacao2.json?.status ?? violacao2.json?.code}`, violacao2.json?.status === "ROMPIDO");

    // ------------------------------------------------------------------ 12
    r.etapa("12. O que ficou nos dois bancos (visualização dos erros)");
    const lacreFinal = await umValor<{ status: string }>("SELECT status FROM lacres WHERE id = $1", [p.lacre.id]);
    r.conferir("Estado do lacre no FluxID (P8)", "ROMPIDO (confirmado pelo gestor)", lacreFinal?.status ?? "?", lacreFinal?.status === "ROMPIDO");
    const alertasFluxid = await linhas(
      "SELECT tipo, severidade, status FROM alertas WHERE dispositivo_id = $1 ORDER BY aberto_em, codigo", [p.dispositivo.id]);
    r.conferir("Alertas do lacre no FluxID", `${restantes.length + 9} alertas com lacre e cilindro`, `${alertasFluxid.length} alertas`, alertasFluxid.length === restantes.length + 9);

    const mapa = await linhas(`
      SELECT c.codigo AS cilindro, l.codigo AS lacre, t.latitude, t.longitude, t.data_coleta,
             (SELECT a.severidade FROM alertas a WHERE a.cilindro_id = c.id AND a.status <> 'ENCERRADO'
              ORDER BY CASE a.severidade WHEN 'CRITICA' THEN 1 WHEN 'ALTA' THEN 2 WHEN 'MEDIA' THEN 3 ELSE 4 END LIMIT 1) AS cor,
             (SELECT count(*) FROM telemetrias_quarentena q WHERE q.cilindro_id = c.id) AS sem_gps
      FROM cilindros c
      JOIN vinculos_cilindro_lacre v ON v.cilindro_id = c.id AND v.data_fim IS NULL
      JOIN lacres l ON l.id = v.lacre_id
      LEFT JOIN LATERAL (SELECT * FROM telemetrias t WHERE t.cilindro_id = c.id ORDER BY t.data_coleta DESC, t.criado_em DESC LIMIT 1) t ON true
      WHERE c.id = $1`, [p.cilindro.id]);
    r.painel("Mapa: onde está o cilindro do lacre (FluxID)", mapa.map(m =>
      `${m.cilindro} / ${m.lacre}: última posição ${m.latitude}, ${m.longitude} (${new Date(m.data_coleta).toISOString()}); cor do ponto = ${m.cor ?? "sem alerta aberto"}; leituras sem GPS = ${m.sem_gps}`));

    r.painel("Alertas do lacre no FluxID (tipo, severidade, status)", alertasFluxid.map(a => `${a.tipo.padEnd(30)} ${a.severidade.padEnd(8)} ${a.status}`));
    const eventos = await linhas(`
      SELECT 'lacre' AS onde, tipo, codigo_erro FROM eventos_lacre WHERE dispositivo_id = $1
      UNION ALL SELECT 'dispositivo', tipo, codigo_erro FROM eventos_dispositivo WHERE dispositivo_id = $1`, [p.dispositivo.id]);
    r.painel("Eventos no FluxID", eventos.map(e => `${e.onde.padEnd(12)} ${e.tipo.padEnd(25)} ${e.codigo_erro ?? ""}`));
    const quarentena = await linhas("SELECT message_id, motivo, recebido_em FROM telemetrias_quarentena WHERE dispositivo_id = $1", [p.dispositivo.id]);
    r.painel("Quarentena: leituras sem GPS (FluxID)", quarentena.map(q => `${q.message_id} ${q.motivo}`));
    const historico = await linhas(
      "SELECT sequencia, tipo_evento, origem, coalesce(justificativa, '') AS justificativa FROM historico_cilindro WHERE cilindro_id = $1 ORDER BY sequencia", [p.cilindro.id]);
    r.painel(`Histórico do cilindro ${p.cilindro.codigo} (FluxID)`, historico.map(h => `${String(h.sequencia).padStart(2)} ${h.tipo_evento.padEnd(22)} ${h.origem.padEnd(8)} ${h.justificativa}`));
    const problemas: string[] = [];
    for (const fila of ["telemetry", "events", "alerts"]) {
      const res = await api("GET", `/sync/problems?queue=${fila}`);
      for (const item of res.json?.itens ?? []) {
        if (String(item.device_id).includes(rodada)) problemas.push(`${fila.padEnd(9)} ${item.chave} ${item.situacao}: ${item.erro}`);
      }
    }
    r.painel("Erros da sincronização vistos pelo gestor (GET /api/v1/sync/problems)", problemas);
    const rodadas = db.prepare("SELECT id, status FROM sync_logs ORDER BY id").all() as Array<{ id: number; status: string }>;
    r.painel("Rodadas do Worker (sync_logs na Oxide)", rodadas.map(s => `#${s.id} ${s.status}`));

    const tabelasOxide = oxide<{ t: number; e: number; a: number }>(
      "SELECT (SELECT count(*) FROM telemetry_queue) AS t, (SELECT count(*) FROM events) AS e, (SELECT count(*) FROM alerts) AS a");
    r.painel("Banco Oxide da simulação (oxide.db)", [
      `telemetry_queue: ${tabelasOxide.t} linhas`, `events: ${tabelasOxide.e} linhas`, `alerts: ${tabelasOxide.a} linhas`,
      `arquivo: ${path.join(ambiente.pasta, "oxide.db")}`
    ]);
  } catch (erro) {
    r.conferir("Execução da simulação", "sem exceção", (erro as Error).stack ?? String(erro), false);
  } finally {
    await fluxid.end().catch(() => undefined);
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  const relatorio = path.join(ambiente.pasta, `relatorio-simulacao-${rodada}.md`);
  fs.writeFileSync(relatorio, r.markdown([
    `**Rodada:** ${rodada}  `,
    `**Data/hora:** ${new Date().toISOString()}  `,
    `**Banco Oxide:** cópia nova em \`${ambiente.pasta}\` (o oxide.db do projeto não foi tocado)  `,
    "**Banco FluxID:** FluxID de análise no Docker (o banco principal não foi tocado)  ",
    "**Como foi feito:** empresa, pessoa e cadastro em massa foram preparados direto no FluxID; rota, saída, entrega, tratamento do alerta e confirmação da violação foram feitos pela API do frontend (`/api/v1/app`). SAIDA_ROTA, SAIDA_GEOCERCA e LACRE_ABERTO_EM_TRANSITO foram detectados automaticamente pelo servidor (não enviados pelo lacre)."
  ]), "utf8");

  console.log(`\nResultado: ${r.verificacoes.length - r.falhas} de ${r.verificacoes.length} verificações conforme; ${r.falhas} falha(s).`);
  console.log(`Relatório: ${relatorio}`);
  return r.falhas === 0 ? 0 : 1;
}
