import { Request, Response } from "express";
import { EventService } from "../services/EventService";

export class EventController {

  private service =
    new EventService();

  async create(
    req: Request,
    res: Response
  ): Promise<void> {

    try {

      const event = req.body ?? {};

      if (
        !event.message_id ||
        !event.device_id ||
        !event.event_type
      ) {
        res.status(400).json({
          success: false,
          message:
            "message_id, device_id e event_type são obrigatórios"
        });

        return;
      }

      const sealStatuses = ["LOCKED", "UNLOCKED", "BROKEN"];

      if (
        event.seal_status != null &&
        !sealStatuses.includes(event.seal_status)
      ) {
        res.status(400).json({
          success: false,
          message: "seal_status deve ser LOCKED, UNLOCKED ou BROKEN"
        });

        return;
      }

      const created = this.service.create(
        event
      );

      if (!created) {
        res.status(409).json({
          success: false,
          message: "Mensagem duplicada"
        });

        return;
      }

      res.status(202).json({
        success: true,
        message: "Evento recebido"
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
