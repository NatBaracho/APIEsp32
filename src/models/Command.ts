// Comandos que o ESP32 sabe executar. Novos tipos entram aqui quando o
// firmware ganhar a função correspondente (lista também no CHECK do banco)
export const commandTypes = ["TRAVAR_VALVULA", "DESTRAVAR_VALVULA"] as const;

export type CommandType = typeof commandTypes[number];

// Estados aceitos na confirmação enviada pelo dispositivo
export const commandExecutionStatuses = ["EXECUTADO", "ERRO"] as const;

export type CommandExecutionStatus = typeof commandExecutionStatuses[number];

export type CommandStatus = "PENDENTE" | CommandExecutionStatus;

export interface DeviceCommand {
  id: number;
  command_id: string;
  device_id: string;
  // Comandos PENDENTE sempre têm um CommandType; o histórico pode guardar
  // tipos antigos, anteriores ao catálogo
  command_type: string;
  status: CommandStatus;
  created_at: string;
  executed_at?: string | null;
  error_message?: string | null;
}
