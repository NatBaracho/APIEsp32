import { Pool } from "pg";
import db from "../database/connection";
import { abrirAlerta, ResultadoAlerta } from "./alertasAutomaticos";
import { distanciaDaRotaMetros, distanciaMetros, lerPontos } from "./geo";
import { limites } from "./limites";

// Regras que dependem do tempo ou do cadastro do FluxID. Rodam no Worker,
// a cada rodada, depois de enviar telemetrias e eventos (as posições já
// estão no FluxID) e antes de enviar os alertas.

export interface ResultadoRegras {
  alertas_criados: Record<string, number>;
  espelhados_do_fluxid: number;
  erros: string[];
}

function contar(resultado: ResultadoRegras, tipo: string, situacao: ResultadoAlerta): void {
  if (situacao === "criado") resultado.alertas_criados[tipo] = (resultado.alertas_criados[tipo] ?? 0) + 1;
}

// Sem contato (telemetria, evento ou busca de comandos) há mais que o limite
function semComunicacao(resultado: ResultadoRegras): void {
  const minutos = limites().semComunicacaoMinutos;
  const linhas = db.prepare(`
    SELECT device_id, last_contact_at FROM devices
    WHERE active = 1 AND last_contact_at IS NOT NULL AND last_contact_at < datetime('now', ?)
  `).all(`-${minutos} minutes`) as Array<{ device_id: string; last_contact_at: string }>;

  for (const linha of linhas) {
    contar(resultado, "SEM_COMUNICACAO", abrirAlerta(linha.device_id, "SEM_COMUNICACAO",
      `Último contato em ${linha.last_contact_at} (UTC); limite de ${minutos} minutos`));
  }
}

// Continua enviando telemetria, mas sem posição há mais que o limite
function gpsSemSinal(resultado: ResultadoRegras): void {
  const minutos = limites().gpsSemSinalMinutos;
  const linhas = db.prepare(`
    SELECT device_id, last_position_at FROM devices
    WHERE active = 1
      AND last_telemetry_at >= datetime('now', ?)
      AND (last_position_at IS NULL OR last_position_at < datetime('now', ?))
  `).all(`-${minutos} minutes`, `-${minutos} minutes`) as Array<{ device_id: string; last_position_at: string | null }>;

  for (const linha of linhas) {
    contar(resultado, "GPS_SEM_SINAL", abrirAlerta(linha.device_id, "GPS_SEM_SINAL",
      linha.last_position_at
        ? `Telemetria chegando sem posição; última posição em ${linha.last_position_at} (UTC)`
        : "Telemetria chegando sem posição; nenhuma posição recebida ainda"));
  }
}

function comandoSemResposta(resultado: ResultadoRegras): void {
  const minutos = limites().comandoSemRespostaMinutos;
  const linhas = db.prepare(`
    SELECT device_id, command_id, command_type, created_at FROM commands
    WHERE status = 'PENDENTE' AND created_at < datetime('now', ?)
    ORDER BY id
  `).all(`-${minutos} minutes`) as Array<{ device_id: string; command_id: string; command_type: string; created_at: string }>;

  for (const linha of linhas) {
    contar(resultado, "COMANDO_SEM_RESPOSTA", abrirAlerta(linha.device_id, "COMANDO_SEM_RESPOSTA",
      `Comando ${linha.command_id} (${linha.command_type}) pendente desde ${linha.created_at} (UTC)`));
  }
}

// Cilindro com o cliente (custódia aberta) cuja última posição, depois do
// início da custódia, está fora do raio do local de entrega
async function saidaGeocerca(pool: Pool, resultado: ResultadoRegras): Promise<void> {
  const linhas = await pool.query<{
    dispositivo: string; cilindro: string; local: string; raio: number;
    latitude: string; longitude: string; tlat: string; tlon: string; data_coleta: Date;
  }>(`
    SELECT d.codigo AS dispositivo, c.codigo AS cilindro, le.nome AS local, le.raio_geocerca_metros AS raio,
           le.latitude, le.longitude, t.latitude AS tlat, t.longitude AS tlon, t.data_coleta
    FROM public.custodias cu
    JOIN public.cilindros c ON c.id = cu.cilindro_id
    JOIN public.locais_entrega le ON le.id = cu.local_entrega_id
    JOIN LATERAL (
      SELECT * FROM public.telemetrias t
      WHERE t.cilindro_id = c.id AND t.data_coleta >= cu.data_inicio
      ORDER BY t.data_coleta DESC LIMIT 1
    ) t ON true
    JOIN public.dispositivos d ON d.id = t.dispositivo_id
    WHERE cu.data_fim IS NULL`);

  for (const l of linhas.rows) {
    const distancia = distanciaMetros(
      { latitude: Number(l.latitude), longitude: Number(l.longitude) },
      { latitude: Number(l.tlat), longitude: Number(l.tlon) });
    if (distancia > l.raio) {
      contar(resultado, "SAIDA_GEOCERCA", abrirAlerta(l.dispositivo, "SAIDA_GEOCERCA",
        `Cilindro ${l.cilindro} a ${Math.round(distancia)} m de "${l.local}" (raio ${l.raio} m) em ${l.data_coleta.toISOString()}`));
    }
  }
}

// Entrega EM_ANDAMENTO com rota: última posição do cilindro, depois da
// saída, mais longe da linha da rota que a margem, fora de um desvio
// programado ou justificado
async function saidaRota(pool: Pool, resultado: ResultadoRegras): Promise<void> {
  const linhas = await pool.query<{
    dispositivo: string; cilindro: string; entrega: string; pontos: unknown; margem: number;
    tlat: string; tlon: string; data_coleta: Date;
  }>(`
    SELECT d.codigo AS dispositivo, c.codigo AS cilindro, e.codigo AS entrega, r.pontos, r.margem_metros AS margem,
           t.latitude AS tlat, t.longitude AS tlon, t.data_coleta
    FROM public.entregas e
    JOIN public.rotas_entrega r ON r.entrega_id = e.id
    JOIN public.entrega_itens ei ON ei.entrega_id = e.id
    JOIN public.cilindros c ON c.id = ei.cilindro_id
    JOIN LATERAL (
      SELECT * FROM public.telemetrias t
      WHERE t.cilindro_id = c.id AND t.data_coleta >= COALESCE(e.data_saida, r.criado_em)
      ORDER BY t.data_coleta DESC LIMIT 1
    ) t ON true
    JOIN public.dispositivos d ON d.id = t.dispositivo_id
    WHERE e.status = 'EM_ANDAMENTO'
      AND NOT EXISTS (
        SELECT 1 FROM public.desvios_rota dr
        WHERE dr.entrega_id = e.id AND t.data_coleta BETWEEN dr.inicio AND dr.fim)`);

  for (const l of linhas.rows) {
    const pontos = lerPontos(l.pontos);
    if (!pontos) {
      resultado.erros.push(`rota da entrega ${l.entrega} com pontos inválidos`);
      continue;
    }
    const distancia = distanciaDaRotaMetros({ latitude: Number(l.tlat), longitude: Number(l.tlon) }, pontos);
    if (distancia > l.margem) {
      contar(resultado, "SAIDA_ROTA", abrirAlerta(l.dispositivo, "SAIDA_ROTA",
        `Cilindro ${l.cilindro} a ${Math.round(distancia)} m da rota da entrega ${l.entrega} (margem ${l.margem} m) em ${l.data_coleta.toISOString()}`));
    }
  }
}

// Decisão D5: análise e encerramento feitos pelo frontend valem também na
// Oxide (sem reenviar ao FluxID), para a regra de não repetir alerta aberto
async function espelharTratamento(pool: Pool, resultado: ResultadoRegras): Promise<void> {
  const abertos = db.prepare("SELECT alert_id FROM alerts WHERE status <> 'ENCERRADO'").all() as Array<{ alert_id: string }>;
  if (abertos.length === 0) return;

  const tratados = await pool.query<{
    codigo: string; status: string; encerrado_em: Date | null; encerrado_por_nome: string | null; motivo_encerramento: string | null;
  }>(`
    SELECT codigo, status, encerrado_em, encerrado_por_nome, motivo_encerramento
    FROM public.alertas WHERE tratado_no_fluxid AND codigo = ANY($1)`,
    [abertos.map(a => a.alert_id)]);

  const atualizar = db.prepare(`
    UPDATE alerts SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?
    WHERE alert_id = ? AND status <> 'ENCERRADO'
  `);
  for (const t of tratados.rows) {
    const encerrado = t.encerrado_em ? t.encerrado_em.toISOString().replace("T", " ").slice(0, 19) : null;
    resultado.espelhados_do_fluxid += atualizar.run(t.status, encerrado, t.encerrado_por_nome, t.motivo_encerramento, t.codigo).changes;
  }
}

export async function aplicarRegrasPeriodicas(pool: Pool): Promise<ResultadoRegras> {
  const resultado: ResultadoRegras = { alertas_criados: {}, espelhados_do_fluxid: 0, erros: [] };
  const passos: Array<[string, () => void | Promise<void>]> = [
    ["espelhar tratamento", () => espelharTratamento(pool, resultado)],
    ["sem comunicação", () => semComunicacao(resultado)],
    ["GPS sem sinal", () => gpsSemSinal(resultado)],
    ["comando sem resposta", () => comandoSemResposta(resultado)],
    ["geocerca", () => saidaGeocerca(pool, resultado)],
    ["rota", () => saidaRota(pool, resultado)]
  ];

  for (const [nome, passo] of passos) {
    try {
      await passo();
    } catch (erro) {
      resultado.erros.push(`${nome}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }
  return resultado;
}
