// Regra de tentativas do Worker (decisão P6): o primeiro envio e mais 5
// tentativas, esperando 1 min, 5 min, 15 min, 1 h e 6 h. Depois disso a
// mensagem fica parada em ERROR (sem próxima tentativa) para o gestor.
//
// Estados de uma mensagem na fila da Oxide:
//   PENDING                       -> pronta para enviar
//   ERROR, com next_attempt_at    -> falhou; nova tentativa agendada
//   ERROR, sem next_attempt_at    -> parada: precisa do gestor
//   SYNCED                        -> gravada no banco principal
//   ARQUIVADA                     -> veio do modelo antigo; não é enviada

export const RETRY_DELAYS_SECONDS = [60, 300, 900, 3600, 21600];

// Data no formato do SQLite (UTC), como CURRENT_TIMESTAMP
export function sqliteUtc(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

// Próxima tentativa depois da falha número `failures` (1, 2, ...);
// null quando as tentativas acabaram
export function nextRetryAt(failures: number): string | null {
  const delay = RETRY_DELAYS_SECONDS[failures - 1];
  return delay === undefined ? null : sqliteUtc(new Date(Date.now() + delay * 1000));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
