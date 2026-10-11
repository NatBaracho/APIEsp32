import { alertTypes } from "../models/Alert";

// Especificação da API do lacre (Swagger em /api-docs)

const jsonBody = (properties: object, required: string[], example: object) => ({
  required: true,
  content: {
    "application/json": {
      schema: { type: "object", required, properties },
      example
    }
  }
});

const resposta = (description: string, example?: object) => ({
  description,
  ...(example ? { content: { "application/json": { example } } } : {})
});

// Campos que toda mensagem do lacre leva
const leitura = {
  device_id: { type: "string", example: "DSP-000001", description: "Código do dispositivo cadastrado" },
  latitude: { type: "number", minimum: -90, maximum: 90, example: -7.2091939 },
  longitude: { type: "number", minimum: -180, maximum: 180, example: -39.3063666 },
  gps_ok: { type: "boolean", default: true, description: "false = sem sinal de GPS; latitude e longitude são a última posição conhecida" },
  battery_percent: { type: "number", minimum: 0, maximum: 100, example: 87 },
  seal_status: { type: "string", enum: ["LOCKED", "UNLOCKED", "BROKEN"], description: "Estado do lacre" },
  speed_kmh: { type: "number", example: 42 },
  gsm_signal: { type: "integer", example: -71, description: "Força do sinal, em dBm" },
  satellites: { type: "integer", example: 9, description: "Também aceito como satelites" },
  hdop: { type: "number", example: 0.9 },
  device_state: { type: "string", example: "OPERACIONAL", description: "Estado informado pelo firmware" },
  attempt_count: { type: "integer", minimum: 0, description: "Quantas vezes o lacre tentou enviar esta mensagem" }
};

const obrigatorios = ["device_id", "latitude", "longitude", "battery_percent"];

const errosDoLacre = {
  "400": resposta("Campo obrigatório ausente ou valor inválido", { success: false, message: "latitude, longitude e battery_percent são obrigatórios" }),
  "401": resposta("X-API-Key ausente ou inválida", { success: false, message: "API Key obrigatória" }),
  "403": resposta("Chave de outro dispositivo, ou dispositivo desativado", { success: false, message: "API Key não pertence ao dispositivo" }),
  "404": resposta("Dispositivo não cadastrado", { success: false, message: "Dispositivo não encontrado" }),
  "409": resposta("Mensagem já recebida (não reenviar)", { success: false, message: "Mensagem duplicada" }),
  "413": resposta("Corpo maior que 32 KB"),
  "429": resposta("Limite de requisições por minuto atingido; o cabeçalho Retry-After diz quantos segundos esperar", { success: false, message: "Muitas requisições deste dispositivo; tente de novo em 42 s" })
};

const chave = [{ ApiKeyAuth: [] }];
// Rotas da equipe: chave de administrador
const admin = [{ AdminKeyAuth: [] }];
const errosDaEquipe = {
  "401": resposta("X-Admin-Key ausente ou inválida", { success: false, message: "Chave de administrador obrigatória (cabeçalho X-Admin-Key)" }),
  "429": resposta("Muitas tentativas com chave inválida a partir deste endereço"),
  "503": resposta("Chave de administrador não configurada no servidor (ADMIN_API_KEY)")
};

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "API ESP32",
    version: "2.1.0",
    description: [
      "API que recebe os dados do lacre (ESP32), valida, guarda numa fila local (Oxide) e envia ao banco principal (Supabase) pelo Worker.",
      "",
      "Toda mensagem do lacre leva **posição e bateria**. Sem sinal de GPS, o lacre manda a última posição conhecida com `gps_ok: false`.",
      "",
      "Para as rotas do lacre, clique em **Authorize** e informe a chave do dispositivo (`X-API-Key`).",
      "",
      "As rotas de **Dispositivos** e de **Acompanhamento** são da equipe: exigem a chave de administrador (`X-Admin-Key`), definida no `.env` do servidor."
    ].join("\n")
  },
  servers: [{ url: "http://localhost:3000", description: "Servidor local" }],
  tags: [
    { name: "Lacre", description: "O que o lacre envia: telemetria, eventos e alertas (exige a X-API-Key do próprio dispositivo)" },
    { name: "Comandos", description: "O lacre busca os comandos pendentes (TRAVAR_VALVULA, DESTRAVAR_VALVULA) e confirma EXECUTADO ou ERRO" },
    { name: "Dispositivos", description: "Consulta e cadastro de bancada (exige a X-Admin-Key). O cadastro oficial vem do banco principal; só o hash da chave é guardado, e ela nunca aparece nas respostas" },
    { name: "Acompanhamento", description: "Mensagens recebidas, situação da fila, erros de envio e métricas (exigem a X-Admin-Key) e a saúde da API (aberta)" }
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key", description: "Chave do dispositivo (lacre)" },
      AdminKeyAuth: { type: "apiKey", in: "header", name: "X-Admin-Key", description: "Chave de administrador, para as rotas da equipe" }
    }
  },
  paths: {
    "/api/v1/iot/telemetries": {
      post: {
        tags: ["Lacre"],
        summary: "Enviar a leitura periódica",
        description: "Posição e estado do lacre iguais aos da última leitura: responde `200` e só atualiza a data e a hora da leitura anterior, sem criar outra.",
        security: chave,
        requestBody: jsonBody(
          { message_id: { type: "string", example: "MSG-000123", description: "Único por mensagem; repetir no reenvio" }, ...leitura },
          ["message_id", ...obrigatorios],
          { message_id: "MSG-000123", device_id: "DSP-000001", latitude: -7.2091939, longitude: -39.3063666, gps_ok: true, battery_percent: 87, seal_status: "LOCKED", satellites: 9, hdop: 0.9 }
        ),
        responses: {
          "202": resposta("Leitura recebida", { success: true, message: "Telemetria recebida" }),
          "200": resposta("Posição repetida", { success: true, message: "Posição já registrada; data e hora atualizadas" }),
          ...errosDoLacre
        }
      }
    },
    "/api/v1/iot/events": {
      post: {
        tags: ["Lacre"],
        summary: "Enviar um evento (algo aconteceu)",
        description: "Exemplos de `event_type`: `startup`, `seal_changed`, `hardware_failure`.",
        security: chave,
        requestBody: jsonBody(
          { message_id: { type: "string", example: "EVT-000045" }, event_type: { type: "string", example: "seal_changed" }, description: { type: "string" }, ...leitura },
          ["message_id", "event_type", ...obrigatorios],
          { message_id: "EVT-000045", device_id: "DSP-000001", event_type: "seal_changed", seal_status: "BROKEN", latitude: -7.2091939, longitude: -39.3063666, battery_percent: 86 }
        ),
        responses: { "202": resposta("Evento recebido", { success: true, message: "Evento recebido" }), ...errosDoLacre }
      }
    },
    "/api/v1/iot/activations": {
      post: {
        tags: ["Lacre"],
        summary: "Avisar que o lacre foi ativado ou desativado",
        description: "Na primeira ativação, a API gera o identificador do lacre (`seal_code`) e o devolve na resposta. O aviso segue para o sistema principal, que usa o identificador para vincular o cilindro e o cliente. `INATIVO` encerra o vínculo.",
        security: chave,
        requestBody: jsonBody(
          { message_id: { type: "string", example: "ATV-000001" }, status: { type: "string", enum: ["ATIVO", "INATIVO"] }, ...leitura },
          ["message_id", "status", ...obrigatorios],
          { message_id: "ATV-000001", device_id: "DSP-000001", status: "ATIVO", latitude: -7.2091939, longitude: -39.3063666, battery_percent: 97 }
        ),
        responses: { "202": resposta("Lacre ativado", { success: true, message: "Lacre ativado", activation_status: "ATIVO", seal_code: "LCR-7K2MPQ9X" }), ...errosDoLacre }
      }
    },
    "/api/v1/iot/alerts": {
      post: {
        tags: ["Lacre"],
        summary: "Enviar um alerta identificado pelo lacre",
        description: "O servidor também abre sozinho, a partir das mensagens: `BATERIA_BAIXA`, `GSM_SINAL_FRACO`, `LACRE_VIOLADO` (lacre `BROKEN`) e `LACRE_ABERTO_SEM_AUTORIZACAO` (lacre `UNLOCKED`). Esses o lacre não precisa mandar.",
        security: chave,
        requestBody: jsonBody(
          {
            alert_id: { type: "string", example: "ALT-000010", description: "Único por alerta" },
            alert_type: { type: "string", enum: [...alertTypes] },
            title: { type: "string", example: "GPS não responde" },
            severity: { type: "string", enum: ["BAIXA", "MEDIA", "ALTA", "CRITICA"], description: "Sem ela, vale a do catálogo" },
            description: { type: "string" },
            ...leitura
          },
          ["alert_id", "alert_type", "title", ...obrigatorios],
          { alert_id: "ALT-000010", device_id: "DSP-000001", alert_type: "GPS_INATIVO", title: "GPS não responde", latitude: -7.2091939, longitude: -39.3063666, gps_ok: false, battery_percent: 80 }
        ),
        responses: {
          "201": resposta("Alerta registrado", { success: true, message: "Alerta registrado", alert: { alert_id: "ALT-000010", alert_type: "GPS_INATIVO", severity: "ALTA", title: "GPS não responde" } }),
          ...errosDoLacre,
          "409": resposta("Alerta já recebido", { success: false, message: "Alerta duplicado" })
        }
      }
    },
    "/api/v1/iot/commands/{deviceId}": {
      get: {
        tags: ["Comandos"],
        summary: "Buscar os comandos pendentes do dispositivo",
        security: chave,
        parameters: [{ name: "deviceId", in: "path", required: true, schema: { type: "string" }, example: "DSP-000001" }],
        responses: {
          "200": resposta("Lista (vazia quando não há comando)", [{ command_id: "CMD-000007", device_id: "DSP-000001", command_type: "TRAVAR_VALVULA", status: "PENDENTE", created_at: "2026-10-10 12:00:00" }] as unknown as object),
          "401": errosDoLacre["401"], "403": errosDoLacre["403"], "429": errosDoLacre["429"], "404": errosDoLacre["404"]
        }
      }
    },
    "/api/v1/iot/commands/confirm": {
      post: {
        tags: ["Comandos"],
        summary: "Confirmar que o comando foi executado (ou falhou)",
        security: chave,
        requestBody: jsonBody(
          {
            command_id: { type: "string" }, device_id: { type: "string" },
            status: { type: "string", enum: ["EXECUTADO", "ERRO"] }, error_message: { type: "string" }
          },
          ["command_id", "device_id", "status"],
          { command_id: "CMD-000007", device_id: "DSP-000001", status: "EXECUTADO" }
        ),
        responses: {
          "200": resposta("Comando confirmado", { success: true, message: "Comando confirmado" }),
          "400": resposta("Dados inválidos"), "401": errosDoLacre["401"], "403": errosDoLacre["403"], "429": errosDoLacre["429"],
          "404": resposta("Comando não encontrado para este dispositivo"),
          "409": resposta("Comando já confirmado")
        }
      }
    },
    "/api/v1/devices": {
      get: {
        tags: ["Dispositivos"],
        summary: "Listar os dispositivos (sem a chave deles)",
        security: admin,
        responses: { "200": resposta("Lista de dispositivos, com o último estado, o identificador do lacre e o vínculo"), ...errosDaEquipe }
      },
      post: {
        tags: ["Dispositivos"],
        summary: "Cadastrar um dispositivo (de bancada, para testes). Só o hash da chave é guardado",
        security: admin,
        requestBody: jsonBody(
          { device_id: { type: "string" }, api_key: { type: "string" }, firmware_version: { type: "string" }, active: { type: "integer", enum: [0, 1] } },
          ["device_id", "api_key"],
          { device_id: "DSP-000001", api_key: "chave-de-teste", firmware_version: "1.0.0" }
        ),
        responses: {
          "201": resposta("Dispositivo criado"), "400": resposta("Dados inválidos"),
          "409": resposta("device_id ou api_key já cadastrados"), ...errosDaEquipe
        }
      }
    },
    "/api/v1/devices/{deviceId}": {
      get: {
        tags: ["Dispositivos"],
        summary: "Buscar um dispositivo",
        security: admin,
        parameters: [{ name: "deviceId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": resposta("Dispositivo"), "404": resposta("Dispositivo não encontrado"), ...errosDaEquipe }
      }
    },
    "/api/v1/iot/messages": {
      get: {
        tags: ["Acompanhamento"],
        summary: "Últimas mensagens recebidas",
        security: admin,
        parameters: [
          { name: "type", in: "query", schema: { type: "string", enum: ["TELEMETRIA", "EVENTO", "ALERTA", "CONFIRMACAO_COMANDO", "ATIVACAO"] } },
          { name: "device_id", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } }
        ],
        responses: { "200": resposta("Mensagens, da mais recente para a mais antiga, com a situação do envio"), ...errosDaEquipe }
      }
    },
    "/api/v1/sync/status": {
      get: {
        tags: ["Acompanhamento"],
        summary: "Situação da fila e da última rodada do Worker",
        security: admin,
        responses: { "200": resposta("Contagem por situação", { fila: { pendentes: 2, enviando: 0, nova_tentativa: 0, paradas: 0, sincronizadas: 120, arquivadas: 0 }, ultima_rodada: null }), ...errosDaEquipe }
      }
    },
    "/api/v1/sync/problems": {
      get: {
        tags: ["Acompanhamento"],
        summary: "Mensagens que não chegaram ao banco principal, com o motivo",
        security: admin,
        responses: { "200": resposta("Lista de mensagens com erro"), ...errosDaEquipe }
      }
    },
    "/api/v1/sync/retry": {
      post: {
        tags: ["Acompanhamento"],
        summary: "Devolver à fila uma mensagem com erro (depois de corrigir a causa)",
        security: admin,
        requestBody: jsonBody({ message_id: { type: "string" } }, ["message_id"], { message_id: "MSG-000123" }),
        responses: { "200": resposta("Mensagem devolvida à fila"), "400": resposta("message_id ausente"), "404": resposta("Mensagem com erro não encontrada"), ...errosDaEquipe }
      }
    },
    "/metrics": {
      get: {
        tags: ["Acompanhamento"],
        summary: "Números de funcionamento: pedidos, respostas, tempos, fila e banco",
        security: admin,
        parameters: [{ name: "formato", in: "query", schema: { type: "string", enum: ["prometheus"] }, description: "Com prometheus, responde em texto" }],
        responses: { "200": resposta("Contadores desde que a API foi ligada e situação atual da fila"), ...errosDaEquipe }
      }
    },
    "/health": {
      get: {
        tags: ["Acompanhamento"],
        summary: "Saúde da API, da fila e do Worker (aberta, sem chave)",
        responses: { "200": resposta("Tudo em ordem"), "503": resposta("Worker parado, atrasado ou com falha") }
      }
    }
  }
};

export default openApiSpec;
