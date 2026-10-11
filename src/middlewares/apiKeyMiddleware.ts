import { NextFunction, Request, Response } from "express";
import { DeviceRepository } from "../repositories/DeviceRepository";
import { deviceAcceptsKey, hashApiKey } from "../utils/apiKeyHash";
import { barrarEnderecoBloqueado, registrarFalhaDeChave } from "./limite";

// Rotas do lacre: exigem a chave do dispositivo no cabeçalho X-API-Key.
// A Oxide guarda só o hash da chave; a chave em texto existe no lacre e
// em quem fez o cadastro.

const deviceRepository = new DeviceRepository();

// A chave existe e o dispositivo está ativo
export function apiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (barrarEnderecoBloqueado(req, res)) return;

  const apiKey = req.header("X-API-Key");

  if (!apiKey) {
    registrarFalhaDeChave(req);
    res.status(401).json({ success: false, message: "API Key obrigatória" });
    return;
  }

  const device = deviceRepository.findByApiKeyHash(hashApiKey(apiKey));

  if (!device) {
    registrarFalhaDeChave(req);
    res.status(401).json({ success: false, message: "API Key inválida" });
    return;
  }

  if (device.active !== 1) {
    res.status(403).json({ success: false, message: "Dispositivo desativado" });
    return;
  }

  next();
}

// A chave é a do próprio dispositivo informado na rota ou no corpo
export function apiKeyDeviceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const routeDeviceId = req.params.deviceId;
  const bodyDeviceId = req.body?.device_id;
  const deviceId =
    typeof routeDeviceId === "string"
      ? routeDeviceId
      : typeof bodyDeviceId === "string"
        ? bodyDeviceId
        : "";

  if (!deviceId) {
    res.status(400).json({ success: false, message: "device_id é obrigatório" });
    return;
  }

  const device = deviceRepository.findByDeviceId(deviceId);

  if (!device) {
    res.status(404).json({ success: false, message: "Dispositivo não encontrado" });
    return;
  }

  if (!deviceAcceptsKey(device, req.header("X-API-Key") ?? "")) {
    registrarFalhaDeChave(req);
    res.status(403).json({ success: false, message: "API Key não pertence ao dispositivo" });
    return;
  }

  next();
}
