const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "API ESP32",
    version: "1.0.0",
    description: "API para dispositivos ESP32 enviarem telemetrias e eventos."
  },
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
          command_type: { type: "string", example: "REBOOT" },
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
            enum: ["SEAL_BROKEN", "GEOFENCE_EXIT", "LOW_BATTERY", "DEVICE_ERROR", "COMMAND_FAILURE", "COMMUNICATION_LOST"]
          },
          status_id: { type: "integer", example: 1 },
          severity_id: { type: "integer", example: 2 },
          title: { type: "string", example: "Lacre rompido" },
          description: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time" },
          resolved_at: { type: "string", format: "date-time", nullable: true }
        }
      }
    }
  },
  paths: {
    "/api/v1/devices": {
      get: {
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
                  latitude: { type: "number", example: -23.5505 },
                  longitude: { type: "number", example: -46.6333 },
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
        summary: "Registrar alerta",
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["alert_id", "device_id", "alert_type", "status_id", "severity_id", "title"],
                properties: {
                  alert_id: { type: "string", example: "ALT-000001" },
                  device_id: { type: "string", example: "DSP-000001" },
                  alert_type: {
                    type: "string",
                    enum: ["SEAL_BROKEN", "GEOFENCE_EXIT", "LOW_BATTERY", "DEVICE_ERROR", "COMMAND_FAILURE", "COMMUNICATION_LOST"]
                  },
                  status_id: { type: "integer", example: 1 },
                  severity_id: { type: "integer", example: 2 },
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
          "400": { description: "Campos, tipo ou IDs de status inválidos" },
          "401": { description: "API Key ausente ou inválida" },
          "403": { description: "API Key não pertence ao dispositivo" },
          "404": { description: "Dispositivo não encontrado" },
          "409": { description: "alert_id já cadastrado" }
        }
      }
    }
  }
};

export default openApiSpec;