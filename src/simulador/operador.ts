import { randomBytes } from "crypto";
import fs from "fs";
import { Pool, PoolClient } from "pg";
import { hashApiKey } from "../utils/apiKeyHash";

// Ações do operador do sistema, feitas direto no FluxID — exatamente o que a
// API do frontend fará quando existir (Doc/Contrato-API-Frontend.md).

export interface Conjunto {
  linha: number;
  cilindro: { id: string; codigo: string; serie: string };
  lacre: { id: string; codigo: string };
  dispositivo: { id: string; codigo: string; chave: string };
  vinculado: boolean;
}

export interface Cadastro {
  organizacaoId: string;
  usuarioId: string;
  clienteId: string;
  localId: string;
  local: { latitude: number; longitude: number; raio: number };
  entregaId: string;
  entregaCodigo: string;
  principal: Conjunto;
}

// Posição do cliente (endereço de entrega) usada na simulação
export const CLIENTE = { latitude: -7.2091939, longitude: -39.3063666, raio: 10 };

const umaHoraAtras = "now() - interval '1 hour'";

async function inserir(client: PoolClient, sql: string, valores: unknown[]): Promise<string> {
  const resultado = await client.query<{ id: string }>(`${sql} RETURNING id`, valores);
  const id = resultado.rows[0]?.id;
  if (!id) throw new Error("inserção sem id");
  return id;
}

export function novaChave(): string {
  return `key-sim-${randomBytes(12).toString("hex")}`;
}

// Cilindro + lacre + dispositivo (com chave gerada; o FluxID guarda só o
// hash) e, se pedido, os vínculos dispositivo ↔ lacre ↔ cilindro
async function criarConjunto(
  client: PoolClient,
  organizacaoId: string,
  rodada: string,
  linha: number,
  dados: { serie: string; tipo: string; capacidade: number; nfc: string; hardware: string; vincular: boolean }
): Promise<Conjunto> {
  const sufixo = String(linha).padStart(2, "0");
  const chave = novaChave();
  const cilindroCodigo = `CIL-S${rodada}-${sufixo}`;
  const lacreCodigo = `LCR-S${rodada}-${sufixo}`;
  const dispositivoCodigo = `DSP-S${rodada}-${sufixo}`;

  const cilindroId = await inserir(client,
    `INSERT INTO cilindros (organizacao_id, codigo, numero_serie, tipo, capacidade_litros, status)
     VALUES ($1, $2, $3, $4, $5, 'DISPONIVEL')`,
    [organizacaoId, cilindroCodigo, dados.serie, dados.tipo, dados.capacidade]);
  const lacreId = await inserir(client,
    `INSERT INTO lacres (organizacao_id, codigo, uid_nfc, data_fabricacao, proxima_revisao, status)
     VALUES ($1, $2, $3, current_date, current_date + interval '5 years', 'EM_ESTOQUE')`,
    [organizacaoId, lacreCodigo, dados.nfc]);
  const dispositivoId = await inserir(client,
    `INSERT INTO dispositivos (organizacao_id, codigo, identificador_hardware, versao_firmware, modelo, ativo, api_key_hash)
     VALUES ($1, $2, $3, '1.0.0', 'ESP32 simulado', true, $4)`,
    [organizacaoId, dispositivoCodigo, dados.hardware, hashApiKey(chave)]);

  if (dados.vincular) {
    await client.query(
      `INSERT INTO vinculos_dispositivo_lacre (dispositivo_id, lacre_id, data_inicio) VALUES ($1, $2, ${umaHoraAtras})`,
      [dispositivoId, lacreId]);
    await client.query(
      `INSERT INTO vinculos_cilindro_lacre (cilindro_id, lacre_id, data_inicio) VALUES ($1, $2, ${umaHoraAtras})`,
      [cilindroId, lacreId]);
    await client.query("UPDATE lacres SET status = 'INSTALADO' WHERE id = $1", [lacreId]);
  }

  return {
    linha,
    cilindro: { id: cilindroId, codigo: cilindroCodigo, serie: dados.serie },
    lacre: { id: lacreId, codigo: lacreCodigo },
    dispositivo: { id: dispositivoId, codigo: dispositivoCodigo, chave },
    vinculado: dados.vincular
  };
}

async function emTransacao<T>(pool: Pool, trabalho: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await trabalho(client);
    await client.query("COMMIT");
    return resultado;
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw erro;
  } finally {
    client.release();
  }
}

// Cadastro unitário: empresa, operador, cliente com endereço (geocerca de
// 10 m), um conjunto completo e a entrega (rota) até o endereço do cliente
export async function cadastroUnitario(pool: Pool, rodada: string): Promise<Cadastro> {
  return emTransacao(pool, async client => {
    const organizacaoId = await inserir(client,
      `INSERT INTO organizacoes (codigo, razao_social, nome_fantasia, cnpj, email, status)
       VALUES ($1, $2, $3, $4, $5, 'ATIVA')`,
      [`ORG-S${rodada}`, `Simulação ${rodada} Gases Ltda`, `Simulação ${rodada}`, `S${Date.now()}`, `simulacao-${rodada.toLowerCase()}@fluxid.teste`]);
    const usuarioId = await inserir(client,
      `INSERT INTO usuarios (organizacao_id, codigo, nome, email, senha_hash, ativo)
       VALUES ($1, $2, $3, $4, 'SEM_LOGIN_SIMULACAO', true)`,
      [organizacaoId, `USR-S${rodada}`, `Operador da simulação ${rodada}`, `operador-${rodada.toLowerCase()}@fluxid.teste`]);
    const clienteId = await inserir(client,
      `INSERT INTO destinatarios (organizacao_id, codigo, razao_social, nome_fantasia, email)
       VALUES ($1, $2, $3, $4, $5)`,
      [organizacaoId, `CLI-S${rodada}`, `Hospital Simulação ${rodada}`, "Hospital Simulação", `cliente-${rodada.toLowerCase()}@fluxid.teste`]);
    const localId = await inserir(client,
      `INSERT INTO locais_entrega (destinatario_id, codigo, nome, endereco, numero, bairro, cidade, estado, cep, latitude, longitude, raio_geocerca_metros)
       VALUES ($1, $2, 'Almoxarifado central', 'Rua da Simulação', '100', 'Centro', 'Juazeiro do Norte', 'CE', '63000-000', $3, $4, $5)`,
      [clienteId, `LOC-S${rodada}`, CLIENTE.latitude, CLIENTE.longitude, CLIENTE.raio]);

    const principal = await criarConjunto(client, organizacaoId, rodada, 0, {
      serie: `SN-S${rodada}-00`, tipo: "OXIGENIO", capacidade: 50,
      nfc: `NFC-S${rodada}-00`, hardware: `HW-S${rodada}-00`, vincular: true
    });

    const entregaCodigo = `ENT-S${rodada}`;
    const entregaId = await inserir(client,
      `INSERT INTO entregas (organizacao_id, local_entrega_id, codigo, status, data_prevista, responsavel_id, observacao)
       VALUES ($1, $2, $3, 'PENDENTE', now() + interval '2 hours', $4, 'Rota da simulação até o endereço do cliente')`,
      [organizacaoId, localId, entregaCodigo, usuarioId]);
    await client.query("INSERT INTO entrega_itens (entrega_id, cilindro_id) VALUES ($1, $2)", [entregaId, principal.cilindro.id]);

    return { organizacaoId, usuarioId, clienteId, localId, local: CLIENTE, entregaId, entregaCodigo, principal };
  });
}

export interface LinhaCsv {
  serie: string; tipo: string; capacidade: number; nfc: string; hardware: string; vincular: boolean;
}

// O CSV de exemplo tem valores fixos; o código da rodada é acrescentado ao
// UID NFC e ao hardware (únicos no banco todo) para a simulação poder repetir
export function lerCsv(arquivo: string, rodada: string): LinhaCsv[] {
  const linhas = fs.readFileSync(arquivo, "utf8").split(/\r?\n/).filter(l => l.trim() !== "");
  const [cabecalho, ...dados] = linhas;
  const colunas = (cabecalho ?? "").split(";");
  const pos = (nome: string): number => {
    const i = colunas.indexOf(nome);
    if (i < 0) throw new Error(`coluna ${nome} ausente no CSV`);
    return i;
  };

  return dados.map(linha => {
    const v = linha.split(";");
    return {
      serie: v[pos("cilindro_serie")] ?? "",
      tipo: v[pos("cilindro_tipo")] ?? "",
      capacidade: Number(v[pos("capacidade_litros")]),
      nfc: `${v[pos("lacre_uid_nfc")]}-${rodada}`,
      hardware: `${v[pos("dispositivo_hardware")]}-${rodada}`,
      vincular: (v[pos("vincular")] ?? "").trim().toLowerCase() === "sim"
    };
  });
}

// Cadastro em massa numa transação: ou entra a planilha inteira, ou nada
export async function cadastroEmMassa(pool: Pool, cadastro: Cadastro, rodada: string, linhas: LinhaCsv[]): Promise<Conjunto[]> {
  return emTransacao(pool, async client => {
    const conjuntos: Conjunto[] = [];
    for (const [i, linha] of linhas.entries()) {
      conjuntos.push(await criarConjunto(client, cadastro.organizacaoId, rodada, i + 1, linha));
    }
    return conjuntos;
  });
}

// Tenta uma ação que o banco deve recusar; devolve a mensagem de erro (ou null)
export async function tentar(pool: Pool, sql: string, valores: unknown[]): Promise<string | null> {
  try {
    await emTransacao(pool, client => client.query(sql, valores));
    return null;
  } catch (erro) {
    return (erro as Error).message;
  }
}

export async function reimportarMassa(pool: Pool, cadastro: Cadastro, rodada: string, linhas: LinhaCsv[]): Promise<string | null> {
  try {
    await emTransacao(pool, async client => {
      for (const [i, linha] of linhas.entries()) {
        await criarConjunto(client, cadastro.organizacaoId, `${rodada}R`, i + 1, linha);
      }
    });
    return null;
  } catch (erro) {
    return (erro as Error).message;
  }
}

// Saída da entrega (cilindro em trânsito) e chegada (cilindro com o
// cliente e custódia no endereço)
export async function iniciarEntrega(pool: Pool, cadastro: Cadastro): Promise<void> {
  await emTransacao(pool, async client => {
    await client.query("UPDATE entregas SET status = 'EM_ANDAMENTO', data_saida = now() WHERE id = $1", [cadastro.entregaId]);
    await client.query("UPDATE cilindros SET status = 'EM_TRANSITO', atualizado_em = now() WHERE id = $1", [cadastro.principal.cilindro.id]);
  });
}

export async function concluirEntrega(pool: Pool, cadastro: Cadastro): Promise<void> {
  await emTransacao(pool, async client => {
    await client.query("UPDATE entregas SET status = 'CONCLUIDA', data_entrega = now() WHERE id = $1", [cadastro.entregaId]);
    await client.query("UPDATE cilindros SET status = 'COM_CLIENTE', atualizado_em = now() WHERE id = $1", [cadastro.principal.cilindro.id]);
    await client.query(
      "INSERT INTO custodias (cilindro_id, local_entrega_id, data_inicio, observacao) VALUES ($1, $2, now(), 'Entrega da simulação')",
      [cadastro.principal.cilindro.id, cadastro.localId]);
  });
}

// Distância em metros entre dois pontos (fórmula de haversine)
export function distanciaMetros(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const r = 6371000;
  const rad = (g: number): number => (g * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
