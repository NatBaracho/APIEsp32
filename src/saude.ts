import db from "./database/connection";
import { fluxid } from "./app/base";

// GET /health: responde 200 quando a Oxide responde e o FluxID (se
// configurado) também; o Worker é informado, sem derrubar a saúde da API.
// Nunca mostra endereço, usuário ou senha do banco

export interface Saude {
  status: "OK" | "DEGRADADO";
  hora: string;
  ligada_ha_segundos: number;
  oxide: { status: "OK" | "FALHOU"; filas?: Record<string, number> };
  fluxid: { status: "OK" | "FALHOU" | "NAO_CONFIGURADO" };
  worker: { ultima_rodada: string | null; resultado: string | null; atrasado: boolean };
}

export async function saude(): Promise<Saude> {
  const resultado: Saude = {
    status: "OK",
    hora: new Date().toISOString(),
    ligada_ha_segundos: Math.round(process.uptime()),
    oxide: { status: "OK" },
    fluxid: { status: "NAO_CONFIGURADO" },
    worker: { ultima_rodada: null, resultado: null, atrasado: false }
  };

  try {
    const contar = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
    resultado.oxide.filas = {
      telemetria_pendente: contar("SELECT count(*) AS n FROM telemetry_queue WHERE COALESCE(status, 'PENDING') <> 'SYNCED'"),
      eventos_pendentes: contar("SELECT count(*) AS n FROM events WHERE COALESCE(status, 'PENDING') <> 'SYNCED'"),
      alertas_pendentes: contar("SELECT count(*) AS n FROM alerts WHERE sync_status <> 'SYNCED'"),
      comandos_pendentes: contar("SELECT count(*) AS n FROM commands WHERE status = 'PENDENTE'")
    };
    const rodada = db.prepare("SELECT started_at, status FROM sync_logs ORDER BY id DESC LIMIT 1").get() as
      { started_at: string; status: string } | undefined;
    if (rodada) {
      resultado.worker = {
        ultima_rodada: rodada.started_at,
        resultado: rodada.status,
        // Sem rodada há mais de 5 minutos (intervalo padrão: 10 s)
        atrasado: Date.parse(`${rodada.started_at.replace(" ", "T")}Z`) < Date.now() - 5 * 60000
      };
    }
  } catch {
    resultado.oxide = { status: "FALHOU" };
    resultado.status = "DEGRADADO";
  }

  const banco = fluxid();
  if (banco) {
    try {
      await banco.query("SELECT 1");
      resultado.fluxid.status = "OK";
    } catch {
      resultado.fluxid.status = "FALHOU";
      resultado.status = "DEGRADADO";
    }
  }

  return resultado;
}
