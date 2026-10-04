import { Router } from "express";
import { TelemetryController } from "../controllers/TelemetryController";
import { apiKeyMiddleware } from "../Middleware/apiKeyMiddleware";

const router = Router();

const controller =
  new TelemetryController();

router.post(
  "/telemetries",
  apiKeyMiddleware,
  controller.create.bind(controller)
);

export default router;
