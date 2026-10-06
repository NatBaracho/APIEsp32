export const sealStatuses = ["LOCKED", "UNLOCKED", "BROKEN"];

export interface Event {
  id?: number;

  message_id: string;

  device_id: string;

  event_type: string;

  seal_status?: string;

  payload_json?: string;

  // Tentativas de envio informadas pelo ESP32 (o payload usa attempt_count)
  device_attempt_count?: number;

  status?: string;

  attempt_count?: number;

  last_error?: string;
}
