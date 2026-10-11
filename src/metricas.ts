import fs from "fs";
import path from "path";
import { NextFunction, Request, Response } from "express";
import { CommandRepository } from "./repositories/CommandRepository";
import { MessageRepository } from "./repositories/MessageRepository";
import { lerUltimaRodada } from "./worker/runner";

// GET /metrics: números de funcionamento da API desde que foi ligada
// (pedidos, respostas e tempos) e a situação atual da fila e do banco.
// Os contadores ficam na memória e zeram quando a API reinicia.

const TEMPOS_GUARDADOS = 5000;

const ligadaEm = new Date();
const porRota = new Map<string, { total: number; somaMs: number; maxMs: number }>();
const porResposta = new Map<number, number>();
const tempos: number[] = [];
let proximo = 0;
let pedidos = 0;

// Conta cada pedido pela rota declarada (sem os códigos dos dispositivos)
export function contarPedidos(req: Request, res: Response, next: NextFunction): void {
  const inicio = process.hrtime.bigint();

  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    const caminho = req.route ? `${req.baseUrl}${req.route.path}` : "(rota inexistente)";
    const chave = `${req.method} ${caminho}`;
    const rota = porRota.get(chave) ?? { total: 0, somaMs: 0, maxMs: 0 };
    rota.total++;
    rota.somaMs += ms;
    rota.maxMs = Math.max(rota.maxMs, ms);
    porRota.set(chave, rota);
    porResposta.set(res.statusCode, (porResposta.get(res.statusCode) ?? 0) + 1);
    tempos[proximo] = ms;
    proximo = (proximo + 1) % TEMPOS_GUARDADOS;
    pedidos++;
  });

  next();
}

const tamanho = (arquivo: string): number => {
  try { return fs.statSync(arquivo).size; } catch { return 0; }
};

export function metricas(): Record<string, unknown> {
  const ordenados = [...tempos].sort((a, b) => a - b);
  const percentil = (p: number): number => Number((ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * p))] ?? 0).toFixed(1));
  const classe = (inicio: number): number => [...porResposta].filter(([status]) => status >= inicio && status < inicio + 100).reduce((n, [, total]) => n + total, 0);
  const banco = path.resolve(process.cwd(), "oxide.db");
  const mensagens = new MessageRepository();
  const rodada = lerUltimaRodada();

  return {
    ligada_em: ligadaEm.toISOString(),
    ligada_ha_segundos: Math.round(process.uptime()),
    pedidos: {
      total: pedidos,
      respostas_2xx: classe(200),
      respostas_4xx: classe(400),
      respostas_5xx: classe(500),
      recusados_por_limite_429: porResposta.get(429) ?? 0,
      por_resposta: Object.fromEntries([...porResposta].sort((a, b) => a[0] - b[0])),
      por_rota: [...porRota].sort((a, b) => b[1].total - a[1].total).map(([rota, r]) => ({
        rota, total: r.total, media_ms: Number((r.somaMs / r.total).toFixed(1)), mais_lenta_ms: Number(r.maxMs.toFixed(1))
      }))
    },
    // Dos últimos pedidos (até 5.000)
    tempo_de_resposta_ms: { metade_ate: percentil(0.5), p95: percentil(0.95), p99: percentil(0.99), mais_lenta: Number((ordenados[ordenados.length - 1] ?? 0).toFixed(1)) },
    fila: { ...mensagens.counts(), mais_antiga_esperando_segundos: mensagens.oldestWaitingSeconds() },
    comandos_pendentes: new CommandRepository().countPending(),
    banco: { arquivo_bytes: tamanho(banco), wal_bytes: tamanho(`${banco}-wal`) },
    memoria_mb: Number((process.memoryUsage().rss / 1048576).toFixed(1)),
    worker: rodada ? { ultima_rodada: rodada.em, resultado: rodada.resultado.status } : { ultima_rodada: null, resultado: null }
  };
}

// O mesmo conteúdo no formato de texto do Prometheus (GET /metrics?formato=prometheus)
export function metricasEmTexto(): string {
  const m = metricas() as any;
  const linhas: string[] = [];
  const medida = (nome: string, valor: number, rotulos = ""): void => { linhas.push(`oxide_${nome}${rotulos} ${valor}`); };

  medida("ligada_ha_segundos", m.ligada_ha_segundos);
  medida("pedidos_total", m.pedidos.total);
  for (const [status, total] of Object.entries<number>(m.pedidos.por_resposta)) medida("respostas_total", total, `{status="${status}"}`);
  for (const [nome, valor] of Object.entries<number>(m.tempo_de_resposta_ms)) medida("tempo_de_resposta_ms", valor, `{medida="${nome}"}`);
  for (const [nome, valor] of Object.entries<number>(m.fila)) medida("fila", valor, `{situacao="${nome}"}`);
  medida("comandos_pendentes", m.comandos_pendentes);
  medida("banco_bytes", m.banco.arquivo_bytes);
  medida("banco_wal_bytes", m.banco.wal_bytes);
  medida("memoria_mb", m.memoria_mb);
  return `${linhas.join("\n")}\n`;
}
