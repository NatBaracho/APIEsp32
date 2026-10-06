export const alertTypes = [
  "SEAL_BROKEN",
  "GEOFENCE_EXIT",
  "LOW_BATTERY",
  "DEVICE_ERROR",
  "COMMAND_FAILURE",
  "COMMUNICATION_LOST"
] as const;

export type AlertType = typeof alertTypes[number];

// Mesmos valores do CHECK de alertas.severidade e alertas.status no FluxID
export const alertSeverities = ["BAIXA", "MEDIA", "ALTA", "CRITICA"] as const;

export type AlertSeverity = typeof alertSeverities[number];

export const alertStatuses = ["ABERTO", "EM_ANALISE", "ENCERRADO"] as const;

export type AlertStatus = typeof alertStatuses[number];

// Severidade usada quando o dispositivo não informa uma
export const defaultSeverityByType: Record<AlertType, AlertSeverity> = {
  SEAL_BROKEN: "CRITICA",
  GEOFENCE_EXIT: "ALTA",
  COMMAND_FAILURE: "ALTA",
  DEVICE_ERROR: "MEDIA",
  COMMUNICATION_LOST: "MEDIA",
  LOW_BATTERY: "BAIXA"
};

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
}
