import { Request, Response } from "express";
import { Alert, alertTypes } from "../models/Alert";
import { AlertService } from "../services/AlertService";

export class AlertController {

  private service = new AlertService();

  async create(
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      const body = req.body ?? {};
      const isInteger = (value: unknown): value is number =>
        typeof value === "number" && Number.isInteger(value) && value > 0;

      if (
        typeof body.alert_id !== "string" ||
        !body.alert_id.trim() ||
        typeof body.device_id !== "string" ||
        !body.device_id.trim() ||
        typeof body.alert_type !== "string" ||
        !alertTypes.includes(body.alert_type as typeof alertTypes[number]) ||
        !isInteger(body.status_id) ||
        !isInteger(body.severity_id) ||
        typeof body.title !== "string" ||
        !body.title.trim() ||
        (body.description != null && typeof body.description !== "string")
      ) {
        res.status(400).json({
          success: false,
          message: "alert_id, device_id, alert_type válido, status_id, severity_id e title são obrigatórios"
        });
        return;
      }

      const result = this.service.create(body as Alert);

      if (result.kind === "duplicate") {
        res.status(409).json({
          success: false,
          message: "Alerta duplicado"
        });
        return;
      }

      if (result.kind === "invalid_status") {
        res.status(400).json({
          success: false,
          message: "status_id e severity_id devem existir na tabela status"
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