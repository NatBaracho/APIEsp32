import { Telemetry } from "../models/Telemetry";
import { TelemetryQueueRepository } from "../repositories/TelemetryQueueRepository";

export class TelemetryService {

  private repository =
    new TelemetryQueueRepository();

  findAll(): Telemetry[] {
    return this.repository.findAll();
  }

  create(
    telemetry: Telemetry
  ): boolean {

    const existing =
      this.repository.findByMessageId(
        telemetry.message_id
      );

    if (existing) {

      console.log(
        "Mensagem duplicada:",
        telemetry.message_id
      );

      return false;

    }

    const lastTelemetry =
      this.repository.findLastByDeviceId(
        telemetry.device_id
      );

    if (
      lastTelemetry &&
      typeof telemetry.latitude === "number" &&
      typeof telemetry.longitude === "number" &&
      lastTelemetry.latitude === telemetry.latitude &&
      lastTelemetry.longitude === telemetry.longitude
    ) {

      this.repository.updateLastSeen(
        lastTelemetry.id!
      );

      console.log(
        "📍 Posição repetida. Apenas atualizando horário."
      );

      return true;

    }

    this.repository.create(
      telemetry
    );

    console.log(
      "Telemetria salva:",
      telemetry.message_id
    );

    return true;

  }

}
