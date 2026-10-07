import db from "../database/connection";
import {
  CylinderAssignment,
  DeviceAssignmentSnapshot,
  SealAssignment
} from "../models/Assignment";

export interface AssignmentFilter {
  device_id?: string;
  seal_code?: string;
  cylinder_code?: string;
  active_only?: boolean;
}

function whereClause(
  filter: AssignmentFilter,
  columns: Array<keyof AssignmentFilter>
): { sql: string; params: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];

  for (const column of columns) {
    const value = filter[column];
    if (typeof value === "string") {
      conditions.push(`${column} = ?`);
      params.push(value);
    }
  }

  if (filter.active_only) {
    conditions.push("ended_at IS NULL");
  }

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params
  };
}

export class AssignmentRepository {

  // Vínculo dispositivo ↔ lacre -------------------------------------------

  findActiveSealByDevice(deviceId: string): SealAssignment | undefined {
    return db.prepare(`
      SELECT * FROM seal_assignments
      WHERE device_id = ? AND ended_at IS NULL
    `).get(deviceId) as SealAssignment | undefined;
  }

  findActiveDeviceBySeal(sealCode: string): SealAssignment | undefined {
    return db.prepare(`
      SELECT * FROM seal_assignments
      WHERE seal_code = ? AND ended_at IS NULL
    `).get(sealCode) as SealAssignment | undefined;
  }

  findSealAssignmentById(id: number): SealAssignment | undefined {
    return db
      .prepare("SELECT * FROM seal_assignments WHERE id = ?")
      .get(id) as SealAssignment | undefined;
  }

  listSealAssignments(filter: AssignmentFilter): SealAssignment[] {
    const where = whereClause(filter, ["device_id", "seal_code"]);
    return db.prepare(`
      SELECT * FROM seal_assignments ${where.sql}
      ORDER BY started_at DESC, id DESC
    `).all(...where.params) as SealAssignment[];
  }

  createSealAssignment(deviceId: string, sealCode: string): SealAssignment {
    const result = db.prepare(`
      INSERT INTO seal_assignments (device_id, seal_code) VALUES (?, ?)
    `).run(deviceId, sealCode);

    return this.findSealAssignmentById(Number(result.lastInsertRowid)) as SealAssignment;
  }

  endSealAssignment(id: number, reason: string | null): void {
    db.prepare(`
      UPDATE seal_assignments
      SET ended_at = CURRENT_TIMESTAMP, end_reason = ?
      WHERE id = ? AND ended_at IS NULL
    `).run(reason, id);
  }

  // Vínculo lacre ↔ cilindro ----------------------------------------------

  findActiveCylinderBySeal(sealCode: string): CylinderAssignment | undefined {
    return db.prepare(`
      SELECT * FROM cylinder_assignments
      WHERE seal_code = ? AND ended_at IS NULL
    `).get(sealCode) as CylinderAssignment | undefined;
  }

  findActiveSealByCylinder(cylinderCode: string): CylinderAssignment | undefined {
    return db.prepare(`
      SELECT * FROM cylinder_assignments
      WHERE cylinder_code = ? AND ended_at IS NULL
    `).get(cylinderCode) as CylinderAssignment | undefined;
  }

  findCylinderAssignmentById(id: number): CylinderAssignment | undefined {
    return db
      .prepare("SELECT * FROM cylinder_assignments WHERE id = ?")
      .get(id) as CylinderAssignment | undefined;
  }

  listCylinderAssignments(filter: AssignmentFilter): CylinderAssignment[] {
    const where = whereClause(filter, ["seal_code", "cylinder_code"]);
    return db.prepare(`
      SELECT * FROM cylinder_assignments ${where.sql}
      ORDER BY started_at DESC, id DESC
    `).all(...where.params) as CylinderAssignment[];
  }

  createCylinderAssignment(sealCode: string, cylinderCode: string): CylinderAssignment {
    const result = db.prepare(`
      INSERT INTO cylinder_assignments (seal_code, cylinder_code) VALUES (?, ?)
    `).run(sealCode, cylinderCode);

    return this.findCylinderAssignmentById(Number(result.lastInsertRowid)) as CylinderAssignment;
  }

  endCylinderAssignment(id: number, reason: string | null): void {
    db.prepare(`
      UPDATE cylinder_assignments
      SET ended_at = CURRENT_TIMESTAMP, end_reason = ?
      WHERE id = ? AND ended_at IS NULL
    `).run(reason, id);
  }

  // Situação atual do dispositivo: lacre ativo e cilindro ativo desse lacre
  snapshotByDevice(deviceId: string): DeviceAssignmentSnapshot {
    const row = db.prepare(`
      SELECT
        sa.seal_code AS seal_code,
        ca.cylinder_code AS cylinder_code,
        c.status AS cylinder_status
      FROM seal_assignments sa
      LEFT JOIN cylinder_assignments ca
        ON ca.seal_code = sa.seal_code AND ca.ended_at IS NULL
      LEFT JOIN cylinders c
        ON c.cylinder_code = ca.cylinder_code
      WHERE sa.device_id = ? AND sa.ended_at IS NULL
    `).get(deviceId) as DeviceAssignmentSnapshot | undefined;

    return row ?? { seal_code: null, cylinder_code: null, cylinder_status: null };
  }

}
