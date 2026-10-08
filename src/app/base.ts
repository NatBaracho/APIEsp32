import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { Pool, PoolClient } from "pg";

// Base da API do frontend (/api/v1/app): conexão com o FluxID, respostas no
// formato { code, ... } (Doc/Contrato-API-Frontend.md) e utilitários.

let pool: Pool | null = null;

export function fluxid(): Pool | null {
  const url = process.env.FLUXID_DATABASE_URL?.trim();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  }
  return pool;
}

export async function fecharFluxid(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export interface Resposta {
  status: number;
  body: Record<string, unknown>;
}

// code vem primeiro e nunca é sobrescrito pelos dados
export const ok = (code: string, dados: Record<string, unknown> = {}, status = 200): Resposta =>
  ({ status, body: Object.assign({ code }, dados, { code }) });

export const falha = (status: number, code: string, dados: Record<string, unknown> = {}): Resposta =>
  ({ status, body: Object.assign({ code }, dados, { code }) });

export const invalido = (campos: Array<{ field: string; message: string }>): Resposta =>
  falha(400, "VALIDATION_FAILED", { fields: campos });

export const negado = (): Resposta => falha(403, "ACCESS_DENIED");
export const naoEncontrado = (): Resposta => falha(404, "NOT_FOUND");

// Ator autenticado e organização ativa da chamada
export interface Contexto {
  usuarioId: string;
  sessaoId: string;
  nome: string;
  organizacaoId: string | null;
  permissoes: Set<string>;
  global: Set<string>;
}

// Erro de regra que vira resposta (ex.: conflito dentro de uma transação)
export class ErroDeRegra extends Error {
  constructor(readonly resposta: Resposta) {
    super(String(resposta.body.code));
  }
}

export const ehTexto = (valor: unknown): valor is string => typeof valor === "string" && valor.trim() !== "";
export const ehUuid = (valor: unknown): valor is string =>
  typeof valor === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);
export const ehData = (valor: unknown): valor is string =>
  typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(valor));
export const justificativaValida = (valor: unknown): valor is string =>
  typeof valor === "string" && valor.trim().length >= 5 && valor.trim().length <= 500;

export const sha256 = (texto: string): string => createHash("sha256").update(texto, "utf8").digest("hex");
export const novoToken = (): string => randomBytes(32).toString("base64url");

// Senha: scrypt com sal aleatório, no formato scrypt$N$r$p$sal$hash
export function hashSenha(senha: string): string {
  const sal = randomBytes(16);
  const hash = scryptSync(senha, sal, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${sal.toString("base64")}$${hash.toString("base64")}`;
}

export function conferirSenha(senha: string, guardada: string): boolean {
  const partes = guardada.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [, n, r, p, sal, hash] = partes;
  const esperado = Buffer.from(hash ?? "", "base64");
  const obtido = scryptSync(senha, Buffer.from(sal ?? "", "base64"), esperado.length, {
    N: Number(n), r: Number(r), p: Number(p)
  });
  return esperado.length === obtido.length && timingSafeEqual(esperado, obtido);
}

export const senhaAceitavel = (senha: unknown): senha is string =>
  typeof senha === "string" && senha.length >= 8 && senha.length <= 128;

export async function transacao<T>(banco: Pool, contexto: Contexto | null, trabalho: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await banco.connect();
  try {
    await client.query("BEGIN");
    if (contexto) {
      // Usado pelo gatilho do histórico do cilindro (origem USUARIO)
      await client.query("SELECT set_config('fluxid.usuario_id', $1, true)", [contexto.usuarioId]);
    }
    const resultado = await trabalho(client);
    await client.query("COMMIT");
    return resultado;
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw erro;
  } finally {
    client.release();
  }
}

// Paginação simples por posição: o cursor é opaco para o frontend
export function lerCursor(cursor: unknown): number {
  if (typeof cursor !== "string" || cursor === "") return 0;
  const valor = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  return Number.isInteger(valor) && valor >= 0 ? valor : 0;
}

export const proximoCursor = (inicio: number, recebidos: number, limite: number): string | null =>
  recebidos > limite ? Buffer.from(String(inicio + limite), "utf8").toString("base64url") : null;

export function limiteDe(valor: unknown, padrao = 25, maximo = 100): number {
  const numero = Number(valor ?? padrao);
  return Number.isInteger(numero) && numero >= 1 ? Math.min(numero, maximo) : padrao;
}

// Próximo código no padrão PREFIXO-000001
export async function proximoCodigo(client: PoolClient, tabela: string, prefixo: string): Promise<string> {
  const resultado = await client.query<{ n: number | null }>(
    `SELECT max(substring(codigo FROM ${prefixo.length + 2})::int) AS n
     FROM public.${tabela} WHERE codigo ~ $1`,
    [`^${prefixo}-[0-9]{6}$`]
  );
  return `${prefixo}-${String((resultado.rows[0]?.n ?? 0) + 1).padStart(6, "0")}`;
}

// Auditoria do FluxID: acao em INSERT, UPDATE, DELETE, LOGIN, LOGOUT, AUTORIZACAO
export async function auditar(
  client: PoolClient | Pool,
  contexto: { usuarioId: string; organizacaoId: string | null },
  organizacaoId: string,
  tabela: string,
  registroId: string,
  acao: "INSERT" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT" | "AUTORIZACAO",
  observacao: string,
  valorNovo: Record<string, unknown> | null = null
): Promise<void> {
  await client.query(
    `INSERT INTO public.auditoria (organizacao_id, usuario_id, tabela_afetada, registro_id, acao, valor_novo, observacao, ocorrido_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    [organizacaoId, contexto.usuarioId, tabela, registroId, acao, valorNovo, observacao]
  );
}

// Erros de unicidade do PostgreSQL viram conflito com o nome da regra
export function violacaoUnica(erro: unknown): string | null {
  const e = erro as { code?: string; constraint?: string };
  return e?.code === "23505" ? (e.constraint ?? "unique") : null;
}
