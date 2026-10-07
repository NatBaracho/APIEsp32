import { Request, Response } from "express";
import { SyncLogRepository } from "../repositories/syncLogRepository";
import { isSyncQueueName, SyncRepository, syncQueueNames } from "../repositories/SyncRepository";

const queuesText = syncQueueNames.join(", ");

// Acompanhamento da sincronização Oxide → FluxID pela equipe e pelo gestor.
// Rotas abertas e provisórias, como /devices
export class SyncController {

  private repository = new SyncRepository();
  private logs = new SyncLogRepository();

  async status(_req: Request, res: Response): Promise<void> {
    res.status(200).json({
      success: true,
      filas: this.repository.summary(),
      ultimas_rodadas: this.logs.latest(5)
    });
  }

  async problems(req: Request, res: Response): Promise<void> {
    const queue = req.query.queue;

    if (!isSyncQueueName(queue)) {
      res.status(400).json({ success: false, message: `queue deve ser ${queuesText}` });
      return;
    }

    const itens = this.repository.problems(queue);
    res.status(200).json({ success: true, queue, total: itens.length, itens });
  }

  async retry(req: Request, res: Response): Promise<void> {
    const { queue, key } = req.body ?? {};

    if (!isSyncQueueName(queue) || typeof key !== "string" || !key.trim()) {
      res.status(400).json({
        success: false,
        message: `queue (${queuesText}) e key (message_id ou alert_id) são obrigatórios`
      });
      return;
    }

    if (!this.repository.retry(queue, key)) {
      res.status(404).json({ success: false, message: "Item não encontrado ou já sincronizado" });
      return;
    }

    res.status(200).json({ success: true, message: "Item voltou para a fila do Worker" });
  }

}
