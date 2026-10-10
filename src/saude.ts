import { CommandRepository } from "./repositories/CommandRepository";
import { MessageRepository } from "./repositories/MessageRepository";
import { lerUltimaRodada } from "./worker/runner";

// GET /health: situação da API, da fila e do Worker. Nunca mostra endereço
// nem chave do banco principal

const ATRASO_MAXIMO_MS = 5 * 60 * 1000;

export function saude(): Record<string, unknown> {
  const rodada = lerUltimaRodada();
  const atrasado = rodada ? Date.parse(rodada.em) < Date.now() - ATRASO_MAXIMO_MS : false;
  const configurado = Boolean(process.env.SUPABASE_IOT_URL?.trim() && process.env.SUPABASE_SERVICE_KEY?.trim());

  return {
    status: rodada && (rodada.resultado.status === "FALHOU" || atrasado) ? "DEGRADADO" : "OK",
    hora: new Date().toISOString(),
    ligada_ha_segundos: Math.round(process.uptime()),
    fila: new MessageRepository().counts(),
    comandos_pendentes: new CommandRepository().countPending(),
    banco_principal: configurado ? "CONFIGURADO" : "NAO_CONFIGURADO",
    worker: rodada
      ? { ultima_rodada: rodada.em, resultado: rodada.resultado.status, atrasado, erro: rodada.resultado.erro ?? null }
      : { ultima_rodada: null, resultado: null, atrasado: false, erro: null }
  };
}
