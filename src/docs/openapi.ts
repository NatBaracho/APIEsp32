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
          api_key: { type: "string", example: "abc123" },
          firmware_version: { type: "string", example: "1.0.0" },
          active: { type: "integer", enum: [0, 1], example: 1 }
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
                  active: { type: "integer", enum: [0, 1], example: 1 }
                }
              }
            }
          }
        },
        responses: {
          "201": { description: "Dispositivo criado" },
          "409": {
            description: "Dispositivo duplicado pelo device_id",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { success: false, message: "Dispositivo duplicado" }
              }
            }
          },
          "400": {
            description: "Campos obrigatórios ausentes",
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
                  status: { type: "string", example: "pending" }
                }
              }
            }
          }
        },
        responses: {
          "202": { description: "Telemetria recebida" },
          "400": { description: "message_id e device_id são obrigatórios" },
          "409": {
            description: "Mensagem duplicada pelo message_id",
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
          "403": { description: "Dispositivo desativado" }
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
                  seal_status: { type: "string", example: "closed" },
                  payload_json: { type: "string", example: "{\"source\":\"sensor\"}" },
                  status: { type: "string", example: "new" }
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
          "403": { description: "Dispositivo desativado" }
        }
      }
    }
  }
};

export default openApiSpec;