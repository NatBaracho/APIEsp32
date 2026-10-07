import { createHash, timingSafeEqual } from "crypto";
import { Device } from "../models/Device";

// Mesmo formato de dispositivos.api_key_hash no FluxID: SHA-256 em hexadecimal
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

// Dispositivo com hash (vindo do FluxID) só aceita a chave que gera esse
// hash; sem hash, vale a chave em texto do cadastro provisório
export function deviceAcceptsKey(device: Device, apiKey: string): boolean {
  if (device.api_key_hash) {
    const expected = Buffer.from(device.api_key_hash, "hex");
    const received = Buffer.from(hashApiKey(apiKey), "hex");
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  return device.api_key === apiKey;
}
