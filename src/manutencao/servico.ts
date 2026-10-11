import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import path from "path";

// npm run servico — mantém tudo ligado: a API, o Worker e o vigia.
//   - Se um deles parar, é religado sozinho (esperando um pouco mais a cada
//     queda seguida, até 30 s).
//   - Uma vez por dia, na hora de BACKUP_HORA (padrão 03:00), faz o backup.
//   - A saída de cada um vai para a pasta logs/, um arquivo por dia.
//   npm run servico              liga tudo e fica rodando (Ctrl+C encerra)
//   npm run servico -- --parar   pede para o serviço que está rodando parar
//
// Para ligar junto com o computador, agende este comando no Agendador de
// Tarefas do Windows (ao iniciar) ou crie um serviço no systemd do Linux.

const PROJETO = path.resolve(__dirname, "..", "..");
const pasta = process.cwd();
const arquivoDeParada = path.resolve(pasta, "oxide-servico.parar");
const arquivoDeEstado = path.resolve(pasta, "oxide-servico.json");
const pastaDeLogs = path.resolve(pasta, "logs");

if (process.argv.includes("--parar")) {
  fs.writeFileSync(arquivoDeParada, new Date().toISOString(), "utf8");
  console.log("Pedido de parada registrado. O serviço encerra em até 2 segundos.");
  process.exit(0);
}

interface Parte { nome: string; script: string; filho?: ChildProcess; quedas: number; ligadaEm: number; religar?: NodeJS.Timeout }

const partes: Parte[] = [
  { nome: "api", script: "src/server.ts", quedas: 0, ligadaEm: 0 },
  { nome: "worker", script: "src/worker/index.ts", quedas: 0, ligadaEm: 0 },
  { nome: "vigia", script: "src/manutencao/vigia.ts", quedas: 0, ligadaEm: 0 }
];
let encerrando = false;

const hoje = (): string => new Date().toISOString().slice(0, 10);

function anotar(nome: string, texto: string): void {
  fs.mkdirSync(pastaDeLogs, { recursive: true });
  fs.appendFileSync(path.join(pastaDeLogs, `${nome}-${hoje()}.log`), texto, "utf8");
}

function aviso(texto: string): void {
  const linha = `${new Date().toISOString()} ${texto}`;
  console.log(linha);
  anotar("servico", `${linha}\n`);
}

function gravarEstado(): void {
  fs.writeFileSync(arquivoDeEstado, JSON.stringify({
    servico: process.pid, desde: new Date().toISOString(),
    partes: Object.fromEntries(partes.map(p => [p.nome, { pid: p.filho?.pid ?? null, quedas: p.quedas }]))
  }), "utf8");
}

// Lê o .env como a API lê, para as três partes receberem a mesma configuração
function argumentos(script: string): string[] {
  const args = ["--require", path.join(PROJETO, "node_modules", "ts-node", "register"), path.join(PROJETO, script)];
  return fs.existsSync(path.resolve(pasta, ".env")) ? ["--env-file=.env", ...args] : args;
}

function ligar(parte: Parte): void {
  if (encerrando) return;
  const filho = spawn(process.execPath, argumentos(parte.script), {
    cwd: pasta, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, TS_NODE_PROJECT: path.join(PROJETO, "tsconfig.json") }
  });
  parte.filho = filho;
  parte.ligadaEm = Date.now();
  filho.stdout?.on("data", dado => anotar(parte.nome, String(dado)));
  filho.stderr?.on("data", dado => anotar(parte.nome, String(dado)));
  aviso(`${parte.nome}: ligado (processo ${filho.pid})`);
  gravarEstado();

  filho.once("exit", codigo => {
    if (encerrando) return;
    // Ficou mais de 1 minuto no ar: a contagem de quedas seguidas recomeça
    parte.quedas = Date.now() - parte.ligadaEm > 60000 ? 1 : parte.quedas + 1;
    const espera = Math.min(30, 2 ** (parte.quedas - 1));
    aviso(`${parte.nome}: parou (código ${codigo}); religando em ${espera} s`);
    gravarEstado();
    parte.religar = setTimeout(() => ligar(parte), espera * 1000);
  });
}

// Backup diário, na hora marcada
const [horaDoBackup = 3, minutoDoBackup = 0] = (process.env.BACKUP_HORA ?? "03:00").split(":").map(Number);
let ultimoBackup = "";
function backupSeForHora(): void {
  const agora = new Date();
  if (agora.getHours() !== horaDoBackup || agora.getMinutes() !== minutoDoBackup || ultimoBackup === hoje()) return;
  ultimoBackup = hoje();
  const filho = spawn(process.execPath, argumentos("src/manutencao/backup.ts"), {
    cwd: pasta, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TS_NODE_PROJECT: path.join(PROJETO, "tsconfig.json") }
  });
  filho.stdout?.on("data", dado => anotar("backup", String(dado)));
  filho.stderr?.on("data", dado => anotar("backup", String(dado)));
  filho.once("exit", codigo => aviso(`backup diário: ${codigo === 0 ? "feito" : `falhou (código ${codigo})`}`));
}

function encerrar(motivo: string): void {
  if (encerrando) return;
  encerrando = true;
  aviso(`Serviço encerrando (${motivo})`);
  for (const parte of partes) {
    if (parte.religar) clearTimeout(parte.religar);
    parte.filho?.kill();
  }
  fs.rmSync(arquivoDeParada, { force: true });
  fs.rmSync(arquivoDeEstado, { force: true });
  setTimeout(() => process.exit(0), 500);
}

fs.rmSync(arquivoDeParada, { force: true });
aviso(`Serviço ligado na pasta ${pasta}; backup diário às ${String(horaDoBackup).padStart(2, "0")}:${String(minutoDoBackup).padStart(2, "0")}`);
for (const parte of partes) ligar(parte);

process.on("SIGINT", () => encerrar("Ctrl+C"));
process.on("SIGTERM", () => encerrar("pedido do sistema"));
setInterval(() => {
  if (fs.existsSync(arquivoDeParada)) encerrar("npm run servico -- --parar");
  else backupSeForHora();
}, 1000);
