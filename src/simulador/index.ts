import { prepararAmbiente, validarFluxid } from "./ambiente";

// Simulação completa de um lacre: npm run simular
// Roda numa pasta temporária, com um oxide.db novo e a própria API numa
// porta separada, contra o FluxID de análise no Docker.

async function main(): Promise<void> {
  const projeto = process.cwd();
  const fluxidUrl = validarFluxid(process.env.FLUXID_DATABASE_URL);
  const porta = Number(process.env.SIMULADOR_PORTA ?? 3199);
  const ambiente = prepararAmbiente(projeto, porta, fluxidUrl);

  // A API e o Worker abrem o oxide.db da pasta atual: a partir daqui, a da simulação
  process.chdir(ambiente.pasta);
  process.env.PORT = String(porta);

  // Carregado só agora, para usar o oxide.db da simulação
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { executar } = require("./executar") as { executar: (a: typeof ambiente, p: string) => Promise<number> };
  process.exitCode = await executar(ambiente, projeto);
}

main().catch(erro => {
  console.error("A simulação não pôde rodar:", erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
