import db from "../database/connection";
import { Device, ResultadoDoVinculo, Vinculo, marcaDoVinculo } from "../models/Device";

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

  // Ordem de vinculação vinda do sistema principal. null (ou sem cilindro)
  // = desfazer o vínculo. Só vale para lacre ativo e com o identificador
  // que a API gerou
  setBinding(deviceId: string, vinculo: Vinculo | null): ResultadoDoVinculo {
    const atual = this.findByDeviceId(deviceId);
    if (!atual) return "igual";

    if (!vinculo || !vinculo.cylinder_code) {
      if (!atual.cylinder_code && !atual.binding_id) return "igual";
      db.prepare(`
        UPDATE devices
        SET binding_id = NULL, cylinder_code = NULL, customer_code = NULL, customer_name = NULL, bound_at = NULL
        WHERE device_id = ?
      `).run(deviceId);
      return "aplicado";
    }

    if (atual.ended_binding && atual.ended_binding === marcaDoVinculo(vinculo)) return "encerrado_pelo_lacre";
    if (atual.activation_status !== "ATIVO") return "lacre_inativo";
    if (!atual.seal_code || vinculo.seal_code !== atual.seal_code) return "lacre_diferente";
    if ((["binding_id", "cylinder_code", "customer_code", "customer_name", "bound_at"] as const).every(c => (atual[c] ?? null) === vinculo[c])) return "igual";

    db.prepare(`
      UPDATE devices
      SET binding_id = ?, cylinder_code = ?, customer_code = ?, customer_name = ?, bound_at = ?, ended_binding = NULL
      WHERE device_id = ?
    `).run(vinculo.binding_id, vinculo.cylinder_code, vinculo.customer_code, vinculo.customer_name, vinculo.bound_at, deviceId);
    return "aplicado";
  }

  sealCodeExists(sealCode: string): boolean {
    return Boolean(db.prepare("SELECT 1 FROM devices WHERE seal_code = ?").get(sealCode));
  }

  // O lacre avisou que está ativo. O identificador é gravado só na primeira vez
  activate(deviceId: string, sealCode: string): void {
    db.prepare(`
      UPDATE devices
      SET seal_code = COALESCE(seal_code, ?),
          activated_at = CASE WHEN activation_status = 'ATIVO' THEN activated_at ELSE CURRENT_TIMESTAMP END,
          binding_alert = CASE WHEN activation_status = 'ATIVO' THEN binding_alert ELSE NULL END,
          activation_status = 'ATIVO'
      WHERE device_id = ?
    `).run(sealCode, deviceId);
  }

  // O lacre avisou que desativou: o vínculo acaba aqui e fica marcado, para
  // não voltar enquanto o sistema principal ainda o mandar
  deactivate(deviceId: string): void {
    const atual = this.findByDeviceId(deviceId);
    if (!atual) return;
    db.prepare(`
      UPDATE devices
      SET activation_status = 'INATIVO', deactivated_at = CURRENT_TIMESTAMP,
          ended_binding = COALESCE(?, ended_binding),
          binding_id = NULL, cylinder_code = NULL, customer_code = NULL, customer_name = NULL, bound_at = NULL, binding_alert = NULL
      WHERE device_id = ?
    `).run(atual.cylinder_code ? marcaDoVinculo(atual) : null, deviceId);
  }

  setBindingAlert(deviceId: string, tipo: string | null): void {
    db.prepare("UPDATE devices SET binding_alert = ? WHERE device_id = ?").run(tipo, deviceId);
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
