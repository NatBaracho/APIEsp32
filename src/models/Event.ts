export interface Event {
  id?: number;

  message_id: string;

  device_id: string;

  event_type: string;

  seal_status?: string;

  payload_json?: string;

  status?: string;

  attempt_count?: number;

  last_error?: string;
}
