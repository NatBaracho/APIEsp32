import { Pool, PoolClient } from "pg";
import {
  Contexto, ErroDeRegra, Resposta, auditar, ehData, ehTexto, ehUuid, falha, invalido, justificativaValida, lerCursor,
  limiteDe, naoEncontrado, negado, ok, proximoCodigo, proximoCursor, sha256, transacao, violacaoUnica
} from "../base";

// query-cylinders e manage-cylinders: mesmo contrato da etapa 006 do
// frontend (specs/006-cilindros-e-estoque/contracts/operacoes-servidor.md),
// sobre as tabelas do FluxID. Nomes em inglês (D9); estoque em coluna própria (D1)

const KIND: Record<string, string> = { qr_code: "QR_CODE", data_matrix: "DATA_MATRIX", nfc_tag: "NFC", hull_number: "NUMERO_CASCO" };
const KIND_INV = Object.fromEntries(Object.entries(KIND).map(([a, b]) => [b, a]));
const MOTIVO: Record<string, string> = { written_off: "BAIXADO", lost: "EXTRAVIADO", condemned: "CONDENADO", other: "OUTRO" };
const MOTIVO_INV = Object.fromEntries(Object.entries(MOTIVO).map(([a, b]) => [b, a]));
const UNIDADE: Record<string, string> = { l: "L", m3: "M3", kg: "KG" };
const CLASSE: Record<string, string> = { medicinal: "MEDICINAL", industrial: "INDUSTRIAL" };
const RESULTADO: Record<string, string> = { approved: "APROVADO", rejected: "REPROVADO" };
export const EVENTO: Record<string, string> = {
  CILINDRO_CRIADO: "cylinder_created", CILINDRO_ATUALIZADO: "cylinder_updated",
  CILINDRO_INATIVADO: "cylinder_inactivated", CILINDRO_REATIVADO: "cylinder_reactivated",
  IDENTIFICADOR_ADICIONADO: "identifier_added", IDENTIFICADOR_DESATIVADO: "identifier_deactivated",
  IDENTIFICADOR_TRANSFERIDO_SAIDA: "identifier_transferred_out", IDENTIFICADOR_TRANSFERIDO_ENTRADA: "identifier_transferred_in",
  ENTRADA_ESTOQUE: "stock_in", SAIDA_ESTOQUE_INATIVACAO: "stock_out_inactivation",
  TESTE_HIDROSTATICO_REGISTRADO: "hydrostatic_test_registered", TESTE_HIDROSTATICO_RETIFICADO: "hydrostatic_test_rectified",
  LACRE_VINCULADO: "seal_bound", LACRE_DESVINCULADO: "seal_unbound",
  ALERTA_REGISTRADO: "alert_opened", ALERTA_ENCERRADO: "alert_closed"
};
const EVENTO_INV = Object.fromEntries(Object.entries(EVENTO).map(([a, b]) => [b, a]));

// Situação do teste: último teste não retificado; 30 dias = "a vencer";
// dia em America/Sao_Paulo (mesma regra do frontend)
const VISAO = `
  SELECT c.id, c.codigo, c.organizacao_id, c.numero_serie, c.tipo, c.capacidade_litros, c.data_fabricacao, c.status,
         c.situacao_estoque, c.observacao, c.criado_em, c.fabricante, c.pressao_trabalho_bar, c.motivo_inativacao, c.versao,
         c.tipo_cilindro_id, tc.gas, tc.capacidade_valor, tc.capacidade_unidade, tc.classificacao, tc.ativo AS tipo_ativo,
         ht.resultado AS teste_resultado, ht.proximo_teste,
         (SELECT count(*) FROM public.identificadores_cilindro i WHERE i.cilindro_id = c.id AND i.status = 'ATIVO')::int AS identificadores_ativos,
         CASE
           WHEN ht.resultado IS NULL THEN 'sem_teste'
           WHEN ht.resultado = 'REPROVADO' THEN 'reprovado'
           WHEN ht.proximo_teste < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'vencido'
           WHEN ht.proximo_teste - (now() AT TIME ZONE 'America/Sao_Paulo')::date <= 30 THEN 'a_vencer'
           ELSE 'em_dia'
         END AS hydro_status
  FROM public.cilindros c
  LEFT JOIN public.tipos_cilindro tc ON tc.id = c.tipo_cilindro_id
  LEFT JOIN LATERAL (
    SELECT t.resultado, t.proximo_teste FROM public.testes_hidrostaticos t
    WHERE t.cilindro_id = c.id
      AND NOT EXISTS (SELECT 1 FROM public.testes_hidrostaticos r WHERE r.retifica_teste_id = t.id)
    ORDER BY t.data_teste DESC, t.criado_em DESC LIMIT 1
  ) ht ON true`;

type Linha = Record<string, any>;

function tipoDe(l: Linha) {
  if (l.tipo_cilindro_id) {
    return {
      id: l.tipo_cilindro_id, gas: l.gas, capacity_value: Number(l.capacidade_valor),
      capacity_unit: String(l.capacidade_unidade).toLowerCase(), classification: String(l.classificacao).toLowerCase(),
      active: l.tipo_ativo
    };
  }
  // Cilindro anterior ao catálogo de tipos: tipo montado do texto antigo
  return {
    id: `legacy:${l.tipo}`, gas: l.tipo, capacity_value: l.capacidade_litros === null ? 0 : Number(l.capacidade_litros),
    capacity_unit: "l", classification: "industrial", active: true, legacy: true
  };
}

export function cilindroJson(l: Linha) {
  return {
    id: l.id, code: l.codigo, serial_number: l.numero_serie, type: tipoDe(l),
    status: l.status === "INATIVO" ? "inactive" : "active", operational_status: l.status,
    stock_status: l.situacao_estoque === "EM_ESTOQUE" ? "in_stock" : "out_of_stock",
    hydro_status: l.hydro_status, active_identifier_count: l.identificadores_ativos, version: Number(l.versao),
    manufacturer: l.fabricante, manufacture_year: l.data_fabricacao ? new Date(l.data_fabricacao).getUTCFullYear() : null,
    working_pressure_bar: l.pressao_trabalho_bar === null ? null : Number(l.pressao_trabalho_bar), notes: l.observacao,
    inactivation_reason: l.motivo_inativacao ? MOTIVO_INV[l.motivo_inativacao] ?? "other" : null,
    hydro_last_result: l.teste_resultado ? (l.teste_resultado === "APROVADO" ? "approved" : "rejected") : null,
    hydro_next_due_on: l.proximo_teste ? dataIso(l.proximo_teste) : null,
    created_at: (l.criado_em as Date).toISOString()
  };
}

const dataIso = (valor: Date | string): string =>
  typeof valor === "string" ? valor.slice(0, 10) : valor.toISOString().slice(0, 10);

async function cilindroDaOrg(banco: Pool | PoolClient, org: string, id: unknown): Promise<Linha | null> {
  if (!ehUuid(id)) return null;
  return (await banco.query(`${VISAO} WHERE c.id = $1 AND c.organizacao_id = $2`, [id, org])).rows[0] ?? null;
}

function exige(ctx: Contexto, permissao: string): void {
  if (!ctx.permissoes.has(permissao)) throw new ErroDeRegra(negado());
}

// Evento do histórico feito por uma pessoa (origem USUARIO)
export async function registrarHistorico(
  client: PoolClient, cilindroId: string, tipo: string, usuarioId: string,
  dados: Record<string, unknown>, justificativa: string | null = null
): Promise<number> {
  const cil = await client.query<{ organizacao_id: string }>(
    "SELECT organizacao_id FROM public.cilindros WHERE id = $1 FOR UPDATE", [cilindroId]);
  const seq = await client.query<{ s: number }>(
    "SELECT COALESCE(max(sequencia), 0) + 1 AS s FROM public.historico_cilindro WHERE cilindro_id = $1", [cilindroId]);
  await client.query(`
    INSERT INTO public.historico_cilindro (organizacao_id, cilindro_id, sequencia, tipo_evento, origem, usuario_id, ocorrido_em, justificativa, dados)
    VALUES ($1, $2, $3, $4, 'USUARIO', $5, now(), $6, $7)`,
    [cil.rows[0]!.organizacao_id, cilindroId, seq.rows[0]!.s, tipo, usuarioId, justificativa, dados]);
  return seq.rows[0]!.s;
}

// ---------------------------------------------------------------- consultas

export async function queryCylinders(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  const org = ctx.organizacaoId!;
  switch (corpo.operation) {
    case "list": {
      exige(ctx, "cylinder.read");
      const filtros: string[] = ["c.organizacao_id = $1"];
      const valores: unknown[] = [org];
      const campos: Array<{ field: string; message: string }> = [];
      const status = corpo.status ?? "active";
      if (!["active", "inactive", "all"].includes(status)) campos.push({ field: "status", message: "Use active, inactive ou all." });
      if (status === "active") filtros.push("c.status <> 'INATIVO'");
      if (status === "inactive") filtros.push("c.status = 'INATIVO'");
      if (corpo.stock_status !== undefined) {
        if (!["in_stock", "out_of_stock"].includes(corpo.stock_status)) campos.push({ field: "stock_status", message: "Use in_stock ou out_of_stock." });
        valores.push(corpo.stock_status === "in_stock" ? "EM_ESTOQUE" : "FORA_DO_ESTOQUE");
        filtros.push(`c.situacao_estoque = $${valores.length}`);
      }
      if (corpo.cylinder_type_id !== undefined) {
        if (!ehUuid(corpo.cylinder_type_id)) campos.push({ field: "cylinder_type_id", message: "Tipo inválido." });
        valores.push(corpo.cylinder_type_id);
        filtros.push(`c.tipo_cilindro_id = $${valores.length}`);
      }
      if (ehTexto(corpo.search)) {
        valores.push(corpo.search.trim().toUpperCase());
        const p = valores.length;
        filtros.push(`(EXISTS (SELECT 1 FROM public.identificadores_cilindro i WHERE i.cilindro_id = c.id AND i.status = 'ATIVO' AND i.valor_normalizado = $${p})
                      OR upper(c.numero_serie) LIKE '%' || $${p} || '%' OR upper(c.codigo) = $${p})`);
      }
      const sort = corpo.sort ?? "serial";
      if (!["serial", "serial_desc"].includes(sort)) campos.push({ field: "sort", message: "Ordenação desconhecida." });
      const hydro = corpo.hydro_status;
      if (hydro !== undefined && !["em_dia", "a_vencer", "vencido", "reprovado", "sem_teste"].includes(hydro)) {
        campos.push({ field: "hydro_status", message: "Situação do teste desconhecida." });
      }
      if (campos.length) return invalido(campos);

      const limite = limiteDe(corpo.limit);
      const inicio = lerCursor(corpo.cursor);
      const base = `SELECT * FROM (${VISAO} WHERE ${filtros.join(" AND ")}) v ${hydro ? `WHERE v.hydro_status = '${hydro}'` : ""}`;
      const total = await banco.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${base}) x`, valores);
      const linhas = await banco.query(`${base} ORDER BY v.numero_serie ${sort === "serial" ? "ASC" : "DESC"}, v.id LIMIT ${limite + 1} OFFSET ${inicio}`, valores);
      return ok("LISTED", {
        items: linhas.rows.slice(0, limite).map(cilindroJson),
        total: total.rows[0]!.n,
        next: proximoCursor(inicio, linhas.rows.length, limite)
      });
    }
    case "get": {
      exige(ctx, "cylinder.read");
      const c = await cilindroDaOrg(banco, org, corpo.cylinder_id);
      if (!c) return naoEncontrado();
      const ids = await banco.query(`
        SELECT id, tipo, valor, status, criado_em, desativado_em, justificativa_desativacao, transferido_para_id
        FROM public.identificadores_cilindro WHERE cilindro_id = $1 ORDER BY criado_em`, [c.id]);
      const testes = await banco.query(`
        SELECT t.*, EXISTS (SELECT 1 FROM public.testes_hidrostaticos r WHERE r.retifica_teste_id = t.id) AS superado
        FROM public.testes_hidrostaticos t WHERE t.cilindro_id = $1 ORDER BY t.data_teste DESC, t.criado_em DESC`, [c.id]);
      const lacre = await banco.query(`
        SELECT l.id, l.codigo, l.status, v.data_inicio, d.codigo AS dispositivo
        FROM public.vinculos_cilindro_lacre v JOIN public.lacres l ON l.id = v.lacre_id
        LEFT JOIN public.vinculos_dispositivo_lacre vd ON vd.lacre_id = l.id AND vd.data_fim IS NULL
        LEFT JOIN public.dispositivos d ON d.id = vd.dispositivo_id
        WHERE v.cilindro_id = $1 AND v.data_fim IS NULL`, [c.id]);
      const s = lacre.rows[0];
      return ok("FOUND", {
        cylinder: cilindroJson(c),
        identifiers: ids.rows.map(identificadorJson),
        tests: testes.rows.map(testeJson),
        hydro_status: c.hydro_status,
        seal: s ? { id: s.id, code: s.codigo, status: s.status, bound_at: s.data_inicio.toISOString(), device_code: s.dispositivo } : null
      });
    }
    case "lookup": {
      exige(ctx, "cylinder.read");
      if (!ehTexto(corpo.identifier_value)) return invalido([{ field: "identifier_value", message: "Informe o identificador." }]);
      const ident = await banco.query(`
        SELECT i.id, i.tipo, i.valor, i.status, i.cilindro_id FROM public.identificadores_cilindro i
        WHERE i.organizacao_id = $1 AND i.valor_normalizado = upper(btrim($2))
        ORDER BY (i.status = 'ATIVO') DESC, i.criado_em DESC LIMIT 1`, [org, corpo.identifier_value]);
      const i = ident.rows[0];
      if (!i) return naoEncontrado();
      const c = (await cilindroDaOrg(banco, org, i.cilindro_id))!;
      if (i.status !== "ATIVO") {
        return falha(404, "NOT_FOUND", { deactivated: true, cylinder: { id: c.id, serial_number: c.numero_serie } });
      }
      return ok("FOUND", { cylinder: cilindroJson(c), identifier: { id: i.id, kind: KIND_INV[i.tipo], value: i.valor } });
    }
    case "history": {
      exige(ctx, "cylinder.history");
      const c = await cilindroDaOrg(banco, org, corpo.cylinder_id);
      if (!c) return naoEncontrado();
      const filtros = ["h.cilindro_id = $1"];
      const valores: unknown[] = [c.id];
      const campos: Array<{ field: string; message: string }> = [];
      if (corpo.event_type !== undefined) {
        if (!EVENTO_INV[corpo.event_type]) campos.push({ field: "event_type", message: "Tipo de evento desconhecido." });
        valores.push(EVENTO_INV[corpo.event_type]);
        filtros.push(`h.tipo_evento = $${valores.length}`);
      }
      for (const [campo, op] of [["from", ">="], ["to", "<="]] as const) {
        if (corpo[campo] === undefined) continue;
        if (typeof corpo[campo] !== "string" || Number.isNaN(Date.parse(corpo[campo]))) campos.push({ field: campo, message: "Data inválida." });
        valores.push(corpo[campo]);
        filtros.push(`h.ocorrido_em ${op} $${valores.length}`);
      }
      const ordem = corpo.order ?? "desc";
      if (!["asc", "desc"].includes(ordem)) campos.push({ field: "order", message: "Use asc ou desc." });
      if (campos.length) return invalido(campos);
      const limite = limiteDe(corpo.limit, 50);
      const inicio = lerCursor(corpo.cursor);
      const linhas = await banco.query(`
        SELECT h.*, u.nome AS ator FROM public.historico_cilindro h LEFT JOIN public.usuarios u ON u.id = h.usuario_id
        WHERE ${filtros.join(" AND ")} ORDER BY h.sequencia ${ordem === "asc" ? "ASC" : "DESC"} LIMIT ${limite + 1} OFFSET ${inicio}`, valores);
      return ok("LISTED", {
        events: linhas.rows.slice(0, limite).map(h => ({
          id: h.id, sequence: h.sequencia, event_type: EVENTO[h.tipo_evento] ?? h.tipo_evento, origin: h.origem,
          actor_name: h.ator ?? (h.origem === "OXIDE" ? "Lacre (Oxide)" : h.origem === "SISTEMA" ? "Sistema" : null),
          occurred_at: h.ocorrido_em.toISOString(), justification: h.justificativa, data: h.dados,
          references_event_id: h.referencia_evento_id
        })),
        next: proximoCursor(inicio, linhas.rows.length, limite)
      });
    }
    case "catalog": {
      exige(ctx, "cylinder.read");
      const tipos = await banco.query(
        "SELECT * FROM public.tipos_cilindro WHERE organizacao_id = $1 ORDER BY gas, capacidade_valor", [org]);
      return ok("LISTED", {
        types: tipos.rows.map(t => ({
          id: t.id, gas: t.gas, capacity_value: Number(t.capacidade_valor), capacity_unit: String(t.capacidade_unidade).toLowerCase(),
          classification: String(t.classificacao).toLowerCase(), active: t.ativo
        }))
      });
    }
    default:
      return invalido([{ field: "operation", message: "Operação desconhecida." }]);
  }
}

function identificadorJson(i: Linha) {
  return {
    id: i.id, kind: KIND_INV[i.tipo], value: i.valor, status: i.status === "ATIVO" ? "active" : "deactivated",
    created_at: i.criado_em.toISOString(), deactivated_at: i.desativado_em ? i.desativado_em.toISOString() : null,
    deactivation_justification: i.justificativa_desativacao, transferred: Boolean(i.transferido_para_id)
  };
}

function testeJson(t: Linha) {
  return {
    id: t.id, performed_on: dataIso(t.data_teste), result: t.resultado === "APROVADO" ? "approved" : "rejected",
    report_number: t.numero_laudo, executor: t.realizado_por, next_due_on: dataIso(t.proximo_teste), notes: t.observacao,
    rectifies_test_id: t.retifica_teste_id, rectification_justification: t.justificativa_retificacao,
    created_at: t.criado_em.toISOString(), superseded: t.superado === true
  };
}

// ----------------------------------------------------------------- comandos

interface DadosCilindro {
  tipoId: string | null; serie: string; fabricante: string | null; ano: number | null; pressao: number | null; obs: string | null;
}

function lerDadosCilindro(corpo: Linha, campos: Array<{ field: string; message: string }>): DadosCilindro {
  if (!ehTexto(corpo.serial_number) || corpo.serial_number.trim().length > 50) {
    campos.push({ field: "serial_number", message: "Informe o número de série (até 50 caracteres)." });
  }
  if (corpo.cylinder_type_id != null && !ehUuid(corpo.cylinder_type_id)) campos.push({ field: "cylinder_type_id", message: "Tipo inválido." });
  const ano = corpo.manufacture_year;
  if (ano != null && (!Number.isInteger(ano) || ano < 1900 || ano > new Date().getUTCFullYear())) {
    campos.push({ field: "manufacture_year", message: "Ano inválido." });
  }
  const pressao = corpo.working_pressure_bar;
  if (pressao != null && (typeof pressao !== "number" || !(pressao > 0))) campos.push({ field: "working_pressure_bar", message: "Pressão deve ser maior que zero." });
  if (corpo.manufacturer != null && (typeof corpo.manufacturer !== "string" || corpo.manufacturer.length > 120)) {
    campos.push({ field: "manufacturer", message: "Fabricante inválido." });
  }
  if (corpo.notes != null && (typeof corpo.notes !== "string" || corpo.notes.length > 1000)) campos.push({ field: "notes", message: "Observação inválida." });
  return {
    tipoId: corpo.cylinder_type_id ?? null, serie: String(corpo.serial_number ?? "").trim(),
    fabricante: ehTexto(corpo.manufacturer) ? corpo.manufacturer.trim() : null, ano: ano ?? null, pressao: pressao ?? null,
    obs: ehTexto(corpo.notes) ? corpo.notes.trim() : null
  };
}

async function tipoDaOrg(client: PoolClient, org: string, tipoId: string | null): Promise<Linha | null> {
  if (!tipoId) return null;
  const t = (await client.query("SELECT * FROM public.tipos_cilindro WHERE id = $1 AND organizacao_id = $2", [tipoId, org])).rows[0];
  if (!t) throw new ErroDeRegra(invalido([{ field: "cylinder_type_id", message: "Tipo não encontrado." }]));
  return t;
}

async function conferirSerie(client: PoolClient, org: string, serie: string, exceto: string | null): Promise<void> {
  const dono = await client.query<{ id: string }>(
    "SELECT id FROM public.cilindros WHERE organizacao_id = $1 AND numero_serie = $2 AND id IS DISTINCT FROM $3", [org, serie, exceto]);
  if (dono.rows[0]) throw new ErroDeRegra(falha(409, "SERIAL_CONFLICT", { cylinder_id: dono.rows[0].id }));
}

// Valor ativo em outro cilindro → IDENTIFIER_CONFLICT; valor que já existiu
// na organização → IDENTIFIER_UNAVAILABLE (só volta por transferência)
async function conferirIdentificador(client: PoolClient, org: string, valor: string): Promise<void> {
  const existente = await client.query<{ cilindro_id: string; status: string }>(`
    SELECT cilindro_id, status FROM public.identificadores_cilindro
    WHERE organizacao_id = $1 AND valor_normalizado = upper(btrim($2)) ORDER BY (status = 'ATIVO') DESC LIMIT 1`, [org, valor]);
  const e = existente.rows[0];
  if (e?.status === "ATIVO") throw new ErroDeRegra(falha(409, "IDENTIFIER_CONFLICT", { cylinder_id: e.cilindro_id }));
  if (e) throw new ErroDeRegra(falha(409, "IDENTIFIER_UNAVAILABLE"));
}

function lerIdentificador(kind: unknown, valor: unknown, campos: Array<{ field: string; message: string }>, prefixo = ""): void {
  if (typeof kind !== "string" || !KIND[kind]) campos.push({ field: `${prefixo}kind`, message: "Tipo de identificador desconhecido." });
  if (typeof valor !== "string" || valor.trim().length < 1 || valor.trim().length > 200 || /[\r\n]/.test(valor)) {
    campos.push({ field: `${prefixo}value`, message: "Identificador de 1 a 200 caracteres, sem quebra de linha." });
  }
}

async function bloquearCilindro(client: PoolClient, org: string, id: unknown): Promise<Linha> {
  if (!ehUuid(id)) throw new ErroDeRegra(naoEncontrado());
  const c = (await client.query("SELECT * FROM public.cilindros WHERE id = $1 AND organizacao_id = $2 FOR UPDATE", [id, org])).rows[0];
  if (!c) throw new ErroDeRegra(naoEncontrado());
  return c;
}

async function hydroDe(client: PoolClient, org: string, id: string): Promise<string> {
  return (await cilindroDaOrg(client, org, id))!.hydro_status;
}

export async function manageCylinders(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  const org = ctx.organizacaoId!;
  const ator = { usuarioId: ctx.usuarioId, organizacaoId: org };
  const campos: Array<{ field: string; message: string }> = [];

  switch (corpo.operation) {
    case "create": {
      exige(ctx, "cylinder.write");
      const dados = lerDadosCilindro(corpo, campos);
      const ident = corpo.identifier ?? {};
      lerIdentificador(ident.kind, ident.value, campos, "identifier.");
      if (campos.length) return invalido(campos);
      return transacao(banco, ctx, async client => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('fluxid.cilindros.codigo'))");
        const tipo = await tipoDaOrg(client, org, dados.tipoId);
        await conferirSerie(client, org, dados.serie, null);
        await conferirIdentificador(client, org, ident.value);
        const codigo = await proximoCodigo(client, "cilindros", "CIL");
        const criado = await client.query<{ id: string; versao: string }>(`
          INSERT INTO public.cilindros (organizacao_id, codigo, numero_serie, tipo, capacidade_litros, data_fabricacao, status,
            situacao_estoque, observacao, tipo_cilindro_id, fabricante, pressao_trabalho_bar)
          VALUES ($1, $2, $3, $4, $5, $6, 'DISPONIVEL', 'FORA_DO_ESTOQUE', $7, $8, $9, $10) RETURNING id, versao`,
          [org, codigo, dados.serie, tipo?.gas ?? "NAO_INFORMADO",
           tipo && tipo.capacidade_unidade === "L" ? tipo.capacidade_valor : null,
           dados.ano ? `${dados.ano}-01-01` : null, dados.obs, tipo?.id ?? null, dados.fabricante, dados.pressao]);
        const id = criado.rows[0]!.id;
        await client.query(`
          INSERT INTO public.identificadores_cilindro (organizacao_id, cilindro_id, tipo, valor, status, criado_por)
          VALUES ($1, $2, $3, $4, 'ATIVO', $5)`, [org, id, KIND[ident.kind], ident.value.trim(), ctx.usuarioId]);
        await registrarHistorico(client, id, "IDENTIFICADOR_ADICIONADO", ctx.usuarioId, { kind: ident.kind });
        await auditar(client, ator, org, "cilindros", id, "INSERT", "cylinder.create", { codigo, numero_serie: dados.serie });
        return ok("CREATED", { cylinder_id: id, cylinder_code: codigo, version: Number(criado.rows[0]!.versao) }, 201);
      });
    }
    case "update": {
      exige(ctx, "cylinder.write");
      const dados = lerDadosCilindro(corpo, campos);
      if (!Number.isInteger(corpo.expected_version)) campos.push({ field: "expected_version", message: "Informe a versão lida." });
      if (campos.length) return invalido(campos);
      return transacao(banco, ctx, async client => {
        const c = await bloquearCilindro(client, org, corpo.cylinder_id);
        if (c.status === "INATIVO") return falha(409, "CYLINDER_INACTIVE");
        if (Number(c.versao) !== corpo.expected_version) return falha(409, "VERSION_CONFLICT", { current_version: Number(c.versao) });
        const tipo = await tipoDaOrg(client, org, dados.tipoId);
        await conferirSerie(client, org, dados.serie, c.id);
        const antes = { numero_serie: c.numero_serie, fabricante: c.fabricante, pressao_trabalho_bar: c.pressao_trabalho_bar, tipo_cilindro_id: c.tipo_cilindro_id, observacao: c.observacao };
        const depois = { numero_serie: dados.serie, fabricante: dados.fabricante, pressao_trabalho_bar: dados.pressao, tipo_cilindro_id: tipo?.id ?? c.tipo_cilindro_id, observacao: dados.obs };
        const r = await client.query<{ versao: string }>(`
          UPDATE public.cilindros SET numero_serie = $2, fabricante = $3, pressao_trabalho_bar = $4, tipo_cilindro_id = $5,
            tipo = COALESCE($6, tipo), observacao = $7, data_fabricacao = COALESCE($8, data_fabricacao),
            versao = versao + 1, atualizado_em = now()
          WHERE id = $1 RETURNING versao`,
          [c.id, dados.serie, dados.fabricante, dados.pressao, depois.tipo_cilindro_id, tipo?.gas ?? null, dados.obs,
           dados.ano ? `${dados.ano}-01-01` : null]);
        await registrarHistorico(client, c.id, "CILINDRO_ATUALIZADO", ctx.usuarioId, { antes, depois });
        await auditar(client, ator, org, "cilindros", c.id, "UPDATE", "cylinder.update", depois);
        return ok("UPDATED", { cylinder_id: c.id, version: Number(r.rows[0]!.versao) });
      });
    }
    case "save_type": {
      exige(ctx, "cylinder.write");
      if (typeof corpo.gas !== "string" || corpo.gas.trim().length < 2 || corpo.gas.trim().length > 80) campos.push({ field: "gas", message: "Gás de 2 a 80 caracteres." });
      if (typeof corpo.capacity_value !== "number" || !(corpo.capacity_value > 0)) campos.push({ field: "capacity_value", message: "Capacidade maior que zero." });
      if (!UNIDADE[corpo.capacity_unit]) campos.push({ field: "capacity_unit", message: "Use l, m3 ou kg." });
      if (!CLASSE[corpo.classification]) campos.push({ field: "classification", message: "Use medicinal ou industrial." });
      if (corpo.type_id !== undefined && !ehUuid(corpo.type_id)) campos.push({ field: "type_id", message: "Tipo inválido." });
      if (corpo.active !== undefined && typeof corpo.active !== "boolean") campos.push({ field: "active", message: "Use true ou false." });
      if (campos.length) return invalido(campos);
      return transacao(banco, ctx, async client => {
        const valores = [corpo.gas.trim(), corpo.capacity_value, UNIDADE[corpo.capacity_unit], CLASSE[corpo.classification], corpo.active ?? true];
        let id: string;
        if (corpo.type_id) {
          const r = await client.query<{ id: string }>(`
            UPDATE public.tipos_cilindro SET gas = $1, capacidade_valor = $2, capacidade_unidade = $3, classificacao = $4, ativo = $5
            WHERE id = $6 AND organizacao_id = $7 RETURNING id`, [...valores, corpo.type_id, org]);
          if (!r.rows[0]) return naoEncontrado();
          id = r.rows[0].id;
        } else {
          const r = await client.query<{ id: string }>(`
            INSERT INTO public.tipos_cilindro (organizacao_id, gas, capacidade_valor, capacidade_unidade, classificacao, ativo, criado_por)
            VALUES ($6, $1, $2, $3, $4, $5, $7) RETURNING id`, [...valores, org, ctx.usuarioId]);
          id = r.rows[0]!.id;
        }
        await auditar(client, ator, org, "tipos_cilindro", id, corpo.type_id ? "UPDATE" : "INSERT", "cylinder.type_save");
        return ok("SAVED", { type_id: id });
      });
    }
    case "inactivate": {
      exige(ctx, "cylinder.deactivate");
      if (!MOTIVO[corpo.reason]) campos.push({ field: "reason", message: "Motivo desconhecido." });
      if (campos.length) return invalido(campos);
      if (!justificativaValida(corpo.justification)) return falha(400, "JUSTIFICATION_REQUIRED");
      return transacao(banco, ctx, async client => {
        const c = await bloquearCilindro(client, org, corpo.cylinder_id);
        if (c.status === "INATIVO") return falha(409, "ALREADY_INACTIVE");
        const r = await client.query<{ versao: string }>(`
          UPDATE public.cilindros SET status = 'INATIVO', motivo_inativacao = $2, situacao_estoque = 'FORA_DO_ESTOQUE',
            versao = versao + 1, atualizado_em = now() WHERE id = $1 RETURNING versao`, [c.id, MOTIVO[corpo.reason]]);
        await registrarHistorico(client, c.id, "CILINDRO_INATIVADO", ctx.usuarioId, { motivo: MOTIVO[corpo.reason], status_anterior: c.status }, corpo.justification.trim());
        if (c.situacao_estoque === "EM_ESTOQUE") {
          await registrarHistorico(client, c.id, "SAIDA_ESTOQUE_INATIVACAO", ctx.usuarioId, {});
        }
        await auditar(client, ator, org, "cilindros", c.id, "UPDATE", "cylinder.inactivate", { motivo: MOTIVO[corpo.reason] });
        return ok("INACTIVATED", { version: Number(r.rows[0]!.versao) });
      });
    }
    case "reactivate": {
      exige(ctx, "cylinder.deactivate");
      if (!justificativaValida(corpo.justification)) return falha(400, "JUSTIFICATION_REQUIRED");
      return transacao(banco, ctx, async client => {
        const c = await bloquearCilindro(client, org, corpo.cylinder_id);
        if (c.status !== "INATIVO") return invalido([{ field: "cylinder_id", message: "O cilindro já está ativo." }]);
        const r = await client.query<{ versao: string }>(`
          UPDATE public.cilindros SET status = 'DISPONIVEL', motivo_inativacao = NULL, versao = versao + 1, atualizado_em = now()
          WHERE id = $1 RETURNING versao`, [c.id]);
        await registrarHistorico(client, c.id, "CILINDRO_REATIVADO", ctx.usuarioId, {}, corpo.justification.trim());
        await auditar(client, ator, org, "cilindros", c.id, "UPDATE", "cylinder.reactivate");
        return ok("REACTIVATED", { version: Number(r.rows[0]!.versao) });
      });
    }
    case "add_identifier": {
      exige(ctx, "cylinder.identifier");
      lerIdentificador(corpo.kind, corpo.value, campos);
      if (campos.length) return invalido(campos);
      return transacao(banco, ctx, async client => {
        const c = await bloquearCilindro(client, org, corpo.cylinder_id);
        if (c.status === "INATIVO") return falha(409, "CYLINDER_INACTIVE");
        await conferirIdentificador(client, org, corpo.value);
        const r = await client.query<{ id: string }>(`
          INSERT INTO public.identificadores_cilindro (organizacao_id, cilindro_id, tipo, valor, status, criado_por)
          VALUES ($1, $2, $3, $4, 'ATIVO', $5) RETURNING id`, [org, c.id, KIND[corpo.kind], corpo.value.trim(), ctx.usuarioId]);
        await registrarHistorico(client, c.id, "IDENTIFICADOR_ADICIONADO", ctx.usuarioId, { kind: corpo.kind });
        await auditar(client, ator, org, "identificadores_cilindro", r.rows[0]!.id, "INSERT", "cylinder.identifier_add");
        return ok("ADDED", { identifier_id: r.rows[0]!.id }, 201);
      });
    }
    case "deactivate_identifier": {
      exige(ctx, "cylinder.identifier");
      if (!justificativaValida(corpo.justification)) return falha(400, "JUSTIFICATION_REQUIRED");
      if (!ehUuid(corpo.identifier_id)) return naoEncontrado();
      return transacao(banco, ctx, async client => {
        const r = await client.query<{ cilindro_id: string }>(`
          UPDATE public.identificadores_cilindro SET status = 'DESATIVADO', desativado_em = now(), desativado_por = $3,
            justificativa_desativacao = $4
          WHERE id = $1 AND organizacao_id = $2 AND status = 'ATIVO' RETURNING cilindro_id`,
          [corpo.identifier_id, org, ctx.usuarioId, corpo.justification.trim()]);
        if (!r.rows[0]) return naoEncontrado();
        await registrarHistorico(client, r.rows[0].cilindro_id, "IDENTIFICADOR_DESATIVADO", ctx.usuarioId, {}, corpo.justification.trim());
        await auditar(client, ator, org, "identificadores_cilindro", corpo.identifier_id, "UPDATE", "cylinder.identifier_deactivate");
        return ok("DEACTIVATED");
      });
    }
    case "transfer_identifier": {
      exige(ctx, "cylinder.identifier");
      if (!ehTexto(corpo.value)) campos.push({ field: "value", message: "Informe o identificador." });
      if (corpo.confirmed !== true) campos.push({ field: "confirmed", message: "Confirme a transferência." });
      if (campos.length) return invalido(campos);
      if (!justificativaValida(corpo.justification)) return falha(400, "JUSTIFICATION_REQUIRED");
      return transacao(banco, ctx, async client => {
        const destino = await bloquearCilindro(client, org, corpo.target_cylinder_id);
        if (destino.status === "INATIVO") return falha(409, "CYLINDER_INACTIVE");
        const origem = (await client.query(`
          SELECT * FROM public.identificadores_cilindro WHERE organizacao_id = $1 AND valor_normalizado = upper(btrim($2))
          ORDER BY (status = 'ATIVO') DESC, criado_em DESC LIMIT 1 FOR UPDATE`, [org, corpo.value])).rows[0];
        if (!origem) return naoEncontrado();
        if (origem.cilindro_id === destino.id && origem.status === "ATIVO") {
          return invalido([{ field: "target_cylinder_id", message: "O identificador já está neste cilindro." }]);
        }
        // Ordem: desativa o atual (libera o índice único) e cria o novo ativo
        if (origem.status === "ATIVO") {
          await client.query(`
            UPDATE public.identificadores_cilindro SET status = 'DESATIVADO', desativado_em = now(), desativado_por = $2,
              justificativa_desativacao = $3 WHERE id = $1`, [origem.id, ctx.usuarioId, corpo.justification.trim()]);
        }
        const criado = await client.query<{ id: string }>(`
          INSERT INTO public.identificadores_cilindro (organizacao_id, cilindro_id, tipo, valor, status, criado_por)
          VALUES ($1, $2, $3, $4, 'ATIVO', $5) RETURNING id`, [org, destino.id, origem.tipo, origem.valor, ctx.usuarioId]);
        await client.query("UPDATE public.identificadores_cilindro SET transferido_para_id = $2 WHERE id = $1", [origem.id, criado.rows[0]!.id]);
        await registrarHistorico(client, origem.cilindro_id, "IDENTIFICADOR_TRANSFERIDO_SAIDA", ctx.usuarioId, { para: destino.id }, corpo.justification.trim());
        await registrarHistorico(client, destino.id, "IDENTIFICADOR_TRANSFERIDO_ENTRADA", ctx.usuarioId, { de: origem.cilindro_id }, corpo.justification.trim());
        await auditar(client, ator, org, "identificadores_cilindro", criado.rows[0]!.id, "INSERT", "cylinder.identifier_transfer");
        return ok("TRANSFERRED", { identifier_id: criado.rows[0]!.id });
      });
    }
    case "stock_in": {
      exige(ctx, "cylinder.stock_in");
      if (!ehTexto(corpo.identifier_value)) campos.push({ field: "identifier_value", message: "Informe o identificador." });
      if (!ehUuid(corpo.operation_key)) campos.push({ field: "operation_key", message: "Chave de operação (UUID) obrigatória." });
      if (campos.length) return invalido(campos);
      const pedidoHash = sha256(`stock_in:${corpo.identifier_value.trim().toUpperCase()}`);
      return transacao(banco, ctx, async client => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`chave:${corpo.operation_key}`]);
        const repetida = (await client.query<{ pedido_hash: string; resultado: Linha }>(
          "SELECT pedido_hash, resultado FROM public.chaves_operacao WHERE chave = $1 AND organizacao_id = $2", [corpo.operation_key, org])).rows[0];
        if (repetida) {
          if (repetida.pedido_hash !== pedidoHash) return falha(409, "IDEMPOTENCY_PAYLOAD_CONFLICT");
          return ok("STOCKED", { ...repetida.resultado, replayed: true });
        }
        const ident = (await client.query(`
          SELECT cilindro_id, status FROM public.identificadores_cilindro
          WHERE organizacao_id = $1 AND valor_normalizado = upper(btrim($2)) ORDER BY (status = 'ATIVO') DESC LIMIT 1`,
          [org, corpo.identifier_value])).rows[0];
        if (!ident) return naoEncontrado();
        const c = await bloquearCilindro(client, org, ident.cilindro_id);
        if (ident.status !== "ATIVO") return falha(404, "NOT_FOUND", { deactivated: true, cylinder: { id: c.id, serial_number: c.numero_serie } });
        if (c.status === "INATIVO") return falha(409, "CYLINDER_INACTIVE");
        if (c.situacao_estoque === "EM_ESTOQUE") return falha(409, "ALREADY_IN_STOCK");
        const hydro = await hydroDe(client, org, c.id);
        // Voltou ao depósito: deixa de estar com o cliente (encerra a custódia)
        await client.query("UPDATE public.custodias SET data_fim = now() WHERE cilindro_id = $1 AND data_fim IS NULL", [c.id]);
        await client.query(`
          UPDATE public.cilindros SET situacao_estoque = 'EM_ESTOQUE',
            status = CASE WHEN status IN ('COM_CLIENTE', 'EM_TRANSITO', 'EXTRAVIADO') THEN 'DISPONIVEL' ELSE status END,
            versao = versao + 1, atualizado_em = now() WHERE id = $1`, [c.id]);
        const seq = await registrarHistorico(client, c.id, "ENTRADA_ESTOQUE", ctx.usuarioId, { hydro_status: hydro, status_anterior: c.status });
        const resultado = {
          cylinder: { id: c.id, serial_number: c.numero_serie, stock_status: "in_stock" }, event_sequence: seq, hydro_status: hydro,
          ...(hydro === "vencido" ? { warning: "hydro_expired" } : hydro === "reprovado" ? { warning: "hydro_rejected" } : {})
        };
        await client.query(`
          INSERT INTO public.chaves_operacao (organizacao_id, chave, operacao, pedido_hash, resultado, usuario_id)
          VALUES ($1, $2, 'cylinder.stock_in', $3, $4, $5)`, [org, corpo.operation_key, pedidoHash, resultado, ctx.usuarioId]);
        await auditar(client, ator, org, "cilindros", c.id, "UPDATE", "cylinder.stock_in");
        return ok("STOCKED", { ...resultado, replayed: false });
      });
    }
    case "register_test":
    case "rectify_test": {
      exige(ctx, "cylinder.test");
      const retifica = corpo.operation === "rectify_test";
      if (!ehData(corpo.performed_on)) campos.push({ field: "performed_on", message: "Data no formato AAAA-MM-DD." });
      if (!RESULTADO[corpo.result]) campos.push({ field: "result", message: "Use approved ou rejected." });
      if (!ehTexto(corpo.executor) || corpo.executor.length > 120) campos.push({ field: "executor", message: "Informe quem executou." });
      if (corpo.next_due_on != null && !ehData(corpo.next_due_on)) campos.push({ field: "next_due_on", message: "Data no formato AAAA-MM-DD." });
      if (ehData(corpo.performed_on) && ehData(corpo.next_due_on) && corpo.next_due_on <= corpo.performed_on) {
        campos.push({ field: "next_due_on", message: "O próximo teste deve ser depois do teste." });
      }
      if (ehData(corpo.performed_on) && corpo.performed_on > new Date().toISOString().slice(0, 10)) {
        campos.push({ field: "performed_on", message: "O teste não pode estar no futuro." });
      }
      if (campos.length) return invalido(campos);
      if (retifica && !justificativaValida(corpo.justification)) return falha(400, "JUSTIFICATION_REQUIRED");
      return transacao(banco, ctx, async client => {
        let cilindroId: string;
        if (retifica) {
          if (!ehUuid(corpo.test_id)) return naoEncontrado();
          const t = (await client.query<{ cilindro_id: string }>(`
            SELECT t.cilindro_id FROM public.testes_hidrostaticos t JOIN public.cilindros c ON c.id = t.cilindro_id
            WHERE t.id = $1 AND c.organizacao_id = $2`, [corpo.test_id, org])).rows[0];
          if (!t) return naoEncontrado();
          cilindroId = t.cilindro_id;
        } else {
          cilindroId = (await bloquearCilindro(client, org, corpo.cylinder_id)).id;
        }
        // Sem próxima data: 5 anos depois do teste (prazo usual de requalificação)
        const proximo = corpo.next_due_on ?? `${Number(corpo.performed_on.slice(0, 4)) + 5}${corpo.performed_on.slice(4)}`;
        const r = await client.query<{ id: string }>(`
          INSERT INTO public.testes_hidrostaticos (cilindro_id, data_teste, proximo_teste, resultado, observacao, realizado_por,
            criado_por, numero_laudo, retifica_teste_id, justificativa_retificacao)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [cilindroId, corpo.performed_on, proximo, RESULTADO[corpo.result], corpo.notes ?? null, corpo.executor.trim(), ctx.usuarioId,
           corpo.report_number ?? null, retifica ? corpo.test_id : null, retifica ? corpo.justification.trim() : null]);
        await registrarHistorico(client, cilindroId, retifica ? "TESTE_HIDROSTATICO_RETIFICADO" : "TESTE_HIDROSTATICO_REGISTRADO",
          ctx.usuarioId, { teste_id: r.rows[0]!.id, resultado: RESULTADO[corpo.result], proximo_teste: proximo },
          retifica ? corpo.justification.trim() : null);
        await auditar(client, ator, org, "testes_hidrostaticos", r.rows[0]!.id, "INSERT", retifica ? "cylinder.test_rectify" : "cylinder.test_register");
        return ok(retifica ? "RECTIFIED" : "REGISTERED", { test_id: r.rows[0]!.id }, 201);
      }).catch(erro => {
        if (violacaoUnica(erro) === "uq_teste_retificado_uma_vez") return falha(409, "TEST_ALREADY_RECTIFIED");
        throw erro;
      });
    }
    default:
      return invalido([{ field: "operation", message: "Operação desconhecida." }]);
  }
}
