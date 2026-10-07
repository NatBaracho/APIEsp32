import { Request, Response } from "express";
import { CylinderStatusValue, cylinderStatusValues } from "../models/Assignment";
import { CylinderService } from "../services/CylinderService";

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

export class CylinderController {

  private service = new CylinderService();

  async findAll(req: Request, res: Response): Promise<void> {
    res.status(200).json(this.service.findAll());
  }

  async findByCode(req: Request, res: Response): Promise<void> {
    const cylinder = this.service.findByCode(String(req.params.cylinderCode));

    if (!cylinder) {
      res.status(404).json({ success: false, message: "Cilindro não encontrado" });
      return;
    }

    res.status(200).json(cylinder);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = req.body ?? {};

    if (!isText(body.cylinder_code) || !isText(body.serial_number)) {
      res.status(400).json({ success: false, message: "cylinder_code e serial_number são obrigatórios" });
      return;
    }

    const status = body.status ?? "DISPONIVEL";
    if (!cylinderStatusValues.includes(status)) {
      res.status(400).json({ success: false, message: `status deve ser ${cylinderStatusValues.join(", ")}` });
      return;
    }

    const result = this.service.create({
      cylinder_code: body.cylinder_code,
      serial_number: body.serial_number,
      status
    });

    if (result.kind === "duplicate_code") {
      res.status(409).json({ success: false, message: "Cilindro já cadastrado" });
      return;
    }

    if (result.kind === "duplicate_serial") {
      res.status(409).json({ success: false, message: "Número de série já usado por outro cilindro" });
      return;
    }

    res.status(201).json({ success: true, cylinder: result.cylinder });
  }

  async updateStatus(req: Request, res: Response): Promise<void> {
    const status = req.body?.status;

    if (!cylinderStatusValues.includes(status)) {
      res.status(400).json({ success: false, message: `status deve ser ${cylinderStatusValues.join(", ")}` });
      return;
    }

    const cylinder = this.service.updateStatus(String(req.params.cylinderCode), status as CylinderStatusValue);

    if (!cylinder) {
      res.status(404).json({ success: false, message: "Cilindro não encontrado" });
      return;
    }

    res.status(200).json({ success: true, cylinder });
  }

}
