import { Pool } from "pg";
import { Contexto, sha256 } from "./base";

// Sessões e permissões da API do frontend (decisões D2 e D3)

export const SESSAO_MAXIMA_HORAS = 8;
export const INATIVIDADE_MINUTOS = 30;
export const SESSOES_POR_PESSOA = 3;
export const FALHAS_PARA_BLOQUEIO = 5;
export const JANELA_BLOQUEIO_MINUTOS = 15;

// Permissão do FluxID → código que o frontend já usa (resource.action)
const MAPA: Record<string, string[]> = {
  VER_CILINDROS: ["cylinder.read", "seal.read", "map.read"],
  CRIAR_CILINDRO: ["cylinder.write", "customer.write"],
  EDITAR_CILINDRO: ["cylinder.write", "customer.write"],
  INATIVAR_CILINDRO: ["cylinder.deactivate"],
  GERENCIAR_IDENTIFICADORES: ["cylinder.identifier"],
  ENTRADA_ESTOQUE: ["cylinder.stock_in"],
  REGISTRAR_TESTE_HIDROSTATICO: ["cylinder.test"],
  VER_HISTORICO_CILINDRO: ["cylinder.history"],
  CRIAR_LACRE: ["seal.write"],
  EDITAR_LACRE: ["seal.write"],
  VISUALIZAR_ALERTAS: ["alert.read", "map.read", "seal.read"],
  ENCERRAR_ALERTAS: ["alert.close"],
  JUSTIFICAR_ALERTAS: ["alert.justify"],
  ENVIAR_COMANDOS: ["command.send"],
  PLANEJAR_ROTAS: ["route.plan", "delivery.write"],
  CRIAR_USUARIO: ["tenant.manage"],
  EDITAR_USUARIO: ["tenant.manage"],
  GERAR_RELATORIOS: ["audit.read"],
  ADMINISTRAR_SISTEMA: ["platform.manage", "audit.read"]
};

export function traduzirPermissoes(codigos: string[]): Set<string> {
  const resultado = new Set<string>();
  for (const codigo of codigos) {
    for (const traduzido of MAPA[codigo] ?? []) resultado.add(traduzido);
  }
  return resultado;
}

// Permissões da pessoa numa organização (vínculo e papéis ativos)
export async function permissoesNaOrganizacao(banco: Pool, usuarioId: string, organizacaoId: string): Promise<string[]> {
  const resultado = await banco.query<{ codigo: string }>(`
    SELECT DISTINCT pm.codigo
    FROM public.usuario_organizacoes uo
    JOIN public.organizacoes o ON o.id = uo.organizacao_id AND o.status = 'ATIVA'
    JOIN public.usuario_organizacao_perfis uop ON uop.usuario_id = uo.usuario_id AND uop.organizacao_id = uo.organizacao_id
    JOIN public.perfis pf ON pf.id = uop.perfil_id AND pf.ativo
    JOIN public.perfil_permissoes pp ON pp.perfil_id = pf.id
    JOIN public.permissoes pm ON pm.id = pp.permissao_id AND pm.ativo
    WHERE uo.usuario_id = $1 AND uo.organizacao_id = $2 AND uo.status = 'ATIVO'`,
    [usuarioId, organizacaoId]);
  return resultado.rows.map(r => r.codigo);
}

// Permissões globais: as de quem tem ADMINISTRAR_SISTEMA em alguma organização
export async function permissoesGlobais(banco: Pool, usuarioId: string): Promise<string[]> {
  const resultado = await banco.query<{ codigo: string }>(`
    SELECT DISTINCT pm.codigo
    FROM public.usuario_organizacoes uo
    JOIN public.usuario_organizacao_perfis uop ON uop.usuario_id = uo.usuario_id AND uop.organizacao_id = uo.organizacao_id
    JOIN public.perfis pf ON pf.id = uop.perfil_id AND pf.ativo
    JOIN public.perfil_permissoes pp ON pp.perfil_id = pf.id
    JOIN public.permissoes pm ON pm.id = pp.permissao_id AND pm.ativo
    WHERE uo.usuario_id = $1 AND uo.status = 'ATIVO'
      AND EXISTS (
        SELECT 1 FROM public.perfil_permissoes pp2
        JOIN public.permissoes pm2 ON pm2.id = pp2.permissao_id AND pm2.codigo = 'ADMINISTRAR_SISTEMA'
        WHERE pp2.perfil_id = pf.id)`,
    [usuarioId]);
  return resultado.rows.map(r => r.codigo).filter(c => c === "ADMINISTRAR_SISTEMA" || c === "GERAR_RELATORIOS");
}

export type ResultadoSessao =
  | { tipo: "ativa"; contexto: Omit<Contexto, "organizacaoId" | "permissoes" | "global">; expiraEm: Date }
  | { tipo: "invalida" | "expirada" | "revogada"; motivo?: string };

// Confere o token e renova a atividade (30 min de inatividade encerram)
export async function conferirSessao(banco: Pool, token: string): Promise<ResultadoSessao> {
  const resultado = await banco.query<{
    id: string; usuario_id: string; nome: string; ativo: boolean; expira_em: Date;
    ultimo_acesso_em: Date; revogada_em: Date | null; motivo_revogacao: string | null;
  }>(`
    SELECT s.id, s.usuario_id, u.nome, u.ativo, s.expira_em, s.ultimo_acesso_em, s.revogada_em, s.motivo_revogacao
    FROM public.sessoes_usuario s JOIN public.usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = $1`, [sha256(token)]);
  const sessao = resultado.rows[0];

  if (!sessao) return { tipo: "invalida" };
  if (sessao.revogada_em) return { tipo: "revogada", motivo: sessao.motivo_revogacao ?? "revogada" };
  if (!sessao.ativo) return { tipo: "revogada", motivo: "usuario_inativo" };

  const agora = Date.now();
  if (sessao.expira_em.getTime() <= agora) {
    await banco.query("UPDATE public.sessoes_usuario SET revogada_em = now(), motivo_revogacao = 'TEMPO_MAXIMO' WHERE id = $1", [sessao.id]);
    return { tipo: "expirada", motivo: "timebox" };
  }
  if (sessao.ultimo_acesso_em.getTime() + INATIVIDADE_MINUTOS * 60000 <= agora) {
    await banco.query("UPDATE public.sessoes_usuario SET revogada_em = now(), motivo_revogacao = 'INATIVIDADE' WHERE id = $1", [sessao.id]);
    return { tipo: "expirada", motivo: "inactivity" };
  }

  await banco.query("UPDATE public.sessoes_usuario SET ultimo_acesso_em = now() WHERE id = $1", [sessao.id]);
  const expiraEm = new Date(Math.min(sessao.expira_em.getTime(), agora + INATIVIDADE_MINUTOS * 60000));
  return { tipo: "ativa", contexto: { usuarioId: sessao.usuario_id, sessaoId: sessao.id, nome: sessao.nome }, expiraEm };
}
