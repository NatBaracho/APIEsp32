import { Request, Response } from "express";
import { sealStatuses } from "../models/Event";
import { TelemetryService } from "../services/TelemetryService";

const numericFields = [
  "latitude",
  "longitude",
  "speed_kmh",
  "battery_percent",
  "gsm_signal"
];

const optionalTextFields = [
  "lacre_id",
  "cilindro_id",
  "payload_json",
  "last_seen_at"
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isSqliteUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

export class TelemetryController {

  private service = new TelemetryService();

  async findAll(
    req: Request,
    res: Response
  ): Promise<void> {

    try {
      const telemetries = this.service.findAll();
      res.status(200).json(telemetries);
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Erro ao listar telemetrias"
      });
    }

  }

  async create(
    req: Request,
    res: Response
  ): Promise<void> {

    try {

      const telemetry = req.body ?? {};

      if (
        !isNonEmptyString(telemetry.message_id) ||
        !isNonEmptyString(telemetry.device_id)
      ) {
        res.status(400).json({
          success: false,
          message:
            "message_id e device_id são obrigatórios"
        });

        return;
      }

      const invalidField =
        numericFields.find(field =>
          telemetry[field] != null &&
          (typeof telemetry[field] !== "number" ||
            !Number.isFinite(telemetry[field]))
        ) ??
        optionalTextFields.find(field =>
          telemetry[field] != null &&
          typeof telemetry[field] !== "string"
        );

      if (invalidField) {
        res.status(400).json({
          success: false,
          message: `Campo ${invalidField} com tipo inválido`
        });

        return;
      }

      // Posição vem completa ou não vem (o FluxID exige as duas coordenadas)
      if ((telemetry.latitude == null) !== (telemetry.longitude == null)) {
        res.status(400).json({
          success: false,
          message: "latitude e longitude devem ser enviadas juntas"
        });

        return;
      }

      if (
        telemetry.latitude != null &&
        (telemetry.latitude < -90 ||
          telemetry.latitude > 90 ||
          telemetry.longitude < -180 ||
          telemetry.longitude > 180)
      ) {
        res.status(400).json({
          success: false,
          message: "latitude deve estar entre -90 e 90 e longitude entre -180 e 180"
        });

        return;
      }

      if (
        telemetry.seal_status != null &&
        !sealStatuses.includes(telemetry.seal_status)
      ) {
        res.status(400).json({
          success: false,
          message: "seal_status deve ser LOCKED, UNLOCKED ou BROKEN"
        });

        return;
      }

      if (
        telemetry.attempt_count != null &&
        (!Number.isInteger(telemetry.attempt_count) || telemetry.attempt_count < 0)
      ) {
        res.status(400).json({
          success: false,
          message: "attempt_count deve ser um inteiro maior ou igual a 0"
        });

        return;
      }

      // attempt_count do ESP32 conta as tentativas de envio do dispositivo;
      // a coluna attempt_count da fila pertence ao Worker de sincronização
      const result = this.service.create({
        ...telemetry,
        device_attempt_count: telemetry.attempt_count,
        payload_json: telemetry.payload_json ?? JSON.stringify(telemetry)
      });

      if (result === "duplicate") {
        res.status(409).json({
          success: false,
          message: "Mensagem duplicada"
        });

        return;
      }

      if (result === "device_not_found") {
        res.status(404).json({
          success: false,
          message: "Dispositivo não encontrado"
        });

        return;
      }

      if (result === "position_repeated") {
        res.status(200).json({
          success: true,
          message: "Posição já registrada; data e hora atualizadas"
        });

        return;
      }

      res.status(202).json({
        success: true,
        message: "Telemetria recebida"
      });

    } catch (error) {

      console.error(error);

      if (isSqliteUniqueError(error)) {
        res.status(409).json({
          success: false,
          message: "Mensagem duplicada"
        });

        return;
      }

      res.status(500).json({
        success: false,
        message: "Erro interno"
      });

    }

  }

}
