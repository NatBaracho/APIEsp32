export const alertTypes = [
  "SEAL_BROKEN",
  "GEOFENCE_EXIT",
  "LOW_BATTERY",
  "DEVICE_ERROR",
  "COMMAND_FAILURE",
  "COMMUNICATION_LOST"
] as const;

export type AlertType = typeof alertTypes[number];

export interface Alert {
  id?: number;
  alert_id: string;
  device_id: string;
  alert_type: AlertType;
  status_id: number;
  severity_id: number;
  title: string;
  description?: string;
  created_at?: string;
  resolved_at?: string | null;
}