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

}