// Mesmos estados de lacres.status e cilindros.status no FluxID
export const sealStatusValues = [
  "EM_ESTOQUE",
  "INSTALADO",
  "SUSPEITA_VIOLACAO",
  "ROMPIDO",
  "REMOVIDO",
  "DANIFICADO",
  "INUTILIZADO"
] as const;

export type SealStatusValue = typeof sealStatusValues[number];

// Estados em que o lacre pode ser instalado num cilindro
export const installableSealStatuses: readonly SealStatusValue[] = [
  "EM_ESTOQUE",
  "REMOVIDO"
];

export const cylinderStatusValues = [
  "DISPONIVEL",
  "EM_TRANSITO",
  "COM_CLIENTE",
  "MANUTENCAO",
  "EXTRAVIADO",
  "INATIVO"
] as const;

export type CylinderStatusValue = typeof cylinderStatusValues[number];

export interface Seal {
  id?: number;
  seal_code: string;
  nfc_uid: string;
  status: SealStatusValue;
  created_at?: string;
  updated_at?: string;
}

export interface Cylinder {
  id?: number;
  cylinder_code: string;
  serial_number: string;
  status: CylinderStatusValue;
  created_at?: string;
  updated_at?: string;
}

// Vínculo dispositivo ↔ lacre (seal_assignments)
export interface SealAssignment {
  id: number;
  device_id: string;
  seal_code: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
}

// Vínculo lacre ↔ cilindro (cylinder_assignments)
export interface CylinderAssignment {
  id: number;
  seal_code: string;
  cylinder_code: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
}

// Situação atual de um dispositivo, usada ao receber telemetria e eventos
export interface DeviceAssignmentSnapshot {
  seal_code: string | null;
  cylinder_code: string | null;
  cylinder_status: CylinderStatusValue | null;
}
