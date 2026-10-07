import db from "../database/connection";
import {
  CylinderAssignment,
  installableSealStatuses,
  SealAssignment
} from "../models/Assignment";
import {
  AssignmentFilter,
  AssignmentRepository
} from "../repositories/AssignmentRepository";
import { CylinderRepository } from "../repositories/CylinderRepository";
import { DeviceRepository } from "../repositories/DeviceRepository";
import { SealRepository } from "../repositories/SealRepository";

const REPLACED_REASON = "Substituído por novo vínculo";

export type LinkDeviceSealResult =
  | { kind: "created"; assignment: SealAssignment }
  | { kind: "device_not_found" }
  | { kind: "seal_not_found" }
  | { kind: "device_has_seal"; active: SealAssignment }
  | { kind: "seal_has_device"; active: SealAssignment };

export type LinkSealCylinderResult =
  | { kind: "created"; assignment: CylinderAssignment }
  | { kind: "seal_not_found" }
  | { kind: "cylinder_not_found" }
  | { kind: "seal_not_installable"; status: string }
  | { kind: "seal_has_cylinder"; active: CylinderAssignment }
  | { kind: "cylinder_has_seal"; active: CylinderAssignment };

export interface DeviceSituation {
  seal_code: string | null;
  cylinder_code: string | null;
  error_type: string | null;
}

export type EndAssignmentResult<T> =
  | { kind: "ended"; assignment: T }
  | { kind: "not_found" }
  | { kind: "already_ended" };

export class AssignmentService {

  private repository = new AssignmentRepository();

  private devices = new DeviceRepository();

  private seals = new SealRepository();

  private cylinders = new CylinderRepository();

  listSealAssignments(filter: AssignmentFilter): SealAssignment[] {
    return this.repository.listSealAssignments(filter);
  }

  listCylinderAssignments(filter: AssignmentFilter): CylinderAssignment[] {
    return this.repository.listCylinderAssignments(filter);
  }

  // RN05: um dispositivo ativo por lacre e um lacre ativo por dispositivo.
  // replace = troca: encerra os vínculos em conflito e cria o novo na mesma
  // transação
  linkDeviceSeal(deviceId: string, sealCode: string, replace: boolean): LinkDeviceSealResult {
    if (!this.devices.findByDeviceId(deviceId)) {
      return { kind: "device_not_found" };
    }

    if (!this.seals.findByCode(sealCode)) {
      return { kind: "seal_not_found" };
    }

    const deviceActive = this.repository.findActiveSealByDevice(deviceId);
    const sealActive = this.repository.findActiveDeviceBySeal(sealCode);

    if (!replace && deviceActive) {
      return { kind: "device_has_seal", active: deviceActive };
    }

    if (!replace && sealActive) {
      return { kind: "seal_has_device", active: sealActive };
    }

    const link = db.transaction(() => {
      for (const active of [deviceActive, sealActive]) {
        if (active) {
          this.repository.endSealAssignment(active.id, REPLACED_REASON);
        }
      }
      return this.repository.createSealAssignment(deviceId, sealCode);
    });

    return { kind: "created", assignment: link() };
  }

  // RN04: um cilindro ativo por lacre e um lacre ativo por cilindro.
  // O lacre passa a INSTALADO; o lacre substituído passa a REMOVIDO
  linkSealCylinder(sealCode: string, cylinderCode: string, replace: boolean): LinkSealCylinderResult {
    const seal = this.seals.findByCode(sealCode);

    if (!seal) {
      return { kind: "seal_not_found" };
    }

    if (!this.cylinders.findByCode(cylinderCode)) {
      return { kind: "cylinder_not_found" };
    }

    const sealActive = this.repository.findActiveCylinderBySeal(sealCode);
    const cylinderActive = this.repository.findActiveSealByCylinder(cylinderCode);

    if (!replace && sealActive) {
      return { kind: "seal_has_cylinder", active: sealActive };
    }

    if (!replace && cylinderActive) {
      return { kind: "cylinder_has_seal", active: cylinderActive };
    }

    // Lacre sem cilindro só é instalado se estiver em estoque ou removido;
    // na troca (lacre já instalado), o estado atual é INSTALADO
    if (!sealActive && !installableSealStatuses.includes(seal.status)) {
      return { kind: "seal_not_installable", status: seal.status };
    }

    const link = db.transaction(() => {
      if (sealActive) {
        this.repository.endCylinderAssignment(sealActive.id, REPLACED_REASON);
      }

      if (cylinderActive && cylinderActive.id !== sealActive?.id) {
        this.repository.endCylinderAssignment(cylinderActive.id, REPLACED_REASON);
        this.markSealRemoved(cylinderActive.seal_code);
      }

      const assignment = this.repository.createCylinderAssignment(sealCode, cylinderCode);
      this.seals.updateStatus(sealCode, "INSTALADO");
      return assignment;
    });

    return { kind: "created", assignment: link() };
  }

  endSealAssignment(id: number, reason: string | null): EndAssignmentResult<SealAssignment> {
    const assignment = this.repository.findSealAssignmentById(id);

    if (!assignment) {
      return { kind: "not_found" };
    }

    if (assignment.ended_at) {
      return { kind: "already_ended" };
    }

    this.repository.endSealAssignment(id, reason);
    return { kind: "ended", assignment: this.repository.findSealAssignmentById(id) as SealAssignment };
  }

  endCylinderAssignment(id: number, reason: string | null): EndAssignmentResult<CylinderAssignment> {
    const assignment = this.repository.findCylinderAssignmentById(id);

    if (!assignment) {
      return { kind: "not_found" };
    }

    if (assignment.ended_at) {
      return { kind: "already_ended" };
    }

    const end = db.transaction(() => {
      this.repository.endCylinderAssignment(id, reason);
      this.markSealRemoved(assignment.seal_code);
    });
    end();

    return { kind: "ended", assignment: this.repository.findCylinderAssignmentById(id) as CylinderAssignment };
  }

  // Lacre e cilindro ativos do dispositivo e o código do catálogo
  // Tipos-de-Erro.md a registrar no recebimento (sem gerar alerta)
  describeDevice(deviceId: string, sealStatus?: string | null): DeviceSituation {
    const snapshot = this.repository.snapshotByDevice(deviceId);
    let errorType: string | null = null;

    if (
      (sealStatus === "UNLOCKED" || sealStatus === "BROKEN") &&
      snapshot.cylinder_status === "EM_TRANSITO"
    ) {
      errorType = "LACRE_ABERTO_EM_TRANSITO";
    } else if (!snapshot.seal_code) {
      errorType = "DISPOSITIVO_SEM_LACRE";
    } else if (!snapshot.cylinder_code) {
      errorType = "LACRE_SEM_CILINDRO";
    }

    return {
      seal_code: snapshot.seal_code,
      cylinder_code: snapshot.cylinder_code,
      error_type: errorType
    };
  }

  // Só um lacre INSTALADO vira REMOVIDO; violado ou rompido mantém o estado
  private markSealRemoved(sealCode: string): void {
    if (this.seals.findByCode(sealCode)?.status === "INSTALADO") {
      this.seals.updateStatus(sealCode, "REMOVIDO");
    }
  }

}
