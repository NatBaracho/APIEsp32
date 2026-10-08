import db from "../database/connection";
import { Cylinder, CylinderStatusValue } from "../models/Assignment";

export class CylinderRepository {

  findAll(): Cylinder[] {
    return db
      .prepare("SELECT * FROM cylinders ORDER BY cylinder_code")
      .all() as Cylinder[];
  }

  findByCode(cylinderCode: string): Cylinder | undefined {
    return db
      .prepare("SELECT * FROM cylinders WHERE cylinder_code = ?")
      .get(cylinderCode) as Cylinder | undefined;
  }

  create(cylinder: Cylinder): Cylinder {
    db.prepare(`
      INSERT INTO cylinders (cylinder_code, serial_number, status)
      VALUES (?, ?, ?)
    `).run(cylinder.cylinder_code, cylinder.serial_number, cylinder.status);

    return this.findByCode(cylinder.cylinder_code) as Cylinder;
  }

  updateStatus(cylinderCode: string, status: CylinderStatusValue): void {
    db.prepare(`
      UPDATE cylinders
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE cylinder_code = ?
    `).run(status, cylinderCode);
  }

}
