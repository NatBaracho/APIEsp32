import db from "../database/connection";

export class SyncLogRepository {

  start(
    startedAt: string,
    status: string = "PROCESSING"
  ): number {

    const result = db.prepare(`
      INSERT INTO sync_logs (
        started_at,
        status
      )
      VALUES (
        ?,
        ?
      )
    `).run(
      startedAt,
      status
    );

    return Number(result.lastInsertRowid);
  }

  finish(
    id: number,
    finishedAt: string,
    status: string,
    message?: string
  ): void {

    db.prepare(`
      UPDATE sync_logs
      SET
        finished_at = ?,
        status = ?,
        log_message = ?
      WHERE id = ?
    `).run(
      finishedAt,
      status,
      message ?? null,
      id
    );

  }

  findAll() {

    return db.prepare(`
      SELECT *
      FROM sync_logs
      ORDER BY id DESC
    `).all();

  }

}
