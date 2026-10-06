import { Event } from "../models/Event";
import { EventRepository } from "../repositories/EventRepository";

export class EventService {

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
    this.repository.create(
      event
    );

    console.log(
      "Evento salvo:",
      event.message_id
    );

    return true;

  }

}
