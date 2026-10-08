import { CommandExecutionStatus, DeviceCommand } from "../models/Command";
import { CommandRepository } from "../repositories/CommandRepository";
import { aposConfirmacaoDeComando, aposContato } from "../regras/recepcao";

export type CommandConfirmationResult =
  | "confirmed"
  | "not_found"
  | "not_pending";

export class CommandService {

  private repository = new CommandRepository();

  findPendingByDeviceId(deviceId: string): DeviceCommand[] {
    aposContato(deviceId);
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

    if (!this.repository.confirm(commandId, deviceId, status, errorMessage)) {
      return "not_pending";
    }

    // ERRO abre COMANDO_FALHOU (regra automática)
    aposConfirmacaoDeComando(deviceId, commandId, status, errorMessage);
    return "confirmed";
  }

}