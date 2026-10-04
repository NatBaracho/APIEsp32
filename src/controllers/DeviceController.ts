import { Request, Response } from "express";
import { DeviceService } from "../services/DeviceService";

export class DeviceController {

  private service = new DeviceService();

  async findAll(
    req: Request,
    res: Response
  ): Promise<void> {

    try {
      const devices = this.service.findAll();

      res.status(200).json(devices);

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Erro ao buscar dispositivos"
      });
    }

  }

  async findByDeviceId(
    req: Request,
    res: Response
  ): Promise<void> {

    try {
      const deviceId =
        typeof req.params.deviceId === "string"
          ? req.params.deviceId
          : "";

      if (!deviceId) {
        res.status(400).json({
          success: false,
          message: "Identificador do dispositivo inválido"
        });

        return;
      }

      const device = this.service.findByDeviceId(deviceId);

      if (!device) {
        res.status(404).json({
          success: false,
          message: "Dispositivo não encontrado"
        });

        return;
      }

      res.status(200).json(device);

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Erro interno"
      });
    }

  }

  async create(
    req: Request,
    res: Response
  ): Promise<void> {

    try {
      this.service.create(req.body);

      res.status(201).json({
        success: true,
        message: "Dispositivo criado"
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message: "Erro ao criar dispositivo"
      });
    }

  }

}
