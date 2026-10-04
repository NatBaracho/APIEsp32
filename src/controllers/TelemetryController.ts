import { Request, Response } from "express";

export class TelemetryController {

  async create(
    req: Request,
    res: Response
  ): Promise<void> {

    try {

      const telemetry = req.body;

      console.log("Telemetria recebida:");

      console.log(telemetry);

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
