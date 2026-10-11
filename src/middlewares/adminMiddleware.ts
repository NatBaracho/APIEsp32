import { createHash, timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";
import { barrarEnderecoBloqueado, registrarFalhaDeChave } from "./limite";

// Rotas da equipe (dispositivos, mensagens, fila e métricas): exigem a chave
// de administrador no cabeçalho X-Admin-Key. A chave fica só no .env
// (ADMIN_API_KEY) e nunca aparece em resposta, log ou documento.
//
// Sem chave configurada, as rotas ficam fechadas (503). Para testes de
// bancada, ROTAS_DA_EQUIPE_ABERTAS=true abre as rotas sem chave.

const TAMANHO_MINIMO = 16;

const resumo = (texto: string): Buffer => createHash("sha256").update(texto, "utf8").digest();

export const rotasDaEquipeAbertas = (): boolean => process.env.ROTAS_DA_EQUIPE_ABERTAS === "true";

export function chaveDeAdministrador(): string | null {
  const chave = process.env.ADMIN_API_KEY?.trim() ?? "";
  return chave.length >= TAMANHO_MINIMO ? chave : null;
}

export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (rotasDaEquipeAbertas()) {
    next();
    return;
  }

  const esperada = chaveDeAdministrador();
  if (!esperada) {
    res.status(503).json({
      success: false,
      message: `Chave de administrador não configurada: defina ADMIN_API_KEY no .env, com pelo menos ${TAMANHO_MINIMO} caracteres`
    });
    return;
  }

  if (barrarEnderecoBloqueado(req, res)) return;

  const recebida = req.header("X-Admin-Key");
  if (!recebida) {
    registrarFalhaDeChave(req);
    res.status(401).json({ success: false, message: "Chave de administrador obrigatória (cabeçalho X-Admin-Key)" });
    return;
  }

  // Comparação em tempo constante, para o tempo de resposta não revelar a chave
  if (!timingSafeEqual(resumo(recebida), resumo(esperada))) {
    registrarFalhaDeChave(req);
    res.status(401).json({ success: false, message: "Chave de administrador inválida" });
    return;
  }

  next();
}
