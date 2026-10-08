import { Event } from "../models/Event";
import { EventRepository } from "../repositories/EventRepository";
import { AssignmentService } from "./AssignmentService";
import { aposEvento } from "../regras/recepcao";

export class EventService {

  private assignments = new AssignmentService();

  private repository =
    new EventRepository();

  create(
    event: Event
  ): boolean {

    const existing =
      this.repository.findByMessageId(
        event.message_id
      );

    if (existing) {

      console.log(
        "Evento duplicado:",
        event.message_id
      );

      return false;

    }

    // O dispositivo precisa estar cadastrado: apiKeyDeviceMiddleware já
    // respondeu 404 antes de chegar aqui (sem criação automática, SEG-04)
    const situation = this.assignments.describeDevice(
      event.device_id,
      event.seal_status
    );

    this.repository.create({
      ...event,
      error_type: situation.error_type
    });

    // Regras automáticas (lacre aberto em trânsito)
    aposEvento(event.device_id, situation.error_type, event.seal_status, event.message_id);

    console.log(
      "Evento salvo:",
      event.message_id
    );

    return true;

  }

}
