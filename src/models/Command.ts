export type CommandExecutionStatus = "EXECUTADO" | "ERRO";

export interface DeviceCommand {
  id: number;
  command_id: string;
  device_id: string;
  command_type: string;
  status: string;
  created_at: string;
  executed_at?: string | null;
  error_message?: string | null;
}