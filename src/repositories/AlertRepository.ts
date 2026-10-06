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

}