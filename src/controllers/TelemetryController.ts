import { Request, Response } from "express";
import { TelemetryService } from "../services/TelemetryService";

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
        !telemetry.message_id ||
        !telemetry.device_id
      ) {
        res.status(400).json({
          success: false,
          message:
            "message_id e device_id são obrigatórios"
        });

        return;
      }

      const created = this.service.create(telemetry);

      if (!created) {
        res.status(409).json({
          success: false,
          message: "Mensagem duplicada"
        });

        return;
      }

      res.status(202).json({
        success: true,
        message: "Telemetria recebida"
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        success: false,
        message: "Erro interno"
      });

    }

  }

}
