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

      const event = req.body;

      this.service.create(
        event
      );

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
