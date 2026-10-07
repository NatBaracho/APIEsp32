import { Pool, PoolClient } from "pg";

// Acesso do Worker ao FluxID (PostgreSQL). Cada linha enviada roda na sua
// própria transação: se algo falhar, nada daquela linha fica gravado.

export interface FluxidDevice {
  id: string;
  organizacao_id: string;
}

export function createFluxidPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000
  });
}

export async function inTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function findDevice(
  client: PoolClient,
  deviceCode: string
): Promise<FluxidDevice | undefined> {
  const result = await client.query<FluxidDevice>(
    "SELECT id, organizacao_id FROM public.dispositivos WHERE codigo = $1",
    [deviceCode]
  );
  return result.rows[0];
}

export async function findIdByCode(
  client: PoolClient,
  table: "lacres" | "cilindros",
  code: string | null | undefined
): Promise<string | null> {
  if (!code) {
    return null;
  }

  const result = await client.query<{ id: string }>(
    `SELECT id FROM public.${table} WHERE codigo = $1`,
    [code]
  );
  return result.rows[0]?.id ?? null;
}

// Lacre vinculado ao dispositivo num momento (null = agora, vínculo ativo)
export async function sealOfDeviceAt(
  client: PoolClient,
  deviceId: string,
  atUtc: string | null
): Promise<string | null> {
  const result = atUtc === null
    ? await client.query<{ lacre_id: string }>(
      `SELECT lacre_id FROM public.vinculos_dispositivo_lacre
       WHERE dispositivo_id = $1 AND data_fim IS NULL`,
      [deviceId]
    )
    : await client.query<{ lacre_id: string }>(
      `SELECT lacre_id FROM public.vinculos_dispositivo_lacre
       WHERE dispositivo_id = $1
         AND data_inicio <= ($2::timestamp AT TIME ZONE 'UTC')
         AND (data_fim IS NULL OR data_fim > ($2::timestamp AT TIME ZONE 'UTC'))
       ORDER BY data_inicio DESC
       LIMIT 1`,
      [deviceId, atUtc]
    );
  return result.rows[0]?.lacre_id ?? null;
}

// Cilindro em que o lacre estava num momento (vínculo lacre → cilindro)
export async function cylinderOfSealAt(
  client: PoolClient,
  sealId: string,
  atUtc: string
): Promise<string | null> {
  const result = await client.query<{ cilindro_id: string }>(
    `SELECT cilindro_id FROM public.vinculos_cilindro_lacre
     WHERE lacre_id = $1
       AND data_inicio <= ($2::timestamp AT TIME ZONE 'UTC')
       AND (data_fim IS NULL OR data_fim > ($2::timestamp AT TIME ZONE 'UTC'))
     ORDER BY data_inicio DESC
     LIMIT 1`,
    [sealId, atUtc]
  );
  return result.rows[0]?.cilindro_id ?? null;
}

// payload_json da Oxide (texto) para o JSONB do FluxID, com os campos de
// controle da Oxide que não têm coluna própria no FluxID
export function toPayloadRaw(
  payloadJson: string | null,
  oxideFields: Record<string, unknown>
): Record<string, unknown> {
  let original: unknown = null;

  if (payloadJson) {
    try {
      original = JSON.parse(payloadJson);
    } catch {
      original = { texto: payloadJson };
    }
  }

  const base = original !== null && typeof original === "object" && !Array.isArray(original)
    ? { ...(original as Record<string, unknown>) }
    : { valor: original };

  const oxide = Object.fromEntries(
    Object.entries(oxideFields).filter(([, value]) => value !== null && value !== undefined)
  );

  return { ...base, oxide };
}
