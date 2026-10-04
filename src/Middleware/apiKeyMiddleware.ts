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

export function apiKeyDeviceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const routeDeviceId = req.params.deviceId;
  const bodyDeviceId = req.body?.device_id;
  const deviceId =
    typeof routeDeviceId === "string"
      ? routeDeviceId
      : typeof bodyDeviceId === "string"
        ? bodyDeviceId
        : "";

  if (!deviceId) {
    res.status(400).json({
      success: false,
      message: "device_id é obrigatório"
    });
    return;
  }

  const device = deviceRepository.findByDeviceId(deviceId);

  if (!device) {
    res.status(404).json({
      success: false,
      message: "Dispositivo não encontrado"
    });
    return;
  }

  if (device.api_key !== req.header("X-API-Key")) {
    res.status(403).json({
      success: false,
      message: "API Key não pertence ao dispositivo"
    });
    return;
  }

  next();
}
