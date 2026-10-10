import { Request, Response } from "express";
import { MessageRepository } from "../repositories/MessageRepository";
import { lerUltimaRodada } from "../worker/runner";

// Acompanhamento da fila (rotas abertas e provisórias, para a equipe)
export class SyncController {

  private messages = new MessageRepository();

  status(req: Request, res: Response): void {
    res.status(200).json({ fila: this.messages.counts(), ultima_rodada: lerUltimaRodada() });
  }

  problems(req: Request, res: Response): void {
    res.status(200).json({
      itens: this.messages.problems(200).map(m => ({
        message_id: m.message_id,
        device_id: m.device_id,
        type: m.tipo,
        situacao: m.next_attempt_at ? "nova tentativa agendada" : "parada: precisa do gestor",
        tentativas: m.attempt_count,
        proxima_tentativa: m.next_attempt_at,
        erro: m.last_error
      }))
    });
  }

  retry(req: Request, res: Response): void {
    const messageId = req.body?.message_id;

    if (typeof messageId !== "string" || !messageId) {
      res.status(400).json({ success: false, message: "message_id é obrigatório" });
      return;
    }
    if (!this.messages.retry(messageId)) {
      res.status(404).json({ success: false, message: "Mensagem com erro não encontrada" });
      return;
    }

    res.status(200).json({ success: true, message: "Mensagem devolvida à fila" });
  }

}
