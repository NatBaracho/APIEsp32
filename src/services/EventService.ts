import { Event } from "../models/Event";
import { DeviceRepository } from "../repositories/DeviceRepository";
import { EventRepository } from "../repositories/EventRepository";

export class EventService {

  private repository =
    new EventRepository();

  private deviceRepository =
    new DeviceRepository();

  create(
    event: Event
  ): void {

    const existing =
      this.repository.findByMessageId(
        event.message_id
      );

    if (existing) {

      console.log(
        "Evento duplicado:",
        event.message_id
      );

      return;

    }

    this.deviceRepository.ensureDeviceExists(
      event.device_id
    );

    this.repository.create(
      event
    );

    console.log(
      "Evento salvo:",
      event.message_id
    );

  }

}
