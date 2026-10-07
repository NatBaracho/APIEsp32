import { Pool } from "pg";
import { findDevice, findIdByCode, inTransaction, toPayloadRaw } from "./fluxid";
import { errorMessage, isConnectionError, SyncOutcome } from "./retry";

export interface TelemetryRow {
  id: number;
  message_id: string;
  device_id: string;
  lacre_id: string | null;
  cilindro_id: string | null;
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  battery_percent: number | null;
  gsm_signal: number | null;
  payload_json: string | null;
  last_seen_at: string | null;
  seal_status: string | null;
  device_attempt_count: number | null;
  error_type: string | null;
}

// telemetry_queue → telemetrias (com posição) ou telemetrias_quarentena
// (sem posição, decisão P2). data_coleta/recebido_em: hora de chegada
// ao FluxID (P1). Reenviar a mesma linha não duplica (message_id único).
export async function pushTelemetry(pool: Pool, row: TelemetryRow): Promise<SyncOutcome> {
  try {
    return await inTransaction(pool, async client => {
      const device = await findDevice(client, row.device_id);

      if (!device) {
        return { kind: "retry", error: "dispositivo não cadastrado no FluxID" } as const;
      }

      // Lacre e cilindro gravados pela Oxide no recebimento (vínculo da hora)
      const sealId = await findIdByCode(client, "lacres", row.lacre_id);
      const cylinderId = await findIdByCode(client, "cilindros", row.cilindro_id);
      const payload = toPayloadRaw(row.payload_json, {
        seal_status: row.seal_status,
        device_attempt_count: row.device_attempt_count,
        error_type: row.error_type,
        last_seen_at: row.last_seen_at,
        lacre_codigo: row.lacre_id,
        cilindro_codigo: row.cilindro_id
      });

      if (row.latitude === null || row.longitude === null) {
        const result = await client.query(
          `INSERT INTO public.telemetrias_quarentena (
             message_id, dispositivo_id, organizacao_id, lacre_id, cilindro_id,
             velocidade_kmh, bateria_percentual, sinal_gsm, payload_raw
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (message_id) DO NOTHING`,
          [
            row.message_id, device.id, device.organizacao_id, sealId, cylinderId,
            row.speed_kmh, row.battery_percent, row.gsm_signal, payload
          ]
        );
        return {
          kind: "synced",
          note: result.rowCount === 0 ? "já estava na quarentena" : "quarentena (sem posição)"
        } as const;
      }

      const result = await client.query(
        `INSERT INTO public.telemetrias (
           message_id, dispositivo_id, lacre_id, cilindro_id, latitude, longitude,
           velocidade_kmh, bateria_percentual, sinal_gsm, payload_raw
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (message_id) DO NOTHING`,
        [
          row.message_id, device.id, sealId, cylinderId, row.latitude, row.longitude,
          row.speed_kmh, row.battery_percent, row.gsm_signal, payload
        ]
      );
      return {
        kind: "synced",
        note: result.rowCount === 0 ? "já estava no FluxID" : "telemetria"
      } as const;
    });
  } catch (error) {
    if (isConnectionError(error)) {
      throw error;
    }
    return { kind: "retry", error: errorMessage(error) };
  }
}
