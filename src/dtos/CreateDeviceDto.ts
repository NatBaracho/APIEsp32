export interface CreateDeviceDto {
  device_id: string;

  api_key: string;

  firmware_version?: string;

  active: number;

  device_status_id?: number;

  valve_status_id?: number;

  seal_status_id?: number;
}
