// Códigos do catálogo Doc/Tipos-de-Erro.md (mesmos aceitos em alertas.tipo
// no FluxID, decisão P5 do plano de integração)
export const alertTypes = [
  // Lacre
  "LACRE_VIOLADO",
  "LACRE_ABERTO_EM_TRANSITO",
  "LACRE_ABERTO_SEM_AUTORIZACAO",
  "DISPOSITIVO_SEM_LACRE",
  "LACRE_SEM_CILINDRO",
  "LACRE_SEM_DISPOSITIVO",
  "LACRE_REVISAO_VENCIDA",
  "LACRE_REPROVADO_EM_USO",
  // Cilindro e cliente
  "CILINDRO_SEM_CLIENTE",
  "CILINDRO_SEM_LACRE",
  "TESTE_HIDROSTATICO_VENCIDO",
  "CILINDRO_REPROVADO_EM_USO",
  // GPS e posição
  "GPS_INATIVO",
  "GPS_SEM_SINAL",
  "POSICAO_INVALIDA",
  "SAIDA_GEOCERCA",
  "SAIDA_ROTA",
  "MOVIMENTACAO_SUSPEITA",
  "PARADA_PROLONGADA",
  // Dispositivo, energia e comunicação
  "BATERIA_BAIXA",
  "SEM_COMUNICACAO",
  "GSM_SINAL_FRACO",
  "DISPOSITIVO_FALHA",
  "DISPOSITIVO_NAO_CADASTRADO",
  "CHAVE_INVALIDA",
  // Comandos
  "COMANDO_FALHOU",
  "COMANDO_SEM_RESPOSTA",
  "COMANDO_DESCONTINUADO"
] as const;

export type AlertType = typeof alertTypes[number];

// Transição: nomes antigos em inglês ainda aceitos e convertidos antes de gravar
export const legacyAlertTypes: Record<string, AlertType> = {
  SEAL_BROKEN: "LACRE_VIOLADO",
  GEOFENCE_EXIT: "SAIDA_GEOCERCA",
  LOW_BATTERY: "BATERIA_BAIXA",
  COMMUNICATION_LOST: "SEM_COMUNICACAO",
  DEVICE_ERROR: "DISPOSITIVO_FALHA",
  COMMAND_FAILURE: "COMANDO_FALHOU"
};

// Mesmos valores do CHECK de alertas.severidade e alertas.status no FluxID
export const alertSeverities = ["BAIXA", "MEDIA", "ALTA", "CRITICA"] as const;

export type AlertSeverity = typeof alertSeverities[number];

export const alertStatuses = ["ABERTO", "EM_ANALISE", "ENCERRADO"] as const;

export type AlertStatus = typeof alertStatuses[number];

// Severidade sugerida no catálogo, usada quando o dispositivo não informa uma
export const defaultSeverityByType: Record<AlertType, AlertSeverity> = {
  LACRE_VIOLADO: "CRITICA",
  LACRE_ABERTO_EM_TRANSITO: "CRITICA",
  LACRE_ABERTO_SEM_AUTORIZACAO: "CRITICA",
  DISPOSITIVO_SEM_LACRE: "MEDIA",
  LACRE_SEM_CILINDRO: "ALTA",
  LACRE_SEM_DISPOSITIVO: "MEDIA",
  LACRE_REVISAO_VENCIDA: "MEDIA",
  LACRE_REPROVADO_EM_USO: "ALTA",
  CILINDRO_SEM_CLIENTE: "ALTA",
  CILINDRO_SEM_LACRE: "ALTA",
  TESTE_HIDROSTATICO_VENCIDO: "ALTA",
  CILINDRO_REPROVADO_EM_USO: "CRITICA",
  GPS_INATIVO: "ALTA",
  GPS_SEM_SINAL: "MEDIA",
  POSICAO_INVALIDA: "BAIXA",
  SAIDA_GEOCERCA: "ALTA",
  SAIDA_ROTA: "ALTA",
  MOVIMENTACAO_SUSPEITA: "ALTA",
  PARADA_PROLONGADA: "MEDIA",
  BATERIA_BAIXA: "BAIXA",
  SEM_COMUNICACAO: "ALTA",
  GSM_SINAL_FRACO: "BAIXA",
  DISPOSITIVO_FALHA: "MEDIA",
  DISPOSITIVO_NAO_CADASTRADO: "MEDIA",
  CHAVE_INVALIDA: "ALTA",
  COMANDO_FALHOU: "ALTA",
  COMANDO_SEM_RESPOSTA: "MEDIA",
  COMANDO_DESCONTINUADO: "BAIXA"
};

export function normalizeAlertType(value: string): AlertType | undefined {
  if (alertTypes.includes(value as AlertType)) {
    return value as AlertType;
  }

  return Object.prototype.hasOwnProperty.call(legacyAlertTypes, value)
    ? legacyAlertTypes[value]
    : undefined;
}

export interface Alert {
  id?: number;
  alert_id: string;
  device_id: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  description?: string;
  created_at?: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_note?: string | null;
}
