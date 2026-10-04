import { Alert } from "../models/Alert";
import { AlertRepository } from "../repositories/AlertRepository";

export type CreateAlertResult =
  | { kind: "created"; alert: Alert }
  | { kind: "duplicate" }
  | { kind: "invalid_status" };

export class AlertService {

  private repository = new AlertRepository();

  create(alert: Alert): CreateAlertResult {
    if (this.repository.findByAlertId(alert.alert_id)) {
      return { kind: "duplicate" };
    }

    if (
      !this.repository.statusExists(alert.status_id) ||
      !this.repository.statusExists(alert.severity_id)
    ) {
      return { kind: "invalid_status" };
    }

    return {
      kind: "created",
      alert: this.repository.create(alert)
    };
  }

}