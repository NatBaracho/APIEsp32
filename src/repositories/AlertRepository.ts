import db from "../database/connection";
import { Alert } from "../models/Alert";

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

  statusExists(statusId: number): boolean {
    return Boolean(
      db.prepare("SELECT 1 FROM status WHERE id = ?").get(statusId)
    );
  }

  create(alert: Alert): Alert {
    const result = db.prepare(`
      INSERT INTO alerts (
        alert_id,
        device_id,
        alert_type,
        status_id,
        severity_id,
        title,
        description
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      alert.alert_id,
      alert.device_id,
      alert.alert_type,
      alert.status_id,
      alert.severity_id,
      alert.title,
      alert.description ?? null
    );

    return db
      .prepare("SELECT * FROM alerts WHERE id = ?")
      .get(result.lastInsertRowid) as Alert;
  }

}