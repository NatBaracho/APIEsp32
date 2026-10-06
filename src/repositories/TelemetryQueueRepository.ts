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

    // status e attempt_count são controlados pelo servidor, nunca pelo cliente
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
      telemetry.latitude ?? null,
      telemetry.longitude ?? null,
      telemetry.speed_kmh ?? null,
      telemetry.battery_percent ?? null,
      telemetry.gsm_signal ?? null,
      telemetry.payload_json ?? JSON.stringify(telemetry),
      telemetry.last_seen_at ?? null,
      "PENDING",
      0
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

  // Considera também os message_id de posições repetidas, que não têm linha própria
  messageIdExists(
    messageId: string
  ): boolean {

    return Boolean(
      db
        .prepare(`
          SELECT 1 FROM telemetry_queue WHERE message_id = ?
          UNION ALL
          SELECT 1 FROM telemetry_position_repeats WHERE message_id = ?
        `)
        .get(messageId, messageId)
    );

  }

  registerPositionRepeat(
    messageId: string,
    deviceId: string,
    telemetryId: number
  ): void {

    db.prepare(`
      INSERT INTO telemetry_position_repeats (
        message_id,
        device_id,
        telemetry_id
      )
      VALUES (?, ?, ?)
    `).run(
      messageId,
      deviceId,
      telemetryId
    );

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
