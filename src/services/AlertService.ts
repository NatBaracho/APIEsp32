import { Alert } from "../models/Alert";
import { AlertRepository } from "../repositories/AlertRepository";

export type CreateAlertResult =
  | { kind: "created"; alert: Alert }
  | { kind: "duplicate" };

export class AlertService {

  private repository = new AlertRepository();

  create(alert: Alert): CreateAlertResult {
    if (this.repository.findByAlertId(alert.alert_id)) {
      return { kind: "duplicate" };
    }

    return {
      kind: "created",
      alert: this.repository.create(alert)
    };
  }

}
