import db from "../database/connection";
import { nextRetryAt, secondsFromNow, SyncOutcome, WAIT_SECONDS } from "../worker/retry";

// Filas da Oxide que o Worker envia ao FluxID. Os alertas têm colunas de
// sincronização próprias, porque status (ABERTO...) é o estado de negócio
interface QueueColumns {
  table: string;
  key: string;
  status: string;
  attempts: string;
  error: string;
  next: string;
}

export const syncQueues = {
  telemetry: {
    table: "telemetry_queue", key: "message_id", status: "status",
    attempts: "attempt_count", error: "last_error", next: "next_attempt_at"
  },
  events: {
    table: "events", key: "message_id", status: "status",
    attempts: "attempt_count", error: "last_error", next: "next_attempt_at"
  },
  alerts: {
    table: "alerts", key: "alert_id", status: "sync_status",
    attempts: "sync_attempt_count", error: "sync_last_error", next: "sync_next_attempt_at"
  }
} satisfies Record<string, QueueColumns>;

export type SyncQueueName = keyof typeof syncQueues;

export const syncQueueNames = Object.keys(syncQueues) as SyncQueueName[];

export function isSyncQueueName(value: unknown): value is SyncQueueName {
  return typeof value === "string" && value in syncQueues;
}

export interface QueueSummary {
  queue: SyncQueueName;
  pendentes: number;
  aguardando: number;
  nova_tentativa: number;
  parados: number;
  enviando: number;
  sincronizados: number;
}

export class SyncRepository {

  // Linhas prontas para enviar: novas, esperas vencidas e novas tentativas
  // vencidas. Linhas paradas (ERROR sem próxima tentativa) ficam de fora
  findDue<T>(queue: SyncQueueName, limit: number): T[] {
    const q = syncQueues[queue];

    return db.prepare(`
      SELECT *
      FROM ${q.table}
      WHERE (
          COALESCE(${q.status}, 'PENDING') = 'PENDING'
          AND (${q.next} IS NULL OR ${q.next} <= datetime('now'))
        ) OR (
          ${q.status} = 'ERROR'
          AND ${q.next} IS NOT NULL
          AND ${q.next} <= datetime('now')
        )
      ORDER BY id
      LIMIT ?
    `).all(limit) as T[];
  }

  markProcessing(queue: SyncQueueName, id: number): boolean {
    const q = syncQueues[queue];

    return db.prepare(`
      UPDATE ${q.table}
      SET ${q.status} = 'PROCESSING'
      WHERE id = ?
    `).run(id).changes > 0;
  }

  // Só grava o resultado se a linha ainda estiver PROCESSING: um alerta
  // alterado durante o envio volta a PENDING e é enviado de novo
  applyOutcome(queue: SyncQueueName, id: number, outcome: SyncOutcome): void {
    const q = syncQueues[queue];
    const guard = `WHERE id = ? AND ${q.status} = 'PROCESSING'`;

    switch (outcome.kind) {
      case "synced":
        db.prepare(`
          UPDATE ${q.table}
          SET ${q.status} = 'SYNCED', ${q.error} = NULL, ${q.next} = NULL
          ${guard}
        `).run(id);
        return;

      case "wait":
        db.prepare(`
          UPDATE ${q.table}
          SET ${q.status} = 'PENDING', ${q.error} = ?, ${q.next} = ?
          ${guard}
        `).run(outcome.reason, secondsFromNow(WAIT_SECONDS), id);
        return;

      case "retry": {
        const row = db.prepare(`SELECT COALESCE(${q.attempts}, 0) AS attempts FROM ${q.table} WHERE id = ?`)
          .get(id) as { attempts: number } | undefined;
        const failures = (row?.attempts ?? 0) + 1;

        db.prepare(`
          UPDATE ${q.table}
          SET ${q.status} = 'ERROR', ${q.attempts} = ?, ${q.error} = ?, ${q.next} = ?
          ${guard}
        `).run(failures, outcome.error, nextRetryAt(failures), id);
        return;
      }

      case "stop":
        db.prepare(`
          UPDATE ${q.table}
          SET ${q.status} = 'ERROR', ${q.attempts} = COALESCE(${q.attempts}, 0) + 1,
              ${q.error} = ?, ${q.next} = NULL
          ${guard}
        `).run(outcome.error, id);
        return;
    }
  }

  // Envio interrompido (ex.: Worker encerrado no meio): volta para a fila
  resetProcessing(): number {
    return syncQueueNames.reduce((total, queue) => {
      const q = syncQueues[queue];
      return total + db.prepare(`
        UPDATE ${q.table} SET ${q.status} = 'PENDING' WHERE ${q.status} = 'PROCESSING'
      `).run().changes;
    }, 0);
  }

  summary(): QueueSummary[] {
    return syncQueueNames.map(queue => {
      const q = syncQueues[queue];
      const row = db.prepare(`
        SELECT
          SUM(COALESCE(${q.status}, 'PENDING') = 'PENDING' AND ${q.next} IS NULL) AS pendentes,
          SUM(COALESCE(${q.status}, 'PENDING') = 'PENDING' AND ${q.next} IS NOT NULL) AS aguardando,
          SUM(${q.status} = 'ERROR' AND ${q.next} IS NOT NULL) AS nova_tentativa,
          SUM(${q.status} = 'ERROR' AND ${q.next} IS NULL) AS parados,
          SUM(${q.status} = 'PROCESSING') AS enviando,
          SUM(${q.status} = 'SYNCED') AS sincronizados
        FROM ${q.table}
      `).get() as Record<string, number | null>;

      return {
        queue,
        pendentes: row.pendentes ?? 0,
        aguardando: row.aguardando ?? 0,
        nova_tentativa: row.nova_tentativa ?? 0,
        parados: row.parados ?? 0,
        enviando: row.enviando ?? 0,
        sincronizados: row.sincronizados ?? 0
      };
    });
  }

  // Linhas com problema: paradas (gestor), esperando condição ou com nova
  // tentativa agendada
  problems(queue: SyncQueueName): Array<Record<string, unknown>> {
    const q = syncQueues[queue];

    return db.prepare(`
      SELECT
        id,
        ${q.key} AS chave,
        device_id,
        ${q.status} AS sync_status,
        COALESCE(${q.attempts}, 0) AS tentativas,
        ${q.error} AS erro,
        ${q.next} AS proxima_tentativa,
        CASE
          WHEN ${q.status} = 'ERROR' AND ${q.next} IS NULL THEN 'PARADO'
          WHEN ${q.status} = 'ERROR' THEN 'NOVA_TENTATIVA'
          ELSE 'AGUARDANDO'
        END AS situacao
      FROM ${q.table}
      WHERE ${q.status} = 'ERROR'
         OR (COALESCE(${q.status}, 'PENDING') = 'PENDING' AND ${q.next} IS NOT NULL)
      ORDER BY id
    `).all() as Array<Record<string, unknown>>;
  }

  // Gestor manda tentar de novo: zera as tentativas e volta para a fila
  retry(queue: SyncQueueName, key: string): boolean {
    const q = syncQueues[queue];

    return db.prepare(`
      UPDATE ${q.table}
      SET ${q.status} = 'PENDING', ${q.attempts} = 0, ${q.error} = NULL, ${q.next} = NULL
      WHERE ${q.key} = ? AND ${q.status} <> 'SYNCED'
    `).run(key).changes > 0;
  }

}
