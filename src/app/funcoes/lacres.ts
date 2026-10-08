import { randomBytes } from "crypto";
import { Pool, PoolClient } from "pg";
import db from "../../database/connection";
import { commandTypes, CommandType } from "../../models/Command";
import { criarComando } from "../../regras/alertasAutomaticos";
import { hashApiKey } from "../../utils/apiKeyHash";
import {
  Contexto, ErroDeRegra, Resposta, auditar, ehData, ehTexto, ehUuid, falha, invalido, justificativaValida, lerCursor,
  limiteDe, naoEncontrado, negado, ok, proximoCodigo, proximoCursor, transacao, violacaoUnica
} from "../base";

// Telas novas ligadas à Oxide (Contrato seção 7): visão geral, mapa,
// alertas, lacres e dispositivos, telemetria e comandos

type Linha = Record<string, any>;
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function exige(ctx: Contexto, permissao: string): void {
  if (!ctx.permissoes.has(permissao)) throw new ErroDeRegra(negado());
}

function periodo(corpo: Linha, campos: Array<{ field: string; message: string }>): { de: string | null; ate: string | null } {
  for (const campo of ["from", "to"]) {
    if (corpo[campo] !== undefined && (typeof corpo[campo] !== "string" || Number.isNaN(Date.parse(corpo[campo])))) {
      campos.push({ field: campo, message: "Data inválida (ISO 8601)." });
    }
  }
  return { de: corpo.from ?? null, ate: corpo.to ?? null };
}

const SEVERIDADE_ORDEM = "CASE a.severidade WHEN 'CRITICA' THEN 4 WHEN 'ALTA' THEN 3 WHEN 'MEDIA' THEN 2 ELSE 1 END";

// ------------------------------------------------------------------- mapa

async function pontosDoMapa(banco: Pool, org: string, corpo: Linha): Promise<Linha[]> {
  const valores: unknown[] = [org];
  const filtros = ["c.organizacao_id = $1", "t.data_coleta IS NOT NULL"];
  if (Array.isArray(corpo.bbox) && corpo.bbox.length === 4 && corpo.bbox.every((n: unknown) => typeof n === "number")) {
    const [minLon, minLat, maxLon, maxLat] = corpo.bbox as number[];
    valores.push(minLon, minLat, maxLon, maxLat);
    filtros.push(`t.longitude BETWEEN $2 AND $4 AND t.latitude BETWEEN $3 AND $5`);
  }
  if (corpo.alert_only === true) filtros.push("a.codigo IS NOT NULL");

  const linhas = await banco.query(`
    SELECT c.id, c.codigo, c.numero_serie, c.status, l.id AS lacre_id, l.codigo AS lacre, l.status AS lacre_status,
           d.id AS dispositivo_id, d.codigo AS dispositivo, t.latitude, t.longitude, t.data_coleta, t.bateria_percentual,
           q.recebido_em AS sem_gps_em, a.codigo AS alerta, a.tipo AS alerta_tipo, a.severidade AS alerta_severidade
    FROM public.cilindros c
    LEFT JOIN public.vinculos_cilindro_lacre v ON v.cilindro_id = c.id AND v.data_fim IS NULL
    LEFT JOIN public.lacres l ON l.id = v.lacre_id
    LEFT JOIN public.vinculos_dispositivo_lacre vd ON vd.lacre_id = l.id AND vd.data_fim IS NULL
    LEFT JOIN public.dispositivos d ON d.id = vd.dispositivo_id
    LEFT JOIN LATERAL (SELECT latitude, longitude, data_coleta, bateria_percentual FROM public.telemetrias
                       WHERE cilindro_id = c.id ORDER BY data_coleta DESC LIMIT 1) t ON true
    LEFT JOIN LATERAL (SELECT recebido_em FROM public.telemetrias_quarentena
                       WHERE cilindro_id = c.id ORDER BY recebido_em DESC LIMIT 1) q ON true
    LEFT JOIN LATERAL (SELECT a.codigo, a.tipo, a.severidade FROM public.alertas a
                       WHERE a.cilindro_id = c.id AND a.status <> 'ENCERRADO'
                       ORDER BY ${SEVERIDADE_ORDEM} DESC, a.aberto_em DESC LIMIT 1) a ON true
    WHERE ${filtros.join(" AND ")}
    ORDER BY c.codigo LIMIT 2000`, valores);

  return linhas.rows.map(p => ({
    cylinder: { id: p.id, code: p.codigo, serial_number: p.numero_serie, status: p.status },
    seal: p.lacre ? { id: p.lacre_id, code: p.lacre, status: p.lacre_status } : null,
    device: p.dispositivo ? { id: p.dispositivo_id, code: p.dispositivo } : null,
    position: { latitude: Number(p.latitude), longitude: Number(p.longitude), at: iso(p.data_coleta) },
    battery_percent: p.bateria_percentual === null ? null : Number(p.bateria_percentual),
    // Decisão P2: sem GPS, o ponto fica na última posição conhecida
    gps: p.sem_gps_em && p.sem_gps_em > p.data_coleta ? "no_signal" : "ok",
    alert: p.alerta ? { code: p.alerta, type: p.alerta_tipo, severity: p.alerta_severidade } : null
  }));
}

export async function queryMap(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  exige(ctx, "map.read");
  return ok("LISTED", { points: await pontosDoMapa(banco, ctx.organizacaoId!, corpo) });
}

// ----------------------------------------------------------- visão geral

export async function queryOverview(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  exige(ctx, "cylinder.read");
  const org = ctx.organizacaoId!;
  const bloco = corpo.block;
  const dias = Number.isInteger(corpo.days) && corpo.days >= 1 && corpo.days <= 90 ? corpo.days : 14;

  switch (bloco) {
    case "indicators": {
      const r = (await banco.query(`
        SELECT count(*) FILTER (WHERE status <> 'INATIVO')::int AS total,
               count(*) FILTER (WHERE status = 'EM_TRANSITO')::int AS em_transito,
               count(*) FILTER (WHERE status = 'COM_CLIENTE')::int AS com_cliente,
               count(*) FILTER (WHERE situacao_estoque = 'EM_ESTOQUE')::int AS em_estoque,
               (SELECT count(*) FROM public.alertas WHERE organizacao_id = $1 AND status <> 'ENCERRADO')::int AS alertas_abertos
        FROM public.cilindros WHERE organizacao_id = $1`, [org])).rows[0]!;
      if (r.total === 0 && r.alertas_abertos === 0) return ok("EMPTY");
      return ok("READY", { data: {
        cylinders_total: r.total, in_transit: r.em_transito, with_customer: r.com_cliente, in_stock: r.em_estoque, open_alerts: r.alertas_abertos
      } });
    }
    case "map": {
      if (!ctx.permissoes.has("map.read")) throw new ErroDeRegra(negado());
      const pontos = await pontosDoMapa(banco, org, corpo);
      return pontos.length ? ok("READY", { data: { points: pontos } }) : ok("EMPTY");
    }
    case "movement": {
      // D6: movimentação = entregas por dia (concluídas e iniciadas)
      const r = await banco.query(`
        SELECT d::date AS dia,
               (SELECT count(*) FROM public.entregas e WHERE e.organizacao_id = $1 AND e.data_saida::date = d::date)::int AS saidas,
               (SELECT count(*) FROM public.entregas e WHERE e.organizacao_id = $1 AND e.data_entrega::date = d::date)::int AS entregas
        FROM generate_series(current_date - ($2::int - 1), current_date, interval '1 day') d ORDER BY d`, [org, dias]);
      const serie = r.rows.map(l => ({ day: (l.dia as Date).toISOString().slice(0, 10), departures: l.saidas, deliveries: l.entregas }));
      return serie.some(s => s.departures || s.deliveries) ? ok("READY", { data: { series: serie } }) : ok("EMPTY");
    }
    case "situation": {
      const r = await banco.query(
        "SELECT status, count(*)::int AS n FROM public.cilindros WHERE organizacao_id = $1 GROUP BY status ORDER BY status", [org]);
      return r.rows.length ? ok("READY", { data: { by_status: r.rows.map(l => ({ status: l.status, count: l.n })) } }) : ok("EMPTY");
    }
    case "recent_alerts": {
      const r = await banco.query(`
        SELECT a.codigo, a.tipo, a.severidade, a.status, a.titulo, a.aberto_em, c.codigo AS cilindro
        FROM public.alertas a LEFT JOIN public.cilindros c ON c.id = a.cilindro_id
        WHERE a.organizacao_id = $1 ORDER BY a.aberto_em DESC LIMIT 5`, [org]);
      return r.rows.length ? ok("READY", { data: { alerts: r.rows.map(a => ({
        code: a.codigo, type: a.tipo, severity: a.severidade, status: a.status, title: a.titulo, opened_at: iso(a.aberto_em), cylinder_code: a.cilindro
      })) } }) : ok("EMPTY");
    }
    case "recent_cylinders": {
      const r = await banco.query(`
        SELECT id, codigo, numero_serie, status, criado_em FROM public.cilindros WHERE organizacao_id = $1 ORDER BY criado_em DESC LIMIT 5`, [org]);
      return r.rows.length ? ok("READY", { data: { cylinders: r.rows.map(c => ({
        id: c.id, code: c.codigo, serial_number: c.numero_serie, status: c.status, created_at: iso(c.criado_em)
      })) } }) : ok("EMPTY");
    }
    case "performance": {
      // D6: % com GPS em dia (posição nas últimas 24 h, entre os que têm
      // lacre), % de alertas encerrados em até 24 h (30 dias) e % de
      // testes hidrostáticos em dia
      const r = (await banco.query(`
        WITH lacrados AS (
          SELECT c.id FROM public.cilindros c
          JOIN public.vinculos_cilindro_lacre v ON v.cilindro_id = c.id AND v.data_fim IS NULL
          WHERE c.organizacao_id = $1),
        gps AS (
          SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.telemetrias t WHERE t.cilindro_id = l.id AND t.data_coleta > now() - interval '24 hours'))::numeric AS em_dia,
                 count(*)::numeric AS total FROM lacrados l),
        al AS (
          SELECT count(*) FILTER (WHERE status = 'ENCERRADO' AND encerrado_em - aberto_em <= interval '24 hours')::numeric AS no_prazo,
                 count(*)::numeric AS total
          FROM public.alertas WHERE organizacao_id = $1 AND aberto_em > now() - interval '30 days'),
        th AS (
          SELECT count(*) FILTER (WHERE ht.proximo_teste >= current_date AND ht.resultado = 'APROVADO')::numeric AS em_dia, count(*)::numeric AS total
          FROM public.cilindros c
          LEFT JOIN LATERAL (SELECT resultado, proximo_teste FROM public.testes_hidrostaticos t WHERE t.cilindro_id = c.id
                             AND NOT EXISTS (SELECT 1 FROM public.testes_hidrostaticos r WHERE r.retifica_teste_id = t.id)
                             ORDER BY data_teste DESC LIMIT 1) ht ON true
          WHERE c.organizacao_id = $1 AND c.status <> 'INATIVO')
        SELECT gps.em_dia AS g1, gps.total AS g2, al.no_prazo AS a1, al.total AS a2, th.em_dia AS t1, th.total AS t2 FROM gps, al, th`, [org])).rows[0]!;
      const pct = (a: string, b: string): number | null => (Number(b) > 0 ? Math.round(Number(a) * 1000 / Number(b)) / 10 : null);
      return ok("READY", { data: { measures: [
        { key: "gps_up_to_date", label: "Cilindros com GPS em dia (24 h)", percent: pct(r.g1, r.g2) },
        { key: "alerts_closed_on_time", label: "Alertas encerrados em até 24 h (30 dias)", percent: pct(r.a1, r.a2) },
        { key: "hydro_up_to_date", label: "Testes hidrostáticos em dia", percent: pct(r.t1, r.t2) }
      ] } });
    }
    default:
      return invalido([{ field: "block", message: "Use indicators, map, movement, situation, recent_alerts, recent_cylinders ou performance." }]);
  }
}

// --------------------------------------------------------------- alertas

const ALERTA_SQL = `
  SELECT a.*, c.codigo AS cilindro, c.numero_serie, l.codigo AS lacre, l.status AS lacre_status, d.codigo AS dispositivo,
         u.nome AS justificado_por_nome
  FROM public.alertas a
  LEFT JOIN public.cilindros c ON c.id = a.cilindro_id
  LEFT JOIN public.lacres l ON l.id = a.lacre_id
  LEFT JOIN public.dispositivos d ON d.id = a.dispositivo_id
  LEFT JOIN public.usuarios u ON u.id = a.justificado_por`;

function alertaJson(a: Linha) {
  return {
    id: a.id, code: a.codigo, type: a.tipo, severity: a.severidade, status: a.status, title: a.titulo, description: a.descricao,
    opened_at: iso(a.aberto_em), closed_at: iso(a.encerrado_em), closed_by: a.encerrado_por_nome, resolution_note: a.motivo_encerramento,
    justification: a.justificativa, justified_by: a.justificado_por_nome, justified_at: iso(a.justificado_em),
    handled_in_fluxid: a.tratado_no_fluxid,
    cylinder: a.cilindro_id ? { id: a.cilindro_id, code: a.cilindro, serial_number: a.numero_serie } : null,
    seal: a.lacre_id ? { id: a.lacre_id, code: a.lacre, status: a.lacre_status } : null,
    device: a.dispositivo_id ? { id: a.dispositivo_id, code: a.dispositivo } : null
  };
}

async function alertaDaOrg(banco: Pool | PoolClient, org: string, id: unknown, bloquear = false): Promise<Linha | null> {
  if (!ehTexto(id)) return null;
  const coluna = ehUuid(id) ? "a.id" : "a.codigo";
  return (await banco.query(`${ALERTA_SQL} WHERE ${coluna} = $1 AND a.organizacao_id = $2 ${bloquear ? "FOR UPDATE OF a" : ""}`, [id, org])).rows[0] ?? null;
}

export async function queryAlerts(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  exige(ctx, "alert.read");
  const org = ctx.organizacaoId!;
  if (corpo.operation === "get") {
    const a = await alertaDaOrg(banco, org, corpo.alert_id);
    if (!a) return naoEncontrado();
    // Posição do lacre no momento mais próximo do alarme
    const pos = a.cilindro_id ? (await banco.query(`
      SELECT latitude, longitude, data_coleta FROM public.telemetrias WHERE cilindro_id = $1
      ORDER BY abs(extract(epoch FROM data_coleta - $2::timestamptz)) LIMIT 1`, [a.cilindro_id, a.aberto_em])).rows[0] : null;
    return ok("FOUND", {
      alert: alertaJson(a),
      position: pos ? { latitude: Number(pos.latitude), longitude: Number(pos.longitude), at: iso(pos.data_coleta) } : null
    });
  }
  if (corpo.operation !== undefined && corpo.operation !== "list") return invalido([{ field: "operation", message: "Use list ou get." }]);

  const campos: Array<{ field: string; message: string }> = [];
  const filtros = ["a.organizacao_id = $1"];
  const valores: unknown[] = [org];
  const listas: Array<[string, string, string[]]> = [
    ["status", "a.status", ["ABERTO", "EM_ANALISE", "ENCERRADO"]],
    ["severity", "a.severidade", ["BAIXA", "MEDIA", "ALTA", "CRITICA"]]
  ];
  for (const [campo, coluna, aceitos] of listas) {
    if (corpo[campo] === undefined) continue;
    const lista = Array.isArray(corpo[campo]) ? corpo[campo] : [corpo[campo]];
    if (!lista.every((v: unknown) => aceitos.includes(v as string))) campos.push({ field: campo, message: `Use ${aceitos.join(", ")}.` });
    valores.push(lista);
    filtros.push(`${coluna} = ANY($${valores.length})`);
  }
  if (corpo.type !== undefined) {
    if (!ehTexto(corpo.type)) campos.push({ field: "type", message: "Tipo inválido." });
    valores.push(corpo.type);
    filtros.push(`a.tipo = $${valores.length}`);
  }
  if (corpo.cylinder_id !== undefined) {
    if (!ehUuid(corpo.cylinder_id)) campos.push({ field: "cylinder_id", message: "Cilindro inválido." });
    valores.push(corpo.cylinder_id);
    filtros.push(`a.cilindro_id = $${valores.length}`);
  }
  const { de, ate } = periodo(corpo, campos);
  if (de) { valores.push(de); filtros.push(`a.aberto_em >= $${valores.length}`); }
  if (ate) { valores.push(ate); filtros.push(`a.aberto_em <= $${valores.length}`); }
  if (campos.length) return invalido(campos);

  const limite = limiteDe(corpo.limit);
  const inicio = lerCursor(corpo.cursor);
  const total = await banco.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.alertas a WHERE ${filtros.join(" AND ")}`, valores);
  const linhas = await banco.query(`${ALERTA_SQL} WHERE ${filtros.join(" AND ")}
    ORDER BY (a.status = 'ENCERRADO'), ${SEVERIDADE_ORDEM} DESC, a.aberto_em DESC LIMIT ${limite + 1} OFFSET ${inicio}`, valores);
  return ok("LISTED", { items: linhas.rows.slice(0, limite).map(alertaJson), total: total.rows[0]!.n, next: proximoCursor(inicio, linhas.rows.length, limite) });
}

// D5: tratado aqui, o alerta fica marcado (tratado_no_fluxid) e a Oxide não
// o sobrescreve mais; o Worker espelha o novo estado na Oxide
export async function manageAlerts(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  const org = ctx.organizacaoId!;
  const ator = { usuarioId: ctx.usuarioId, organizacaoId: org };
  switch (corpo.operation) {
    case "analyze":
      exige(ctx, "alert.close");
      return transacao(banco, ctx, async client => {
        const a = await alertaDaOrg(client, org, corpo.alert_id, true);
        if (!a) return naoEncontrado();
        if (a.status !== "ABERTO") return falha(409, "INVALID_TRANSITION", { current_status: a.status });
        await client.query("UPDATE public.alertas SET status = 'EM_ANALISE', tratado_no_fluxid = true WHERE id = $1", [a.id]);
        await auditar(client, ator, org, "alertas", a.id, "UPDATE", "alert.analyze");
        return ok("UPDATED", { alert: alertaJson({ ...a, status: "EM_ANALISE", tratado_no_fluxid: true }) });
      });
    case "close":
      exige(ctx, "alert.close");
      if (!justificativaValida(corpo.resolution_note)) {
        return invalido([{ field: "resolution_note", message: "Descreva a resolução (5 a 500 caracteres)." }]);
      }
      return transacao(banco, ctx, async client => {
        const a = await alertaDaOrg(client, org, corpo.alert_id, true);
        if (!a) return naoEncontrado();
        if (a.status === "ENCERRADO") return falha(409, "INVALID_TRANSITION", { current_status: a.status });
        const r = await client.query(`
          UPDATE public.alertas SET status = 'ENCERRADO', encerrado_em = now(), encerrado_por = $2, encerrado_por_nome = $3,
            motivo_encerramento = $4, tratado_no_fluxid = true WHERE id = $1 RETURNING encerrado_em`,
          [a.id, ctx.usuarioId, ctx.nome, corpo.resolution_note.trim()]);
        await auditar(client, ator, org, "alertas", a.id, "UPDATE", "alert.close");
        return ok("UPDATED", { alert: alertaJson({
          ...a, status: "ENCERRADO", encerrado_em: r.rows[0]!.encerrado_em, encerrado_por_nome: ctx.nome,
          motivo_encerramento: corpo.resolution_note.trim(), tratado_no_fluxid: true
        }) });
      });
    case "justify":
      // Motorista (ou operador) explica o alerta; só o gestor encerra
      exige(ctx, "alert.justify");
      if (!justificativaValida(corpo.justification)) return falha(400, "JUSTIFICATION_REQUIRED");
      return transacao(banco, ctx, async client => {
        const a = await alertaDaOrg(client, org, corpo.alert_id, true);
        if (!a) return naoEncontrado();
        if (a.status === "ENCERRADO") return falha(409, "INVALID_TRANSITION", { current_status: a.status });
        await client.query(`
          UPDATE public.alertas SET justificativa = $2, justificado_por = $3, justificado_em = now(), tratado_no_fluxid = true
          WHERE id = $1`, [a.id, corpo.justification.trim(), ctx.usuarioId]);
        await auditar(client, ator, org, "alertas", a.id, "UPDATE", "alert.justify");
        return ok("JUSTIFIED");
      });
    default:
      return invalido([{ field: "operation", message: "Use analyze, close ou justify." }]);
  }
}

// ----------------------------------------------------- lacres e dispositivos

export async function querySeals(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  exige(ctx, "seal.read");
  const org = ctx.organizacaoId!;
  const base = `
    SELECT l.*, d.id AS dispositivo_id, d.codigo AS dispositivo, vd.id AS vinculo_dispositivo,
           c.id AS cilindro_id, c.codigo AS cilindro, vc.id AS vinculo_cilindro,
           (SELECT row_to_json(i) FROM (SELECT data_inspecao, resultado, proxima_revisao FROM public.inspecoes_lacre
             WHERE lacre_id = l.id ORDER BY data_inspecao DESC, criado_em DESC LIMIT 1) i) AS inspecao
    FROM public.lacres l
    LEFT JOIN public.vinculos_dispositivo_lacre vd ON vd.lacre_id = l.id AND vd.data_fim IS NULL
    LEFT JOIN public.dispositivos d ON d.id = vd.dispositivo_id
    LEFT JOIN public.vinculos_cilindro_lacre vc ON vc.lacre_id = l.id AND vc.data_fim IS NULL
    LEFT JOIN public.cilindros c ON c.id = vc.cilindro_id
    WHERE l.organizacao_id = $1`;
  const json = (l: Linha) => ({
    id: l.id, code: l.codigo, nfc_uid: l.uid_nfc, status: l.status, manufactured_on: l.data_fabricacao.toISOString().slice(0, 10),
    next_review_on: l.proxima_revisao.toISOString().slice(0, 10), review_overdue: l.proxima_revisao < new Date(),
    device: l.dispositivo ? { id: l.dispositivo_id, code: l.dispositivo, binding_id: l.vinculo_dispositivo } : null,
    cylinder: l.cilindro ? { id: l.cilindro_id, code: l.cilindro, binding_id: l.vinculo_cilindro } : null,
    last_inspection: l.inspecao, notes: l.observacao
  });

  switch (corpo.operation ?? "list") {
    case "list": {
      const valores: unknown[] = [org];
      let filtro = "";
      if (ehTexto(corpo.status)) { valores.push(corpo.status); filtro += ` AND l.status = $${valores.length}`; }
      if (ehTexto(corpo.search)) { valores.push(`%${corpo.search.trim().toUpperCase()}%`); filtro += ` AND (upper(l.codigo) LIKE $${valores.length} OR upper(l.uid_nfc) LIKE $${valores.length})`; }
      const limite = limiteDe(corpo.limit);
      const inicio = lerCursor(corpo.cursor);
      const linhas = await banco.query(`${base}${filtro} ORDER BY l.codigo LIMIT ${limite + 1} OFFSET ${inicio}`, valores);
      return ok("LISTED", { items: linhas.rows.slice(0, limite).map(json), next: proximoCursor(inicio, linhas.rows.length, limite) });
    }
    case "get": {
      if (!ehUuid(corpo.seal_id)) return naoEncontrado();
      const l = (await banco.query(`${base} AND l.id = $2`, [org, corpo.seal_id])).rows[0];
      if (!l) return naoEncontrado();
      const historico = await banco.query(`
        SELECT 'device' AS tipo, v.id, d.codigo AS alvo, v.data_inicio, v.data_fim, v.motivo_encerramento
        FROM public.vinculos_dispositivo_lacre v JOIN public.dispositivos d ON d.id = v.dispositivo_id WHERE v.lacre_id = $1
        UNION ALL
        SELECT 'cylinder', v.id, c.codigo, v.data_inicio, v.data_fim, v.motivo_encerramento
        FROM public.vinculos_cilindro_lacre v JOIN public.cilindros c ON c.id = v.cilindro_id WHERE v.lacre_id = $1
        ORDER BY data_inicio DESC`, [l.id]);
      return ok("FOUND", { seal: json(l), bindings: historico.rows.map(b => ({
        kind: b.tipo, id: b.id, target_code: b.alvo, started_at: iso(b.data_inicio), ended_at: iso(b.data_fim), end_reason: b.motivo_encerramento
      })) });
    }
    case "devices": {
      const linhas = await banco.query(`
        SELECT d.id, d.codigo, d.identificador_hardware, d.versao_firmware, d.modelo, d.ativo, (d.api_key_hash IS NOT NULL) AS tem_chave,
               l.id AS lacre_id, l.codigo AS lacre
        FROM public.dispositivos d
        LEFT JOIN public.vinculos_dispositivo_lacre v ON v.dispositivo_id = d.id AND v.data_fim IS NULL
        LEFT JOIN public.lacres l ON l.id = v.lacre_id
        WHERE d.organizacao_id = $1 ORDER BY d.codigo`, [org]);
      // Situação de comunicação vem da Oxide (último contato)
      const contato = db.prepare("SELECT device_id, last_contact_at, last_position_at FROM devices").all() as Array<{ device_id: string; last_contact_at: string | null; last_position_at: string | null }>;
      const porCodigo = new Map(contato.map(c => [c.device_id, c]));
      return ok("LISTED", { items: linhas.rows.map(d => ({
        id: d.id, code: d.codigo, hardware_id: d.identificador_hardware, firmware_version: d.versao_firmware, model: d.modelo,
        active: d.ativo, has_key: d.tem_chave, seal: d.lacre ? { id: d.lacre_id, code: d.lacre } : null,
        synced_to_oxide: porCodigo.has(d.codigo),
        last_contact_at: porCodigo.get(d.codigo)?.last_contact_at ?? null, last_position_at: porCodigo.get(d.codigo)?.last_position_at ?? null
      })) });
    }
    default:
      return invalido([{ field: "operation", message: "Use list, get ou devices." }]);
  }
}

const novaChave = (): string => randomBytes(24).toString("hex");

async function lacreDaOrg(client: PoolClient, org: string, id: unknown): Promise<Linha> {
  if (!ehUuid(id)) throw new ErroDeRegra(naoEncontrado());
  const l = (await client.query("SELECT * FROM public.lacres WHERE id = $1 AND organizacao_id = $2 FOR UPDATE", [id, org])).rows[0];
  if (!l) throw new ErroDeRegra(naoEncontrado());
  return l;
}

export async function manageSeals(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  exige(ctx, "seal.write");
  const org = ctx.organizacaoId!;
  const ator = { usuarioId: ctx.usuarioId, organizacaoId: org };
  const campos: Array<{ field: string; message: string }> = [];
  const replace = corpo.replace === true;

  const resposta = await (async (): Promise<Resposta> => {
    switch (corpo.operation) {
      case "create_seal": {
        if (!ehTexto(corpo.nfc_uid) || corpo.nfc_uid.length > 50) campos.push({ field: "nfc_uid", message: "Informe o UID do NFC (até 50)." });
        if (!ehData(corpo.manufactured_on)) campos.push({ field: "manufactured_on", message: "Data AAAA-MM-DD." });
        if (!ehData(corpo.next_review_on)) campos.push({ field: "next_review_on", message: "Data AAAA-MM-DD." });
        if (corpo.code !== undefined && (!ehTexto(corpo.code) || corpo.code.length > 20)) campos.push({ field: "code", message: "Código até 20 caracteres." });
        if (campos.length) return invalido(campos);
        return transacao(banco, ctx, async client => {
          await client.query("SELECT pg_advisory_xact_lock(hashtext('fluxid.lacres.codigo'))");
          const codigo = corpo.code?.trim() ?? await proximoCodigo(client, "lacres", "LCR");
          const r = await client.query<{ id: string }>(`
            INSERT INTO public.lacres (organizacao_id, codigo, uid_nfc, data_fabricacao, proxima_revisao, status, observacao)
            VALUES ($1, $2, $3, $4, $5, 'EM_ESTOQUE', $6) RETURNING id`,
            [org, codigo, corpo.nfc_uid.trim(), corpo.manufactured_on, corpo.next_review_on, corpo.notes ?? null]);
          await auditar(client, ator, org, "lacres", r.rows[0]!.id, "INSERT", "seal.create");
          return ok("CREATED", { seal_id: r.rows[0]!.id, seal_code: codigo }, 201);
        });
      }
      case "create_device": {
        if (!ehTexto(corpo.hardware_id) || corpo.hardware_id.length > 100) campos.push({ field: "hardware_id", message: "Informe o identificador do hardware." });
        if (corpo.code !== undefined && (!ehTexto(corpo.code) || corpo.code.length > 20)) campos.push({ field: "code", message: "Código até 20 caracteres." });
        if (campos.length) return invalido(campos);
        const chave = novaChave();
        return transacao(banco, ctx, async client => {
          await client.query("SELECT pg_advisory_xact_lock(hashtext('fluxid.dispositivos.codigo'))");
          const codigo = corpo.code?.trim() ?? await proximoCodigo(client, "dispositivos", "DSP");
          const r = await client.query<{ id: string }>(`
            INSERT INTO public.dispositivos (organizacao_id, codigo, identificador_hardware, versao_firmware, modelo, ativo, api_key_hash)
            VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
            [org, codigo, corpo.hardware_id.trim(), corpo.firmware_version ?? null, corpo.model ?? null, hashApiKey(chave)]);
          await auditar(client, ator, org, "dispositivos", r.rows[0]!.id, "INSERT", "device.create");
          // A chave aparece só nesta resposta; o FluxID guarda o hash
          return ok("CREATED", { device_id: r.rows[0]!.id, device_code: codigo, api_key: chave }, 201);
        });
      }
      case "rotate_device_key": {
        if (!ehUuid(corpo.device_id)) return naoEncontrado();
        const chave = novaChave();
        return transacao(banco, ctx, async client => {
          const r = await client.query<{ id: string }>(`
            UPDATE public.dispositivos SET api_key_hash = $3, atualizado_em = now() WHERE id = $1 AND organizacao_id = $2 RETURNING id`,
            [corpo.device_id, org, hashApiKey(chave)]);
          if (!r.rows[0]) return naoEncontrado();
          await auditar(client, ator, org, "dispositivos", corpo.device_id, "UPDATE", "device.rotate_key");
          return ok("KEY_ROTATED", { device_id: corpo.device_id, api_key: chave });
        });
      }
      case "set_device_active": {
        if (!ehUuid(corpo.device_id)) return naoEncontrado();
        if (typeof corpo.active !== "boolean") return invalido([{ field: "active", message: "Use true ou false." }]);
        const r = await banco.query<{ id: string }>(
          "UPDATE public.dispositivos SET ativo = $3, atualizado_em = now() WHERE id = $1 AND organizacao_id = $2 RETURNING id",
          [corpo.device_id, org, corpo.active]);
        if (!r.rows[0]) return naoEncontrado();
        await auditar(banco, ator, org, "dispositivos", corpo.device_id, "UPDATE", corpo.active ? "device.activate" : "device.deactivate");
        return ok("UPDATED");
      }
      case "bind_device":
        return transacao(banco, ctx, async client => {
          const lacre = await lacreDaOrg(client, org, corpo.seal_id);
          if (!ehUuid(corpo.device_id)) return naoEncontrado();
          const disp = (await client.query("SELECT id, ativo FROM public.dispositivos WHERE id = $1 AND organizacao_id = $2", [corpo.device_id, org])).rows[0];
          if (!disp) return naoEncontrado();
          if (!disp.ativo) return falha(409, "DEVICE_INACTIVE");
          const ativos = await client.query<{ id: string }>(`
            SELECT id FROM public.vinculos_dispositivo_lacre WHERE data_fim IS NULL AND (lacre_id = $1 OR dispositivo_id = $2) FOR UPDATE`,
            [lacre.id, disp.id]);
          if (ativos.rows.length && !replace) return falha(409, "BINDING_CONFLICT", { active_binding_ids: ativos.rows.map(a => a.id) });
          await client.query(`
            UPDATE public.vinculos_dispositivo_lacre SET data_fim = now(), desvinculado_por = $2, motivo_encerramento = 'Substituído por novo vínculo'
            WHERE id = ANY($1)`, [ativos.rows.map(a => a.id), ctx.usuarioId]);
          const r = await client.query<{ id: string }>(`
            INSERT INTO public.vinculos_dispositivo_lacre (dispositivo_id, lacre_id, vinculado_por, data_inicio)
            VALUES ($1, $2, $3, now()) RETURNING id`, [disp.id, lacre.id, ctx.usuarioId]);
          await auditar(client, ator, org, "vinculos_dispositivo_lacre", r.rows[0]!.id, "INSERT", "seal.bind_device");
          return ok("BOUND", { binding_id: r.rows[0]!.id }, 201);
        });
      case "bind_cylinder":
        return transacao(banco, ctx, async client => {
          const lacre = await lacreDaOrg(client, org, corpo.seal_id);
          if (!ehUuid(corpo.cylinder_id)) return naoEncontrado();
          const cil = (await client.query("SELECT id, status FROM public.cilindros WHERE id = $1 AND organizacao_id = $2 FOR UPDATE", [corpo.cylinder_id, org])).rows[0];
          if (!cil) return naoEncontrado();
          if (cil.status === "INATIVO") return falha(409, "CYLINDER_INACTIVE");
          const ativos = await client.query<{ id: string; lacre_id: string }>(`
            SELECT id, lacre_id FROM public.vinculos_cilindro_lacre WHERE data_fim IS NULL AND (lacre_id = $1 OR cilindro_id = $2) FOR UPDATE`,
            [lacre.id, cil.id]);
          if (ativos.rows.length && !replace) return falha(409, "BINDING_CONFLICT", { active_binding_ids: ativos.rows.map(a => a.id) });
          if (!ativos.rows.some(a => a.lacre_id === lacre.id) && !["EM_ESTOQUE", "REMOVIDO"].includes(lacre.status)) {
            return falha(409, "SEAL_NOT_INSTALLABLE", { seal_status: lacre.status });
          }
          await client.query(`
            UPDATE public.vinculos_cilindro_lacre SET data_fim = now(), removido_por = $2, motivo_encerramento = 'Substituído por novo vínculo'
            WHERE id = ANY($1)`, [ativos.rows.map(a => a.id), ctx.usuarioId]);
          await client.query(`
            UPDATE public.lacres SET status = 'REMOVIDO', atualizado_em = now()
            WHERE id = ANY($1) AND id <> $2 AND status = 'INSTALADO'`, [ativos.rows.map(a => a.lacre_id), lacre.id]);
          const r = await client.query<{ id: string }>(`
            INSERT INTO public.vinculos_cilindro_lacre (cilindro_id, lacre_id, instalado_por, data_inicio)
            VALUES ($1, $2, $3, now()) RETURNING id`, [cil.id, lacre.id, ctx.usuarioId]);
          await client.query("UPDATE public.lacres SET status = 'INSTALADO', atualizado_em = now() WHERE id = $1", [lacre.id]);
          await auditar(client, ator, org, "vinculos_cilindro_lacre", r.rows[0]!.id, "INSERT", "seal.bind_cylinder");
          return ok("BOUND", { binding_id: r.rows[0]!.id }, 201);
        });
      case "unbind": {
        if (!ehUuid(corpo.binding_id)) return naoEncontrado();
        if (!justificativaValida(corpo.reason)) return falha(400, "JUSTIFICATION_REQUIRED");
        return transacao(banco, ctx, async client => {
          const disp = await client.query<{ id: string }>(`
            UPDATE public.vinculos_dispositivo_lacre v SET data_fim = now(), desvinculado_por = $3, motivo_encerramento = $4
            FROM public.lacres l WHERE v.id = $1 AND l.id = v.lacre_id AND l.organizacao_id = $2 AND v.data_fim IS NULL RETURNING v.id`,
            [corpo.binding_id, org, ctx.usuarioId, corpo.reason.trim()]);
          if (disp.rows[0]) {
            await auditar(client, ator, org, "vinculos_dispositivo_lacre", corpo.binding_id, "UPDATE", "seal.unbind_device");
            return ok("UNBOUND", { kind: "device" });
          }
          const cil = await client.query<{ lacre_id: string }>(`
            UPDATE public.vinculos_cilindro_lacre v SET data_fim = now(), removido_por = $3, motivo_encerramento = $4
            FROM public.lacres l WHERE v.id = $1 AND l.id = v.lacre_id AND l.organizacao_id = $2 AND v.data_fim IS NULL RETURNING v.lacre_id`,
            [corpo.binding_id, org, ctx.usuarioId, corpo.reason.trim()]);
          if (!cil.rows[0]) return naoEncontrado();
          // Mesma regra da Oxide: só INSTALADO vira REMOVIDO
          await client.query("UPDATE public.lacres SET status = 'REMOVIDO', atualizado_em = now() WHERE id = $1 AND status = 'INSTALADO'", [cil.rows[0].lacre_id]);
          await auditar(client, ator, org, "vinculos_cilindro_lacre", corpo.binding_id, "UPDATE", "seal.unbind_cylinder");
          return ok("UNBOUND", { kind: "cylinder" });
        });
      }
      case "confirm_violation": {
        // P8: o Worker só marca SUSPEITA_VIOLACAO; o gestor confirma (ROMPIDO)
        // ou libera (volta a INSTALADO)
        if (!["confirm", "release"].includes(corpo.decision)) campos.push({ field: "decision", message: "Use confirm ou release." });
        if (campos.length) return invalido(campos);
        if (!justificativaValida(corpo.justification)) return falha(400, "JUSTIFICATION_REQUIRED");
        if (!ctx.permissoes.has("alert.close")) return negado();
        return transacao(banco, ctx, async client => {
          const lacre = await lacreDaOrg(client, org, corpo.seal_id);
          if (lacre.status !== "SUSPEITA_VIOLACAO") return falha(409, "INVALID_TRANSITION", { current_status: lacre.status });
          const novo = corpo.decision === "confirm" ? "ROMPIDO" : "INSTALADO";
          await client.query("UPDATE public.lacres SET status = $2, atualizado_em = now() WHERE id = $1", [lacre.id, novo]);
          await auditar(client, ator, org, "lacres", lacre.id, "UPDATE", `seal.violation_${corpo.decision}`, { status: novo });
          return ok("UPDATED", { status: novo });
        });
      }
      case "inspect": {
        const resultados = ["APROVADO", "APROVADO_COM_RESTRICAO", "REPROVADO", "INUTILIZADO"];
        if (!resultados.includes(corpo.result)) campos.push({ field: "result", message: `Use ${resultados.join(", ")}.` });
        if (corpo.inspected_on !== undefined && !ehData(corpo.inspected_on)) campos.push({ field: "inspected_on", message: "Data AAAA-MM-DD." });
        if (!ehData(corpo.next_review_on)) campos.push({ field: "next_review_on", message: "Data AAAA-MM-DD." });
        if (campos.length) return invalido(campos);
        return transacao(banco, ctx, async client => {
          const lacre = await lacreDaOrg(client, org, corpo.seal_id);
          const r = await client.query<{ id: string }>(`
            INSERT INTO public.inspecoes_lacre (lacre_id, data_inspecao, proxima_revisao, resultado, observacao, realizado_por, criado_por)
            VALUES ($1, COALESCE($2, current_date), $3, $4, $5, $6, $7) RETURNING id`,
            [lacre.id, corpo.inspected_on ?? null, corpo.next_review_on, corpo.result, corpo.notes ?? null, ctx.nome, ctx.usuarioId]);
          await client.query(`
            UPDATE public.lacres SET proxima_revisao = $2,
              status = CASE WHEN $3 = 'INUTILIZADO' THEN 'INUTILIZADO' ELSE status END, atualizado_em = now() WHERE id = $1`,
            [lacre.id, corpo.next_review_on, corpo.result]);
          await auditar(client, ator, org, "inspecoes_lacre", r.rows[0]!.id, "INSERT", "seal.inspect");
          return ok("INSPECTED", { inspection_id: r.rows[0]!.id }, 201);
        });
      }
      default:
        return invalido([{ field: "operation", message: "Operação desconhecida." }]);
    }
  })().catch(erro => {
    const regra = violacaoUnica(erro);
    if (regra === "lacres_codigo_key" || regra === "dispositivos_codigo_key") return falha(409, "CODE_CONFLICT");
    if (regra === "lacres_uid_nfc_key") return falha(409, "NFC_CONFLICT");
    if (regra === "dispositivos_identificador_hardware_key") return falha(409, "HARDWARE_ID_CONFLICT");
    throw erro;
  });
  return resposta;
}

// ------------------------------------------------------------- telemetria

export async function queryTelemetry(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  exige(ctx, "seal.read");
  const org = ctx.organizacaoId!;
  const campos: Array<{ field: string; message: string }> = [];
  const { de, ate } = periodo(corpo, campos);
  if (campos.length) return invalido(campos);
  const limite = limiteDe(corpo.limit, 500, 5000);
  const intervalo = (coluna: string, valores: unknown[]): string => {
    let sql = "";
    if (de) { valores.push(de); sql += ` AND ${coluna} >= $${valores.length}`; }
    if (ate) { valores.push(ate); sql += ` AND ${coluna} <= $${valores.length}`; }
    return sql;
  };

  switch (corpo.operation) {
    case "track": {
      const valores: unknown[] = [org];
      let alvo: string;
      if (ehUuid(corpo.cylinder_id)) { valores.push(corpo.cylinder_id); alvo = `t.cilindro_id = $2 AND EXISTS (SELECT 1 FROM public.cilindros c WHERE c.id = t.cilindro_id AND c.organizacao_id = $1)`; }
      else if (ehUuid(corpo.device_id)) { valores.push(corpo.device_id); alvo = `t.dispositivo_id = $2 AND EXISTS (SELECT 1 FROM public.dispositivos d WHERE d.id = t.dispositivo_id AND d.organizacao_id = $1)`; }
      else return invalido([{ field: "cylinder_id", message: "Informe cylinder_id ou device_id." }]);
      const linhas = await banco.query(`
        SELECT t.message_id, t.data_coleta, t.latitude, t.longitude, t.velocidade_kmh, t.bateria_percentual, t.sinal_gsm
        FROM public.telemetrias t WHERE ${alvo}${intervalo("t.data_coleta", valores)} ORDER BY t.data_coleta LIMIT ${limite}`, valores);
      return ok("LISTED", { positions: linhas.rows.map(t => ({
        message_id: t.message_id, at: iso(t.data_coleta), latitude: Number(t.latitude), longitude: Number(t.longitude),
        speed_kmh: t.velocidade_kmh === null ? null : Number(t.velocidade_kmh),
        battery_percent: t.bateria_percentual === null ? null : Number(t.bateria_percentual), gsm_signal: t.sinal_gsm
      })) });
    }
    case "events": {
      const valores: unknown[] = [org];
      let alvoLacre: string;
      let alvoDisp: string;
      if (ehUuid(corpo.seal_id)) { valores.push(corpo.seal_id); alvoLacre = "e.lacre_id = $2"; alvoDisp = "e.lacre_id = $2"; }
      else if (ehUuid(corpo.device_id)) { valores.push(corpo.device_id); alvoLacre = "e.dispositivo_id = $2"; alvoDisp = "e.dispositivo_id = $2"; }
      else return invalido([{ field: "seal_id", message: "Informe seal_id ou device_id." }]);
      const periodoSql = intervalo("e.ocorrido_em", valores);
      const linhas = await banco.query(`
        SELECT 'seal' AS origem, e.message_id, e.tipo, e.autorizado, e.codigo_erro, e.descricao, e.ocorrido_em
        FROM public.eventos_lacre e JOIN public.lacres l ON l.id = e.lacre_id AND l.organizacao_id = $1 WHERE ${alvoLacre}${periodoSql}
        UNION ALL
        SELECT 'device', e.message_id, e.tipo, NULL, e.codigo_erro, e.descricao, e.ocorrido_em
        FROM public.eventos_dispositivo e WHERE e.organizacao_id = $1 AND ${alvoDisp}${periodoSql}
        ORDER BY ocorrido_em DESC LIMIT ${limite}`, valores);
      return ok("LISTED", { events: linhas.rows.map(e => ({
        source: e.origem, message_id: e.message_id, type: e.tipo, authorized: e.autorizado, error_code: e.codigo_erro,
        description: e.descricao, at: iso(e.ocorrido_em)
      })) });
    }
    case "quarantine": {
      if (!ehUuid(corpo.device_id)) return invalido([{ field: "device_id", message: "Informe device_id." }]);
      const valores: unknown[] = [org, corpo.device_id];
      const linhas = await banco.query(`
        SELECT message_id, recebido_em, velocidade_kmh, bateria_percentual, sinal_gsm, motivo FROM public.telemetrias_quarentena q
        WHERE q.organizacao_id = $1 AND q.dispositivo_id = $2${intervalo("q.recebido_em", valores)} ORDER BY recebido_em DESC LIMIT ${limite}`, valores);
      return ok("LISTED", { readings: linhas.rows.map(q => ({
        message_id: q.message_id, at: iso(q.recebido_em), reason: q.motivo,
        battery_percent: q.bateria_percentual === null ? null : Number(q.bateria_percentual), gsm_signal: q.sinal_gsm
      })) });
    }
    default:
      return invalido([{ field: "operation", message: "Use track, events ou quarantine." }]);
  }
}

// --------------------------------------------------------------- comandos

// D8: comando pelo frontend só com login, ENVIAR_COMANDOS e justificativa.
// O comando entra na Oxide (commands) e o ESP32 o busca como já faz
export async function manageCommands(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  const org = ctx.organizacaoId!;
  if (!ehUuid(corpo.device_id)) return invalido([{ field: "device_id", message: "Informe device_id." }]);
  const disp = (await banco.query<{ id: string; codigo: string; ativo: boolean }>(
    "SELECT id, codigo, ativo FROM public.dispositivos WHERE id = $1 AND organizacao_id = $2", [corpo.device_id, org])).rows[0];

  switch (corpo.operation) {
    case "send": {
      exige(ctx, "command.send");
      if (!commandTypes.includes(corpo.command_type)) return invalido([{ field: "command_type", message: "Use TRAVAR_VALVULA ou DESTRAVAR_VALVULA." }]);
      if (!justificativaValida(corpo.justification)) return falha(400, "JUSTIFICATION_REQUIRED");
      if (!disp) return naoEncontrado();
      if (!disp.ativo) return falha(409, "DEVICE_INACTIVE");
      if (!db.prepare("SELECT 1 FROM devices WHERE device_id = ?").get(disp.codigo)) {
        return falha(409, "DEVICE_NOT_SYNCED", { message: "O dispositivo ainda não chegou à Oxide; aguarde a sincronização do cadastro (até 5 minutos)." });
      }
      const comando = criarComando(disp.codigo, corpo.command_type as CommandType);
      await auditar(banco, { usuarioId: ctx.usuarioId, organizacaoId: org }, org, "dispositivos", disp.id, "AUTORIZACAO",
        `command.send ${corpo.command_type} ${comando.command_id}: ${corpo.justification.trim()}`);
      return ok(comando.criado ? "COMMAND_QUEUED" : "COMMAND_ALREADY_PENDING", { command_id: comando.command_id }, comando.criado ? 201 : 200);
    }
    case "list": {
      exige(ctx, "seal.read");
      if (!disp) return naoEncontrado();
      const comandos = db.prepare(`
        SELECT command_id, command_type, status, created_at, executed_at, error_message FROM commands
        WHERE device_id = ? ORDER BY id DESC LIMIT 100`).all(disp.codigo) as Linha[];
      return ok("LISTED", { items: comandos.map(c => ({
        command_id: c.command_id, command_type: c.command_type, status: c.status, created_at: c.created_at,
        executed_at: c.executed_at, error_message: c.error_message
      })) });
    }
    default:
      return invalido([{ field: "operation", message: "Use send ou list." }]);
  }
}
