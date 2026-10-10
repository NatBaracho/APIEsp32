export const messageTypes = ["TELEMETRIA", "EVENTO", "ALERTA", "CONFIRMACAO_COMANDO"] as const;
export type MessageType = typeof messageTypes[number];

export const sealStatuses = ["LOCKED", "UNLOCKED", "BROKEN"] as const;
export type SealStatus = typeof sealStatuses[number];

// PENDING sem next_attempt_at: pronta; ERROR com next_attempt_at: nova
// tentativa marcada; ERROR sem next_attempt_at: parada para o gestor;
// ARQUIVADA: veio do modelo antigo e não é enviada
export type QueueStatus = "PENDING" | "PROCESSING" | "SYNCED" | "ERROR" | "ARQUIVADA";

export interface QueuedMessage {
  id: number;
  message_id: string;
  device_id: string;
  tipo: MessageType;
  payload_json: string;
  received_at: string;
  status: QueueStatus;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: string | null;
  synced_at: string | null;
}

// Parte comum a toda mensagem do lacre, depois de validada. Posição e
// bateria são obrigatórias; sem sinal de GPS, o lacre manda a última posição
// conhecida com gps_ok = false
export interface LeituraComum {
  message_id: string;
  device_id: string;
  latitude: number;
  longitude: number;
  gps_ok: boolean;
  battery_percent: number;
  seal_status?: SealStatus;
  speed_kmh?: number;
  gsm_signal?: number;
  satellites?: number;
  hdop?: number;
  device_state?: string;
  // Tentativas de envio informadas pelo lacre (o payload usa attempt_count)
  device_attempt_count?: number;
}
