import db from "../database/connection";
import { MessageType, QueuedMessage } from "../models/Message";

// Fila única da Oxide (tabela mensagens)
export class MessageRepository {

  exists(messageId: string): boolean {
    return Boolean(db.prepare("SELECT 1 FROM mensagens WHERE message_id = ?").get(messageId));
  }

  findByMessageId(messageId: string): QueuedMessage | undefined {
    return db.prepare("SELECT * FROM mensagens WHERE message_id = ?").get(messageId) as QueuedMessage | undefined;
  }

  enqueue(messageId: string, deviceId: string, tipo: MessageType, payload: Record<string, unknown>): void {
    db.prepare(`
      INSERT INTO mensagens (message_id, device_id, tipo, payload_json)
      VALUES (?, ?, ?, ?)
    `).run(messageId, deviceId, tipo, JSON.stringify(payload));
  }

  // Posição repetida: atualiza a mesma mensagem e a devolve à fila se já
  // tinha sido enviada, para o banco principal receber a nova data
  updatePayload(messageId: string, payload: Record<string, unknown>): void {
    db.prepare(`
      UPDATE mensagens
      SET payload_json = ?,
          status = CASE WHEN status = 'SYNCED' THEN 'PENDING' ELSE status END,
          next_attempt_at = CASE WHEN status = 'SYNCED' THEN NULL ELSE next_attempt_at END
      WHERE message_id = ?
    `).run(JSON.stringify(payload), messageId);
  }

  listRecent(limit: number, tipo?: string, deviceId?: string): QueuedMessage[] {
    const conditions: string[] = ["status <> 'ARQUIVADA'"];
    const params: unknown[] = [];
    if (tipo) { conditions.push("tipo = ?"); params.push(tipo); }
    if (deviceId) { conditions.push("device_id = ?"); params.push(deviceId); }
    return db.prepare(`
      SELECT * FROM mensagens WHERE ${conditions.join(" AND ")} ORDER BY id DESC LIMIT ?
    `).all(...params, limit) as QueuedMessage[];
  }

  // ----- Worker -----

  findDue(limit: number): QueuedMessage[] {
    return db.prepare(`
      SELECT * FROM mensagens
      WHERE status IN ('PENDING', 'ERROR')
        AND (status = 'PENDING' OR next_attempt_at IS NOT NULL)
        AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
      ORDER BY id LIMIT ?
    `).all(limit) as QueuedMessage[];
  }

  markProcessing(ids: number[]): void {
    const mark = db.prepare("UPDATE mensagens SET status = 'PROCESSING' WHERE id = ? AND status IN ('PENDING', 'ERROR')");
    db.transaction(() => ids.forEach(id => mark.run(id)))();
  }

  markSynced(id: number): void {
    db.prepare(`
      UPDATE mensagens SET status = 'SYNCED', last_error = NULL, next_attempt_at = NULL, synced_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'PROCESSING'
    `).run(id);
  }

  // nextAttemptAt nulo = parada para o gestor
  markError(id: number, error: string, nextAttemptAt: string | null, countAttempt: boolean): void {
    db.prepare(`
      UPDATE mensagens SET status = 'ERROR', last_error = ?, next_attempt_at = ?,
        attempt_count = attempt_count + ?
      WHERE id = ? AND status = 'PROCESSING'
    `).run(error.slice(0, 500), nextAttemptAt, countAttempt ? 1 : 0, id);
  }

  // Volta à fila o que ficou pela metade (queda do Worker ou do destino),
  // sem gastar tentativa
  resetProcessing(): number {
    return db.prepare(`
      UPDATE mensagens SET status = CASE WHEN attempt_count > 0 THEN 'ERROR' ELSE 'PENDING' END,
        next_attempt_at = CASE WHEN attempt_count > 0 THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE status = 'PROCESSING'
    `).run().changes;
  }

  counts(): Record<string, number> {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(status = 'PENDING'), 0) AS pendentes,
        COALESCE(SUM(status = 'PROCESSING'), 0) AS enviando,
        COALESCE(SUM(status = 'ERROR' AND next_attempt_at IS NOT NULL), 0) AS nova_tentativa,
        COALESCE(SUM(status = 'ERROR' AND next_attempt_at IS NULL), 0) AS paradas,
        COALESCE(SUM(status = 'SYNCED'), 0) AS sincronizadas,
        COALESCE(SUM(status = 'ARQUIVADA'), 0) AS arquivadas
      FROM mensagens
    `).get() as Record<string, number>;
    return row;
  }

  problems(limit: number): QueuedMessage[] {
    return db.prepare("SELECT * FROM mensagens WHERE status = 'ERROR' ORDER BY id LIMIT ?").all(limit) as QueuedMessage[];
  }

  retry(messageId: string): boolean {
    return db.prepare(`
      UPDATE mensagens SET status = 'PENDING', attempt_count = 0, next_attempt_at = NULL
      WHERE message_id = ? AND status = 'ERROR'
    `).run(messageId).changes === 1;
  }

}
