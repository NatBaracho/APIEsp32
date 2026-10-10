import http from "http";
import { AddressInfo } from "net";

// Recebedor de teste: faz o papel da função de recebimento do Supabase,
// seguindo Doc/Contrato-Entrega-Supabase.md. Guarda tudo em memória. Usado
// pelo simulador e pela suíte; nunca fala com o Supabase de verdade.

export interface Recebedor {
  url: string;
  chave: string;
  mensagens: Map<string, Record<string, unknown>>;
  dispositivos: Array<{ device_id: string; api_key_hash: string | null; active: boolean; firmware_version?: string }>;
  comandos: Array<{ command_id: string; device_id: string; command_type: string; created_at?: string; confirmado?: string }>;
  // Liga e desliga falhas para os testes
  foraDoAr: boolean;
  recusar: (mensagem: Record<string, unknown>) => string | null;
  semResposta: Set<string>;
  chamadas: string[];
  fechar: () => Promise<void>;
}

export async function iniciarRecebedor(chave = "chave-de-teste-do-recebedor"): Promise<Recebedor> {
  const estado: Recebedor = {
    url: "",
    chave,
    mensagens: new Map(),
    dispositivos: [],
    comandos: [],
    foraDoAr: false,
    recusar: () => null,
    semResposta: new Set(),
    chamadas: [],
    fechar: async () => undefined
  };

  const servidor = http.createServer((req, res) => {
    const responder = (status: number, corpo: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(corpo));
    };
    let bruto = "";
    req.on("data", pedaco => { bruto += pedaco; });
    req.on("end", () => {
      if (estado.foraDoAr) return responder(503, { code: "UNAVAILABLE" });
      if (req.method !== "POST") return responder(405, { code: "METHOD_NOT_ALLOWED" });
      if (req.headers.authorization !== `Bearer ${estado.chave}`) return responder(401, { code: "AUTH_REQUIRED" });

      let corpo: Record<string, unknown>;
      try {
        corpo = JSON.parse(bruto);
      } catch {
        return responder(400, { code: "VALIDATION_FAILED" });
      }
      estado.chamadas.push(String(corpo.operation));

      switch (corpo.operation) {
        case "list_devices":
          return responder(200, { devices: estado.dispositivos });
        case "list_commands":
          return responder(200, { commands: estado.comandos.filter(c => !c.confirmado) });
        case "push_messages": {
          if (!Array.isArray(corpo.messages)) return responder(400, { code: "VALIDATION_FAILED" });
          const results: Array<Record<string, unknown>> = [];
          for (const m of corpo.messages as Array<Record<string, unknown>>) {
            const id = String(m.message_id);
            if (estado.semResposta.has(id)) continue;
            const motivo = estado.recusar(m);
            if (motivo) {
              results.push({ message_id: id, status: "rejected", error: motivo });
              continue;
            }
            const repetida = estado.mensagens.has(id);
            estado.mensagens.set(id, m);
            if (m.type === "CONFIRMACAO_COMANDO") {
              const comando = estado.comandos.find(c => c.command_id === m.command_id);
              if (comando) comando.confirmado = String(m.command_status);
            }
            results.push({ message_id: id, status: repetida ? "duplicate" : "stored" });
          }
          return responder(200, { results });
        }
        default:
          return responder(400, { code: "VALIDATION_FAILED" });
      }
    });
  });

  await new Promise<void>(resolve => servidor.listen(0, "127.0.0.1", resolve));
  estado.url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/functions/v1/iot-ingest`;
  estado.fechar = () => new Promise<void>(resolve => servidor.close(() => resolve()));
  return estado;
}
