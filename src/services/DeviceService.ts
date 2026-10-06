import { Device } from "../models/Device";
import { DeviceRepository } from "../repositories/DeviceRepository";

export type CreateDeviceResult =
  | "created"
  | "duplicate_device"
  | "duplicate_api_key";

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
  ): CreateDeviceResult {

    const existing =
      this.repository.findByDeviceId(
        device.device_id
      );

    if (existing) {

      console.log(
        "⚠️ Dispositivo já existe:",
        device.device_id
      );

      return "duplicate_device";

    }

    if (this.repository.findByApiKey(device.api_key)) {

      console.log(
        "⚠️ API Key já usada por outro dispositivo"
      );

      return "duplicate_api_key";

    }

    this.repository.create(
      device
    );

    console.log(
      "✅ Dispositivo criado:",
      device.device_id
    );

    return "created";

  }

}
