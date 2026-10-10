import { loadWorkerConfig } from "./config";
import { resetInterrupted, runCycle } from "./runner";

// Worker Oxide → banco principal (Supabase).
//   npm run worker            roda sem parar (Ctrl+C encerra)
//   npm run worker -- --once  faz uma rodada completa e sai
// Configuração: arquivo .env (modelo em .env.example).

const once = process.argv.includes("--once");

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  let stopping = false;
  let lastCadastro = 0;

  const stop = (): void => {
    stopping = true;
    console.log("Encerrando o Worker ao fim da rodada atual...");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const interrupted = resetInterrupted();
  if (interrupted > 0) {
    console.log(`${interrupted} mensagem(ns) interrompidas voltaram para a fila`);
  }

  console.log(
    once
      ? "Worker: uma rodada"
      : `Worker: rodada a cada ${config.intervalSeconds}s; cadastro a cada ${config.cadastroIntervalSeconds}s`
  );

  do {
    const withCadastro = Date.now() - lastCadastro >= config.cadastroIntervalSeconds * 1000;
    const result = await runCycle(config, { withCadastro });

    if (withCadastro && result.status !== "FALHOU") {
      lastCadastro = Date.now();
    }

    console.log(new Date().toISOString(), JSON.stringify(result));

    if (once || stopping) {
      break;
    }

    await new Promise(resolve => setTimeout(resolve, config.intervalSeconds * 1000));
  } while (!stopping);
}

main().catch(error => {
  console.error("Worker parou:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
