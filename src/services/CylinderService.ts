import { Cylinder, CylinderStatusValue } from "../models/Assignment";
import { CylinderRepository } from "../repositories/CylinderRepository";

export type CreateCylinderResult =
  | { kind: "created"; cylinder: Cylinder }
  | { kind: "duplicate_code" }
  | { kind: "duplicate_serial" };

export class CylinderService {

  private repository = new CylinderRepository();

  findAll(): Cylinder[] {
    return this.repository.findAll();
  }

  findByCode(cylinderCode: string): Cylinder | undefined {
    return this.repository.findByCode(cylinderCode);
  }

  create(cylinder: Cylinder): CreateCylinderResult {
    if (this.repository.findByCode(cylinder.cylinder_code)) {
      return { kind: "duplicate_code" };
    }

    if (this.repository.findBySerialNumber(cylinder.serial_number)) {
      return { kind: "duplicate_serial" };
    }

    return { kind: "created", cylinder: this.repository.create(cylinder) };
  }

  updateStatus(cylinderCode: string, status: CylinderStatusValue): Cylinder | undefined {
    if (!this.repository.findByCode(cylinderCode)) {
      return undefined;
    }

    this.repository.updateStatus(cylinderCode, status);
    return this.repository.findByCode(cylinderCode);
  }

}
