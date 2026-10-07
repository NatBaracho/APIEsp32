// Configuração do Worker, lida só do ambiente (arquivo .env, fora do git).
// A URL do FluxID contém a senha do banco: nunca registrá-la em documento.

export interface WorkerConfig {
  fluxidDatabaseUrl: string;
  intervalSeconds: number;
  cadastroIntervalSeconds: number;
  batchSize: number;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} deve ser um inteiro maior que zero`);
  }

  return value;
}

export function loadWorkerConfig(): WorkerConfig {
  const fluxidDatabaseUrl = process.env.FLUXID_DATABASE_URL?.trim();

  if (!fluxidDatabaseUrl) {
    throw new Error(
      "FLUXID_DATABASE_URL não definida. Copie .env.example para .env e preencha a conexão do FluxID"
    );
  }

  return {
    fluxidDatabaseUrl,
    intervalSeconds: positiveInteger("WORKER_INTERVAL_SECONDS", 10),
    cadastroIntervalSeconds: positiveInteger("WORKER_CADASTRO_INTERVAL_SECONDS", 300),
    batchSize: positiveInteger("WORKER_BATCH_SIZE", 100)
  };
}
