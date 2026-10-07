export interface Device {
  id?: number;

  device_id: string;

  api_key: string;

  firmware_version?: string;

  active: number;

  device_status_id?: number;

  valve_status_id?: number;

  seal_status_id?: number;

  // SHA-256 da chave, vindo do FluxID; quando existe, substitui api_key
  api_key_hash?: string | null;
}
