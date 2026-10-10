import db from "../database/connection";
import { CommandExecutionStatus, DeviceCommand } from "../models/Command";

export class CommandRepository {

  findPendingByDeviceId(deviceId: string): DeviceCommand[] {
    return db
      .prepare(`
        SELECT *
        FROM commands
        WHERE device_id = ?
          AND status = 'PENDENTE'
        ORDER BY id ASC
      `)
      .all(deviceId) as DeviceCommand[];
  }

  findByCommandId(
    commandId: string,
    deviceId: string
  ): DeviceCommand | undefined {
    return db
      .prepare(`
        SELECT *
        FROM commands
        WHERE command_id = ?
          AND device_id = ?
      `)
      .get(commandId, deviceId) as DeviceCommand | undefined;
  }

  confirm(
    commandId: string,
    deviceId: string,
    status: CommandExecutionStatus,
    errorMessage?: string
  ): boolean {
    const result = db.prepare(`
      UPDATE commands
      SET
        status = ?,
        executed_at = CURRENT_TIMESTAMP,
        error_message = ?
      WHERE command_id = ?
        AND device_id = ?
        AND status = 'PENDENTE'
    `).run(
      status,
      errorMessage ?? null,
      commandId,
      deviceId
    );

    return result.changes === 1;
  }

  // Comando vindo do banco principal: entra uma vez só (pelo command_id)
  insertFromMain(commandId: string, deviceId: string, commandType: string, createdAt: string | null): boolean {
    return db.prepare(`
      INSERT OR IGNORE INTO commands (command_id, device_id, command_type, status, created_at)
      VALUES (?, ?, ?, 'PENDENTE', COALESCE(?, CURRENT_TIMESTAMP))
    `).run(commandId, deviceId, commandType, createdAt).changes === 1;
  }

  countPending(): number {
    return (db.prepare("SELECT count(*) AS n FROM commands WHERE status = 'PENDENTE'").get() as { n: number }).n;
  }

}
