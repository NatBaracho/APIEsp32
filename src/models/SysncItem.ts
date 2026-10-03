export interface SyncItem {
  id?: number;

  sync_log_id: number;

  entity_type: string;

  entity_id: number;

  sync_status: string;

  error_message?: string;
}
