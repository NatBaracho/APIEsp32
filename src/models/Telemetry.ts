export interface TelemetryQueue {
  id?: number;

  message_id: string;

  device_id: string;

  lacre_id?: string;

  cilindro_id?: string;

  latitude?: number;

  longitude?: number;

  speed_kmh?: number;

  battery_percent?: number;

  gsm_signal?: number;

  payload_json?: string;

  last_seen_at?: string;

  seal_status?: string;

  // Tentativas de envio informadas pelo ESP32 (o payload usa attempt_count)
  device_attempt_count?: number;

  last_repeat_message_id?: string;

  status?: string;

  attempt_count?: number;

  last_error?: string;
}

export type Telemetry = TelemetryQueue;
