import { Router } from "express";
import { IngestController } from "../controllers/IngestController";
import { adminMiddleware } from "../middlewares/adminMiddleware";
import { apiKeyDeviceMiddleware, apiKeyMiddleware } from "../middlewares/apiKeyMiddleware";
import { limitePorDispositivo } from "../middlewares/limite";

const router = Router();
const controller = new IngestController();

// O envio só é aceito com a chave do próprio dispositivo, dentro do limite por minuto
const lacre = [apiKeyMiddleware, apiKeyDeviceMiddleware, limitePorDispositivo];

router.post("/telemetries", lacre, controller.telemetry.bind(controller));
router.post("/events", lacre, controller.event.bind(controller));
router.post("/alerts", lacre, controller.alert.bind(controller));
router.post("/activations", lacre, controller.activation.bind(controller));

// Para a equipe acompanhar as mensagens de todos os lacres: chave de administrador
router.get("/messages", adminMiddleware, controller.list.bind(controller));

export default router;
