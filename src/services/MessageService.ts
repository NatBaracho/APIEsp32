import { randomBytes } from "crypto";
import db from "../database/connection";
import { AlertType, defaultSeverityByType } from "../models/Alert";
import { Device } from "../models/Device";
import { LeituraComum, MessageType, SealStatus, sealStatuses } from "../models/Message";
import { DeviceRepository } from "../repositories/DeviceRepository";
import { MessageRepository } from "../repositories/MessageRepository";

// Recebimento das mensagens do lacre: valida, evita duplicidade, grava na
// fila única e abre os alertas que saem da própria mensagem.

export type ReceiveResult = "created" | "position_repeated" | "duplicate";

export type Validacao =
  | { ok: true; leitura: LeituraComum }
  | { ok: false; message: string };

const ehNumero = (valor: unknown): valor is number => typeof valor === "number" && Number.isFinite(valor);

// Limites das regras automáticas; mudam no .env, sem mudar o código
function limite(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  const valor = bruto === undefined || bruto.trim() === "" ? NaN : Number(bruto);
  return Number.isFinite(valor) ? valor : padrao;
}

// Campos comuns a telemetria, evento e alerta. chave = nome do campo que
// identifica a mensagem (message_id; no alerta, alert_id)
export function validarLeitura(body: Record<string, unknown>, chave: "message_id" | "alert_id" = "message_id"): Validacao {
  const id = body[chave];
  if (typeof id !== "string" || !id.trim() || typeof body.device_id !== "string" || !body.device_id.trim()) {
    return { ok: false, message: `${chave} e device_id são obrigatórios` };
  }

  if (body.latitude === undefined || body.longitude === undefined || body.battery_percent === undefined ||
      body.latitude === null || body.longitude === null || body.battery_percent === null) {
    return { ok: false, message: "latitude, longitude e battery_percent são obrigatórios" };
  }

  const satellites = body.satellites ?? body.satelites;
  const numericos: Array<[string, unknown]> = [
    ["latitude", body.latitude], ["longitude", body.longitude], ["battery_percent", body.battery_percent],
    ["speed_kmh", body.speed_kmh], ["gsm_signal", body.gsm_signal], ["satellites", satellites], ["hdop", body.hdop]
  ];
  for (const [campo, valor] of numericos) {
    if (valor !== undefined && valor !== null && !ehNumero(valor)) {
      return { ok: false, message: `Campo ${campo} com tipo inválido` };
    }
  }

  const latitude = body.latitude as number;
  const longitude = body.longitude as number;
  const battery = body.battery_percent as number;

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { ok: false, message: "latitude deve estar entre -90 e 90 e longitude entre -180 e 180" };
  }
  if (battery < 0 || battery > 100) {
    return { ok: false, message: "battery_percent deve estar entre 0 e 100" };
  }
  if (body.gps_ok !== undefined && typeof body.gps_ok !== "boolean") {
    return { ok: false, message: "gps_ok deve ser true ou false" };
  }
  if (body.seal_status !== undefined && body.seal_status !== null &&
      !sealStatuses.includes(body.seal_status as SealStatus)) {
    return { ok: false, message: "seal_status deve ser LOCKED, UNLOCKED ou BROKEN" };
  }
  if (body.attempt_count !== undefined && body.attempt_count !== null &&
      (!Number.isInteger(body.attempt_count) || (body.attempt_count as number) < 0)) {
    return { ok: false, message: "attempt_count deve ser um inteiro maior ou igual a 0" };
  }
  if (body.device_state !== undefined && body.device_state !== null && typeof body.device_state !== "string") {
    return { ok: false, message: "device_state deve ser texto" };
  }

  const leitura: LeituraComum = {
    message_id: id.trim(),
    device_id: body.device_id.trim(),
    latitude,
    longitude,
    gps_ok: body.gps_ok !== false,
    battery_percent: battery
  };
  if (body.seal_status) leitura.seal_status = body.seal_status as SealStatus;
  if (ehNumero(body.speed_kmh)) leitura.speed_kmh = body.speed_kmh;
  if (ehNumero(body.gsm_signal)) leitura.gsm_signal = body.gsm_signal;
  if (ehNumero(satellites)) leitura.satellites = satellites;
  if (ehNumero(body.hdop)) leitura.hdop = body.hdop;
  if (typeof body.device_state === "string") leitura.device_state = body.device_state;
  if (Number.isInteger(body.attempt_count)) leitura.device_attempt_count = body.attempt_count as number;

  return { ok: true, leitura };
}

const titulos: Partial<Record<AlertType, string>> = {
  BATERIA_BAIXA: "Bateria baixa",
  GSM_SINAL_FRACO: "Sinal fraco",
  LACRE_VIOLADO: "Lacre rompido",
  LACRE_ABERTO_SEM_AUTORIZACAO: "Lacre aberto"
};

export class MessageService {

  private messages = new MessageRepository();

  private devices = new DeviceRepository();

  isDuplicate(messageId: string): boolean {
    return this.messages.exists(messageId) || this.devices.isRepeatMessageId(messageId);
  }

  // Grava a mensagem do lacre. extra = campos próprios do tipo (event_type,
  // alert_type...). Tudo numa transação: mensagem, alertas e estado
  receive(tipo: Exclude<MessageType, "CONFIRMACAO_COMANDO">, leitura: LeituraComum, extra: Record<string, unknown>): ReceiveResult {
    return db.transaction((): ReceiveResult => {
      if (this.isDuplicate(leitura.message_id)) {
        return "duplicate";
      }

      const device = this.devices.findByDeviceId(leitura.device_id)!;
      const agora = new Date().toISOString();
      const payload: Record<string, unknown> = { type: tipo, origin: "lacre", received_at: agora, ...leitura, ...extra };

      // Mesma posição e mesmo estado do lacre da última telemetria: não cria
      // outra linha, só atualiza a data, a bateria e o sinal da que já existe
      if (tipo === "TELEMETRIA" && this.samePosition(device, leitura)) {
        const anterior = this.messages.findByMessageId(device.last_telemetry_message_id!);
        if (anterior) {
          const atual = JSON.parse(anterior.payload_json) as Record<string, unknown>;
          this.messages.updatePayload(anterior.message_id, {
            ...atual,
            last_seen_at: agora,
            battery_percent: leitura.battery_percent,
            ...(leitura.gsm_signal !== undefined ? { gsm_signal: leitura.gsm_signal } : {})
          });
          this.devices.setLastRepeat(device.device_id, leitura.message_id);
          this.automaticAlerts(device, leitura, agora);
          this.updateState(leitura);
          return "position_repeated";
        }
      }

      this.messages.enqueue(leitura.message_id, leitura.device_id, tipo, payload);
      if (tipo === "TELEMETRIA") {
        this.devices.setLastTelemetry(leitura.device_id, leitura.message_id);
      }
      this.automaticAlerts(device, leitura, agora);
      this.updateState(leitura);
      return "created";
    })();
  }

  // Confirmação de comando: vai para a fila como mensagem própria
  enqueueCommandConfirmation(deviceId: string, commandId: string, status: string, errorMessage?: string): void {
    const messageId = `CONF-${commandId}`;
    if (this.messages.exists(messageId)) return;
    this.messages.enqueue(messageId, deviceId, "CONFIRMACAO_COMANDO", {
      type: "CONFIRMACAO_COMANDO", origin: "lacre", received_at: new Date().toISOString(),
      message_id: messageId, device_id: deviceId, command_id: commandId, command_status: status,
      ...(errorMessage ? { error_message: errorMessage } : {})
    });
  }

  private samePosition(device: Device, leitura: LeituraComum): boolean {
    return Boolean(device.last_telemetry_message_id) &&
      device.last_latitude === leitura.latitude &&
      device.last_longitude === leitura.longitude &&
      (device.last_gps_ok ?? 1) === (leitura.gps_ok ? 1 : 0) &&
      (leitura.seal_status === undefined || (device.last_seal_status ?? null) === leitura.seal_status);
  }

  private updateState(leitura: LeituraComum): void {
    this.devices.updateState(leitura.device_id, {
      latitude: leitura.latitude, longitude: leitura.longitude, gpsOk: leitura.gps_ok,
      batteryPercent: leitura.battery_percent, sealStatus: leitura.seal_status, signal: leitura.gsm_signal
    });
  }

  // Alertas que saem da própria mensagem. Cada um abre só na mudança (ao
  // cruzar o limite ou quando o lacre muda de estado), para não repetir a
  // cada leitura. Rota, geocerca e tempo sem comunicar ficam no sistema principal
  private automaticAlerts(device: Device, leitura: LeituraComum, agora: string): void {
    const bateriaMinima = limite("REGRA_BATERIA_MINIMA", 15);
    const sinalMinimo = limite("REGRA_SINAL_MINIMO_DBM", -105);
    const abrir = (tipo: AlertType, descricao: string): void => {
      const id = `AUT-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
      this.messages.enqueue(id, leitura.device_id, "ALERTA", {
        type: "ALERTA", origin: "servidor", received_at: agora, message_id: id, device_id: leitura.device_id,
        alert_type: tipo, severity: defaultSeverityByType[tipo], title: titulos[tipo] ?? tipo, description: descricao,
        source_message_id: leitura.message_id, latitude: leitura.latitude, longitude: leitura.longitude,
        gps_ok: leitura.gps_ok, battery_percent: leitura.battery_percent,
        ...(leitura.seal_status ? { seal_status: leitura.seal_status } : {})
      });
    };

    const bateriaAntes = device.last_battery_percent;
    if (leitura.battery_percent < bateriaMinima && (bateriaAntes == null || bateriaAntes >= bateriaMinima)) {
      abrir("BATERIA_BAIXA", `Bateria em ${leitura.battery_percent}% (mínimo ${bateriaMinima}%)`);
    }

    const sinalAntes = device.last_signal;
    if (leitura.gsm_signal !== undefined && leitura.gsm_signal < sinalMinimo && (sinalAntes == null || sinalAntes >= sinalMinimo)) {
      abrir("GSM_SINAL_FRACO", `Sinal em ${leitura.gsm_signal} dBm (mínimo ${sinalMinimo} dBm)`);
    }

    if (leitura.seal_status && leitura.seal_status !== (device.last_seal_status ?? null)) {
      if (leitura.seal_status === "BROKEN") {
        abrir("LACRE_VIOLADO", "O lacre informou que foi rompido");
      } else if (leitura.seal_status === "UNLOCKED") {
        abrir("LACRE_ABERTO_SEM_AUTORIZACAO", "O lacre informou que foi aberto; o sistema principal confere se havia autorização");
      }
    }
  }

}
