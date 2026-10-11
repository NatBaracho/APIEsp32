import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { Device } from "../models/Device";

// A Oxide guarda só o hash da chave do dispositivo: SHA-256 em hexadecimal,
// o mesmo formato do cadastro no sistema principal
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

// O que fica na coluna api_key (obrigatória e única): um texto aleatório,
// que não é a chave e não autentica ninguém
export const PREFIXO_SEM_CHAVE = "sem-chave-em-texto:";
export const marcaSemChave = (): string => `${PREFIXO_SEM_CHAVE}${randomBytes(12).toString("hex")}`;

// O dispositivo só aceita a chave que gera o hash guardado
export function deviceAcceptsKey(device: Device, apiKey: string): boolean {
  if (!device.api_key_hash || !apiKey) return false;

  const expected = Buffer.from(device.api_key_hash, "hex");
  const received = Buffer.from(hashApiKey(apiKey), "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
