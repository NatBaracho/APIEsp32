// Configuração do Worker, lida só do ambiente (arquivo .env, fora do git).
// A chave do Supabase nunca vai para documento, log ou resposta da API.

export interface WorkerConfig {
  destinoUrl: string;
  destinoKey: string;
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
  const destinoUrl = process.env.SUPABASE_IOT_URL?.trim();
  const destinoKey = process.env.SUPABASE_SERVICE_KEY?.trim();

  if (!destinoUrl || !destinoKey) {
    throw new Error(
      "SUPABASE_IOT_URL e SUPABASE_SERVICE_KEY não definidas. Copie .env.example para .env e preencha"
    );
  }

  return {
    destinoUrl,
    destinoKey,
    intervalSeconds: positiveInteger("WORKER_INTERVAL_SECONDS", 10),
    cadastroIntervalSeconds: positiveInteger("WORKER_CADASTRO_INTERVAL_SECONDS", 300),
    batchSize: positiveInteger("WORKER_BATCH_SIZE", 100)
  };
}
