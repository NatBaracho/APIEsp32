import { Request, Response } from "express";
import {
  AlertSeverity,
  AlertStatus,
  alertSeverities,
  alertStatuses,
  defaultSeverityByType,
  normalizeAlertType
} from "../models/Alert";
import { AlertFilters } from "../repositories/AlertRepository";
import { AlertService, UpdateAlertStatusResult } from "../services/AlertService";

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

export class AlertController {

  private service = new AlertService();

  async create(
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      const body = req.body ?? {};
      // Códigos do catálogo; nomes antigos em inglês são convertidos
      const alertType = typeof body.alert_type === "string"
        ? normalizeAlertType(body.alert_type)
        : undefined;

      if (
        typeof body.alert_id !== "string" ||
        !body.alert_id.trim() ||
        typeof body.device_id !== "string" ||
        !body.device_id.trim() ||
        !alertType ||
        typeof body.title !== "string" ||
        !body.title.trim() ||
        (body.description != null && typeof body.description !== "string")
      ) {
        res.status(400).json({
          success: false,
          message: "alert_id, device_id, alert_type do catálogo (Tipos-de-Erro.md) e title são obrigatórios"
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

  async list(
    req: Request,
    res: Response
  ): Promise<void> {
    const filters: AlertFilters = {};

    if (req.query.status != null) {
      if (!alertStatuses.includes(req.query.status as AlertStatus)) {
        res.status(400).json({
          success: false,
          message: "status deve ser ABERTO, EM_ANALISE ou ENCERRADO"
        });
        return;
      }

      filters.status = req.query.status as AlertStatus;
    }

    if (isText(req.query.device_id)) {
      filters.device_id = req.query.device_id;
    }

    const alerts = this.service.list(filters);

    res.status(200).json({
      success: true,
      total: alerts.length,
      alerts
    });
  }

  async updateStatus(
    req: Request,
    res: Response
  ): Promise<void> {
    const body = req.body ?? {};
    const alertId = String(req.params.alertId);
    let result: UpdateAlertStatusResult;

    if (body.status === "EM_ANALISE") {
      result = this.service.markInAnalysis(alertId);
    } else if (body.status === "ENCERRADO") {
      if (!isText(body.resolved_by) || !isText(body.resolution_note)) {
        res.status(400).json({
          success: false,
          message: "Para encerrar, resolved_by e resolution_note são obrigatórios"
        });
        return;
      }

      result = this.service.close(
        alertId,
        body.resolved_by.trim(),
        body.resolution_note.trim()
      );
    } else {
      res.status(400).json({
        success: false,
        message: "status deve ser EM_ANALISE ou ENCERRADO"
      });
      return;
    }

    switch (result.kind) {
      case "not_found":
        res.status(404).json({
          success: false,
          message: "Alerta não encontrado"
        });
        return;
      case "invalid_transition":
        res.status(409).json({
          success: false,
          message: result.current === "ENCERRADO"
            ? "Alerta já encerrado; um problema novo gera um alerta novo"
            : `Transição não permitida a partir de ${result.current}`
        });
        return;
      default:
        res.status(200).json({
          success: true,
          alert: result.alert
        });
    }
  }

}
