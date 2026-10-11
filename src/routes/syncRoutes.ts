import { Router } from "express";
import { SyncController } from "../controllers/SyncController";
import { adminMiddleware } from "../middlewares/adminMiddleware";

const router = Router();
const controller = new SyncController();

// Acompanhamento da fila: só com a chave de administrador
router.use(adminMiddleware);

router.get("/status", controller.status.bind(controller));
router.get("/problems", controller.problems.bind(controller));
router.post("/retry", controller.retry.bind(controller));

export default router;
