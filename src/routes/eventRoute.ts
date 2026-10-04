import { Router } from "express";
import { EventController } from "../controllers/EventController";

const router = Router();

const controller =
  new EventController();

router.post(
  "/events",
  controller.create.bind(controller)
);

export default router;
