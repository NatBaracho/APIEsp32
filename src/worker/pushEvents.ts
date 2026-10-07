import { Pool } from "pg";
import { findDevice, inTransaction, sealOfDeviceAt, toPayloadRaw } from "./fluxid";
import { errorMessage, isConnectionError, SyncOutcome } from "./retry";

export interface EventRow {
  id: number;
  message_id: string;
  device_id: string;
  message_type: string;
  seal_status: string | null;
  payload_json: string | null;
  device_attempt_count: number | null;
  error_type: string | null;
}

// Estado do lacre enviado pelo ESP32 → tipo do evento no FluxID (seção 3.2
// do plano de integração)
const sealEventType: Record<string, string> = {
  LOCKED: "FECHAMENTO",
  UNLOCKED: "ABERTURA_NAO_AUTORIZADA",
  BROKEN: "VIOLACAO"
};

// Tipos que deixam o lacre sob suspeita (P8: o Worker só marca a suspeita;
// quem confirma ROMPIDO é o gestor)
const suspiciousTypes = new Set(["ABERTURA_NAO_AUTORIZADA", "VIOLACAO"]);

function description(row: EventRow): string {
  return row.error_type
    ? `Evento ${row.message_type} recebido pela Oxide (${row.error_type})`
    : `Evento ${row.message_type} recebido pela Oxide`;
}

// events → eventos_lacre (com estado do lacre) ou eventos_dispositivo
// (sem estado do lacre, P4). ocorrido_em = chegada ao FluxID (P1)
export async function pushEvent(pool: Pool, row: EventRow): Promise<SyncOutcome> {
  try {
    return await inTransaction(pool, async client => {
      const device = await findDevice(client, row.device_id);

      if (!device) {
        return { kind: "retry", error: "dispositivo não cadastrado no FluxID" } as const;
      }

      const sealId = await sealOfDeviceAt(client, device.id, null);
      const payload = toPayloadRaw(row.payload_json, {
        message_type: row.message_type,
        seal_status: row.seal_status,
        device_attempt_count: row.device_attempt_count,
        error_type: row.error_type
      });
      const sealType = row.seal_status ? sealEventType[row.seal_status] : undefined;

      if (!sealType) {
        await client.query(
          `INSERT INTO public.eventos_dispositivo (
             message_id, dispositivo_id, organizacao_id, lacre_id, tipo,
             codigo_erro, descricao, payload_raw
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (message_id) DO NOTHING`,
          [
            row.message_id, device.id, device.organizacao_id, sealId,
            row.message_type, row.error_type, description(row), payload
          ]
        );
        return { kind: "synced", note: "evento do dispositivo" } as const;
      }

      // P3: evento do lacre espera o dispositivo ter lacre vinculado no FluxID
      if (!sealId) {
        return {
          kind: "wait",
          reason: "aguardando o dispositivo ter um lacre vinculado no FluxID (P3)"
        } as const;
      }

      const inserted = await client.query(
        `INSERT INTO public.eventos_lacre (
           message_id, lacre_id, dispositivo_id, tipo, autorizado,
           descricao, codigo_erro, payload_raw
         )
         VALUES ($1, $2, $3, $4, false, $5, $6, $7)
         ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
        [row.message_id, sealId, device.id, sealType, description(row), row.error_type, payload]
      );

      if (inserted.rowCount === 1 && suspiciousTypes.has(sealType)) {
        await client.query(
          `UPDATE public.lacres
           SET status = 'SUSPEITA_VIOLACAO', atualizado_em = now()
           WHERE id = $1 AND status = 'INSTALADO'`,
          [sealId]
        );
      }

      return {
        kind: "synced",
        note: inserted.rowCount === 0 ? "já estava no FluxID" : `evento do lacre (${sealType})`
      } as const;
    });
  } catch (error) {
    if (isConnectionError(error)) {
      throw error;
    }
    return { kind: "retry", error: errorMessage(error) };
  }
}
