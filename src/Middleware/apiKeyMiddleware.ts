import { Request, Response, NextFunction } from "express";
import { DeviceRepository } from "../repositories/DeviceRepository";

const deviceRepository =
  new DeviceRepository();

export function apiKeyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {

  const apiKey =
    req.header("X-API-Key");

  if (!apiKey) {

    res.status(401).json({
      success: false,
      message: "API Key obrigatória"
    });

    return;
  }

  const devices =
    deviceRepository.findAll();

  const device =
    devices.find(
      item => item.api_key === apiKey
    );

  if (!device) {

    res.status(401).json({
      success: false,
      message: "API Key inválida"
    });

    return;
  }

  if (device.active !== 1) {

    res.status(403).json({
      success: false,
      message: "Dispositivo desativado"
    });

    return;
  }

  next();
}
