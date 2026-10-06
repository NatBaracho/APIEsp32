import { Request, Response } from "express";
import {
  AlertSeverity,
  AlertType,
  alertSeverities,
  alertTypes,
  defaultSeverityByType
} from "../models/Alert";
import { AlertService } from "../services/AlertService";

export class AlertController {

  private service = new AlertService();

  async create(
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      const body = req.body ?? {};

      if (
        typeof body.alert_id !== "string" ||
        !body.alert_id.trim() ||
        typeof body.device_id !== "string" ||
        !body.device_id.trim() ||
        typeof body.alert_type !== "string" ||
        !alertTypes.includes(body.alert_type as AlertType) ||
        typeof body.title !== "string" ||
        !body.title.trim() ||
        (body.description != null && typeof body.description !== "string")
      ) {
        res.status(400).json({
          success: false,
          message: "alert_id, device_id, alert_type válido e title são obrigatórios"
        });
        return;
      }

      if (
        body.severity != null &&
        !alertSeverities.includes(body.severity as AlertSeverity)
      ) {
        res.status(400).json({
          success: false,
          message: "severity deve ser BAIXA, MEDIA, ALTA ou CRITICA"
        });
        return;
      }

      // status nasce sempre ABERTO; status_id/severity_id de firmwares
      // antigos são ignorados (ficam fora do alerta gravado)
      const alertType = body.alert_type as AlertType;
      const result = this.service.create({
        alert_id: body.alert_id,
        device_id: body.device_id,
        alert_type: alertType,
        severity: body.severity ?? defaultSeverityByType[alertType],
        status: "ABERTO",
        title: body.title,
        description: body.description
      });

      if (result.kind === "duplicate") {
        res.status(409).json({
          success: false,
          message: "Alerta duplicado"
        });
        return;
      }

      res.status(201).json({
        success: true,
        alert: result.alert
      });
    } catch (error) {
      console.error(error);

      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "SQLITE_CONSTRAINT_UNIQUE"
      ) {
        res.status(409).json({
          success: false,
          message: "Alerta duplicado"
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: "Erro ao criar alerta"
      });
    }
  }

}