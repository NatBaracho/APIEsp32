import { randomBytes } from "crypto";
import { Pool } from "pg";
import db from "../database/connection";

// Cadastro oficial FluxID → cópia na Oxide: dispositivos (com o hash da
// chave), lacres, cilindros e vínculos. O FluxID é a fonte: o que vem de lá
// sobrescreve a cópia; o que só existe na Oxide (cadastro provisório) é
// mantido. Nada é apagado.

export interface CadastroResult {
  dispositivos: number;
  lacres: number;
  cilindros: number;
  vinculos_dispositivo_lacre: number;
  vinculos_lacre_cilindro: number;
  conflitos: string[];
}

interface FluxidDeviceRow {
  codigo: string;
  api_key_hash: string | null;
  ativo: boolean;
  versao_firmware: string | null;
}

interface FluxidSealRow { codigo: string; uid_nfc: string; status: string }
interface FluxidCylinderRow { codigo: string; numero_serie: string; status: string }

interface FluxidBindingRow {
  id: string;
  origem: string;
  destino: string;
  inicio: string;
  fim: string | null;
  motivo: string | null;
}

// Datas convertidas para o formato da Oxide (UTC, como CURRENT_TIMESTAMP)
const utc = (column: string): string =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;

// Chave em texto impossível de adivinhar: dispositivos vindos do FluxID
// autenticam pelo hash; sem hash, ainda não têm chave utilizável
const unusableKey = (): string => `fluxid-sem-chave:${randomBytes(24).toString("hex")}`;

function syncDevices(rows: FluxidDeviceRow[]): number {
  const find = db.prepare("SELECT device_id FROM devices WHERE device_id = ?");
  const insert = db.prepare(`
    INSERT INTO devices (device_id, api_key, api_key_hash, firmware_version, active)
    VALUES (?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE devices
    SET active = ?,
        firmware_version = COALESCE(?, firmware_version),
        api_key_hash = COALESCE(?, api_key_hash)
    WHERE device_id = ?
  `);

  for (const row of rows) {
    const active = row.ativo ? 1 : 0;

    if (find.get(row.codigo)) {
      update.run(active, row.versao_firmware, row.api_key_hash, row.codigo);
    } else {
      insert.run(row.codigo, unusableKey(), row.api_key_hash, row.versao_firmware, active);
    }
  }

  return rows.length;
}

function syncSeals(rows: FluxidSealRow[], conflitos: string[]): number {
  const upsert = db.prepare(`
    INSERT INTO seals (seal_code, nfc_uid, status)
    VALUES (?, ?, ?)
    ON CONFLICT (seal_code) DO UPDATE
      SET nfc_uid = excluded.nfc_uid, status = excluded.status, updated_at = CURRENT_TIMESTAMP
  `);
  let total = 0;

  for (const row of rows) {
    try {
      upsert.run(row.codigo, row.uid_nfc, row.status);
      total++;
    } catch (error) {
      conflitos.push(`lacre ${row.codigo}: ${(error as Error).message}`);
    }
  }

  return total;
}

function syncCylinders(rows: FluxidCylinderRow[], conflitos: string[]): number {
  const upsert = db.prepare(`
    INSERT INTO cylinders (cylinder_code, serial_number, status)
    VALUES (?, ?, ?)
    ON CONFLICT (cylinder_code) DO UPDATE
      SET serial_number = excluded.serial_number, status = excluded.status, updated_at = CURRENT_TIMESTAMP
  `);
  let total = 0;

  for (const row of rows) {
    try {
      upsert.run(row.codigo, row.numero_serie, row.status);
      total++;
    } catch (error) {
      conflitos.push(`cilindro ${row.codigo}: ${(error as Error).message}`);
    }
  }

  return total;
}

// Vínculos com histórico: atualiza pelo id do FluxID; um vínculo ativo vindo
// do FluxID encerra o vínculo ativo local que o contradiz (RN04/RN05)
function syncBindings(
  table: "seal_assignments" | "cylinder_assignments",
  originColumn: "device_id" | "seal_code",
  targetColumn: "seal_code" | "cylinder_code",
  rows: FluxidBindingRow[],
  conflitos: string[]
): number {
  const byFluxid = db.prepare(`SELECT id FROM ${table} WHERE fluxid_id = ?`);
  const update = db.prepare(`
    UPDATE ${table} SET ended_at = ?, end_reason = ? WHERE fluxid_id = ?
  `);
  const endContradicting = db.prepare(`
    UPDATE ${table}
    SET ended_at = CURRENT_TIMESTAMP,
        end_reason = 'Encerrado pela sincronização: o FluxID registra outro vínculo ativo'
    WHERE ended_at IS NULL
      AND fluxid_id IS NOT ?
      AND (${originColumn} = ? OR ${targetColumn} = ?)
  `);
  const insert = db.prepare(`
    INSERT INTO ${table} (${originColumn}, ${targetColumn}, started_at, ended_at, end_reason, fluxid_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  let total = 0;

  // Encerrados primeiro, depois os ativos (do mais antigo ao mais novo)
  const ordered = [...rows].sort((a, b) =>
    Number(a.fim === null) - Number(b.fim === null) || a.inicio.localeCompare(b.inicio));

  for (const row of ordered) {
    try {
      if (byFluxid.get(row.id)) {
        update.run(row.fim, row.motivo, row.id);
      } else {
        if (row.fim === null) {
          endContradicting.run(row.id, row.origem, row.destino);
        }
        insert.run(row.origem, row.destino, row.inicio, row.fim, row.motivo, row.id);
      }
      total++;
    } catch (error) {
      conflitos.push(`${table} ${row.origem} → ${row.destino}: ${(error as Error).message}`);
    }
  }

  return total;
}

export async function syncCadastro(pool: Pool): Promise<CadastroResult> {
  const devices = await pool.query<FluxidDeviceRow>(
    "SELECT codigo, api_key_hash, ativo, versao_firmware FROM public.dispositivos ORDER BY codigo"
  );
  const seals = await pool.query<FluxidSealRow>(
    "SELECT codigo, uid_nfc, status FROM public.lacres ORDER BY codigo"
  );
  const cylinders = await pool.query<FluxidCylinderRow>(
    "SELECT codigo, numero_serie, status FROM public.cilindros ORDER BY codigo"
  );
  const deviceSeal = await pool.query<FluxidBindingRow>(`
    SELECT v.id::text AS id, d.codigo AS origem, l.codigo AS destino,
           ${utc("v.data_inicio")} AS inicio,
           CASE WHEN v.data_fim IS NULL THEN NULL ELSE ${utc("v.data_fim")} END AS fim,
           v.motivo_encerramento AS motivo
    FROM public.vinculos_dispositivo_lacre v
    JOIN public.dispositivos d ON d.id = v.dispositivo_id
    JOIN public.lacres l ON l.id = v.lacre_id
  `);
  const sealCylinder = await pool.query<FluxidBindingRow>(`
    SELECT v.id::text AS id, l.codigo AS origem, c.codigo AS destino,
           ${utc("v.data_inicio")} AS inicio,
           CASE WHEN v.data_fim IS NULL THEN NULL ELSE ${utc("v.data_fim")} END AS fim,
           v.motivo_encerramento AS motivo
    FROM public.vinculos_cilindro_lacre v
    JOIN public.lacres l ON l.id = v.lacre_id
    JOIN public.cilindros c ON c.id = v.cilindro_id
  `);

  const conflitos: string[] = [];

  // Tudo numa transação da Oxide: ou a cópia inteira é atualizada, ou nada
  const apply = db.transaction((): CadastroResult => ({
    dispositivos: syncDevices(devices.rows),
    lacres: syncSeals(seals.rows, conflitos),
    cilindros: syncCylinders(cylinders.rows, conflitos),
    vinculos_dispositivo_lacre: syncBindings(
      "seal_assignments", "device_id", "seal_code", deviceSeal.rows, conflitos),
    vinculos_lacre_cilindro: syncBindings(
      "cylinder_assignments", "seal_code", "cylinder_code", sealCylinder.rows, conflitos),
    conflitos
  }));

  return apply();
}
