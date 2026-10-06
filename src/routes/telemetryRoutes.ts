import { Router } from "express";
import { TelemetryController } from "../controllers/TelemetryController";
import {
  apiKeyDeviceMiddleware,
  apiKeyMiddleware
} from "../Middleware/apiKeyMiddleware";

const router = Router();

const controller =
  new TelemetryController();

router.get(
  "/telemetries",
  apiKeyMiddleware,
  controller.findAll.bind(controller)
);

// A listagem continua geral para a equipe acompanhar os testes (SEG-03);
// o envio só é aceito com a chave do próprio dispositivo
router.post(
  "/telemetries",
  apiKeyMiddleware,
  apiKeyDeviceMiddleware,
  controller.create.bind(controller)
);

export default router;
