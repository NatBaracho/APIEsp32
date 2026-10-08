import { Pool, PoolClient } from "pg";
import { lerPontos } from "../../regras/geo";
import {
  Contexto, ErroDeRegra, Resposta, auditar, ehTexto, ehUuid, falha, invalido, justificativaValida, lerCursor, limiteDe,
  naoEncontrado, negado, ok, proximoCodigo, proximoCursor, transacao, violacaoUnica
} from "../base";

// query-deliveries e manage-deliveries (novas, fora do contrato v0.1):
// clientes (destinatarios), endereços (locais_entrega, com a geocerca),
// entregas, rotas e desvios. Iniciar a entrega põe os cilindros EM_TRANSITO
// (vale a regra de rota); concluir põe COM_CLIENTE e abre a custódia (vale
// a regra de geocerca)

type Linha = Record<string, any>;
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function exige(ctx: Contexto, permissao: string): void {
  if (!ctx.permissoes.has(permissao)) throw new ErroDeRegra(negado());
}

async function entregaDaOrg(client: PoolClient | Pool, org: string, id: unknown, bloquear = false): Promise<Linha> {
  if (!ehUuid(id)) throw new ErroDeRegra(naoEncontrado());
  const e = (await client.query(`SELECT * FROM public.entregas WHERE id = $1 AND organizacao_id = $2 ${bloquear ? "FOR UPDATE" : ""}`, [id, org])).rows[0];
  if (!e) throw new ErroDeRegra(naoEncontrado());
  return e;
}

async function detalheEntrega(banco: Pool | PoolClient, e: Linha) {
  const itens = await banco.query(`
    SELECT c.id, c.codigo, c.numero_serie, c.status FROM public.entrega_itens i JOIN public.cilindros c ON c.id = i.cilindro_id
    WHERE i.entrega_id = $1 ORDER BY c.codigo`, [e.id]);
  const local = (await banco.query(`
    SELECT le.*, d.razao_social, d.nome_fantasia FROM public.locais_entrega le JOIN public.destinatarios d ON d.id = le.destinatario_id
    WHERE le.id = $1`, [e.local_entrega_id])).rows[0]!;
  const rota = (await banco.query("SELECT * FROM public.rotas_entrega WHERE entrega_id = $1", [e.id])).rows[0];
  const desvios = await banco.query("SELECT * FROM public.desvios_rota WHERE entrega_id = $1 ORDER BY inicio", [e.id]);
  return {
    id: e.id, code: e.codigo, status: e.status, planned_at: iso(e.data_prevista), departed_at: iso(e.data_saida),
    delivered_at: iso(e.data_entrega), notes: e.observacao,
    location: localJson(local), customer: { id: local.destinatario_id, name: local.nome_fantasia ?? local.razao_social },
    cylinders: itens.rows.map(c => ({ id: c.id, code: c.codigo, serial_number: c.numero_serie, status: c.status })),
    route: rota ? { points: rota.pontos, margin_meters: rota.margem_metros, updated_at: iso(rota.atualizado_em) } : null,
    deviations: desvios.rows.map(d => ({ id: d.id, type: d.tipo, start: iso(d.inicio), end: iso(d.fim), justification: d.justificativa }))
  };
}

function localJson(l: Linha) {
  return {
    id: l.id, code: l.codigo, name: l.nome, street: l.endereco, number: l.numero, complement: l.complemento, district: l.bairro,
    city: l.cidade, state: l.estado, zip: l.cep, latitude: Number(l.latitude), longitude: Number(l.longitude),
    geofence_radius_meters: l.raio_geocerca_metros, active: l.ativo
  };
}

export async function queryDeliveries(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  exige(ctx, "cylinder.read");
  const org = ctx.organizacaoId!;
  const limite = limiteDe(corpo.limit);
  const inicio = lerCursor(corpo.cursor);
  switch (corpo.operation) {
    case "list_customers": {
      const linhas = await banco.query(`
        SELECT d.*, (SELECT json_agg(le ORDER BY le.codigo) FROM public.locais_entrega le WHERE le.destinatario_id = d.id) AS locais
        FROM public.destinatarios d WHERE d.organizacao_id = $1 ORDER BY d.razao_social LIMIT ${limite + 1} OFFSET ${inicio}`, [org]);
      return ok("LISTED", { items: linhas.rows.slice(0, limite).map(d => ({
        id: d.id, code: d.codigo, legal_name: d.razao_social, trade_name: d.nome_fantasia, document: d.documento, email: d.email,
        active: d.ativo, locations: (d.locais ?? []).map((l: Linha) => ({
          id: l.id, code: l.codigo, name: l.nome, city: l.cidade, state: l.estado, latitude: Number(l.latitude), longitude: Number(l.longitude),
          geofence_radius_meters: l.raio_geocerca_metros, active: l.ativo
        }))
      })), next: proximoCursor(inicio, linhas.rows.length, limite) });
    }
    case "list_deliveries": {
      const valores: unknown[] = [org];
      let filtro = "";
      if (ehTexto(corpo.status)) { valores.push(corpo.status); filtro = ` AND e.status = $2`; }
      const linhas = await banco.query(`
        SELECT e.*, le.nome AS local, (SELECT count(*) FROM public.entrega_itens i WHERE i.entrega_id = e.id)::int AS itens,
               EXISTS (SELECT 1 FROM public.rotas_entrega r WHERE r.entrega_id = e.id) AS tem_rota
        FROM public.entregas e JOIN public.locais_entrega le ON le.id = e.local_entrega_id
        WHERE e.organizacao_id = $1${filtro} ORDER BY e.criado_em DESC LIMIT ${limite + 1} OFFSET ${inicio}`, valores);
      return ok("LISTED", { items: linhas.rows.slice(0, limite).map(e => ({
        id: e.id, code: e.codigo, status: e.status, location_name: e.local, cylinder_count: e.itens, has_route: e.tem_rota,
        planned_at: iso(e.data_prevista), departed_at: iso(e.data_saida), delivered_at: iso(e.data_entrega)
      })), next: proximoCursor(inicio, linhas.rows.length, limite) });
    }
    case "get_delivery": {
      const e = await entregaDaOrg(banco, org, corpo.delivery_id);
      return ok("FOUND", { delivery: await detalheEntrega(banco, e) });
    }
    default:
      return invalido([{ field: "operation", message: "Use list_customers, list_deliveries ou get_delivery." }]);
  }
}

async function cilindrosDaEntrega(client: PoolClient, entregaId: string): Promise<Linha[]> {
  return (await client.query(`
    SELECT c.* FROM public.entrega_itens i JOIN public.cilindros c ON c.id = i.cilindro_id
    WHERE i.entrega_id = $1 ORDER BY c.id FOR UPDATE OF c`, [entregaId])).rows;
}

export async function manageDeliveries(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  const org = ctx.organizacaoId!;
  const ator = { usuarioId: ctx.usuarioId, organizacaoId: org };
  const campos: Array<{ field: string; message: string }> = [];

  const resposta = await (async (): Promise<Resposta> => {
    switch (corpo.operation) {
      case "create_customer": {
        exige(ctx, "customer.write");
        if (!ehTexto(corpo.legal_name) || corpo.legal_name.length > 200) campos.push({ field: "legal_name", message: "Informe a razão social." });
        if (corpo.email != null && (typeof corpo.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(corpo.email))) campos.push({ field: "email", message: "E-mail inválido." });
        if (campos.length) return invalido(campos);
        return transacao(banco, ctx, async client => {
          await client.query("SELECT pg_advisory_xact_lock(hashtext('fluxid.destinatarios.codigo'))");
          const codigo = await proximoCodigo(client, "destinatarios", "CLI");
          const r = await client.query<{ id: string }>(`
            INSERT INTO public.destinatarios (organizacao_id, codigo, razao_social, nome_fantasia, documento, email, observacao)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [org, codigo, corpo.legal_name.trim(), corpo.trade_name ?? null, corpo.document ?? null, corpo.email ?? null, corpo.notes ?? null]);
          await auditar(client, ator, org, "destinatarios", r.rows[0]!.id, "INSERT", "customer.create");
          return ok("CREATED", { customer_id: r.rows[0]!.id, customer_code: codigo }, 201);
        });
      }
      case "create_location": {
        exige(ctx, "customer.write");
        if (!ehUuid(corpo.customer_id)) campos.push({ field: "customer_id", message: "Informe o cliente." });
        for (const campo of ["name", "street", "city"]) if (!ehTexto(corpo[campo])) campos.push({ field: campo, message: "Obrigatório." });
        if (typeof corpo.state !== "string" || !/^[A-Za-z]{2}$/.test(corpo.state)) campos.push({ field: "state", message: "UF com 2 letras." });
        if (typeof corpo.latitude !== "number" || Math.abs(corpo.latitude) > 90) campos.push({ field: "latitude", message: "Latitude inválida." });
        if (typeof corpo.longitude !== "number" || Math.abs(corpo.longitude) > 180) campos.push({ field: "longitude", message: "Longitude inválida." });
        const raio = corpo.geofence_radius_meters ?? 200;
        if (!Number.isInteger(raio) || raio < 10 || raio > 50000) campos.push({ field: "geofence_radius_meters", message: "Raio de 10 a 50000 metros." });
        if (campos.length) return invalido(campos);
        return transacao(banco, ctx, async client => {
          const cliente = (await client.query("SELECT id FROM public.destinatarios WHERE id = $1 AND organizacao_id = $2", [corpo.customer_id, org])).rows[0];
          if (!cliente) return naoEncontrado();
          await client.query("SELECT pg_advisory_xact_lock(hashtext('fluxid.locais_entrega.codigo'))");
          const codigo = await proximoCodigo(client, "locais_entrega", "LOC");
          const r = await client.query<{ id: string }>(`
            INSERT INTO public.locais_entrega (destinatario_id, codigo, nome, endereco, numero, complemento, bairro, cidade, estado, cep,
              latitude, longitude, raio_geocerca_metros)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
            [cliente.id, codigo, corpo.name.trim(), corpo.street.trim(), corpo.number ?? null, corpo.complement ?? null, corpo.district ?? null,
             corpo.city.trim(), corpo.state.toUpperCase(), corpo.zip ?? null, corpo.latitude, corpo.longitude, raio]);
          await auditar(client, ator, org, "locais_entrega", r.rows[0]!.id, "INSERT", "customer.location_create");
          return ok("CREATED", { location_id: r.rows[0]!.id, location_code: codigo }, 201);
        });
      }
      case "create_delivery": {
        exige(ctx, "delivery.write");
        if (!ehUuid(corpo.location_id)) campos.push({ field: "location_id", message: "Informe o endereço de entrega." });
        if (!Array.isArray(corpo.cylinder_ids) || corpo.cylinder_ids.length === 0 || corpo.cylinder_ids.length > 200 || !corpo.cylinder_ids.every(ehUuid)) {
          campos.push({ field: "cylinder_ids", message: "Informe de 1 a 200 cilindros." });
        }
        if (corpo.planned_at !== undefined && (typeof corpo.planned_at !== "string" || Number.isNaN(Date.parse(corpo.planned_at)))) {
          campos.push({ field: "planned_at", message: "Data inválida." });
        }
        if (campos.length) return invalido(campos);
        return transacao(banco, ctx, async client => {
          const local = (await client.query(`
            SELECT le.id FROM public.locais_entrega le JOIN public.destinatarios d ON d.id = le.destinatario_id
            WHERE le.id = $1 AND d.organizacao_id = $2 AND le.ativo`, [corpo.location_id, org])).rows[0];
          if (!local) return naoEncontrado();
          const ids = [...new Set(corpo.cylinder_ids as string[])];
          const cil = await client.query<{ id: string; status: string }>(
            "SELECT id, status FROM public.cilindros WHERE id = ANY($1) AND organizacao_id = $2", [ids, org]);
          if (cil.rows.length !== ids.length) return naoEncontrado();
          const inativos = cil.rows.filter(c => c.status === "INATIVO").map(c => c.id);
          if (inativos.length) return falha(409, "CYLINDER_INACTIVE", { cylinder_ids: inativos });
          const ocupados = await client.query<{ cilindro_id: string }>(`
            SELECT i.cilindro_id FROM public.entrega_itens i JOIN public.entregas e ON e.id = i.entrega_id
            WHERE i.cilindro_id = ANY($1) AND e.status IN ('PENDENTE', 'EM_ANDAMENTO')`, [ids]);
          if (ocupados.rows.length) return falha(409, "CYLINDER_IN_OTHER_DELIVERY", { cylinder_ids: ocupados.rows.map(o => o.cilindro_id) });
          await client.query("SELECT pg_advisory_xact_lock(hashtext('fluxid.entregas.codigo'))");
          const codigo = await proximoCodigo(client, "entregas", "ENT");
          const r = await client.query<{ id: string }>(`
            INSERT INTO public.entregas (organizacao_id, local_entrega_id, codigo, status, data_prevista, responsavel_id, observacao)
            VALUES ($1, $2, $3, 'PENDENTE', $4, $5, $6) RETURNING id`,
            [org, local.id, codigo, corpo.planned_at ?? null, ctx.usuarioId, corpo.notes ?? null]);
          for (const id of ids) await client.query("INSERT INTO public.entrega_itens (entrega_id, cilindro_id) VALUES ($1, $2)", [r.rows[0]!.id, id]);
          await auditar(client, ator, org, "entregas", r.rows[0]!.id, "INSERT", "delivery.create");
          return ok("CREATED", { delivery_id: r.rows[0]!.id, delivery_code: codigo }, 201);
        });
      }
      case "set_route": {
        exige(ctx, "route.plan");
        const pontos = lerPontos(corpo.points);
        if (!pontos || pontos.length > 500) campos.push({ field: "points", message: "De 2 a 500 pontos { latitude, longitude }." });
        const margem = corpo.margin_meters ?? Number(process.env.REGRA_MARGEM_ROTA_METROS ?? 50);
        if (!Number.isInteger(margem) || margem < 5 || margem > 5000) campos.push({ field: "margin_meters", message: "Margem de 5 a 5000 metros." });
        if (campos.length) return invalido(campos);
        return transacao(banco, ctx, async client => {
          const e = await entregaDaOrg(client, org, corpo.delivery_id, true);
          if (!["PENDENTE", "EM_ANDAMENTO"].includes(e.status)) return falha(409, "DELIVERY_FINISHED", { status: e.status });
          const r = await client.query<{ id: string }>(`
            INSERT INTO public.rotas_entrega (entrega_id, pontos, margem_metros, criado_por) VALUES ($1, $2, $3, $4)
            ON CONFLICT (entrega_id) DO UPDATE SET pontos = EXCLUDED.pontos, margem_metros = EXCLUDED.margem_metros, atualizado_em = now()
            RETURNING id`, [e.id, JSON.stringify(pontos), margem, ctx.usuarioId]);
          await auditar(client, ator, org, "rotas_entrega", r.rows[0]!.id, "UPDATE", "delivery.route_set", { pontos: pontos!.length, margem });
          return ok("SAVED", { route_id: r.rows[0]!.id });
        });
      }
      case "add_deviation": {
        exige(ctx, "route.plan");
        if (!["PROGRAMADO", "JUSTIFICADO"].includes(corpo.type)) campos.push({ field: "type", message: "Use PROGRAMADO ou JUSTIFICADO." });
        for (const campo of ["start", "end"]) {
          if (typeof corpo[campo] !== "string" || Number.isNaN(Date.parse(corpo[campo]))) campos.push({ field: campo, message: "Data inválida." });
        }
        if (!campos.length && Date.parse(corpo.end) <= Date.parse(corpo.start)) campos.push({ field: "end", message: "O fim deve ser depois do início." });
        if (campos.length) return invalido(campos);
        if (!justificativaValida(corpo.justification)) return falha(400, "JUSTIFICATION_REQUIRED");
        return transacao(banco, ctx, async client => {
          const e = await entregaDaOrg(client, org, corpo.delivery_id);
          const r = await client.query<{ id: string }>(`
            INSERT INTO public.desvios_rota (entrega_id, tipo, inicio, fim, justificativa, criado_por) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [e.id, corpo.type, corpo.start, corpo.end, corpo.justification.trim(), ctx.usuarioId]);
          await auditar(client, ator, org, "desvios_rota", r.rows[0]!.id, "INSERT", "delivery.deviation_add");
          return ok("CREATED", { deviation_id: r.rows[0]!.id }, 201);
        });
      }
      case "start": {
        exige(ctx, "delivery.write");
        return transacao(banco, ctx, async client => {
          const e = await entregaDaOrg(client, org, corpo.delivery_id, true);
          if (e.status !== "PENDENTE") return falha(409, "INVALID_TRANSITION", { current_status: e.status });
          const cilindros = await cilindrosDaEntrega(client, e.id);
          const inativos = cilindros.filter(c => c.status === "INATIVO").map(c => c.id);
          if (inativos.length) return falha(409, "CYLINDER_INACTIVE", { cylinder_ids: inativos });
          await client.query("UPDATE public.entregas SET status = 'EM_ANDAMENTO', data_saida = now(), atualizado_em = now() WHERE id = $1", [e.id]);
          await client.query(`
            UPDATE public.cilindros SET status = 'EM_TRANSITO', situacao_estoque = 'FORA_DO_ESTOQUE', atualizado_em = now()
            WHERE id = ANY($1)`, [cilindros.map(c => c.id)]);
          // Saiu com o caminhão: a custódia anterior (outro cliente) termina
          await client.query("UPDATE public.custodias SET data_fim = now() WHERE cilindro_id = ANY($1) AND data_fim IS NULL", [cilindros.map(c => c.id)]);
          await auditar(client, ator, org, "entregas", e.id, "UPDATE", "delivery.start");
          return ok("STARTED", { delivery: await detalheEntrega(client, { ...e, status: "EM_ANDAMENTO" }) });
        });
      }
      case "finish": {
        exige(ctx, "delivery.write");
        return transacao(banco, ctx, async client => {
          const e = await entregaDaOrg(client, org, corpo.delivery_id, true);
          if (e.status !== "EM_ANDAMENTO") return falha(409, "INVALID_TRANSITION", { current_status: e.status });
          const cilindros = await cilindrosDaEntrega(client, e.id);
          await client.query("UPDATE public.entregas SET status = 'CONCLUIDA', data_entrega = now(), atualizado_em = now() WHERE id = $1", [e.id]);
          await client.query("UPDATE public.cilindros SET status = 'COM_CLIENTE', atualizado_em = now() WHERE id = ANY($1)", [cilindros.map(c => c.id)]);
          for (const c of cilindros) {
            await client.query("UPDATE public.custodias SET data_fim = now() WHERE cilindro_id = $1 AND data_fim IS NULL", [c.id]);
            await client.query(`
              INSERT INTO public.custodias (cilindro_id, local_entrega_id, data_inicio, criado_por, observacao)
              VALUES ($1, $2, now(), $3, $4)`, [c.id, e.local_entrega_id, ctx.usuarioId, `Entrega ${e.codigo}`]);
          }
          await auditar(client, ator, org, "entregas", e.id, "UPDATE", "delivery.finish");
          return ok("FINISHED");
        });
      }
      case "cancel": {
        exige(ctx, "delivery.write");
        if (!justificativaValida(corpo.reason)) return falha(400, "JUSTIFICATION_REQUIRED");
        return transacao(banco, ctx, async client => {
          const e = await entregaDaOrg(client, org, corpo.delivery_id, true);
          if (!["PENDENTE", "EM_ANDAMENTO"].includes(e.status)) return falha(409, "INVALID_TRANSITION", { current_status: e.status });
          const cilindros = await cilindrosDaEntrega(client, e.id);
          await client.query(`
            UPDATE public.entregas SET status = 'CANCELADA', atualizado_em = now(),
              observacao = concat_ws(E'\\n', observacao, 'Cancelada: ' || $2) WHERE id = $1`, [e.id, corpo.reason.trim()]);
          await client.query(`
            UPDATE public.cilindros SET status = 'DISPONIVEL', atualizado_em = now() WHERE id = ANY($1) AND status = 'EM_TRANSITO'`,
            [cilindros.map(c => c.id)]);
          await auditar(client, ator, org, "entregas", e.id, "UPDATE", "delivery.cancel");
          return ok("CANCELLED");
        });
      }
      case "end_custody": {
        // Recolhimento no cliente sem passar pelo estoque ainda
        exige(ctx, "delivery.write");
        if (!ehUuid(corpo.cylinder_id)) return naoEncontrado();
        if (!justificativaValida(corpo.reason)) return falha(400, "JUSTIFICATION_REQUIRED");
        return transacao(banco, ctx, async client => {
          const r = await client.query<{ id: string }>(`
            UPDATE public.custodias cu SET data_fim = now(), observacao = concat_ws(E'\\n', cu.observacao, 'Encerrada: ' || $3)
            FROM public.cilindros c WHERE cu.cilindro_id = c.id AND c.id = $1 AND c.organizacao_id = $2 AND cu.data_fim IS NULL
            RETURNING cu.id`, [corpo.cylinder_id, org, corpo.reason.trim()]);
          if (!r.rows[0]) return naoEncontrado();
          await client.query("UPDATE public.cilindros SET status = 'DISPONIVEL', atualizado_em = now() WHERE id = $1 AND status = 'COM_CLIENTE'", [corpo.cylinder_id]);
          await auditar(client, ator, org, "custodias", r.rows[0].id, "UPDATE", "delivery.end_custody");
          return ok("CUSTODY_ENDED");
        });
      }
      default:
        return invalido([{ field: "operation", message: "Operação desconhecida." }]);
    }
  })().catch(erro => {
    if (violacaoUnica(erro)) return falha(409, "CONFLICT");
    throw erro;
  });
  return resposta;
}
