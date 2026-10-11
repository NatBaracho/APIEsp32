import { Router } from "express";
import { DeviceController } from "../controllers/DeviceController";
import { adminMiddleware } from "../middlewares/adminMiddleware";

const router = Router();
const controller = new DeviceController();

// Consulta e cadastro de bancada: só com a chave de administrador
router.use(adminMiddleware);

router.get("/", controller.findAll.bind(controller));
router.get("/:deviceId", controller.findByDeviceId.bind(controller));
router.post("/", controller.create.bind(controller));

export default router;
