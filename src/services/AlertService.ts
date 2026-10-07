import { Alert } from "../models/Alert";
import { AlertFilters, AlertRepository } from "../repositories/AlertRepository";

export type CreateAlertResult =
  | { kind: "created"; alert: Alert }
  | { kind: "duplicate" };

export type UpdateAlertStatusResult =
  | { kind: "updated"; alert: Alert }
  | { kind: "not_found" }
  | { kind: "invalid_transition"; current: Alert["status"] };

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

  list(filters: AlertFilters): Alert[] {
    return this.repository.list(filters);
  }

  // ABERTO → EM_ANALISE → ENCERRADO, ou ABERTO → ENCERRADO.
  // ENCERRADO é final: problema novo gera alerta novo
  markInAnalysis(alertId: string): UpdateAlertStatusResult {
    const alert = this.repository.findByAlertId(alertId);

    if (!alert) {
      return { kind: "not_found" };
    }

    if (
      alert.status !== "ABERTO" ||
      !this.repository.markInAnalysis(alertId, alert.status)
    ) {
      return { kind: "invalid_transition", current: alert.status };
    }

    return { kind: "updated", alert: this.repository.findByAlertId(alertId)! };
  }

  close(
    alertId: string,
    resolvedBy: string,
    resolutionNote: string
  ): UpdateAlertStatusResult {
    const alert = this.repository.findByAlertId(alertId);

    if (!alert) {
      return { kind: "not_found" };
    }

    if (
      alert.status === "ENCERRADO" ||
      !this.repository.close(alertId, alert.status, resolvedBy, resolutionNote)
    ) {
      return { kind: "invalid_transition", current: alert.status };
    }

    return { kind: "updated", alert: this.repository.findByAlertId(alertId)! };
  }

}
