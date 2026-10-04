export interface CreateTelemetryDto {
  message_id: string;

  device_id: string;

  latitude?: number;

  longitude?: number;

  speed_kmh?: number;

  battery_percent?: number;

  gsm_signal?: number;

  payload_json?: string;

  last_seen_at?: string;
}
