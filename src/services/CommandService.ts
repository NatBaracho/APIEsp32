import db from "../database/connection";
import { CommandExecutionStatus, DeviceCommand } from "../models/Command";
import { CommandRepository } from "../repositories/CommandRepository";
import { DeviceRepository } from "../repositories/DeviceRepository";
import { MessageService } from "./MessageService";

export type CommandConfirmationResult =
  | "confirmed"
  | "not_found"
  | "not_pending";

export class CommandService {

  private repository = new CommandRepository();

  private devices = new DeviceRepository();

  private messages = new MessageService();

  // A busca de comandos também conta como contato do lacre
  findPendingByDeviceId(deviceId: string): DeviceCommand[] {
    this.devices.touch(deviceId);
    return this.repository.findPendingByDeviceId(deviceId);
  }

  // A confirmação vai para a fila, para o banco principal saber o resultado
  confirm(
    commandId: string,
    deviceId: string,
    status: CommandExecutionStatus,
    errorMessage?: string
  ): CommandConfirmationResult {
    return db.transaction((): CommandConfirmationResult => {
      const command = this.repository.findByCommandId(commandId, deviceId);

      if (!command) {
        return "not_found";
      }

      if (
        command.status !== "PENDENTE" ||
        !this.repository.confirm(commandId, deviceId, status, errorMessage)
      ) {
        return "not_pending";
      }

      this.devices.touch(deviceId);
      this.messages.enqueueCommandConfirmation(deviceId, commandId, status, errorMessage);
      return "confirmed";
    })();
  }

}
