import { NextFunction, Request, Response } from "express";

// Limite de requisições, guardado na memória da API (janela de 1 minuto).
//   - por dispositivo: quantas mensagens um lacre pode mandar por minuto;
//   - por endereço: quantas vezes um endereço pode errar a chave por minuto.
// Passou do limite: 429, com o tempo de espera no cabeçalho Retry-After.

const JANELA_MS = 60000;

interface Janela { inicio: number; total: number }

const porDispositivo = new Map<string, Janela>();
const falhasPorEndereco = new Map<string, Janela>();

function inteiro(nome: string, padrao: number): number {
  const valor = Number(process.env[nome]);
  return Number.isInteger(valor) && valor > 0 ? valor : padrao;
}

function contar(mapa: Map<string, Janela>, chave: string, agora: number): Janela {
  const janela = mapa.get(chave);
  if (!janela || agora - janela.inicio >= JANELA_MS) {
    const nova = { inicio: agora, total: 1 };
    mapa.set(chave, nova);
    return nova;
  }
  janela.total++;
  return janela;
}

function recusar(res: Response, janela: Janela, agora: number, message: string): void {
  const espera = Math.max(1, Math.ceil((janela.inicio + JANELA_MS - agora) / 1000));
  res.setHeader("Retry-After", String(espera));
  res.status(429).json({ success: false, message: `${message}; tente de novo em ${espera} s` });
}

export const enderecoDe = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? "desconhecido";

// Depois da conferência da chave: conta as mensagens de cada dispositivo
export function limitePorDispositivo(req: Request, res: Response, next: NextFunction): void {
  const deviceId = typeof req.params.deviceId === "string" ? req.params.deviceId
    : typeof req.body?.device_id === "string" ? req.body.device_id : "";
  const agora = Date.now();
  const janela = contar(porDispositivo, deviceId, agora);

  if (janela.total > inteiro("LIMITE_MENSAGENS_POR_MINUTO", 120)) {
    recusar(res, janela, agora, "Muitas requisições deste dispositivo");
    return;
  }
  next();
}

// Chave errada ou ausente: conta contra o endereço de quem enviou
export function registrarFalhaDeChave(req: Request): void {
  contar(falhasPorEndereco, enderecoDe(req), Date.now());
}

// Antes de conferir qualquer chave: endereço que errou demais espera a janela acabar
export function barrarEnderecoBloqueado(req: Request, res: Response): boolean {
  const agora = Date.now();
  const janela = falhasPorEndereco.get(enderecoDe(req));
  if (!janela || agora - janela.inicio >= JANELA_MS) return false;
  if (janela.total < inteiro("LIMITE_FALHAS_DE_CHAVE_POR_MINUTO", 60)) return false;

  recusar(res, janela, agora, "Muitas tentativas com chave inválida a partir deste endereço");
  return true;
}

// Só para os testes: apaga as contagens
export function zerarLimites(): void {
  porDispositivo.clear();
  falhasPorEndereco.clear();
}

// Tira da memória as janelas que já acabaram
const limpeza = setInterval(() => {
  const agora = Date.now();
  for (const mapa of [porDispositivo, falhasPorEndereco]) {
    for (const [chave, janela] of mapa) {
      if (agora - janela.inicio >= JANELA_MS) mapa.delete(chave);
    }
  }
}, JANELA_MS);
limpeza.unref();
