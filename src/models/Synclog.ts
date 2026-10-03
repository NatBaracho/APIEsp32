export interface SyncLog {
  id?: number;

  started_at: string;

  finished_at?: string;

  status: string;

  log_message?: string;
}
