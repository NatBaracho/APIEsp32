import { Router } from "express";
import { CommandController } from "../controllers/CommandController";
import { apiKeyDeviceMiddleware, apiKeyMiddleware } from "../middlewares/apiKeyMiddleware";
import { limitePorDispositivo } from "../middlewares/limite";

const router = Router();
const controller = new CommandController();

// O lacre só busca e confirma os próprios comandos
const lacre = [apiKeyMiddleware, apiKeyDeviceMiddleware, limitePorDispositivo];

router.get("/commands/:deviceId", lacre, controller.findPendingByDevice.bind(controller));
router.post("/commands/confirm", lacre, controller.confirm.bind(controller));

export default router;
