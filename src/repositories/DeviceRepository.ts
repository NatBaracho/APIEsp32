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
      INSERT INTO devices (device_id, api_key, firmware_version, active)
      VALUES (?, ?, ?, ?)
    `).run(
      device.device_id,
      device.api_key,
      device.firmware_version ?? null,
      device.active ?? 1
    );

  }

  // Cadastro vindo do banco principal: cria ou atualiza pelo device_id. A
  // chave em texto de quem é criado assim é aleatória e não autentica
  upsertFromMain(
    deviceId: string,
    apiKeyHash: string | null,
    active: number,
    firmwareVersion: string | null,
    placeholderKey: string
  ): "criado" | "atualizado" {
    const existing = this.findByDeviceId(deviceId);

    if (!existing) {
      db.prepare(`
        INSERT INTO devices (device_id, api_key, api_key_hash, firmware_version, active)
        VALUES (?, ?, ?, ?, ?)
      `).run(deviceId, placeholderKey, apiKeyHash, firmwareVersion, active);
      return "criado";
    }

    db.prepare(`
      UPDATE devices
      SET api_key_hash = COALESCE(?, api_key_hash), active = ?, firmware_version = COALESCE(?, firmware_version)
      WHERE device_id = ?
    `).run(apiKeyHash, active, firmwareVersion, deviceId);
    return "atualizado";
  }

  touch(deviceId: string): void {
    db.prepare("UPDATE devices SET last_contact_at = CURRENT_TIMESTAMP WHERE device_id = ?").run(deviceId);
  }

  // Estado mais recente do lacre; campos não informados ficam como estavam
  updateState(deviceId: string, state: {
    latitude: number; longitude: number; gpsOk: boolean; batteryPercent: number;
    sealStatus?: string | undefined; signal?: number | undefined;
  }): void {
    db.prepare(`
      UPDATE devices SET
        last_contact_at = CURRENT_TIMESTAMP,
        last_latitude = ?, last_longitude = ?, last_gps_ok = ?, last_battery_percent = ?,
        last_seal_status = COALESCE(?, last_seal_status),
        last_signal = COALESCE(?, last_signal)
      WHERE device_id = ?
    `).run(
      state.latitude, state.longitude, state.gpsOk ? 1 : 0, state.batteryPercent,
      state.sealStatus ?? null, state.signal ?? null, deviceId
    );
  }

  setLastTelemetry(deviceId: string, messageId: string): void {
    db.prepare("UPDATE devices SET last_telemetry_message_id = ?, last_repeat_message_id = NULL WHERE device_id = ?")
      .run(messageId, deviceId);
  }

  setLastRepeat(deviceId: string, messageId: string): void {
    db.prepare("UPDATE devices SET last_repeat_message_id = ? WHERE device_id = ?").run(messageId, deviceId);
  }

  isRepeatMessageId(messageId: string): boolean {
    return Boolean(db.prepare("SELECT 1 FROM devices WHERE last_repeat_message_id = ?").get(messageId));
  }

}
