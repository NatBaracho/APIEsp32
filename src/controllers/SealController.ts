import { Request, Response } from "express";
import { SealStatusValue, sealStatusValues } from "../models/Assignment";
import { SealService } from "../services/SealService";

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

export class SealController {

  private service = new SealService();

  async findAll(req: Request, res: Response): Promise<void> {
    res.status(200).json(this.service.findAll());
  }

  async findByCode(req: Request, res: Response): Promise<void> {
    const seal = this.service.findByCode(String(req.params.sealCode));

    if (!seal) {
      res.status(404).json({ success: false, message: "Lacre não encontrado" });
      return;
    }

    res.status(200).json(seal);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = req.body ?? {};

    if (!isText(body.seal_code) || !isText(body.nfc_uid)) {
      res.status(400).json({ success: false, message: "seal_code e nfc_uid são obrigatórios" });
      return;
    }

    // Lacre novo entra em estoque; INSTALADO só pelo vínculo com o cilindro
    const status = body.status ?? "EM_ESTOQUE";
    if (!sealStatusValues.includes(status) || status === "INSTALADO") {
      res.status(400).json({ success: false, message: "status inválido para cadastro de lacre" });
      return;
    }

    const result = this.service.create({ seal_code: body.seal_code, nfc_uid: body.nfc_uid, status });

    if (result.kind === "duplicate_code") {
      res.status(409).json({ success: false, message: "Lacre já cadastrado" });
      return;
    }

    if (result.kind === "duplicate_nfc") {
      res.status(409).json({ success: false, message: "UID NFC já usado por outro lacre" });
      return;
    }

    res.status(201).json({ success: true, seal: result.seal });
  }

  async updateStatus(req: Request, res: Response): Promise<void> {
    const status = req.body?.status;

    if (!sealStatusValues.includes(status)) {
      res.status(400).json({ success: false, message: `status deve ser ${sealStatusValues.join(", ")}` });
      return;
    }

    const result = this.service.updateStatus(String(req.params.sealCode), status as SealStatusValue);

    if (result.kind === "not_found") {
      res.status(404).json({ success: false, message: "Lacre não encontrado" });
      return;
    }

    if (result.kind === "use_assignment") {
      res.status(409).json({ success: false, message: "INSTALADO é definido pelo vínculo do lacre com o cilindro" });
      return;
    }

    if (result.kind === "has_active_cylinder") {
      res.status(409).json({ success: false, message: "Lacre está instalado; encerre o vínculo com o cilindro antes" });
      return;
    }

    res.status(200).json({ success: true, seal: result.seal });
  }

}
