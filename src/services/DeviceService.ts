import { Device } from "../models/Device";
import { DeviceRepository } from "../repositories/DeviceRepository";

export class DeviceService {

  private repository =
    new DeviceRepository();

  findAll(): Device[] {
    return this.repository.findAll();
  }

  findByDeviceId(
    deviceId: string
  ): Device | undefined {

    return this.repository.findByDeviceId(
      deviceId
    );

  }

  create(
    device: Device
  ): boolean {

    const existing =
      this.repository.findByDeviceId(
        device.device_id
      );

    if (existing) {

      console.log(
        "⚠️ Dispositivo já existe:",
        device.device_id
      );

      return false;

    }

    this.repository.create(
      device
    );

    console.log(
      "✅ Dispositivo criado:",
      device.device_id
    );

    return true;

  }

}
