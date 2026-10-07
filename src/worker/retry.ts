// Regra de tentativas do Worker (decisão P6): o primeiro envio e mais 5
// tentativas, esperando 1 min, 5 min, 15 min, 1 h e 6 h. Depois disso a
// linha fica parada em ERROR (sem próxima tentativa) para o gestor.
//
// Estados de uma linha da fila na Oxide:
//   PENDING, sem next_attempt_at  -> pronta para enviar
//   PENDING, com next_attempt_at  -> esperando uma condição (ex.: vínculo, P3);
//                                    não conta como tentativa
//   ERROR,   com next_attempt_at  -> falhou; nova tentativa agendada
//   ERROR,   sem next_attempt_at  -> parada: precisa do gestor
//   SYNCED                        -> gravada no FluxID

export const RETRY_DELAYS_SECONDS = [60, 300, 900, 3600, 21600];

// Espera de quem aguarda uma condição combinada (P3), sem contar tentativa
export const WAIT_SECONDS = 300;

// Resultado do envio de uma linha
export type SyncOutcome =
  | { kind: "synced"; note?: string }
  | { kind: "wait"; reason: string }
  | { kind: "retry"; error: string }
  | { kind: "stop"; error: string };

// Data no formato do SQLite (UTC), como CURRENT_TIMESTAMP
export function sqliteUtc(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

export function secondsFromNow(seconds: number): string {
  return sqliteUtc(new Date(Date.now() + seconds * 1000));
}

// Próxima tentativa depois da falha número `failures` (1, 2, ...);
// null quando as tentativas acabaram
export function nextRetryAt(failures: number): string | null {
  const delay = RETRY_DELAYS_SECONDS[failures - 1];
  return delay === undefined ? null : secondsFromNow(delay);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

// Falha de conexão com o FluxID (fora do ar, rede): a rodada é interrompida
// e as linhas voltam para a fila sem gastar tentativa, porque nada chegou a
// ser enviado. Erros de dado (ex.: regra do banco) contam tentativa.
const connectionCodes = new Set([
  "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH",
  "57P01", "57P03", "08000", "08001", "08003", "08006"
]);

export function isConnectionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;

  if (typeof code === "string" && connectionCodes.has(code)) {
    return true;
  }

  const message = errorMessage(error);
  return /connection terminated|timeout exceeded when trying to connect|connect ECONNREFUSED/i.test(message);
}
