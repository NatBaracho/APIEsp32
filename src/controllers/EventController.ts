import { Request, Response } from "express";
import { sealStatuses } from "../models/Event";
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

      if (
        event.attempt_count != null &&
        (!Number.isInteger(event.attempt_count) || event.attempt_count < 0)
      ) {
        res.status(400).json({
          success: false,
          message: "attempt_count deve ser um inteiro maior ou igual a 0"
        });

        return;
      }

      // attempt_count do ESP32 conta as tentativas de envio do dispositivo;
      // a coluna attempt_count da fila pertence ao Worker de sincronização
      const created = this.service.create({
        ...event,
        device_attempt_count: event.attempt_count,
        payload_json: event.payload_json ?? JSON.stringify(event)
      });

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
