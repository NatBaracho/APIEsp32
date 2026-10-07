import { Router } from "express";
import { AssignmentController } from "../controllers/AssignmentController";
import { CylinderController } from "../controllers/CylinderController";
import { SealController } from "../controllers/SealController";

// Rotas abertas e provisórias (como /devices) até o Worker trazer o cadastro
// e os vínculos oficiais do FluxID
const seals = new SealController();
const cylinders = new CylinderController();
const assignments = new AssignmentController();

export const sealRoutes = Router();
sealRoutes.get("/", seals.findAll.bind(seals));
sealRoutes.get("/:sealCode", seals.findByCode.bind(seals));
sealRoutes.post("/", seals.create.bind(seals));
sealRoutes.post("/:sealCode/status", seals.updateStatus.bind(seals));

export const cylinderRoutes = Router();
cylinderRoutes.get("/", cylinders.findAll.bind(cylinders));
cylinderRoutes.get("/:cylinderCode", cylinders.findByCode.bind(cylinders));
cylinderRoutes.post("/", cylinders.create.bind(cylinders));
cylinderRoutes.post("/:cylinderCode/status", cylinders.updateStatus.bind(cylinders));

export const assignmentRoutes = Router();
assignmentRoutes.get("/device-seal", assignments.listDeviceSeal.bind(assignments));
assignmentRoutes.post("/device-seal", assignments.linkDeviceSeal.bind(assignments));
assignmentRoutes.post("/device-seal/:id/end", assignments.endDeviceSeal.bind(assignments));
assignmentRoutes.get("/seal-cylinder", assignments.listSealCylinder.bind(assignments));
assignmentRoutes.post("/seal-cylinder", assignments.linkSealCylinder.bind(assignments));
assignmentRoutes.post("/seal-cylinder/:id/end", assignments.endSealCylinder.bind(assignments));
