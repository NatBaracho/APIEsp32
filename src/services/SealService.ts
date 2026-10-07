import { Seal, SealStatusValue } from "../models/Assignment";
import { AssignmentRepository } from "../repositories/AssignmentRepository";
import { SealRepository } from "../repositories/SealRepository";

export type CreateSealResult =
  | { kind: "created"; seal: Seal }
  | { kind: "duplicate_code" }
  | { kind: "duplicate_nfc" };

export type UpdateSealStatusResult =
  | { kind: "updated"; seal: Seal }
  | { kind: "not_found" }
  | { kind: "use_assignment" }
  | { kind: "has_active_cylinder" };

export class SealService {

  private repository = new SealRepository();

  private assignments = new AssignmentRepository();

  findAll(): Seal[] {
    return this.repository.findAll();
  }

  findByCode(sealCode: string): Seal | undefined {
    return this.repository.findByCode(sealCode);
  }

  create(seal: Seal): CreateSealResult {
    if (this.repository.findByCode(seal.seal_code)) {
      return { kind: "duplicate_code" };
    }

    if (this.repository.findByNfcUid(seal.nfc_uid)) {
      return { kind: "duplicate_nfc" };
    }

    return { kind: "created", seal: this.repository.create(seal) };
  }

  // INSTALADO e REMOVIDO só mudam pelo vínculo com o cilindro, para o estado
  // do lacre nunca contradizer o vínculo ativo
  updateStatus(sealCode: string, status: SealStatusValue): UpdateSealStatusResult {
    if (!this.repository.findByCode(sealCode)) {
      return { kind: "not_found" };
    }

    if (status === "INSTALADO") {
      return { kind: "use_assignment" };
    }

    if (
      (status === "EM_ESTOQUE" || status === "REMOVIDO") &&
      this.assignments.findActiveCylinderBySeal(sealCode)
    ) {
      return { kind: "has_active_cylinder" };
    }

    this.repository.updateStatus(sealCode, status);
    return { kind: "updated", seal: this.repository.findByCode(sealCode) as Seal };
  }

}
