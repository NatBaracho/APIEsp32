import db from "../database/connection";

export type SyncLogStatus = "RUNNING" | "OK" | "PARCIAL" | "FALHOU";

export interface SyncLog {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: SyncLogStatus;
  log_message: string | null;
}

// Uma linha por rodada do Worker
export class SyncLogRepository {

  start(): number {
    const result = db.prepare(`
      INSERT INTO sync_logs (status) VALUES ('RUNNING')
    `).run();

    return Number(result.lastInsertRowid);
  }

  finish(id: number, status: SyncLogStatus, message: string): void {
    db.prepare(`
      UPDATE sync_logs
      SET finished_at = CURRENT_TIMESTAMP, status = ?, log_message = ?
      WHERE id = ?
    `).run(status, message, id);
  }

  latest(limit: number): SyncLog[] {
    return db.prepare(`
      SELECT *
      FROM sync_logs
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as SyncLog[];
  }

}
