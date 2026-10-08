import { promises as fs } from "fs";
import path from "path";
import { Pool } from "pg";
import {
  Contexto, ErroDeRegra, Resposta, auditar, ehTexto, ehUuid, falha, hashSenha, invalido, lerCursor, limiteDe,
  naoEncontrado, negado, novoToken, ok, proximoCodigo, proximoCursor, senhaAceitavel, sha256, transacao, violacaoUnica
} from "../base";

// query-permissions, manage-organizations, manage-membership, manage-access,
// invite-user, query-audit e profile-avatar (Contrato seção 5; D4 e D7)

type Linha = Record<string, any>;
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const STATUS_ORG: Record<string, string> = { active: "ATIVA", inactive: "INATIVA", suspended: "SUSPENSA" };
const STATUS_VINCULO: Record<string, string> = { active: "ATIVO", blocked: "BLOQUEADO", inactive: "INATIVO" };
const emailValido = (v: unknown): v is string => typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

function exige(ctx: Contexto, permissao: string, global = false): void {
  if (!(global ? ctx.global : ctx.permissoes).has(permissao)) throw new ErroDeRegra(negado());
}

const expor = (token: string): Record<string, unknown> => (process.env.APP_EXPOR_TOKENS === "1" ? { invite_token: token } : {});

export async function queryPermissions(_banco: Pool, ctx: Contexto): Promise<Resposta> {
  return ok("PERMISSIONS_LISTED", { tenant: [...ctx.permissoes].sort(), global: [...ctx.global].sort(), organization_id: ctx.organizacaoId });
}

// ----------------------------------------------------------- organizações

export async function manageOrganizations(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  const ator = { usuarioId: ctx.usuarioId, organizacaoId: ctx.organizacaoId };
  const json = (o: Linha) => ({
    id: o.id, code: o.codigo, legal_name: o.razao_social, name: o.nome_fantasia, cnpj: o.cnpj, email: o.email,
    status: Object.entries(STATUS_ORG).find(([, v]) => v === o.status)?.[0] ?? o.status, created_at: iso(o.criado_em)
  });
  switch (corpo.operation ?? "list") {
    case "list": {
      // Plataforma vê todas; os demais, as organizações em que têm vínculo
      const todas = ctx.global.has("platform.manage");
      const r = await banco.query(todas
        ? "SELECT * FROM public.organizacoes ORDER BY nome_fantasia"
        : `SELECT o.* FROM public.organizacoes o JOIN public.usuario_organizacoes uo ON uo.organizacao_id = o.id
           WHERE uo.usuario_id = $1 AND uo.status = 'ATIVO' ORDER BY o.nome_fantasia`, todas ? [] : [ctx.usuarioId]);
      return ok("LISTED", { items: r.rows.map(json) });
    }
    case "create": {
      exige(ctx, "platform.manage", true);
      const campos: Array<{ field: string; message: string }> = [];
      if (!ehTexto(corpo.legal_name)) campos.push({ field: "legal_name", message: "Obrigatório." });
      if (!ehTexto(corpo.name)) campos.push({ field: "name", message: "Obrigatório." });
      if (typeof corpo.cnpj !== "string" || corpo.cnpj.replace(/\D/g, "").length !== 14) campos.push({ field: "cnpj", message: "CNPJ com 14 dígitos." });
      if (!emailValido(corpo.email)) campos.push({ field: "email", message: "E-mail inválido." });
      if (campos.length) return invalido(campos);
      return transacao(banco, ctx, async client => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('fluxid.organizacoes.codigo'))");
        const codigo = await proximoCodigo(client, "organizacoes", "ORG");
        const r = await client.query(`
          INSERT INTO public.organizacoes (codigo, razao_social, nome_fantasia, cnpj, email, status)
          VALUES ($1, $2, $3, $4, $5, 'ATIVA') RETURNING *`,
          [codigo, corpo.legal_name.trim(), corpo.name.trim(), corpo.cnpj.replace(/\D/g, ""), corpo.email.trim().toLowerCase()]);
        await auditar(client, ator, r.rows[0].id, "organizacoes", r.rows[0].id, "INSERT", "organization.create");
        return ok("CREATED", { organization: json(r.rows[0]) }, 201);
      }).catch(erro => {
        if (violacaoUnica(erro) === "organizacoes_cnpj_key") return falha(409, "CNPJ_CONFLICT");
        throw erro;
      });
    }
    case "change_status": {
      exige(ctx, "platform.manage", true);
      if (!ehUuid(corpo.target_organization_id)) return naoEncontrado();
      if (!STATUS_ORG[corpo.status]) return invalido([{ field: "status", message: "Use active, inactive ou suspended." }]);
      const r = await banco.query("UPDATE public.organizacoes SET status = $2, atualizado_em = now() WHERE id = $1 RETURNING id",
        [corpo.target_organization_id, STATUS_ORG[corpo.status]]);
      if (!r.rows[0]) return naoEncontrado();
      await auditar(banco, ator, corpo.target_organization_id, "organizacoes", corpo.target_organization_id, "UPDATE", `organization.status_${corpo.status}`);
      return ok("UPDATED");
    }
    case "invite_first_admin": {
      exige(ctx, "platform.manage", true);
      if (!ehUuid(corpo.target_organization_id)) return naoEncontrado();
      return criarConvite(banco, ctx, corpo.target_organization_id, corpo.email, "ORG_ADMIN");
    }
    default:
      return invalido([{ field: "operation", message: "Use list, create, change_status ou invite_first_admin." }]);
  }
}

// --------------------------------------------------------------- pessoas

export async function manageMembership(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  exige(ctx, "tenant.manage");
  const org = ctx.organizacaoId!;
  switch (corpo.operation ?? "list") {
    case "list": {
      const r = await banco.query(`
        SELECT u.id, u.codigo, u.nome, u.email, u.ultimo_login, uo.status, uo.criado_em,
               COALESCE(array_agg(pf.codigo ORDER BY pf.codigo) FILTER (WHERE pf.codigo IS NOT NULL), '{}') AS papeis
        FROM public.usuario_organizacoes uo JOIN public.usuarios u ON u.id = uo.usuario_id
        LEFT JOIN public.usuario_organizacao_perfis uop ON uop.usuario_id = uo.usuario_id AND uop.organizacao_id = uo.organizacao_id
        LEFT JOIN public.perfis pf ON pf.id = uop.perfil_id
        WHERE uo.organizacao_id = $1 GROUP BY u.id, uo.status, uo.criado_em ORDER BY u.nome`, [org]);
      return ok("LISTED", { items: r.rows.map(m => ({
        user_id: m.id, code: m.codigo, name: m.nome, email: m.email, last_login_at: iso(m.ultimo_login),
        status: Object.entries(STATUS_VINCULO).find(([, v]) => v === m.status)?.[0], roles: m.papeis, member_since: iso(m.criado_em)
      })) });
    }
    case "change_status": {
      if (!ehUuid(corpo.user_id)) return naoEncontrado();
      if (!STATUS_VINCULO[corpo.status]) return invalido([{ field: "status", message: "Use active, blocked ou inactive." }]);
      if (corpo.user_id === ctx.usuarioId) return invalido([{ field: "user_id", message: "Não é possível alterar o próprio vínculo." }]);
      const r = await banco.query(`
        UPDATE public.usuario_organizacoes SET status = $3, atualizado_em = now() WHERE usuario_id = $1 AND organizacao_id = $2 RETURNING usuario_id`,
        [corpo.user_id, org, STATUS_VINCULO[corpo.status]]);
      if (!r.rows[0]) return naoEncontrado();
      await auditar(banco, { usuarioId: ctx.usuarioId, organizacaoId: org }, org, "usuario_organizacoes", corpo.user_id, "UPDATE", `membership.${corpo.status}`);
      return ok("UPDATED");
    }
    default:
      return invalido([{ field: "operation", message: "Use list ou change_status." }]);
  }
}

// ---------------------------------------------------------------- papéis

export async function manageAccess(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  const org = ctx.organizacaoId;
  const ator = { usuarioId: ctx.usuarioId, organizacaoId: org };
  switch (corpo.operation ?? "list") {
    case "list": {
      exige(ctx, "tenant.manage");
      const r = await banco.query(`
        SELECT pf.id, pf.codigo, pf.nome, pf.descricao, pf.ativo,
               COALESCE(array_agg(pm.codigo ORDER BY pm.codigo) FILTER (WHERE pm.codigo IS NOT NULL), '{}') AS permissoes
        FROM public.perfis pf LEFT JOIN public.perfil_permissoes pp ON pp.perfil_id = pf.id
        LEFT JOIN public.permissoes pm ON pm.id = pp.permissao_id
        GROUP BY pf.id ORDER BY pf.codigo`);
      const todas = await banco.query("SELECT codigo, nome FROM public.permissoes WHERE ativo ORDER BY codigo");
      return ok("LISTED", {
        roles: r.rows.map(p => ({ id: p.id, code: p.codigo, name: p.nome, description: p.descricao, active: p.ativo, permissions: p.permissoes })),
        permissions: todas.rows.map(p => ({ code: p.codigo, name: p.nome }))
      });
    }
    case "assign_role":
    case "remove_role": {
      exige(ctx, "tenant.manage");
      if (!ehUuid(corpo.user_id)) return naoEncontrado();
      if (!ehTexto(corpo.role_code)) return invalido([{ field: "role_code", message: "Informe o papel." }]);
      if (corpo.role_code === "FLUXID_MASTER" && !ctx.global.has("platform.manage")) return negado();
      return transacao(banco, ctx, async client => {
        const perfil = (await client.query("SELECT id FROM public.perfis WHERE codigo = $1 AND ativo", [corpo.role_code])).rows[0];
        if (!perfil) return naoEncontrado();
        const membro = (await client.query("SELECT 1 FROM public.usuario_organizacoes WHERE usuario_id = $1 AND organizacao_id = $2", [corpo.user_id, org])).rows[0];
        if (!membro) return naoEncontrado();
        if (corpo.operation === "assign_role") {
          await client.query(`
            INSERT INTO public.usuario_organizacao_perfis (usuario_id, organizacao_id, perfil_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [corpo.user_id, org, perfil.id]);
        } else {
          await client.query("DELETE FROM public.usuario_organizacao_perfis WHERE usuario_id = $1 AND organizacao_id = $2 AND perfil_id = $3",
            [corpo.user_id, org, perfil.id]);
        }
        await auditar(client, ator, org!, "usuario_organizacao_perfis", corpo.user_id, corpo.operation === "assign_role" ? "INSERT" : "DELETE",
          `access.${corpo.operation} ${corpo.role_code}`);
        return ok("UPDATED");
      });
    }
    case "save_role": {
      // Papéis são do sistema todo (perfis): só a plataforma altera
      exige(ctx, "platform.manage", true);
      if (typeof corpo.code !== "string" || !/^[A-Z][A-Z0-9_]{2,29}$/.test(corpo.code)) return invalido([{ field: "code", message: "Código em maiúsculas (3 a 30)." }]);
      if (!ehTexto(corpo.name)) return invalido([{ field: "name", message: "Obrigatório." }]);
      if (!Array.isArray(corpo.permissions) || !corpo.permissions.every(ehTexto)) return invalido([{ field: "permissions", message: "Lista de códigos de permissão do FluxID." }]);
      return transacao(banco, ctx, async client => {
        const perfil = (await client.query<{ id: string }>(`
          INSERT INTO public.perfis (codigo, nome, descricao, ativo) VALUES ($1, $2, $3, true)
          ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, descricao = EXCLUDED.descricao, atualizado_em = now() RETURNING id`,
          [corpo.code, corpo.name.trim(), corpo.description ?? null])).rows[0]!;
        const perms = await client.query<{ id: string; codigo: string }>("SELECT id, codigo FROM public.permissoes WHERE codigo = ANY($1)", [corpo.permissions]);
        if (perms.rows.length !== new Set(corpo.permissions).size) throw new ErroDeRegra(invalido([{ field: "permissions", message: "Permissão desconhecida." }]));
        await client.query("DELETE FROM public.perfil_permissoes WHERE perfil_id = $1", [perfil.id]);
        for (const p of perms.rows) await client.query("INSERT INTO public.perfil_permissoes (perfil_id, permissao_id) VALUES ($1, $2)", [perfil.id, p.id]);
        await auditar(client, ator, org!, "perfis", perfil.id, "UPDATE", `access.save_role ${corpo.code}`, { permissoes: corpo.permissions });
        return ok("SAVED", { role_id: perfil.id });
      });
    }
    case "set_role_active": {
      exige(ctx, "platform.manage", true);
      if (typeof corpo.active !== "boolean" || !ehTexto(corpo.role_code)) return invalido([{ field: "active", message: "Informe role_code e active." }]);
      if (corpo.role_code === "FLUXID_MASTER") return invalido([{ field: "role_code", message: "O papel da plataforma não pode ser desativado." }]);
      const r = await banco.query<{ id: string }>("UPDATE public.perfis SET ativo = $2, atualizado_em = now() WHERE codigo = $1 RETURNING id", [corpo.role_code, corpo.active]);
      if (!r.rows[0]) return naoEncontrado();
      await auditar(banco, ator, org!, "perfis", r.rows[0].id, "UPDATE", `access.set_role_active ${corpo.role_code}=${corpo.active}`);
      return ok("UPDATED");
    }
    default:
      return invalido([{ field: "operation", message: "Use list, assign_role, remove_role, save_role ou set_role_active." }]);
  }
}

// --------------------------------------------------------------- convites

async function criarConvite(banco: Pool, ctx: Contexto, org: string, email: unknown, papel: unknown): Promise<Resposta> {
  if (!emailValido(email)) return invalido([{ field: "email", message: "E-mail inválido." }]);
  if (!ehTexto(papel)) return invalido([{ field: "role_code", message: "Informe o papel." }]);
  if (papel === "FLUXID_MASTER" && !ctx.global.has("platform.manage")) return negado();
  const perfil = (await banco.query<{ id: string }>("SELECT id FROM public.perfis WHERE codigo = $1 AND ativo", [papel])).rows[0];
  if (!perfil) return invalido([{ field: "role_code", message: "Papel desconhecido." }]);
  const token = novoToken();
  const r = await banco.query<{ id: string; expira_em: Date }>(`
    INSERT INTO public.convites (organizacao_id, email, perfil_id, token_hash, criado_por, expira_em)
    VALUES ($1, $2, $3, $4, $5, now() + interval '7 days') RETURNING id, expira_em`,
    [org, email.trim().toLowerCase(), perfil.id, sha256(token), ctx.usuarioId]);
  await auditar(banco, { usuarioId: ctx.usuarioId, organizacaoId: org }, org, "convites", r.rows[0]!.id, "INSERT", `invite.create ${papel}`);
  return ok("INVITED", { invite_id: r.rows[0]!.id, expires_at: iso(r.rows[0]!.expira_em), ...expor(token) }, 201);
}

// accept é público (a pessoa ainda não tem login): o token prova o convite
export async function inviteUser(banco: Pool, ctx: Contexto | null, corpo: Linha): Promise<Resposta> {
  if (corpo.operation === "accept") {
    if (!ehTexto(corpo.token)) return invalido([{ field: "token", message: "Token do convite obrigatório." }]);
    return transacao(banco, null, async client => {
      const convite = (await client.query(`
        SELECT * FROM public.convites WHERE token_hash = $1 AND status = 'ENVIADO' AND expira_em > now() FOR UPDATE`, [sha256(corpo.token)])).rows[0];
      if (!convite) return falha(400, "INVITE_INVALID");
      let pessoa = (await client.query<{ id: string }>("SELECT id FROM public.usuarios WHERE lower(email) = $1", [convite.email])).rows[0];
      if (!pessoa) {
        const campos: Array<{ field: string; message: string }> = [];
        if (!ehTexto(corpo.name) || corpo.name.length > 150) campos.push({ field: "name", message: "Informe o nome." });
        if (!senhaAceitavel(corpo.password)) campos.push({ field: "password", message: "Senha de 8 a 128 caracteres." });
        if (campos.length) return invalido(campos);
        await client.query("SELECT pg_advisory_xact_lock(hashtext('fluxid.usuarios.codigo'))");
        const codigo = await proximoCodigo(client, "usuarios", "USR");
        pessoa = (await client.query<{ id: string }>(`
          INSERT INTO public.usuarios (organizacao_id, codigo, nome, email, senha_hash, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
          [convite.organizacao_id, codigo, corpo.name.trim(), convite.email, hashSenha(corpo.password as string)])).rows[0]!;
      }
      await client.query(`
        INSERT INTO public.usuario_organizacoes (usuario_id, organizacao_id, status) VALUES ($1, $2, 'ATIVO')
        ON CONFLICT (usuario_id, organizacao_id) DO UPDATE SET status = 'ATIVO', atualizado_em = now()`, [pessoa.id, convite.organizacao_id]);
      await client.query(`
        INSERT INTO public.usuario_organizacao_perfis (usuario_id, organizacao_id, perfil_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [pessoa.id, convite.organizacao_id, convite.perfil_id]);
      await client.query("UPDATE public.convites SET status = 'ACEITO', aceito_em = now() WHERE id = $1", [convite.id]);
      await auditar(client, { usuarioId: pessoa.id, organizacaoId: convite.organizacao_id }, convite.organizacao_id, "convites", convite.id, "UPDATE", "invite.accept");
      return ok("INVITE_ACCEPTED", { user_id: pessoa.id, organization_id: convite.organizacao_id });
    });
  }

  if (!ctx) return falha(401, "AUTH_REQUIRED");
  exige(ctx, "tenant.manage");
  const org = ctx.organizacaoId!;
  switch (corpo.operation ?? "invite") {
    case "invite":
      return criarConvite(banco, ctx, org, corpo.email, corpo.role_code);
    case "list": {
      const r = await banco.query(`
        SELECT c.id, c.email, c.status, c.criado_em, c.expira_em, c.aceito_em, p.codigo AS papel
        FROM public.convites c JOIN public.perfis p ON p.id = c.perfil_id WHERE c.organizacao_id = $1 ORDER BY c.criado_em DESC`, [org]);
      return ok("LISTED", { items: r.rows.map(c => ({
        id: c.id, email: c.email, role_code: c.papel,
        status: c.status === "ENVIADO" && c.expira_em < new Date() ? "EXPIRADO" : c.status,
        created_at: iso(c.criado_em), expires_at: iso(c.expira_em), accepted_at: iso(c.aceito_em)
      })) });
    }
    case "resend":
    case "revoke": {
      if (!ehUuid(corpo.invite_id)) return naoEncontrado();
      const token = novoToken();
      const r = await banco.query<{ id: string }>(corpo.operation === "resend"
        ? `UPDATE public.convites SET token_hash = $3, expira_em = now() + interval '7 days', status = 'ENVIADO'
           WHERE id = $1 AND organizacao_id = $2 AND status IN ('ENVIADO', 'EXPIRADO') RETURNING id`
        : `UPDATE public.convites SET status = 'REVOGADO' WHERE id = $1 AND organizacao_id = $2 AND status = 'ENVIADO' RETURNING id`,
        corpo.operation === "resend" ? [corpo.invite_id, org, sha256(token)] : [corpo.invite_id, org]);
      if (!r.rows[0]) return naoEncontrado();
      await auditar(banco, { usuarioId: ctx.usuarioId, organizacaoId: org }, org, "convites", corpo.invite_id, "UPDATE", `invite.${corpo.operation}`);
      return ok(corpo.operation === "resend" ? "INVITE_RESENT" : "INVITE_REVOKED", corpo.operation === "resend" ? expor(token) : {});
    }
    default:
      return invalido([{ field: "operation", message: "Use invite, list, resend, revoke ou accept." }]);
  }
}

// --------------------------------------------------------------- auditoria

export async function queryAudit(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  exige(ctx, "audit.read");
  const org = ctx.organizacaoId!;
  const filtros = ["a.organizacao_id = $1"];
  const valores: unknown[] = [org];
  const campos: Array<{ field: string; message: string }> = [];
  for (const [campo, op] of [["from", ">="], ["to", "<="]] as const) {
    if (corpo[campo] === undefined) continue;
    if (typeof corpo[campo] !== "string" || Number.isNaN(Date.parse(corpo[campo]))) { campos.push({ field: campo, message: "Data inválida." }); continue; }
    valores.push(corpo[campo]);
    filtros.push(`a.ocorrido_em ${op} $${valores.length}`);
  }
  if (corpo.action !== undefined) {
    if (!["INSERT", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "AUTORIZACAO"].includes(corpo.action)) campos.push({ field: "action", message: "Ação desconhecida." });
    valores.push(corpo.action);
    filtros.push(`a.acao = $${valores.length}`);
  }
  if (corpo.actor_id !== undefined) {
    if (!ehUuid(corpo.actor_id)) campos.push({ field: "actor_id", message: "Pessoa inválida." });
    valores.push(corpo.actor_id);
    filtros.push(`a.usuario_id = $${valores.length}`);
  }
  if (ehTexto(corpo.table)) { valores.push(corpo.table); filtros.push(`a.tabela_afetada = $${valores.length}`); }
  if (campos.length) return invalido(campos);
  const limite = limiteDe(corpo.limit, 50);
  const inicio = lerCursor(corpo.cursor);
  const r = await banco.query(`
    SELECT a.id, a.acao, a.tabela_afetada, a.registro_id, a.observacao, a.ocorrido_em, u.nome AS ator
    FROM public.auditoria a LEFT JOIN public.usuarios u ON u.id = a.usuario_id
    WHERE ${filtros.join(" AND ")} ORDER BY a.ocorrido_em DESC LIMIT ${limite + 1} OFFSET ${inicio}`, valores);
  return ok("LISTED", { items: r.rows.slice(0, limite).map(a => ({
    id: a.id, action: a.acao, table: a.tabela_afetada, record_id: a.registro_id, note: a.observacao, actor_name: a.ator, occurred_at: iso(a.ocorrido_em)
  })), next: proximoCursor(inicio, r.rows.length, limite) });
}

// --------------------------------------------------------- foto da pessoa

// D7 (a): pasta do servidor (APP_PASTA_ARQUIVOS, padrão ./arquivos). Só a
// própria pessoa troca a foto; PNG, JPEG ou WEBP até 512 KB, enviada em base64
const TIPOS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const pastaFotos = (): string => path.resolve(process.cwd(), process.env.APP_PASTA_ARQUIVOS ?? "arquivos", "fotos");

export async function profileAvatar(banco: Pool, ctx: Contexto, corpo: Linha): Promise<Resposta> {
  const atual = (await banco.query<{ foto_caminho: string | null }>("SELECT foto_caminho FROM public.usuarios WHERE id = $1", [ctx.usuarioId])).rows[0];
  switch (corpo.operation ?? "get") {
    case "get": {
      if (!atual?.foto_caminho) return ok("NO_AVATAR");
      const arquivo = path.join(pastaFotos(), path.basename(atual.foto_caminho));
      const extensao = path.extname(arquivo).slice(1);
      const tipo = Object.entries(TIPOS).find(([, e]) => e === extensao)?.[0] ?? "application/octet-stream";
      const dados = await fs.readFile(arquivo).catch(() => null);
      return dados ? ok("FOUND", { content_type: tipo, data_base64: dados.toString("base64") }) : ok("NO_AVATAR");
    }
    case "upload": {
      const extensao = TIPOS[corpo.content_type];
      if (!extensao) return invalido([{ field: "content_type", message: "Use image/png, image/jpeg ou image/webp." }]);
      if (typeof corpo.data_base64 !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(corpo.data_base64)) return invalido([{ field: "data_base64", message: "Conteúdo em base64." }]);
      const dados = Buffer.from(corpo.data_base64, "base64");
      if (dados.length === 0 || dados.length > 512 * 1024) return invalido([{ field: "data_base64", message: "Imagem de até 512 KB." }]);
      const assinaturas: Record<string, (b: Buffer) => boolean> = {
        png: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
        jpg: b => b[0] === 0xff && b[1] === 0xd8,
        webp: b => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP"
      };
      if (!assinaturas[extensao]!(dados)) return invalido([{ field: "data_base64", message: "O conteúdo não corresponde ao tipo da imagem." }]);
      await fs.mkdir(pastaFotos(), { recursive: true });
      const nome = `${ctx.usuarioId}.${extensao}`;
      await fs.writeFile(path.join(pastaFotos(), nome), dados);
      if (atual?.foto_caminho && atual.foto_caminho !== nome) await fs.rm(path.join(pastaFotos(), path.basename(atual.foto_caminho)), { force: true });
      await banco.query("UPDATE public.usuarios SET foto_caminho = $2, atualizado_em = now() WHERE id = $1", [ctx.usuarioId, nome]);
      return ok("SAVED");
    }
    case "remove": {
      if (atual?.foto_caminho) await fs.rm(path.join(pastaFotos(), path.basename(atual.foto_caminho)), { force: true });
      await banco.query("UPDATE public.usuarios SET foto_caminho = NULL, atualizado_em = now() WHERE id = $1", [ctx.usuarioId]);
      return ok("REMOVED");
    }
    default:
      return invalido([{ field: "operation", message: "Use get, upload ou remove." }]);
  }
}
