import { Telemetry } from "../models/Telemetry";
import { DeviceRepository } from "../repositories/DeviceRepository";
import { TelemetryQueueRepository } from "../repositories/TelemetryQueueRepository";

export type CreateTelemetryResult =
  | "created"
  | "position_repeated"
  | "duplicate"
  | "device_not_found";

export class TelemetryService {

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

      return "position_repeated";

    }

    this.repository.create(
      telemetry
    );

    console.log(
      "Telemetria salva:",
      telemetry.message_id
    );

    return "created";

  }

}
