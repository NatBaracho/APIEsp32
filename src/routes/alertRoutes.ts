import { Router } from "express";
import { AlertController } from "../controllers/AlertController";
import {
  apiKeyDeviceMiddleware,
  apiKeyMiddleware
} from "../Middleware/apiKeyMiddleware";

const router = Router();
const controller = new AlertController();

router.post(
  "/alerts",
  apiKeyMiddleware,
  apiKeyDeviceMiddleware,
  controller.create.bind(controller)
);

// Abertas e provisórias (como /devices) para a equipe acompanhar e o gestor
// analisar e encerrar; o controle por perfil será o do FluxID
router.get("/alerts", controller.list.bind(controller));

router.patch(
  "/alerts/:alertId/status",
  controller.updateStatus.bind(controller)
);

export default router;
