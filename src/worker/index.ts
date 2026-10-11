import { loadWorkerConfig } from "./config";
import { MAX_LOTES_POR_RODADA, resetInterrupted, runCycle } from "./runner";

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

    // Fila acumulada (por exemplo, depois de uma queda do banco principal):
    // a rodada enviou tudo o que podia, então a próxima começa em seguida
    const filaAcumulada = result.status === "OK" && result.enviadas >= config.batchSize * MAX_LOTES_POR_RODADA;
    if (!filaAcumulada) {
      await new Promise(resolve => setTimeout(resolve, config.intervalSeconds * 1000));
    }
  } while (!stopping);
}

main().catch(error => {
  console.error("Worker parou:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
