import { Router } from "express";
import { EventController } from "../controllers/EventController";
import { apiKeyMiddleware } from "../Middleware/apiKeyMiddleware";

const router = Router();

const controller =
  new EventController();

router.post(
  "/events",
  apiKeyMiddleware,
  controller.create.bind(controller)
);

export default router;
