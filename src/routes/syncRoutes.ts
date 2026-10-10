import { Router } from "express";
import { SyncController } from "../controllers/SyncController";

const router = Router();
const controller = new SyncController();

router.get("/status", controller.status.bind(controller));
router.get("/problems", controller.problems.bind(controller));
router.post("/retry", controller.retry.bind(controller));

export default router;
