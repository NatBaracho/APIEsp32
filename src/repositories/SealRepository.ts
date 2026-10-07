import db from "../database/connection";
import { Seal, SealStatusValue } from "../models/Assignment";

export class SealRepository {

  findAll(): Seal[] {
    return db
      .prepare("SELECT * FROM seals ORDER BY seal_code")
      .all() as Seal[];
  }

  findByCode(sealCode: string): Seal | undefined {
    return db
      .prepare("SELECT * FROM seals WHERE seal_code = ?")
      .get(sealCode) as Seal | undefined;
  }

  findByNfcUid(nfcUid: string): Seal | undefined {
    return db
      .prepare("SELECT * FROM seals WHERE nfc_uid = ?")
      .get(nfcUid) as Seal | undefined;
  }

  create(seal: Seal): Seal {
    db.prepare(`
      INSERT INTO seals (seal_code, nfc_uid, status)
      VALUES (?, ?, ?)
    `).run(seal.seal_code, seal.nfc_uid, seal.status);

    return this.findByCode(seal.seal_code) as Seal;
  }

  updateStatus(sealCode: string, status: SealStatusValue): void {
    db.prepare(`
      UPDATE seals
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE seal_code = ?
    `).run(status, sealCode);
  }

}
