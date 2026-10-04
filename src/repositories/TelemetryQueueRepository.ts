import db from "../database/connection";
import { Telemetry, TelemetryQueue } from "../models/Telemetry";

export class TelemetryQueueRepository {

  findAll(): TelemetryQueue[] {

    return db
      .prepare(`
        SELECT *
        FROM telemetry_queue
        ORDER BY id DESC
      `)
      .all() as TelemetryQueue[];

  }

  create(
    telemetry: TelemetryQueue
  ): void {

    db.prepare(`
      INSERT INTO telemetry_queue (
        message_id,
        device_id,
        lacre_id,
        cilindro_id,
        latitude,
        longitude,
        speed_kmh,
        battery_percent,
        gsm_signal,
        payload_json,
        last_seen_at,
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
        ?,
        ?,
        ?,
        ?
      )
    `).run(
      telemetry.message_id,
      telemetry.device_id,
      telemetry.lacre_id ?? null,
      telemetry.cilindro_id ?? null,
      telemetry.latitude,
      telemetry.longitude,
      telemetry.speed_kmh,
      telemetry.battery_percent,
      telemetry.gsm_signal,
      telemetry.payload_json ?? JSON.stringify(telemetry),
      telemetry.last_seen_at ?? null,
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

  findLastByDeviceId(
    deviceId: string
  ): Telemetry | undefined {

    return db
      .prepare(`
        SELECT *
        FROM telemetry_queue
        WHERE device_id = ?
        ORDER BY id DESC
        LIMIT 1
      `)
      .get(deviceId) as Telemetry | undefined;

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

  updateLastSeen(
    id: number
  ): void {

    db.prepare(`
      UPDATE telemetry_queue
      SET last_seen_at = CURRENT_TIMESTAMP
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
