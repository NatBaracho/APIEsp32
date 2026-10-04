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

export default router;