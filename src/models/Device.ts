export interface Device {
  id?: number;

  device_id: string;

  api_key: string;

  firmware_version?: string;

  active: number;

  // SHA-256 da chave, vindo do banco principal; quando existe, substitui api_key
  api_key_hash?: string | null;

  // Último estado recebido do lacre
  last_contact_at?: string | null;
  last_latitude?: number | null;
  last_longitude?: number | null;
  last_gps_ok?: number | null;
  last_seal_status?: string | null;
  last_battery_percent?: number | null;
  last_signal?: number | null;
  last_telemetry_message_id?: string | null;
  last_repeat_message_id?: string | null;
}
