export interface CreateDeviceDto {
  device_id: string;

  api_key: string;

  firmware_version?: string;

  active: number;
}
