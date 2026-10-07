import { Pool } from "pg";
import { SyncLogRepository, SyncLogStatus } from "../repositories/syncLogRepository";
import { SyncQueueName, SyncRepository } from "../repositories/SyncRepository";
import { CadastroResult, syncCadastro } from "./cadastroSync";
import { AlertRow, pushAlert } from "./pushAlerts";
import { EventRow, pushEvent } from "./pushEvents";
import { pushTelemetry, TelemetryRow } from "./pushTelemetry";
import { errorMessage, SyncOutcome } from "./retry";

const syncRepository = new SyncRepository();
const syncLogRepository = new SyncLogRepository();

interface QueueCount {
  enviados: number;
  aguardando: number;
  com_erro: number;
  parados: number;
}

export interface CycleResult {
  status: SyncLogStatus;
  cadastro?: CadastroResult | { erro: string };
  filas: Partial<Record<SyncQueueName, QueueCount>>;
  erro?: string;
}

function emptyCount(): QueueCount {
  return { enviados: 0, aguardando: 0, com_erro: 0, parados: 0 };
}

async function drainQueue<Row extends { id: number }>(
  pool: Pool,
  queue: SyncQueueName,
  batchSize: number,
  push: (pool: Pool, row: Row) => Promise<SyncOutcome>
): Promise<QueueCount> {
  const count = emptyCount();

  for (const row of syncRepository.findDue<Row>(queue, batchSize)) {
    if (!syncRepository.markProcessing(queue, row.id)) {
      continue;
    }

    // Falha de conexão interrompe a rodada; a linha volta para a fila
    // (resetProcessing) sem gastar tentativa
    const outcome = await push(pool, row);
    syncRepository.applyOutcome(queue, row.id, outcome);

    if (outcome.kind === "synced") count.enviados++;
    if (outcome.kind === "wait") count.aguardando++;
    if (outcome.kind === "retry") count.com_erro++;
    if (outcome.kind === "stop") count.parados++;
  }

  return count;
}

// Uma rodada: cadastro FluxID → Oxide (quando pedido) e depois as filas
// Oxide → FluxID, na ordem telemetria, eventos e alertas
export async function runCycle(
  pool: Pool,
  options: { batchSize: number; withCadastro: boolean }
): Promise<CycleResult> {
  const logId = syncLogRepository.start();
  const result: CycleResult = { status: "OK", filas: {} };

  try {
    // Teste de conexão antes de tocar nas filas
    await pool.query("SELECT 1");

    if (options.withCadastro) {
      try {
        result.cadastro = await syncCadastro(pool);
      } catch (error) {
        result.cadastro = { erro: errorMessage(error) };
        result.status = "PARCIAL";
      }
    }

    result.filas.telemetry = await drainQueue<TelemetryRow>(pool, "telemetry", options.batchSize, pushTelemetry);
    result.filas.events = await drainQueue<EventRow>(pool, "events", options.batchSize, pushEvent);
    result.filas.alerts = await drainQueue<AlertRow>(pool, "alerts", options.batchSize, pushAlert);

    const failures = Object.values(result.filas)
      .reduce((total, count) => total + count.com_erro + count.parados, 0);

    if (failures > 0 || (result.cadastro && "conflitos" in result.cadastro && result.cadastro.conflitos.length > 0)) {
      result.status = "PARCIAL";
    }
  } catch (error) {
    result.status = "FALHOU";
    result.erro = errorMessage(error);
  } finally {
    syncRepository.resetProcessing();
    syncLogRepository.finish(logId, result.status, JSON.stringify(result));
  }

  return result;
}

export function resetInterrupted(): number {
  return syncRepository.resetProcessing();
}
