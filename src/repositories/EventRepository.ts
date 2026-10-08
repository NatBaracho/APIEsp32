import db from "../database/connection";
import { Event } from "../models/Event";

export class EventRepository {

  create(
    event: Event
  ): void {

    const payloadJson =
      event.payload_json ??
      JSON.stringify(event);

    db.prepare(`
      INSERT INTO events (
        message_id,
        device_id,
        message_type,
        seal_status,
        payload_json,
        device_attempt_count,
        error_type,
        status,
        attempt_count,
        received_at
      )
      VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        datetime('now')
      )
    `).run(
      event.message_id,
      event.device_id,
      event.event_type ?? "EVENT",
      event.seal_status ?? null,
      payloadJson,
      event.device_attempt_count ?? null,
      event.error_type ?? null,
      "PENDING",
      0
    );

  }

  findByMessageId(
    messageId: string
  ): Event | undefined {

    return db
      .prepare(`
        SELECT *
        FROM events
        WHERE message_id = ?
      `)
      .get(messageId) as Event | undefined;

  }

  findPending(): Event[] {

    return db
      .prepare(`
        SELECT *
        FROM events
        WHERE status = 'PENDING'
      `)
      .all() as Event[];

  }

  markProcessing(
    id: number
  ): void {

    db.prepare(`
      UPDATE events
      SET status = 'PROCESSING'
      WHERE id = ?
    `).run(id);

  }

  markSynced(
    id: number
  ): void {

    db.prepare(`
      UPDATE events
      SET status = 'SYNCED'
      WHERE id = ?
    `).run(id);

  }

  markError(
    id: number,
    error: string
  ): void {

    db.prepare(`
      UPDATE events
      SET
        status = 'ERROR',
        attempt_count = attempt_count + 1,
        last_error = ?
      WHERE id = ?
    `).run(
      error,
      id
    );

  }

}
