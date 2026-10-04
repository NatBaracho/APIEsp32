import { CommandExecutionStatus, DeviceCommand } from "../models/Command";
import { CommandRepository } from "../repositories/CommandRepository";

export type CommandConfirmationResult =
  | "confirmed"
  | "not_found"
  | "not_pending";

export class CommandService {

  private repository = new CommandRepository();

  findPendingByDeviceId(deviceId: string): DeviceCommand[] {
    return this.repository.findPendingByDeviceId(deviceId);
  }

  confirm(
    commandId: string,
    deviceId: string,
    status: CommandExecutionStatus,
    errorMessage?: string
  ): CommandConfirmationResult {
    const command = this.repository.findByCommandId(commandId, deviceId);

    if (!command) {
      return "not_found";
    }

    if (command.status !== "PENDENTE") {
      return "not_pending";
    }

    return this.repository.confirm(
      commandId,
      deviceId,
      status,
      errorMessage
    )
      ? "confirmed"
      : "not_pending";
  }

}