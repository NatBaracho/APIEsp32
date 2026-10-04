import { Router } from "express";
import { DeviceController } from "../controllers/DeviceController";

const router = Router();

const controller =
  new DeviceController();

router.get(
  "/",
  controller.findAll.bind(controller)
);

router.get(
  "/:deviceId",
  controller.findByDeviceId.bind(controller)
);

router.post(
  "/",
  controller.create.bind(controller)
);

export default router;
