import { Router } from "express";
import { CommandController } from "../controllers/CommandController";
import {
  apiKeyDeviceMiddleware,
  apiKeyMiddleware
} from "../Middleware/apiKeyMiddleware";

const router = Router();
const controller = new CommandController();

router.get(
  "/commands/:deviceId",
  apiKeyMiddleware,
  apiKeyDeviceMiddleware,
  controller.findPendingByDevice.bind(controller)
);

router.post(
  "/commands/confirm",
  apiKeyMiddleware,
  apiKeyDeviceMiddleware,
  controller.confirm.bind(controller)
);

export default router;