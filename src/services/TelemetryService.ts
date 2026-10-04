import { Telemetry } from "../models/Telemetry";
import { TelemetryQueueRepository } from "../repositories/TelemetryQueueRepository";

export class TelemetryService {

  private repository =
    new TelemetryQueueRepository();

  create(
    telemetry: Telemetry
  ): void {

    const existing =
      this.repository.findByMessageId(
        telemetry.message_id
      );

    if (existing) {

      console.log(
        "Mensagem duplicada:",
        telemetry.message_id
      );

      return;

    }

    this.repository.create(
      telemetry
    );

    console.log(
      "Telemetria salva:",
      telemetry.message_id
    );

  }

}
