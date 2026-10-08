import { Pool } from "pg";
import {
  FALHAS_PARA_BLOQUEIO, INATIVIDADE_MINUTOS, JANELA_BLOQUEIO_MINUTOS, SESSAO_MAXIMA_HORAS, SESSOES_POR_PESSOA, conferirSessao
} from "../acesso";
import {
  Resposta, auditar, conferirSenha, ehTexto, falha, hashSenha, novoToken, ok, senhaAceitavel, sha256, transacao
} from "../base";

// session-login, session-status, session-logout e password-recovery
// (Contrato seção 4; formato igual ao do session-service do frontend)

const emailValido = (valor: unknown): valor is string =>
  typeof valor === "string" && valor.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor.trim());

async function organizacoesDaPessoa(banco: Pool, usuarioId: string) {
  const resultado = await banco.query<{ id: string; codigo: string; nome: string; status: string; papeis: string[] }>(`
    SELECT o.id, o.codigo, o.nome_fantasia AS nome, uo.status,
           COALESCE(array_agg(pf.codigo ORDER BY pf.codigo) FILTER (WHERE pf.codigo IS NOT NULL), '{}') AS papeis
    FROM public.usuario_organizacoes uo
    JOIN public.organizacoes o ON o.id = uo.organizacao_id
    LEFT JOIN public.usuario_organizacao_perfis uop ON uop.usuario_id = uo.usuario_id AND uop.organizacao_id = uo.organizacao_id
    LEFT JOIN public.perfis pf ON pf.id = uop.perfil_id
    WHERE uo.usuario_id = $1 AND uo.status = 'ATIVO' AND o.status = 'ATIVA'
    GROUP BY o.id, uo.status ORDER BY o.nome_fantasia`, [usuarioId]);
  return resultado.rows.map(o => ({ id: o.id, code: o.codigo, name: o.nome, roles: o.papeis }));
}

export async function sessionLogin(banco: Pool, corpo: Record<string, unknown>, ip: string | null): Promise<Resposta> {
  if (!emailValido(corpo.email) || typeof corpo.password !== "string" || corpo.password === "" ||
      (corpo.revoke_session_id !== undefined && typeof corpo.revoke_session_id !== "string")) {
    return falha(400, "INVALID_REQUEST");
  }
  const email = corpo.email.trim().toLowerCase();
  const emailHash = sha256(email);

  // 5 falhas em 15 minutos bloqueiam o e-mail até a janela passar
  const falhas = await banco.query<{ n: string }>(`
    SELECT count(*) AS n FROM public.tentativas_login
    WHERE email_hash = $1 AND NOT sucesso AND ocorrido_em > now() - make_interval(mins => $2)
      AND ocorrido_em > COALESCE((SELECT max(ocorrido_em) FROM public.tentativas_login WHERE email_hash = $1 AND sucesso), '-infinity')`,
    [emailHash, JANELA_BLOQUEIO_MINUTOS]);
  if (Number(falhas.rows[0]?.n ?? 0) >= FALHAS_PARA_BLOQUEIO) {
    return falha(429, "RATE_LIMITED", { retry_after_minutes: JANELA_BLOQUEIO_MINUTOS });
  }

  const pessoa = (await banco.query<{ id: string; nome: string; senha_hash: string; ativo: boolean; organizacao_id: string }>(
    "SELECT id, nome, senha_hash, ativo, organizacao_id FROM public.usuarios WHERE lower(email) = $1", [email])).rows[0];

  // Mesmo custo de conferência com ou sem pessoa, para não revelar e-mails
  const senhaConfere = conferirSenha(corpo.password, pessoa?.senha_hash ?? hashSenha("comparacao-sem-usuario"));
  if (!pessoa || !senhaConfere) {
    await banco.query("INSERT INTO public.tentativas_login (email_hash, sucesso) VALUES ($1, false)", [emailHash]);
    return falha(401, "INVALID_CREDENTIALS");
  }

  const organizacoes = await organizacoesDaPessoa(banco, pessoa.id);
  if (!pessoa.ativo || organizacoes.length === 0) {
    return falha(403, "ACCOUNT_UNAVAILABLE");
  }

  const sessoes = (await banco.query<{ id: string; criado_em: Date; ultimo_acesso_em: Date }>(`
    SELECT id, criado_em, ultimo_acesso_em FROM public.sessoes_usuario
    WHERE usuario_id = $1 AND revogada_em IS NULL AND expira_em > now()
      AND ultimo_acesso_em > now() - make_interval(mins => $2)
    ORDER BY criado_em`, [pessoa.id, INATIVIDADE_MINUTOS])).rows;

  if (sessoes.length >= SESSOES_POR_PESSOA) {
    const revogar = typeof corpo.revoke_session_id === "string" ? corpo.revoke_session_id : null;
    if (!revogar || !sessoes.some(s => s.id === revogar)) {
      return falha(409, "SESSION_LIMIT_REACHED", {
        sessions: sessoes.map(s => ({
          session_id: s.id, started_at: s.criado_em.toISOString(), last_seen_at: s.ultimo_acesso_em.toISOString(), aal: "aal1"
        }))
      });
    }
  }

  const token = novoToken();
  const sessao = await transacao(banco, null, async client => {
    if (typeof corpo.revoke_session_id === "string" && sessoes.length >= SESSOES_POR_PESSOA) {
      await client.query(
        "UPDATE public.sessoes_usuario SET revogada_em = now(), motivo_revogacao = 'SUBSTITUIDA_NO_LOGIN' WHERE id = $1 AND usuario_id = $2",
        [corpo.revoke_session_id, pessoa.id]);
    }
    const criada = await client.query<{ id: string; expira_em: Date }>(`
      INSERT INTO public.sessoes_usuario (usuario_id, token_hash, expira_em)
      VALUES ($1, $2, now() + make_interval(hours => $3)) RETURNING id, expira_em`,
      [pessoa.id, sha256(token), SESSAO_MAXIMA_HORAS]);
    await client.query("INSERT INTO public.tentativas_login (email_hash, sucesso) VALUES ($1, true)", [emailHash]);
    await client.query("UPDATE public.usuarios SET ultimo_login = now() WHERE id = $1", [pessoa.id]);
    await auditar(client, { usuarioId: pessoa.id, organizacaoId: null }, pessoa.organizacao_id,
      "sessoes_usuario", criada.rows[0]!.id, "LOGIN", `login${ip ? ` de ${ip}` : ""}`);
    return criada.rows[0]!;
  });

  const expiraEm = new Date(Math.min(sessao.expira_em.getTime(), Date.now() + INATIVIDADE_MINUTOS * 60000)).toISOString();
  return ok("AUTHENTICATED", {
    session: { access_token: token, refresh_token: "", expires_at: expiraEm },
    access_token: token,
    expires_at: expiraEm,
    session_id: sessao.id,
    user: { id: pessoa.id, name: pessoa.nome },
    organizations: organizacoes
  });
}

export async function sessionStatus(banco: Pool, token: string | null): Promise<Resposta> {
  if (!token) return falha(401, "SESSION_INVALID");
  const sessao = await conferirSessao(banco, token);
  if (sessao.tipo === "ativa") {
    return ok("SESSION_ACTIVE", { aal: "aal1", mfa_required: false, expires_at: sessao.expiraEm.toISOString() });
  }
  if (sessao.tipo === "expirada") return falha(401, "SESSION_EXPIRED", { reason: sessao.motivo });
  if (sessao.tipo === "revogada") return falha(401, "SESSION_REVOKED");
  return falha(401, "SESSION_INVALID");
}

export async function sessionLogout(banco: Pool, token: string | null): Promise<Resposta> {
  if (token) {
    const encerrada = await banco.query<{ id: string; usuario_id: string; organizacao_id: string }>(`
      UPDATE public.sessoes_usuario s SET revogada_em = now(), motivo_revogacao = 'LOGOUT'
      FROM public.usuarios u
      WHERE s.token_hash = $1 AND s.revogada_em IS NULL AND u.id = s.usuario_id
      RETURNING s.id, s.usuario_id, u.organizacao_id`, [sha256(token)]);
    const linha = encerrada.rows[0];
    if (linha) {
      await auditar(banco, { usuarioId: linha.usuario_id, organizacaoId: null }, linha.organizacao_id,
        "sessoes_usuario", linha.id, "LOGOUT", "logout");
    }
  }
  return ok("SIGNED_OUT");
}

// Pedido: sempre a mesma resposta para e-mail bem formado (não revela quem
// existe). Sem serviço de e-mail ainda: o link sai no console do servidor
// (somente em desenvolvimento) e, em teste, na resposta (APP_EXPOR_TOKENS=1).
// Troca: token de uso único, 1 hora; encerra as sessões abertas
export async function passwordRecovery(banco: Pool, corpo: Record<string, unknown>): Promise<Resposta> {
  if (ehTexto(corpo.token)) {
    if (!senhaAceitavel(corpo.new_password)) {
      return falha(400, "VALIDATION_FAILED", { fields: [{ field: "new_password", message: "A senha deve ter de 8 a 128 caracteres." }] });
    }
    const novaSenha = corpo.new_password;
    const trocou = await transacao(banco, null, async client => {
      const pedido = (await client.query<{ id: string; usuario_id: string }>(`
        UPDATE public.recuperacoes_senha SET usado_em = now()
        WHERE token_hash = $1 AND usado_em IS NULL AND expira_em > now()
        RETURNING id, usuario_id`, [sha256(corpo.token as string)])).rows[0];
      if (!pedido) return false;
      await client.query("UPDATE public.usuarios SET senha_hash = $1, atualizado_em = now() WHERE id = $2",
        [hashSenha(novaSenha), pedido.usuario_id]);
      await client.query(`
        UPDATE public.sessoes_usuario SET revogada_em = now(), motivo_revogacao = 'SENHA_REDEFINIDA'
        WHERE usuario_id = $1 AND revogada_em IS NULL`, [pedido.usuario_id]);
      return true;
    });
    return trocou ? ok("PASSWORD_UPDATED") : falha(400, "RECOVERY_TOKEN_INVALID");
  }

  if (!emailValido(corpo.email)) return falha(400, "INVALID_REQUEST");
  const pessoa = (await banco.query<{ id: string }>(
    "SELECT id FROM public.usuarios WHERE lower(email) = $1 AND ativo", [corpo.email.trim().toLowerCase()])).rows[0];
  const extra: Record<string, unknown> = {};
  if (pessoa) {
    const token = novoToken();
    await banco.query(`
      INSERT INTO public.recuperacoes_senha (usuario_id, token_hash, expira_em) VALUES ($1, $2, now() + interval '1 hour')`,
      [pessoa.id, sha256(token)]);
    if (process.env.APP_EXPOR_TOKENS === "1") extra.recovery_token = token;
    else if (process.env.NODE_ENV !== "production") console.log(`[recuperação de senha] token gerado para o usuário ${pessoa.id} (válido por 1 hora)`);
  }
  return ok("RECOVERY_REQUEST_ACCEPTED", extra);
}
