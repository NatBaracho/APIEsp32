export interface CreateEventDto {
  message_id: string;

  device_id: string;

  event_type: string;

  seal_status?: string;

  payload_json?: string;
}
