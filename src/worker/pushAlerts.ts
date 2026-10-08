import { Pool } from "pg";
import { cylinderOfSealAt, findDevice, inTransaction, sealOfDeviceAt } from "./fluxid";
import { errorMessage, isConnectionError, SyncOutcome } from "./retry";

export interface AlertRow {
  id: number;
  alert_id: string;
  device_id: string;
  alert_type: string;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

// Códigos de cadastro que, por definição, não têm cilindro (ou nem lacre).
// Mesma regra do CHECK do script 003 no FluxID
const withoutCylinder = new Set([
  "LACRE_SEM_CILINDRO", "DISPOSITIVO_SEM_LACRE", "DISPOSITIVO_NAO_CADASTRADO", "CHAVE_INVALIDA"
]);
const withoutSeal = new Set([
  "DISPOSITIVO_SEM_LACRE", "DISPOSITIVO_NAO_CADASTRADO", "CHAVE_INVALIDA"
]);

// alerts → alertas. codigo = alert_id da Oxide (P7). Lacre e cilindro são os
// do vínculo válido no momento do alerta (created_at), não os de agora,
// para a auditoria (script 003). Sem vínculo naquela data, o alerta não vai
// ao FluxID e fica parado na Oxide para o gestor. Um alerta já enviado é
// atualizado (análise e encerramento feitos na Oxide), salvo se já foi
// tratado pelo frontend (D5).
export async function pushAlert(pool: Pool, row: AlertRow): Promise<SyncOutcome> {
  try {
    return await inTransaction(pool, async client => {
      const device = await findDevice(client, row.device_id);

      if (!device) {
        return { kind: "retry", error: "dispositivo não cadastrado no FluxID" } as const;
      }

      const sealId = await sealOfDeviceAt(client, device.id, row.created_at);
      const cylinderId = sealId ? await cylinderOfSealAt(client, sealId, row.created_at) : null;

      if (!sealId && !withoutSeal.has(row.alert_type)) {
        return {
          kind: "stop",
          error: `sem lacre vinculado ao dispositivo em ${row.created_at} (UTC); o alerta não pode ir ao FluxID sem lacre e cilindro`
        } as const;
      }

      if (!cylinderId && !withoutCylinder.has(row.alert_type)) {
        return {
          kind: "stop",
          error: `o lacre não estava em nenhum cilindro em ${row.created_at} (UTC); o alerta não pode ir ao FluxID sem cilindro`
        } as const;
      }

      const existing = await client.query<{ dispositivo_id: string | null; tratado_no_fluxid: boolean }>(
        "SELECT dispositivo_id, tratado_no_fluxid FROM public.alertas WHERE codigo = $1",
        [row.alert_id]
      );
      const current = existing.rows[0];

      if (current && current.dispositivo_id !== device.id) {
        return {
          kind: "stop",
          error: `o código ${row.alert_id} já é usado no FluxID por outro alerta`
        } as const;
      }

      if (current?.tratado_no_fluxid) {
        // Decisão D5: depois que o gestor tratou o alerta pelo frontend, o
        // FluxID manda; a Oxide não sobrescreve análise nem encerramento
        return { kind: "synced", note: "alerta já tratado no FluxID; nada alterado" } as const;
      }

      if (current) {
        // Reenvio do mesmo alerta: atualiza o que muda na Oxide (análise e
        // encerramento). Lacre, cilindro e abertura não mudam
        await client.query(
          `UPDATE public.alertas
           SET severidade = $2, status = $3, titulo = $4, descricao = $5,
               encerrado_em = ($6::timestamp AT TIME ZONE 'UTC'),
               encerrado_por_nome = $7, motivo_encerramento = $8
           WHERE codigo = $1`,
          [
            row.alert_id, row.severity, row.status, row.title, row.description,
            row.resolved_at, row.resolved_by, row.resolution_note
          ]
        );
        return { kind: "synced", note: `alerta atualizado (${row.status})` } as const;
      }

      const values = [
        row.alert_id, device.organizacao_id, device.id, sealId, cylinderId,
        row.alert_type, row.severity, row.status, row.title, row.description,
        row.created_at, row.resolved_at, row.resolved_by, row.resolution_note
      ];

      await client.query(
        `INSERT INTO public.alertas (
           codigo, organizacao_id, dispositivo_id, lacre_id, cilindro_id,
           tipo, severidade, status, titulo, descricao,
           aberto_em, encerrado_em, encerrado_por_nome, motivo_encerramento
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 ($11::timestamp AT TIME ZONE 'UTC'), ($12::timestamp AT TIME ZONE 'UTC'), $13, $14)`,
        values
      );
      return { kind: "synced", note: "alerta criado" } as const;
    });
  } catch (error) {
    if (isConnectionError(error)) {
      throw error;
    }
    return { kind: "retry", error: errorMessage(error) };
  }
}
