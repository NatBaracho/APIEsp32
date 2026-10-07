import { Device } from "../models/Device";
import { DeviceRepository } from "../repositories/DeviceRepository";
import { hashApiKey } from "../utils/apiKeyHash";

export type CreateDeviceResult =
  | "created"
  | "duplicate_device"
  | "duplicate_api_key";

// Dispositivo como exposto pela API: a api_key (e o hash dela) nunca sai
// nas respostas (SEG-01)
export type PublicDevice = Omit<Device, "api_key" | "api_key_hash">;

function toPublicDevice(device: Device): PublicDevice {
  const { api_key: _apiKey, api_key_hash: _apiKeyHash, ...publicDevice } = device;
  return publicDevice;
}

export class DeviceService {

  private repository =
    new DeviceRepository();

  findAll(): PublicDevice[] {
    return this.repository.findAll().map(toPublicDevice);
  }

  findByDeviceId(
    deviceId: string
  ): PublicDevice | undefined {

    const device = this.repository.findByDeviceId(
      deviceId
    );

    return device && toPublicDevice(device);

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

    if (
      this.repository.findByApiKey(device.api_key) ||
      this.repository.findByApiKeyHash(hashApiKey(device.api_key))
    ) {

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
