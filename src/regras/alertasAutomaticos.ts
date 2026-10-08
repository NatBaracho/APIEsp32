import { randomBytes } from "crypto";
import db from "../database/connection";
import { AlertType, defaultSeverityByType } from "../models/Alert";
import { CommandType } from "../models/Command";
import { AssignmentRepository } from "../repositories/AssignmentRepository";
import { limites } from "./limites";

// Alertas e comandos criados pela própria API (regras automáticas).
// Entram na tabela alerts como os do ESP32 e vão ao FluxID pelo Worker.

const titulos: Partial<Record<AlertType, string>> = {
  BATERIA_BAIXA: "Bateria baixa",
  GSM_SINAL_FRACO: "Sinal GSM fraco",
  LACRE_ABERTO_EM_TRANSITO: "Lacre aberto com o cilindro em trânsito",
  COMANDO_FALHOU: "Comando não executado pelo dispositivo",
  COMANDO_SEM_RESPOSTA: "Comando sem resposta do dispositivo",
  SEM_COMUNICACAO: "Dispositivo sem comunicação",
  GPS_SEM_SINAL: "GPS sem sinal",
  SAIDA_GEOCERCA: "Cilindro fora da geocerca do cliente",
  SAIDA_ROTA: "Cilindro fora da rota de entrega"
};

// Até 20 caracteres (alertas.codigo e dispositivos.codigo no FluxID)
export function novoCodigo(prefixo: "AUT" | "CMD"): string {
  return `${prefixo}-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

export type ResultadoAlerta = "criado" | "ja_aberto" | "sem_vinculo";

const assignments = new AssignmentRepository();

// Só abre o alerta quando o dispositivo está num lacre que está num
// cilindro: o FluxID exige lacre e cilindro no alerta (scripts 003/004).
// Não repete enquanto houver um aberto do mesmo tipo, nem antes do
// intervalo de repetição depois do último
export function abrirAlerta(deviceId: string, tipo: AlertType, descricao: string): ResultadoAlerta {
  const situacao = assignments.snapshotByDevice(deviceId);
  if (!situacao.seal_code || !situacao.cylinder_code) return "sem_vinculo";

  const recente = db.prepare(`
    SELECT 1 FROM alerts
    WHERE device_id = ? AND alert_type = ?
      AND (status <> 'ENCERRADO' OR created_at >= datetime('now', ?))
    LIMIT 1
  `).get(deviceId, tipo, `-${limites().repeticaoMinutos} minutes`);
  if (recente) return "ja_aberto";

  db.prepare(`
    INSERT INTO alerts (alert_id, device_id, alert_type, severity, status, title, description)
    VALUES (?, ?, ?, ?, 'ABERTO', ?, ?)
  `).run(novoCodigo("AUT"), deviceId, tipo, defaultSeverityByType[tipo], titulos[tipo] ?? tipo, descricao);
  return "criado";
}

// Comando criado pelo servidor (ou pelo frontend); não duplica um pendente
// do mesmo tipo para o mesmo dispositivo
export function criarComando(deviceId: string, tipo: CommandType): { command_id: string; criado: boolean } {
  const pendente = db.prepare(`
    SELECT command_id FROM commands WHERE device_id = ? AND command_type = ? AND status = 'PENDENTE' LIMIT 1
  `).get(deviceId, tipo) as { command_id: string } | undefined;
  if (pendente) return { command_id: pendente.command_id, criado: false };

  const commandId = novoCodigo("CMD");
  db.prepare(`
    INSERT INTO commands (command_id, device_id, command_type, status, created_at)
    VALUES (?, ?, ?, 'PENDENTE', datetime('now'))
  `).run(commandId, deviceId, tipo);
  return { command_id: commandId, criado: true };
}

export function registrarContato(deviceId: string, tipo: "telemetria" | "outro", comPosicao = false): void {
  db.prepare(`
    UPDATE devices SET
      last_contact_at = datetime('now'),
      last_telemetry_at = CASE WHEN ? THEN datetime('now') ELSE last_telemetry_at END,
      last_position_at = CASE WHEN ? THEN datetime('now') ELSE last_position_at END
    WHERE device_id = ?
  `).run(tipo === "telemetria" ? 1 : 0, comPosicao ? 1 : 0, deviceId);
}
