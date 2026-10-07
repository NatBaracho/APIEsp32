import db from "../database/connection";
import { Device } from "../models/Device";

export class DeviceRepository {

  findAll(): Device[] {
    return db
      .prepare(`
        SELECT *
        FROM devices
      `)
      .all() as Device[];
  }

  findByDeviceId(
    deviceId: string
  ): Device | undefined {

    return db
      .prepare(`
        SELECT *
        FROM devices
        WHERE device_id = ?
      `)
      .get(deviceId) as Device | undefined;
  }

  findByApiKey(
    apiKey: string
  ): Device | undefined {

    return db
      .prepare(`
        SELECT *
        FROM devices
        WHERE api_key = ? AND api_key_hash IS NULL
      `)
      .get(apiKey) as Device | undefined;
  }

  findByApiKeyHash(
    apiKeyHash: string
  ): Device | undefined {

    return db
      .prepare(`
        SELECT *
        FROM devices
        WHERE api_key_hash = ?
      `)
      .get(apiKeyHash) as Device | undefined;
  }

  findById(id: number): Device | undefined {

    return db
      .prepare(`
        SELECT *
        FROM devices
        WHERE id = ?
      `)
      .get(id) as Device | undefined;

  }

  update(
    deviceId: string,
    firmwareVersion: string
  ): void {

    db.prepare(`
      UPDATE devices
      SET firmware_version = ?
      WHERE device_id = ?
    `).run(
      firmwareVersion,
      deviceId
    );

  }

  disable(deviceId: string): void {

    db.prepare(`
      UPDATE devices
      SET active = 0
      WHERE device_id = ?
    `).run(deviceId);

  }

  create(device: Device): void {

    db.prepare(`
      INSERT INTO devices (
        device_id,
        api_key,
        firmware_version,
        active,
        device_status_id,
        valve_status_id,
        seal_status_id
      )
      VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )
    `).run(
      device.device_id,
      device.api_key,
      device.firmware_version ?? null,
      device.active ?? 1,
      device.device_status_id ?? null,
      device.valve_status_id ?? null,
      device.seal_status_id ?? null
    );

  }

}
