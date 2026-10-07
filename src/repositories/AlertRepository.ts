import db from "../database/connection";
import { Alert, AlertStatus } from "../models/Alert";

export interface AlertFilters {
  status?: AlertStatus;
  device_id?: string;
}

export class AlertRepository {

  findByAlertId(alertId: string): Alert | undefined {
    return db
      .prepare(`
        SELECT *
        FROM alerts
        WHERE alert_id = ?
      `)
      .get(alertId) as Alert | undefined;
  }

  list(filters: AlertFilters): Alert[] {
    const conditions: string[] = [];
    const params: string[] = [];

    if (filters.status) {
      conditions.push("status = ?");
      params.push(filters.status);
    }

    if (filters.device_id) {
      conditions.push("device_id = ?");
      params.push(filters.device_id);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    return db
      .prepare(`
        SELECT *
        FROM alerts
        ${where}
        ORDER BY created_at DESC, id DESC
      `)
      .all(...params) as Alert[];
  }

  create(alert: Alert): Alert {
    const result = db.prepare(`
      INSERT INTO alerts (
        alert_id,
        device_id,
        alert_type,
        severity,
        status,
        title,
        description
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      alert.alert_id,
      alert.device_id,
      alert.alert_type,
      alert.severity,
      alert.status,
      alert.title,
      alert.description ?? null
    );

    return db
      .prepare("SELECT * FROM alerts WHERE id = ?")
      .get(result.lastInsertRowid) as Alert;
  }

  // Só altera se o alerta ainda estiver no status lido (evita duas
  // atualizações simultâneas passarem pela mesma transição)
  markInAnalysis(alertId: string, currentStatus: AlertStatus): boolean {
    return db.prepare(`
      UPDATE alerts
      SET status = 'EM_ANALISE'
      WHERE alert_id = ? AND status = ?
    `).run(alertId, currentStatus).changes > 0;
  }

  close(
    alertId: string,
    currentStatus: AlertStatus,
    resolvedBy: string,
    resolutionNote: string
  ): boolean {
    return db.prepare(`
      UPDATE alerts
      SET status = 'ENCERRADO',
          resolved_at = CURRENT_TIMESTAMP,
          resolved_by = ?,
          resolution_note = ?
      WHERE alert_id = ? AND status = ?
    `).run(resolvedBy, resolutionNote, alertId, currentStatus).changes > 0;
  }

}
