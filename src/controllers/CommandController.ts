import { Request, Response } from "express";
import {
  CommandExecutionStatus,
  commandExecutionStatuses
} from "../models/Command";
import { CommandService } from "../services/CommandService";

const commandStatuses: readonly CommandExecutionStatus[] = commandExecutionStatuses;

export class CommandController {

  private service = new CommandService();

  async findPendingByDevice(
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      const deviceId =
        typeof req.params.deviceId === "string"
          ? req.params.deviceId
          : "";

      if (!deviceId) {
        res.status(400).json({
          success: false,
          message: "deviceId é obrigatório"
        });
        return;
      }

      res.status(200).json(
        this.service.findPendingByDeviceId(deviceId)
      );
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Erro ao listar comandos pendentes"
      });
    }
  }

  async confirm(
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      const body = req.body ?? {};

      if (
        typeof body.command_id !== "string" ||
        !body.command_id ||
        typeof body.device_id !== "string" ||
        !body.device_id ||
        typeof body.status !== "string" ||
        !commandStatuses.includes(body.status as CommandExecutionStatus)
      ) {
        res.status(400).json({
          success: false,
          message: "command_id, device_id e status EXECUTADO ou ERRO são obrigatórios"
        });
        return;
      }

      if (
        body.error_message != null &&
        typeof body.error_message !== "string"
      ) {
        res.status(400).json({
          success: false,
          message: "error_message deve ser texto"
        });
        return;
      }

      const result = this.service.confirm(
        body.command_id,
        body.device_id,
        body.status as CommandExecutionStatus,
        body.error_message
      );

      if (result === "not_found") {
        res.status(404).json({
          success: false,
          message: "Comando não encontrado para este dispositivo"
        });
        return;
      }

      if (result === "not_pending") {
        res.status(409).json({
          success: false,
          message: "Comando já confirmado"
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Comando confirmado"
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Erro ao confirmar comando"
      });
    }
  }

}