import db from "../database/connection";
import { TelemetryQueue } from "../models/Telemetry";

export class TelemetryQueueRepository {

  create(
    telemetry: TelemetryQueue
  ): void {

    db.prepare(`
      INSERT INTO telemetry_queue (
        message_id,
        device_id,
        latitude,
        longitude,
        speed_kmh,
        battery_percent,
        gsm_signal,
        payload_json,
        status,
        attempt_count
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
        ?
      )
    `).run(
      telemetry.message_id,
      telemetry.device_id,
      telemetry.latitude,
      telemetry.longitude,
      telemetry.speed_kmh,
      telemetry.battery_percent,
      telemetry.gsm_signal,
      telemetry.payload_json,
      telemetry.status ?? "PENDING",
      telemetry.attempt_count ?? 0
    );

  }

  findByMessageId(
    messageId: string
  ): TelemetryQueue | undefined {

    return db
      .prepare(`
        SELECT *
        FROM telemetry_queue
        WHERE message_id = ?
      `)
      .get(messageId) as TelemetryQueue | undefined;

  }

  findPending(): TelemetryQueue[] {

    return db
      .prepare(`
        SELECT *
        FROM telemetry_queue
        WHERE status = 'PENDING'
      `)
      .all() as TelemetryQueue[];

  }

  markProcessing(
    id: number
  ): void {

    db.prepare(`
      UPDATE telemetry_queue
      SET status = 'PROCESSING'
      WHERE id = ?
    `).run(id);

  }

  markSynced(
    id: number
  ): void {

    db.prepare(`
      UPDATE telemetry_queue
      SET status = 'SYNCED'
      WHERE id = ?
    `).run(id);

  }

  markError(
    id: number,
    error: string
  ): void {

    db.prepare(`
      UPDATE telemetry_queue
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
