import { Request, Response } from "express";
import { AlertSeverity, alertSeverities, defaultSeverityByType, normalizeAlertType } from "../models/Alert";
import { messageTypes } from "../models/Message";
import { MessageRepository } from "../repositories/MessageRepository";
import { MessageService, ReceiveResult, validarLeitura } from "../services/MessageService";

// Rotas do lacre: telemetria, evento e alerta. As três exigem posição e
// bateria e gravam na mesma fila (tabela mensagens)
export class IngestController {

  private service = new MessageService();

  private messages = new MessageRepository();

  private respond(res: Response, result: ReceiveResult, recebida: string): void {
    if (result === "duplicate") {
      res.status(409).json({ success: false, message: "Mensagem duplicada" });
      return;
    }
    if (result === "position_repeated") {
      res.status(200).json({ success: true, message: "Posição já registrada; data e hora atualizadas" });
      return;
    }
    res.status(202).json({ success: true, message: recebida });
  }

  private invalid(res: Response, message: string): void {
    res.status(400).json({ success: false, message });
  }

  telemetry(req: Request, res: Response): void {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const validacao = validarLeitura(body);
      if (!validacao.ok) return this.invalid(res, validacao.message);

      this.respond(res, this.service.receive("TELEMETRIA", validacao.leitura, {}), "Telemetria recebida");
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: "Erro ao receber telemetria" });
    }
  }

  event(req: Request, res: Response): void {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body.event_type !== "string" || !body.event_type.trim()) {
        return this.invalid(res, "message_id, device_id e event_type são obrigatórios");
      }
      const validacao = validarLeitura(body);
      if (!validacao.ok) return this.invalid(res, validacao.message);

      const extra: Record<string, unknown> = { event_type: body.event_type.trim() };
      if (typeof body.description === "string") extra.description = body.description;
      this.respond(res, this.service.receive("EVENTO", validacao.leitura, extra), "Evento recebido");
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: "Erro ao receber evento" });
    }
  }

  alert(req: Request, res: Response): void {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const tipo = typeof body.alert_type === "string" ? normalizeAlertType(body.alert_type) : undefined;
      if (!tipo || typeof body.title !== "string" || !body.title.trim()) {
        return this.invalid(res, "alert_id, device_id, alert_type do catálogo (Tipos-de-Erro.md) e title são obrigatórios");
      }
      if (body.severity !== undefined && !alertSeverities.includes(body.severity as AlertSeverity)) {
        return this.invalid(res, "severity deve ser BAIXA, MEDIA, ALTA ou CRITICA");
      }
      const validacao = validarLeitura(body, "alert_id");
      if (!validacao.ok) return this.invalid(res, validacao.message);

      const extra: Record<string, unknown> = {
        alert_type: tipo,
        severity: (body.severity as AlertSeverity | undefined) ?? defaultSeverityByType[tipo],
        title: body.title.trim()
      };
      if (typeof body.description === "string") extra.description = body.description;

      const result = this.service.receive("ALERTA", validacao.leitura, extra);
      if (result === "duplicate") {
        res.status(409).json({ success: false, message: "Alerta duplicado" });
        return;
      }
      res.status(201).json({ success: true, message: "Alerta registrado", alert: { alert_id: validacao.leitura.message_id, ...extra } });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: "Erro ao registrar alerta" });
    }
  }

  // Últimas mensagens recebidas (para a equipe acompanhar os testes)
  list(req: Request, res: Response): void {
    try {
      const tipo = typeof req.query.type === "string" ? req.query.type.toUpperCase() : undefined;
      if (tipo && !(messageTypes as readonly string[]).includes(tipo)) {
        return this.invalid(res, `type deve ser ${messageTypes.join(", ")}`);
      }
      const deviceId = typeof req.query.device_id === "string" ? req.query.device_id : undefined;
      const limite = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

      res.status(200).json(this.messages.listRecent(limite, tipo, deviceId).map(m => ({
        message_id: m.message_id,
        device_id: m.device_id,
        type: m.tipo,
        received_at: m.received_at,
        sync_status: m.status,
        data: JSON.parse(m.payload_json)
      })));
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: "Erro ao listar mensagens" });
    }
  }

}
