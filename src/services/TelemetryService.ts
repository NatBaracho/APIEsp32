import { Telemetry } from "../models/Telemetry";
import { DeviceRepository } from "../repositories/DeviceRepository";
import { AssignmentService } from "./AssignmentService";
import { TelemetryQueueRepository } from "../repositories/TelemetryQueueRepository";
import { aposTelemetria } from "../regras/recepcao";

export type CreateTelemetryResult =
  | "created"
  | "position_repeated"
  | "duplicate"
  | "device_not_found";

export class TelemetryService {

  private assignments = new AssignmentService();

  private repository =
    new TelemetryQueueRepository();

  private deviceRepository =
    new DeviceRepository();

  findAll(): Telemetry[] {
    return this.repository.findAll();
  }

  create(
    telemetry: Telemetry
  ): CreateTelemetryResult {

    if (
      this.repository.messageIdExists(
        telemetry.message_id
      )
    ) {

      console.log(
        "Mensagem duplicada:",
        telemetry.message_id
      );

      return "duplicate";

    }

    if (
      !this.deviceRepository.findByDeviceId(
        telemetry.device_id
      )
    ) {
      return "device_not_found";
    }

    const lastTelemetry =
      this.repository.findLastByDeviceId(
        telemetry.device_id
      );

    // Só é repetição quando posição e estado do lacre são iguais; uma mudança
    // de estado (ex.: LOCKED -> BROKEN) no mesmo lugar precisa de registro próprio
    if (
      lastTelemetry &&
      typeof telemetry.latitude === "number" &&
      typeof telemetry.longitude === "number" &&
      lastTelemetry.latitude === telemetry.latitude &&
      lastTelemetry.longitude === telemetry.longitude &&
      (lastTelemetry.seal_status ?? null) === (telemetry.seal_status ?? null)
    ) {

      this.repository.updateLastSeen(
        lastTelemetry.id!,
        telemetry.message_id
      );

      console.log(
        "📍 Posição repetida. Apenas atualizando horário."
      );

      aposTelemetria(telemetry, null);

      return "position_repeated";

    }

    // lacre_id e cilindro_id vêm do vínculo ativo, nunca do payload
    const situation = this.assignments.describeDevice(
      telemetry.device_id,
      telemetry.seal_status
    );

    this.repository.create({
      ...telemetry,
      lacre_id: situation.seal_code,
      cilindro_id: situation.cylinder_code,
      error_type: situation.error_type
    });

    console.log(
      "Telemetria salva:",
      telemetry.message_id
    );

    // Regras automáticas (bateria, GSM, lacre aberto em trânsito)
    aposTelemetria(telemetry, situation.error_type);

    return "created";

  }

}
