import { alertTypes } from "../models/Alert";

const jsonBody = (properties: object, required: string[]) => ({
  required: true,
  content: {
    "application/json": {
      schema: { type: "object", required, properties }
    }
  }
});

const codeParam = (name: string, example: string) => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string" },
  example
});

const sealStatusEnum = [
  "EM_ESTOQUE", "INSTALADO", "SUSPEITA_VIOLACAO", "ROMPIDO",
  "REMOVIDO", "DANIFICADO", "INUTILIZADO"
];

const cylinderStatusEnum = [
  "DISPONIVEL", "EM_TRANSITO", "COM_CLIENTE", "MANUTENCAO", "EXTRAVIADO", "INATIVO"
];

const historyQuery = [
  { name: "device_id", in: "query", schema: { type: "string" } },
  { name: "seal_code", in: "query", schema: { type: "string" } },
  { name: "cylinder_code", in: "query", schema: { type: "string" } },
  { name: "active", in: "query", schema: { type: "string", enum: ["true"] }, description: "true = só vínculos ativos" }
];

const idParam = [{ name: "id", in: "path", required: true, schema: { type: "integer" } }];

const endBody = jsonBody({ reason: { type: "string", example: "Retirada para manutenção" } }, []);

const endResponses = {
  "200": { description: "Vínculo encerrado (fica no histórico)" },
  "404": { description: "Vínculo não encontrado" },
  "409": { description: "Vínculo já encerrado" }
};

// Associação dispositivo → lacre → cilindro (entrega B). Rotas abertas e
// provisórias até o Worker trazer o cadastro oficial do FluxID
const assetPaths = {
  "/api/v1/seals": {
    get: { tags: ["Lacres"], summary: "Listar lacres", responses: { "200": { description: "Lista de lacres" } } },
    post: {
      tags: ["Lacres"],
      summary: "Cadastrar lacre (provisório até o FluxID)",
      requestBody: jsonBody({
        seal_code: { type: "string", example: "LCR-000001" },
        nfc_uid: { type: "string", example: "04A2B3C4D5" },
        status: { type: "string", enum: sealStatusEnum.filter(s => s !== "INSTALADO"), example: "EM_ESTOQUE" }
      }, ["seal_code", "nfc_uid"]),
      responses: {
        "201": { description: "Lacre cadastrado (EM_ESTOQUE por padrão)" },
        "400": { description: "Campos obrigatórios ou status inválido (INSTALADO só pelo vínculo)" },
        "409": { description: "Código ou UID NFC já cadastrado" }
      }
    }
  },
  "/api/v1/seals/{sealCode}": {
    get: {
      tags: ["Lacres"], summary: "Buscar lacre", parameters: [codeParam("sealCode", "LCR-000001")],
      responses: { "200": { description: "Lacre" }, "404": { description: "Lacre não encontrado" } }
    }
  },
  "/api/v1/seals/{sealCode}/status": {
    post: {
      tags: ["Lacres"], summary: "Alterar estado do lacre", parameters: [codeParam("sealCode", "LCR-000001")],
      requestBody: jsonBody({ status: { type: "string", enum: sealStatusEnum, example: "SUSPEITA_VIOLACAO" } }, ["status"]),
      responses: {
        "200": { description: "Estado alterado" },
        "400": { description: "Estado inválido" },
        "404": { description: "Lacre não encontrado" },
        "409": { description: "INSTALADO só pelo vínculo; EM_ESTOQUE/REMOVIDO só sem cilindro ativo" }
      }
    }
  },
  "/api/v1/cylinders": {
    get: { tags: ["Cilindros"], summary: "Listar cilindros", responses: { "200": { description: "Lista de cilindros" } } },
    post: {
      tags: ["Cilindros"],
      summary: "Cadastrar cilindro (provisório até o FluxID)",
      requestBody: jsonBody({
        cylinder_code: { type: "string", example: "CIL-000001" },
        serial_number: { type: "string", example: "SN-123456" },
        status: { type: "string", enum: cylinderStatusEnum, example: "DISPONIVEL" }
      }, ["cylinder_code", "serial_number"]),
      responses: {
        "201": { description: "Cilindro cadastrado (DISPONIVEL por padrão)" },
        "400": { description: "Campos obrigatórios ou status inválido" },
        "409": { description: "Código ou número de série já cadastrado" }
      }
    }
  },
  "/api/v1/cylinders/{cylinderCode}": {
    get: {
      tags: ["Cilindros"], summary: "Buscar cilindro", parameters: [codeParam("cylinderCode", "CIL-000001")],
      responses: { "200": { description: "Cilindro" }, "404": { description: "Cilindro não encontrado" } }
    }
  },
  "/api/v1/cylinders/{cylinderCode}/status": {
    post: {
      tags: ["Cilindros"], summary: "Alterar estado do cilindro", parameters: [codeParam("cylinderCode", "CIL-000001")],
      requestBody: jsonBody({ status: { type: "string", enum: cylinderStatusEnum, example: "EM_TRANSITO" } }, ["status"]),
      responses: { "200": { description: "Estado alterado" }, "400": { description: "Estado inválido" }, "404": { description: "Cilindro não encontrado" } }
    }
  },
  "/api/v1/assignments/device-seal": {
    get: {
      tags: ["Vínculos"], summary: "Histórico dispositivo ↔ lacre (mais recente primeiro)", parameters: historyQuery,
      responses: { "200": { description: "Vínculos" } }
    },
    post: {
      tags: ["Vínculos"],
      summary: "Vincular dispositivo a lacre (RN05)",
      requestBody: jsonBody({
        device_id: { type: "string", example: "DSP-000001" },
        seal_code: { type: "string", example: "LCR-000001" },
        replace: { type: "boolean", description: "true = troca: encerra os vínculos em conflito e cria o novo", example: false }
      }, ["device_id", "seal_code"]),
      responses: {
        "201": { description: "Vínculo criado" },
        "400": { description: "Campos obrigatórios" },
        "404": { description: "Dispositivo ou lacre não encontrado" },
        "409": { description: "Dispositivo ou lacre já tem vínculo ativo (use replace: true)" }
      }
    }
  },
  "/api/v1/assignments/device-seal/{id}/end": {
    post: {
      tags: ["Vínculos"], summary: "Encerrar vínculo dispositivo ↔ lacre",
      parameters: idParam, requestBody: endBody, responses: endResponses
    }
  },
  "/api/v1/assignments/seal-cylinder": {
    get: {
      tags: ["Vínculos"], summary: "Histórico lacre ↔ cilindro (mais recente primeiro)", parameters: historyQuery,
      responses: { "200": { description: "Vínculos" } }
    },
    post: {
      tags: ["Vínculos"],
      summary: "Instalar lacre em cilindro (RN04); lacre vira INSTALADO",
      requestBody: jsonBody({
        seal_code: { type: "string", example: "LCR-000001" },
        cylinder_code: { type: "string", example: "CIL-000001" },
        replace: { type: "boolean", description: "true = troca: encerra os vínculos em conflito; o lacre substituído vira REMOVIDO", example: false }
      }, ["seal_code", "cylinder_code"]),
      responses: {
        "201": { description: "Vínculo criado" },
        "400": { description: "Campos obrigatórios" },
        "404": { description: "Lacre ou cilindro não encontrado" },
        "409": { description: "Vínculo ativo em conflito ou lacre fora de EM_ESTOQUE/REMOVIDO" }
      }
    }
  },
  "/api/v1/assignments/seal-cylinder/{id}/end": {
    post: {
      tags: ["Vínculos"], summary: "Encerrar vínculo lacre ↔ cilindro; lacre INSTALADO vira REMOVIDO",
      parameters: idParam, requestBody: endBody, responses: endResponses
    }
  }
};

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "API ESP32",
    version: "1.0.0",
    description: "API Oxide: recebe os dados do ESP32 (telemetria, eventos, alertas e comandos) e mantém a fila local até a sincronização com o FluxID. As rotas de cadastro, de associação e de análise de alertas são abertas e provisórias, até o controle por perfil do FluxID."
  },
  tags: [
    { name: "Dispositivos", description: "Cadastro e consulta de dispositivos. Provisório até o Worker trazer o cadastro oficial do FluxID; a api_key só aparece no cadastro" },
    { name: "Telemetria", description: "O ESP32 envia posição, bateria, sinal e estado do lacre (exige a X-API-Key do próprio dispositivo)" },
    { name: "Eventos", description: "O ESP32 envia ocorrências: reinício, falha, mudança do lacre (exige a X-API-Key do próprio dispositivo)" },
    { name: "Comandos", description: "O ESP32 busca comandos pendentes (TRAVAR_VALVULA, DESTRAVAR_VALVULA) e confirma EXECUTADO ou ERRO" },
    { name: "Alertas", description: "O ESP32 cria alertas com os códigos do catálogo Tipos-de-Erro.md; o gestor lista, analisa e encerra (rotas abertas e provisórias)" },
    { name: "Lacres", description: "Cadastro e estado dos lacres. Cópia provisória do cadastro do FluxID" },
    { name: "Cilindros", description: "Cadastro e estado dos cilindros. Cópia provisória do cadastro do FluxID" },
    { name: "Vínculos", description: "Dispositivo ↔ lacre e lacre ↔ cilindro, com troca, encerramento e histórico. Nada é apagado" }
  ],
  servers: [
    {
      url: "http://localhost:3000",
      description: "Servidor local"
    }
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key"
      }
    },
    schemas: {
      Device: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          device_id: { type: "string", example: "DSP-000001" },
          firmware_version: { type: "string", example: "1.0.0" },
          active: { type: "integer", enum: [0, 1], example: 1 },
          device_status_id: { type: "integer", nullable: true, example: 1 },
          valve_status_id: { type: "integer", nullable: true, example: null },
          seal_status_id: { type: "integer", nullable: true, example: 3 }
        }
      },
      Error: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          message: { type: "string", example: "API Key inválida" }
        }
      },
      Telemetry: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          message_id: { type: "string", example: "MSG-000001" },
          device_id: { type: "string", example: "DSP-000001" },
          latitude: { type: "number", example: -23.5505 },
          longitude: { type: "number", example: -46.6333 },
          speed_kmh: { type: "number", example: 42 },
          battery_percent: { type: "number", example: 88 },
          gsm_signal: { type: "number", example: 31 },
          last_seen_at: { type: "string", format: "date-time", nullable: true },
          status: { type: "string", example: "PENDING" }
        }
      },
      DeviceCommand: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          command_id: { type: "string", example: "CMD-000001" },
          device_id: { type: "string", example: "DSP-000001" },
          command_type: { type: "string", example: "TRAVAR_VALVULA" },
          status: { type: "string", example: "PENDENTE" },
          created_at: { type: "string", format: "date-time" },
          executed_at: { type: "string", format: "date-time", nullable: true },
          error_message: { type: "string", nullable: true }
        }
      },
      Alert: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          alert_id: { type: "string", example: "ALT-000001" },
          device_id: { type: "string", example: "DSP-000001" },
          alert_type: {
            type: "string",
            enum: [...alertTypes],
            example: "LACRE_VIOLADO"
          },
          severity: { type: "string", enum: ["BAIXA", "MEDIA", "ALTA", "CRITICA"], example: "CRITICA" },
          status: { type: "string", enum: ["ABERTO", "EM_ANALISE", "ENCERRADO"], example: "ABERTO" },
          title: { type: "string", example: "Lacre rompido" },
          description: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time" },
          resolved_at: { type: "string", format: "date-time", nullable: true },
          resolved_by: { type: "string", nullable: true, example: "Maria (gestora)" },
          resolution_note: { type: "string", nullable: true, example: "Desvio justificado pelo motorista: obra na via" }
        }
      }
    }
  },
  paths: {
    "/api/v1/devices": {
      get: {
        tags: ["Dispositivos"],
        summary: "Listar dispositivos",
        responses: {
          "200": {
            description: "Lista de dispositivos",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Device" }
                }
              }
            }
          }
        }
      },
      post: {
        tags: ["Dispositivos"],
        summary: "Cadastrar dispositivo",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["device_id", "api_key"],
                properties: {
                  device_id: { type: "string", example: "DSP-000002" },
                  api_key: { type: "string", example: "chave-secreta" },
                  firmware_version: { type: "string", example: "1.0.0" },
                  active: { type: "integer", enum: [0, 1], example: 1 },
                  device_status_id: { type: "integer", nullable: true, example: 1 },
                  valve_status_id: { type: "integer", nullable: true, example: null },
                  seal_status_id: { type: "integer", nullable: true, example: 3 }
                }
              }
            }
          }
        },
        responses: {
          "201": { description: "Dispositivo criado" },
          "409": {
            description: "Dispositivo duplicado pelo device_id ou API Key já em uso",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { success: false, message: "Dispositivo duplicado" }
              }
            }
          },
          "400": {
            description: "Campos obrigatórios ausentes ou active diferente de 0/1",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        }
      }
    },
    "/api/v1/devices/{deviceId}": {
      get: {
        tags: ["Dispositivos"],
        summary: "Buscar dispositivo pelo identificador",
        parameters: [
          {
            name: "deviceId",
            in: "path",
            required: true,
            schema: { type: "string" },
            example: "DSP-000001"
          }
        ],
        responses: {
          "200": {
            description: "Dispositivo encontrado",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Device" }
              }
            }
          },
          "404": { description: "Dispositivo não encontrado" }
        }
      }
    },
    "/api/v1/iot/telemetries": {
      get: {
        tags: ["Telemetria"],
        summary: "Listar telemetrias da fila",
        description: "Retorna todas as telemetrias, da mais recente para a mais antiga.",
        security: [{ ApiKeyAuth: [] }],
        responses: {
          "200": {
            description: "Lista de telemetrias",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Telemetry" }
                }
              }
            }
          },
          "401": {
            description: "API Key ausente ou inválida",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          },
          "403": { description: "Dispositivo desativado" }
        }
      },
      post: {
        tags: ["Telemetria"],
        summary: "Enviar telemetria",
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["message_id", "device_id"],
                properties: {
                  message_id: { type: "string", example: "MSG-000001" },
                  device_id: { type: "string", example: "DSP-000001" },
                  latitude: { type: "number", minimum: -90, maximum: 90, description: "Enviar junto com longitude", example: -23.5505 },
                  longitude: { type: "number", minimum: -180, maximum: 180, description: "Enviar junto com latitude", example: -46.6333 },
                  speed_kmh: { type: "number", example: 42 },
                  battery_percent: { type: "number", example: 88 },
                  gsm_signal: { type: "number", example: 31 },
                  payload_json: { type: "string", example: "{}" },
                  last_seen_at: {
                    type: "string",
                    format: "date-time",
                    example: "2026-10-04T15:30:00.000Z"
                  },
                  seal_status: {
                    type: "string",
                    enum: ["LOCKED", "UNLOCKED", "BROKEN"],
                    example: "LOCKED"
                  },
                  attempt_count: {
                    type: "integer",
                    minimum: 0,
                    description: "Tentativas de envio do ESP32; gravado em device_attempt_count",
                    example: 1
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Posição e estado do lacre iguais à última telemetria; data e hora atualizadas" },
          "202": { description: "Telemetria recebida" },
          "400": { description: "message_id e device_id são obrigatórios ou campo com tipo inválido" },
          "404": { description: "Dispositivo não encontrado" },
          "409": {
            description: "Mensagem duplicada pelo message_id (inclusive de posição repetida)",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { success: false, message: "Mensagem duplicada" }
              }
            }
          },
          "401": {
            description: "API Key ausente ou inválida",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          },
          "403": { description: "Dispositivo desativado ou API Key de outro dispositivo" }
        }
      }
    },
    "/api/v1/iot/events": {
      post: {
        tags: ["Eventos"],
        summary: "Enviar evento",
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["message_id", "device_id", "event_type"],
                properties: {
                  message_id: { type: "string", example: "EVT-000001" },
                  device_id: { type: "string", example: "DSP-000001" },
                  event_type: { type: "string", example: "door_open" },
                  seal_status: {
                    type: "string",
                    enum: ["LOCKED", "UNLOCKED", "BROKEN"],
                    example: "LOCKED"
                  },
                  payload_json: { type: "string", example: "{\"source\":\"sensor\"}" },
                  attempt_count: {
                    type: "integer",
                    minimum: 0,
                    description: "Tentativas de envio do ESP32; gravado em device_attempt_count",
                    example: 1
                  }
                }
              }
            }
          }
        },
        responses: {
          "202": { description: "Evento recebido" },
          "400": {
            description: "message_id, device_id e event_type são obrigatórios",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          },
          "409": {
            description: "Mensagem duplicada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { success: false, message: "Mensagem duplicada" }
              }
            }
          },
          "401": { description: "API Key ausente ou inválida" },
          "403": { description: "Dispositivo desativado ou API Key de outro dispositivo" },
          "404": { description: "Dispositivo não cadastrado (não há criação automática)" }
        }
      }
    },
    "/api/v1/iot/commands/{deviceId}": {
      get: {
        tags: ["Comandos"],
        summary: "Listar comandos pendentes do dispositivo",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: "deviceId",
            in: "path",
            required: true,
            schema: { type: "string" },
            example: "DSP-000001"
          }
        ],
        responses: {
          "200": {
            description: "Comandos pendentes, em ordem de criação",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/DeviceCommand" }
                }
              }
            }
          },
          "401": { description: "API Key ausente ou inválida" },
          "403": { description: "API Key não pertence ao dispositivo" },
          "404": { description: "Dispositivo não encontrado" }
        }
      }
    },
    "/api/v1/iot/commands/confirm": {
      post: {
        tags: ["Comandos"],
        summary: "Confirmar execução de comando",
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["command_id", "device_id", "status"],
                properties: {
                  command_id: { type: "string", example: "CMD-000001" },
                  device_id: { type: "string", example: "DSP-000001" },
                  status: { type: "string", enum: ["EXECUTADO", "ERRO"], example: "EXECUTADO" },
                  error_message: { type: "string", nullable: true, example: null }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Comando confirmado" },
          "400": { description: "Campos obrigatórios ou status inválidos" },
          "401": { description: "API Key ausente ou inválida" },
          "403": { description: "API Key não pertence ao dispositivo" },
          "404": { description: "Comando não encontrado para este dispositivo" },
          "409": { description: "Comando já confirmado" }
        }
      }
    },
    "/api/v1/iot/alerts": {
      post: {
        tags: ["Alertas"],
        summary: "Registrar alerta",
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["alert_id", "device_id", "alert_type", "title"],
                properties: {
                  alert_id: { type: "string", example: "ALT-000001" },
                  device_id: { type: "string", example: "DSP-000001" },
                  alert_type: {
                    type: "string",
                    description: "Código do catálogo Tipos-de-Erro.md. Transição: os nomes antigos SEAL_BROKEN, GEOFENCE_EXIT, LOW_BATTERY, COMMUNICATION_LOST, DEVICE_ERROR e COMMAND_FAILURE continuam aceitos e são gravados no código em português",
                    example: "LACRE_VIOLADO"
                  },
                  severity: {
                    type: "string",
                    enum: ["BAIXA", "MEDIA", "ALTA", "CRITICA"],
                    description: "Opcional. Padrão: a severidade sugerida no catálogo para o tipo (ex.: LACRE_VIOLADO CRITICA, SEM_COMUNICACAO ALTA, BATERIA_BAIXA BAIXA). O status nasce sempre ABERTO",
                    example: "CRITICA"
                  },
                  title: { type: "string", example: "Lacre rompido" },
                  description: { type: "string", nullable: true }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Alerta criado",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    alert: { $ref: "#/components/schemas/Alert" }
                  }
                }
              }
            }
          },
          "400": { description: "Campos obrigatórios, alert_type ou severity inválidos" },
          "401": { description: "API Key ausente ou inválida" },
          "403": { description: "API Key não pertence ao dispositivo" },
          "404": { description: "Dispositivo não encontrado" },
          "409": { description: "alert_id já cadastrado" }
        }
      },
      get: {
        tags: ["Alertas"],
        summary: "Listar alertas (aberta e provisória)",
        parameters: [
          { name: "status", in: "query", schema: { type: "string", enum: ["ABERTO", "EM_ANALISE", "ENCERRADO"] } },
          { name: "device_id", in: "query", schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Alertas, do mais recente ao mais antigo",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    total: { type: "integer", example: 1 },
                    alerts: { type: "array", items: { $ref: "#/components/schemas/Alert" } }
                  }
                }
              }
            }
          },
          "400": { description: "status inválido" }
        }
      }
    },
    "/api/v1/iot/alerts/{alertId}/status": {
      patch: {
        tags: ["Alertas"],
        summary: "Analisar ou encerrar alerta (aberta e provisória)",
        description: "Caminhos: ABERTO → EM_ANALISE → ENCERRADO, ou ABERTO → ENCERRADO. ENCERRADO é final: um problema novo gera um alerta novo",
        parameters: [
          { name: "alertId", in: "path", required: true, schema: { type: "string" }, example: "ALT-000001" }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status"],
                properties: {
                  status: { type: "string", enum: ["EM_ANALISE", "ENCERRADO"] },
                  resolved_by: { type: "string", description: "Obrigatório para ENCERRADO: quem liberou", example: "Maria (gestora)" },
                  resolution_note: { type: "string", description: "Obrigatório para ENCERRADO: motivo", example: "Desvio justificado pelo motorista: obra na via" }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Status atualizado",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    alert: { $ref: "#/components/schemas/Alert" }
                  }
                }
              }
            }
          },
          "400": { description: "status inválido, ou resolved_by/resolution_note ausentes ao encerrar" },
          "404": { description: "Alerta não encontrado" },
          "409": { description: "Transição não permitida (ex.: alerta já encerrado)" }
        }
      }
    },
    ...assetPaths
  }
};

export default openApiSpec;