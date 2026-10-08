import express, { NextFunction, Request, Response, Router } from "express";
import { conferirSessao, permissoesGlobais, permissoesNaOrganizacao, traduzirPermissoes } from "./acesso";
import { Contexto, ErroDeRegra, Resposta, ehUuid, falha, fluxid } from "./base";
import { manageCylinders, queryCylinders } from "./funcoes/cilindros";
import { manageDeliveries, queryDeliveries } from "./funcoes/entregas";
import {
  manageAlerts, manageCommands, manageSeals, queryAlerts, queryMap, queryOverview, querySeals, queryTelemetry
} from "./funcoes/lacres";
import {
  inviteUser, manageAccess, manageMembership, manageOrganizations, profileAvatar, queryAudit, queryPermissions
} from "./funcoes/organizacao";
import { passwordRecovery, sessionLogin, sessionLogout, sessionStatus } from "./funcoes/sessao";
import { Pool } from "pg";

// API do frontend: POST /api/v1/app/<função> (Doc/Contrato-API-Frontend.md)

type Corpo = Record<string, any>;
type Funcao = (banco: Pool, ctx: Contexto, corpo: Corpo) => Promise<Resposta>;

// precisaOrganizacao: a função trabalha dentro de uma organização ativa
const FUNCOES: Record<string, { fn: Funcao; precisaOrganizacao: boolean }> = {
  "query-permissions": { fn: queryPermissions, precisaOrganizacao: false },
  "manage-organizations": { fn: manageOrganizations, precisaOrganizacao: false },
  "manage-membership": { fn: manageMembership, precisaOrganizacao: true },
  "manage-access": { fn: manageAccess, precisaOrganizacao: true },
  "invite-user": { fn: inviteUser, precisaOrganizacao: true },
  "query-audit": { fn: queryAudit, precisaOrganizacao: true },
  "profile-avatar": { fn: profileAvatar, precisaOrganizacao: false },
  "query-cylinders": { fn: queryCylinders, precisaOrganizacao: true },
  "manage-cylinders": { fn: manageCylinders, precisaOrganizacao: true },
  "query-overview": { fn: queryOverview, precisaOrganizacao: true },
  "query-map": { fn: queryMap, precisaOrganizacao: true },
  "query-alerts": { fn: queryAlerts, precisaOrganizacao: true },
  "manage-alerts": { fn: manageAlerts, precisaOrganizacao: true },
  "query-seals": { fn: querySeals, precisaOrganizacao: true },
  "manage-seals": { fn: manageSeals, precisaOrganizacao: true },
  "query-telemetry": { fn: queryTelemetry, precisaOrganizacao: true },
  "manage-commands": { fn: manageCommands, precisaOrganizacao: true },
  "query-deliveries": { fn: queryDeliveries, precisaOrganizacao: true },
  "manage-deliveries": { fn: manageDeliveries, precisaOrganizacao: true }
};

const SESSAO = new Set(["session-login", "session-status", "session-logout", "password-recovery"]);
export const FUNCOES_DISPONIVEIS = [...SESSAO, ...Object.keys(FUNCOES)];

function tokenDe(req: Request): string | null {
  const cabecalho = req.headers.authorization;
  if (typeof cabecalho !== "string") return null;
  const [tipo, valor] = cabecalho.split(" ");
  return tipo?.toLowerCase() === "bearer" && valor ? valor.trim() : null;
}

// Origens do frontend autorizadas (APP_ORIGENS, separadas por vírgula).
// Sem a variável, só as de desenvolvimento local
function origensPermitidas(): string[] {
  const lista = process.env.APP_ORIGENS?.split(",").map(o => o.trim()).filter(Boolean);
  return lista?.length ? lista : ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://localhost:3001"];
}

function cors(req: Request, res: Response, next: NextFunction): void {
  const origem = req.headers.origin;
  if (origem && origensPermitidas().includes(origem)) {
    res.setHeader("Access-Control-Allow-Origin", origem);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

async function montarContexto(banco: Pool, token: string | null, corpo: Corpo, precisaOrganizacao: boolean): Promise<Contexto | Resposta> {
  if (!token) return falha(401, "AUTH_REQUIRED");
  const sessao = await conferirSessao(banco, token);
  if (sessao.tipo !== "ativa") return falha(401, "AUTH_REQUIRED", { reason: sessao.tipo });

  const global = traduzirPermissoes(await permissoesGlobais(banco, sessao.contexto.usuarioId));
  let organizacaoId: string | null = null;
  let permissoes = new Set<string>();

  // organization_id é só contexto: vale se a pessoa tem vínculo ativo nela
  if (corpo.organization_id !== undefined) {
    if (!ehUuid(corpo.organization_id)) return falha(400, "VALIDATION_FAILED", { fields: [{ field: "organization_id", message: "Organização inválida." }] });
    const codigos = await permissoesNaOrganizacao(banco, sessao.contexto.usuarioId, corpo.organization_id);
    if (codigos.length === 0) return falha(401, "AUTH_REQUIRED", { reason: "no_membership" });
    organizacaoId = corpo.organization_id;
    permissoes = traduzirPermissoes(codigos);
  } else if (precisaOrganizacao) {
    return falha(400, "VALIDATION_FAILED", { fields: [{ field: "organization_id", message: "Informe a organização ativa." }] });
  }

  return { ...sessao.contexto, organizacaoId, permissoes, global };
}

async function executar(req: Request): Promise<Resposta> {
  const nome = String(req.params.funcao);
  const banco = fluxid();
  if (!banco) return falha(503, "UNAVAILABLE", { message: "FLUXID_DATABASE_URL não configurada no servidor." });

  const corpo: Corpo = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const token = tokenDe(req);

  switch (nome) {
    case "session-login": return sessionLogin(banco, corpo, req.ip ?? null);
    case "session-status": return sessionStatus(banco, token);
    case "session-logout": return sessionLogout(banco, token);
    case "password-recovery": return passwordRecovery(banco, corpo);
  }
  if (nome === "invite-user" && corpo.operation === "accept") return inviteUser(banco, null, corpo);

  const funcao = FUNCOES[nome];
  if (!funcao) return falha(404, "FUNCTION_NOT_FOUND");
  const ctx = await montarContexto(banco, token, corpo, funcao.precisaOrganizacao);
  if ("status" in ctx) return ctx;
  return funcao.fn(banco, ctx, corpo);
}

const router = Router();
router.use(cors);
router.use(express.json({ limit: "1mb" }));

router.post("/:funcao", (req, res) => {
  executar(req)
    .then(resposta => res.status(resposta.status).json(resposta.body))
    .catch(erro => {
      if (erro instanceof ErroDeRegra) {
        res.status(erro.resposta.status).json(erro.resposta.body);
        return;
      }
      // Sem detalhe para o cliente; no console só a mensagem (nunca o corpo)
      console.error(`[app] ${req.params.funcao}:`, erro instanceof Error ? erro.message : erro);
      const conexao = (erro as { code?: string })?.code;
      if (conexao === "ECONNREFUSED" || conexao === "ETIMEDOUT" || conexao === "57P01") {
        res.status(503).json({ code: "UNAVAILABLE" });
        return;
      }
      res.status(500).json({ code: "INTERNAL_ERROR" });
    });
});

router.all("/:funcao", (_req, res) => {
  res.status(405).json({ code: "METHOD_NOT_ALLOWED" });
});

// JSON malformado ou grande demais
router.use((erro: { type?: string; status?: number }, _req: Request, res: Response, next: NextFunction) => {
  if (erro?.type === "entity.parse.failed") return void res.status(400).json({ code: "VALIDATION_FAILED", fields: [{ field: "body", message: "JSON inválido." }] });
  if (erro?.type === "entity.too.large") return void res.status(413).json({ code: "PAYLOAD_TOO_LARGE" });
  next(erro);
});

export default router;
