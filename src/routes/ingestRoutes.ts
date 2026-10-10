import { Router } from "express";
import { IngestController } from "../controllers/IngestController";
import { apiKeyDeviceMiddleware, apiKeyMiddleware } from "../Middleware/apiKeyMiddleware";

const router = Router();
const controller = new IngestController();

// O envio só é aceito com a chave do próprio dispositivo
router.post("/telemetries", apiKeyMiddleware, apiKeyDeviceMiddleware, controller.telemetry.bind(controller));
router.post("/events", apiKeyMiddleware, apiKeyDeviceMiddleware, controller.event.bind(controller));
router.post("/alerts", apiKeyMiddleware, apiKeyDeviceMiddleware, controller.alert.bind(controller));

// Aberta e provisória, para a equipe acompanhar os testes de todos os lacres
router.get("/messages", controller.list.bind(controller));

export default router;
