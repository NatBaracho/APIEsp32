import { Router } from "express";
import { TelemetryController } from "../controllers/TelemetryController";

const router = Router();

const controller =
  new TelemetryController();

router.post(
  "/telemetries",
  controller.create
);

export default router;
