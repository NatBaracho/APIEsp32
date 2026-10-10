import { WorkerConfig } from "./config";

// Conversa com o banco principal (Supabase) pela função de recebimento.
// Contrato em Doc/Contrato-Entrega-Supabase.md. Toda chamada é um POST na
// mesma URL, com { operation, ... } no corpo e a chave no cabeçalho.

// Destino fora do ar, rede, chave recusada ou limite: nada foi gravado, a
// rodada para e nenhuma tentativa é gasta
export class DestinoIndisponivel extends Error {}

// O destino respondeu que o pedido inteiro é inválido (ex.: 400)
export class PedidoRecusado extends Error {}

export interface ResultadoMensagem {
  message_id: string;
  status: "stored" | "duplicate" | "rejected";
  error?: string;
}

export interface DispositivoPrincipal {
  device_id: string;
  api_key_hash: string | null;
  active: boolean;
  firmware_version?: string | null;
}

export interface ComandoPrincipal {
  command_id: string;
  device_id: string;
  command_type: string;
  created_at?: string | null;
}

const TEMPO_LIMITE_MS = 15000;
const SEM_GASTAR_TENTATIVA = new Set([401, 403, 404, 408, 429]);

async function chamar(config: WorkerConfig, operation: string, dados: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  let resposta: Response;

  try {
    resposta = await fetch(config.destinoUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.destinoKey}`,
        apikey: config.destinoKey
      },
      body: JSON.stringify({ operation, ...dados }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS)
    });
  } catch (erro) {
    const causa = (erro as { cause?: { code?: string } }).cause?.code ?? (erro instanceof Error ? erro.name : "erro de rede");
    throw new DestinoIndisponivel(`banco principal inacessível (${causa})`);
  }

  if (resposta.status >= 500 || SEM_GASTAR_TENTATIVA.has(resposta.status)) {
    throw new DestinoIndisponivel(`banco principal respondeu HTTP ${resposta.status} em ${operation}`);
  }

  const corpo = await resposta.json().catch(() => null) as Record<string, unknown> | null;

  if (!resposta.ok) {
    const detalhe = typeof corpo?.code === "string" ? corpo.code : typeof corpo?.message === "string" ? corpo.message : "";
    throw new PedidoRecusado(`HTTP ${resposta.status} em ${operation}${detalhe ? `: ${detalhe}` : ""}`);
  }
  if (!corpo || typeof corpo !== "object") {
    throw new PedidoRecusado(`resposta sem JSON em ${operation}`);
  }

  return corpo;
}

export async function enviarMensagens(config: WorkerConfig, mensagens: Array<Record<string, unknown>>): Promise<Map<string, ResultadoMensagem>> {
  const corpo = await chamar(config, "push_messages", { messages: mensagens });
  const resultados = new Map<string, ResultadoMensagem>();

  if (!Array.isArray(corpo.results)) {
    throw new PedidoRecusado("resposta de push_messages sem a lista results");
  }

  for (const item of corpo.results as Array<Record<string, unknown>>) {
    if (typeof item?.message_id !== "string") continue;
    const status = item.status === "stored" || item.status === "duplicate" || item.status === "rejected" ? item.status : null;
    if (!status) continue;
    resultados.set(item.message_id, {
      message_id: item.message_id,
      status,
      ...(typeof item.error === "string" ? { error: item.error } : {})
    });
  }

  return resultados;
}

export async function listarDispositivos(config: WorkerConfig): Promise<DispositivoPrincipal[]> {
  const corpo = await chamar(config, "list_devices");
  if (!Array.isArray(corpo.devices)) {
    throw new PedidoRecusado("resposta de list_devices sem a lista devices");
  }
  return (corpo.devices as Array<Record<string, unknown>>)
    .filter(d => typeof d?.device_id === "string" && d.device_id.trim() !== "")
    .map(d => ({
      device_id: (d.device_id as string).trim(),
      api_key_hash: typeof d.api_key_hash === "string" && /^[0-9a-f]{64}$/i.test(d.api_key_hash) ? d.api_key_hash.toLowerCase() : null,
      active: d.active !== false,
      firmware_version: typeof d.firmware_version === "string" ? d.firmware_version : null
    }));
}

export async function listarComandos(config: WorkerConfig): Promise<ComandoPrincipal[]> {
  const corpo = await chamar(config, "list_commands");
  if (!Array.isArray(corpo.commands)) {
    throw new PedidoRecusado("resposta de list_commands sem a lista commands");
  }
  return (corpo.commands as Array<Record<string, unknown>>)
    .filter(c => typeof c?.command_id === "string" && typeof c?.device_id === "string" && typeof c?.command_type === "string")
    .map(c => ({
      command_id: String(c.command_id),
      device_id: c.device_id as string,
      command_type: c.command_type as string,
      created_at: typeof c.created_at === "string" ? c.created_at : null
    }));
}
