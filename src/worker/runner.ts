import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { commandTypes } from "../models/Command";
import { CommandRepository } from "../repositories/CommandRepository";
import { DeviceRepository } from "../repositories/DeviceRepository";
import { MessageRepository } from "../repositories/MessageRepository";
import { WorkerConfig } from "./config";
import {
  DestinoIndisponivel, PedidoRecusado, enviarMensagens, listarComandos, listarDispositivos
} from "./destino";
import { errorMessage, nextRetryAt, sqliteUtc } from "./retry";

const messages = new MessageRepository();
const devices = new DeviceRepository();
const commands = new CommandRepository();

const MAX_LOTES_POR_RODADA = 10;

export interface CycleResult {
  status: "OK" | "PARCIAL" | "FALHOU";
  enviadas: number;
  com_erro: number;
  paradas: number;
  dispositivos?: { criados: number; atualizados: number };
  comandos_novos: number;
  avisos: string[];
  erro?: string;
}

// Última rodada, para GET /health e GET /sync/status (o Worker é outro processo)
export const arquivoDaRodada = (): string => path.resolve(process.cwd(), "oxide-worker.json");

export function lerUltimaRodada(): { em: string; resultado: CycleResult } | null {
  try {
    return JSON.parse(fs.readFileSync(arquivoDaRodada(), "utf8"));
  } catch {
    return null;
  }
}

// Cadastro de dispositivos (com o hash da chave) do banco principal → Oxide
async function trazerDispositivos(config: WorkerConfig, result: CycleResult): Promise<void> {
  const lista = await listarDispositivos(config);
  const contagem = { criados: 0, atualizados: 0 };

  for (const d of lista) {
    const feito = devices.upsertFromMain(
      d.device_id, d.api_key_hash, d.active ? 1 : 0, d.firmware_version ?? null,
      `sem-chave-em-texto:${randomBytes(12).toString("hex")}`
    );
    contagem[feito === "criado" ? "criados" : "atualizados"]++;
  }

  result.dispositivos = contagem;
}

// Comandos pendentes do banco principal → Oxide (o lacre os busca aqui)
async function trazerComandos(config: WorkerConfig, result: CycleResult): Promise<void> {
  for (const c of await listarComandos(config)) {
    if (!(commandTypes as readonly string[]).includes(c.command_type)) {
      result.avisos.push(`comando ${c.command_id}: tipo ${c.command_type} fora do catálogo`);
      continue;
    }
    if (!devices.findByDeviceId(c.device_id)) {
      result.avisos.push(`comando ${c.command_id}: dispositivo ${c.device_id} não cadastrado na Oxide`);
      continue;
    }
    const criado = c.created_at && !Number.isNaN(Date.parse(c.created_at)) ? sqliteUtc(new Date(c.created_at)) : null;
    if (commands.insertFromMain(c.command_id, c.device_id, c.command_type, criado)) {
      result.comandos_novos++;
    }
  }
}

// Fila → banco principal, em lotes. Reenviar a mesma mensagem não duplica:
// o destino responde "duplicate" e ela é marcada como enviada
async function enviarFila(config: WorkerConfig, result: CycleResult): Promise<void> {
  for (let lote = 0; lote < MAX_LOTES_POR_RODADA; lote++) {
    const pendentes = messages.findDue(config.batchSize);
    if (pendentes.length === 0) return;

    messages.markProcessing(pendentes.map(m => m.id));

    let respostas;
    try {
      respostas = await enviarMensagens(config, pendentes.map(m => JSON.parse(m.payload_json)));
    } catch (erro) {
      if (!(erro instanceof PedidoRecusado)) throw erro;
      // O destino recusou o lote inteiro: cada mensagem gasta uma tentativa
      for (const m of pendentes) {
        messages.markError(m.id, errorMessage(erro), nextRetryAt(m.attempt_count + 1), true);
        result.com_erro++;
      }
      return;
    }

    for (const m of pendentes) {
      const resposta = respostas.get(m.message_id);

      if (resposta?.status === "stored" || resposta?.status === "duplicate") {
        messages.markSynced(m.id);
        result.enviadas++;
      } else if (resposta?.status === "rejected") {
        // Recusada pelo banco principal: tentar de novo não muda o dado
        messages.markError(m.id, resposta.error ?? "recusada pelo banco principal", null, true);
        result.paradas++;
      } else {
        const proxima = nextRetryAt(m.attempt_count + 1);
        messages.markError(m.id, "sem resposta do banco principal para esta mensagem", proxima, true);
        result[proxima ? "com_erro" : "paradas"]++;
      }
    }

    if (pendentes.length < config.batchSize) return;
  }
}

export async function runCycle(config: WorkerConfig, options: { withCadastro: boolean }): Promise<CycleResult> {
  const result: CycleResult = { status: "OK", enviadas: 0, com_erro: 0, paradas: 0, comandos_novos: 0, avisos: [] };

  try {
    if (options.withCadastro) {
      await trazerDispositivos(config, result);
    }
    await trazerComandos(config, result);
    await enviarFila(config, result);

    if (result.com_erro > 0 || result.paradas > 0 || result.avisos.length > 0) {
      result.status = "PARCIAL";
    }
  } catch (erro) {
    result.status = "FALHOU";
    result.erro = errorMessage(erro);
    if (!(erro instanceof DestinoIndisponivel) && !(erro instanceof PedidoRecusado)) {
      console.error(erro);
    }
  } finally {
    messages.resetProcessing();
    fs.writeFileSync(arquivoDaRodada(), JSON.stringify({ em: new Date().toISOString(), resultado: result }), "utf8");
  }

  return result;
}

export function resetInterrupted(): number {
  return messages.resetProcessing();
}
