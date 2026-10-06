import { Router } from "express";
import { EventController } from "../controllers/EventController";
import {
  apiKeyDeviceMiddleware,
  apiKeyMiddleware
} from "../Middleware/apiKeyMiddleware";

const router = Router();

const controller =
  new EventController();

router.post(
  "/events",
  apiKeyMiddleware,
  apiKeyDeviceMiddleware,
  controller.create.bind(controller)
);

export default router;
