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

  // Identificador do lacre, gerado pela API na primeira ativação
  seal_code?: string | null;
  activation_status?: ActivationStatus;
  activated_at?: string | null;
  deactivated_at?: string | null;

  // Vínculo atual, mandado pelo sistema principal
  binding_id?: string | null;
  cylinder_code?: string | null;
  customer_code?: string | null;
  customer_name?: string | null;
  bound_at?: string | null;
  ended_binding?: string | null;
  binding_alert?: string | null;
}

export const activationStatuses = ["ATIVO", "INATIVO"] as const;
export type ActivationStatus = typeof activationStatuses[number];

// Ordem de vinculação do sistema principal: o cilindro e o cliente do lacre.
// seal_code é o identificador que a API gerou; é por ele que o sistema vincula
export interface Vinculo {
  binding_id: string | null;
  seal_code: string | null;
  cylinder_code: string | null;
  customer_code: string | null;
  customer_name: string | null;
  bound_at: string | null;
}

export type ResultadoDoVinculo = "aplicado" | "igual" | "lacre_inativo" | "lacre_diferente" | "encerrado_pelo_lacre";

// Marca de um vínculo, para reconhecer o mesmo vínculo mais tarde
export const marcaDoVinculo = (v: { binding_id?: string | null; cylinder_code?: string | null; customer_code?: string | null; bound_at?: string | null }): string =>
  v.binding_id ?? `${v.cylinder_code ?? ""}|${v.customer_code ?? ""}|${v.bound_at ?? ""}`;
