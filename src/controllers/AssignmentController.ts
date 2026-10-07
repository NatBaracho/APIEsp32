import { Request, Response } from "express";
import { AssignmentFilter } from "../repositories/AssignmentRepository";
import { AssignmentService } from "../services/AssignmentService";

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

function filterFromQuery(query: Request["query"]): AssignmentFilter {
  const filter: AssignmentFilter = {};
  if (isText(query.device_id)) filter.device_id = query.device_id;
  if (isText(query.seal_code)) filter.seal_code = query.seal_code;
  if (isText(query.cylinder_code)) filter.cylinder_code = query.cylinder_code;
  if (query.active === "true") filter.active_only = true;
  return filter;
}

function parseReplace(value: unknown): boolean | undefined {
  if (value == null) return false;
  return typeof value === "boolean" ? value : undefined;
}

function parseEndReason(value: unknown): string | null | undefined {
  if (value == null) return null;
  return typeof value === "string" ? value : undefined;
}

export class AssignmentController {

  private service = new AssignmentService();

  // Dispositivo ↔ lacre ----------------------------------------------------

  async listDeviceSeal(req: Request, res: Response): Promise<void> {
    res.status(200).json(this.service.listSealAssignments(filterFromQuery(req.query)));
  }

  async linkDeviceSeal(req: Request, res: Response): Promise<void> {
    const body = req.body ?? {};
    const replace = parseReplace(body.replace);

    if (!isText(body.device_id) || !isText(body.seal_code) || replace === undefined) {
      res.status(400).json({ success: false, message: "device_id e seal_code são obrigatórios; replace deve ser true ou false" });
      return;
    }

    const result = this.service.linkDeviceSeal(body.device_id, body.seal_code, replace);

    switch (result.kind) {
      case "device_not_found":
        res.status(404).json({ success: false, message: "Dispositivo não encontrado" });
        return;
      case "seal_not_found":
        res.status(404).json({ success: false, message: "Lacre não encontrado" });
        return;
      case "device_has_seal":
        res.status(409).json({ success: false, message: "Dispositivo já tem lacre ativo; use replace: true para trocar", active: result.active });
        return;
      case "seal_has_device":
        res.status(409).json({ success: false, message: "Lacre já tem dispositivo ativo; use replace: true para trocar", active: result.active });
        return;
      default:
        res.status(201).json({ success: true, assignment: result.assignment });
    }
  }

  async endDeviceSeal(req: Request, res: Response): Promise<void> {
    const reason = parseEndReason(req.body?.reason);

    if (reason === undefined) {
      res.status(400).json({ success: false, message: "reason deve ser texto" });
      return;
    }

    const result = this.service.endSealAssignment(Number(req.params.id), reason);
    this.respondEnd(res, result);
  }

  // Lacre ↔ cilindro --------------------------------------------------------

  async listSealCylinder(req: Request, res: Response): Promise<void> {
    res.status(200).json(this.service.listCylinderAssignments(filterFromQuery(req.query)));
  }

  async linkSealCylinder(req: Request, res: Response): Promise<void> {
    const body = req.body ?? {};
    const replace = parseReplace(body.replace);

    if (!isText(body.seal_code) || !isText(body.cylinder_code) || replace === undefined) {
      res.status(400).json({ success: false, message: "seal_code e cylinder_code são obrigatórios; replace deve ser true ou false" });
      return;
    }

    const result = this.service.linkSealCylinder(body.seal_code, body.cylinder_code, replace);

    switch (result.kind) {
      case "seal_not_found":
        res.status(404).json({ success: false, message: "Lacre não encontrado" });
        return;
      case "cylinder_not_found":
        res.status(404).json({ success: false, message: "Cilindro não encontrado" });
        return;
      case "seal_not_installable":
        res.status(409).json({ success: false, message: `Lacre no estado ${result.status} não pode ser instalado; só EM_ESTOQUE ou REMOVIDO` });
        return;
      case "seal_has_cylinder":
        res.status(409).json({ success: false, message: "Lacre já tem cilindro ativo; use replace: true para trocar", active: result.active });
        return;
      case "cylinder_has_seal":
        res.status(409).json({ success: false, message: "Cilindro já tem lacre ativo; use replace: true para trocar", active: result.active });
        return;
      default:
        res.status(201).json({ success: true, assignment: result.assignment });
    }
  }

  async endSealCylinder(req: Request, res: Response): Promise<void> {
    const reason = parseEndReason(req.body?.reason);

    if (reason === undefined) {
      res.status(400).json({ success: false, message: "reason deve ser texto" });
      return;
    }

    const result = this.service.endCylinderAssignment(Number(req.params.id), reason);
    this.respondEnd(res, result);
  }

  private respondEnd(
    res: Response,
    result: { kind: "ended"; assignment: unknown } | { kind: "not_found" } | { kind: "already_ended" }
  ): void {
    if (result.kind === "not_found") {
      res.status(404).json({ success: false, message: "Vínculo não encontrado" });
      return;
    }

    if (result.kind === "already_ended") {
      res.status(409).json({ success: false, message: "Vínculo já encerrado" });
      return;
    }

    res.status(200).json({ success: true, assignment: result.assignment });
  }

}
