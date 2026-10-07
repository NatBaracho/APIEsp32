// Documentação da API do frontend sobre o FluxID: PROPOSTA (Doc/Contrato-API-Frontend.md
// v0.1). Nenhuma destas rotas existe ainda; a página serve para o backend e o frontend
// enxergarem o contrato antes da implementação.

const NOT_IMPLEMENTED = "**Proposta: ainda não implementado.**";

interface FunctionDoc {
  tag: string;
  summary: string;
  description: string;
  operations?: string[];
  properties: Record<string, object>;
  required?: string[];
  example: Record<string, unknown>;
  success: { code: string; description: string; example: Record<string, unknown> };
  errors?: Record<string, string>;
}

const commonErrors: Record<string, string> = {
  "400": "VALIDATION_FAILED: corpo inválido (traz `fields`)",
  "401": "AUTH_REQUIRED: sem token, token inválido ou sessão vencida",
  "403": "ACCESS_DENIED: sem a permissão da operação",
  "404": "NOT_FOUND: não existe ou é de outra organização (mesma resposta)",
  "405": "METHOD_NOT_ALLOWED: só POST",
  "500": "INTERNAL_ERROR: falha inesperada, sem detalhe"
};

const organizationId = {
  type: "string",
  format: "uuid",
  description: "Organização ativa. É só contexto: o acesso é conferido no servidor pelo token"
};

function fn(doc: FunctionDoc): object {
  const properties: Record<string, object> = {};

  if (doc.operations) {
    properties.operation = { type: "string", enum: doc.operations };
  }

  Object.assign(properties, doc.properties);

  const responses: Record<string, object> = {
    "200": {
      description: `${doc.success.code}: ${doc.success.description}`,
      content: { "application/json": { example: doc.success.example } }
    }
  };

  for (const [status, text] of Object.entries({ ...commonErrors, ...(doc.errors ?? {}) })) {
    responses[status] = { description: text };
  }

  return {
    post: {
      tags: [doc.tag],
      summary: doc.summary,
      description: `${NOT_IMPLEMENTED}\n\n${doc.description}`,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: [...(doc.operations ? ["operation"] : []), ...(doc.required ?? [])],
              properties
            },
            example: doc.example
          }
        }
      },
      responses
    }
  };
}

// Login e recuperação de senha são chamados sem token
function publicFunction(path: object): object {
  const post = (path as { post: object }).post;
  return { post: { ...post, security: [] } };
}

const cylinderExample = {
  id: "5ff5c689-39ec-4c83-bc3a-de20caa585b6",
  code: "CIL-000001",
  serial_number: "SN-000001",
  status: "active",
  stock_status: "out_of_stock",
  hydro_status: "valid",
  active_identifier_count: 1,
  version: 1
};

const openApiFluxidSpec = {
  openapi: "3.0.3",
  info: {
    title: "API FluxID para o frontend (PROPOSTA)",
    version: "0.1.0",
    description: [
      "**Proposta para aprovação — nada aqui está implementado.** Contrato completo: `Doc/Contrato-API-Frontend.md` (v0.1).",
      "",
      "Todas as chamadas são `POST http://<servidor>:3000/api/v1/app/<função>`, com `authorization: Bearer <token>` (exceto login e recuperação de senha) e corpo JSON. A resposta é sempre `{ \"code\": \"...\", ... }`.",
      "",
      "A API imita o jeito como o frontend já chama o servidor (mesmos nomes de função, corpo e códigos), lendo e gravando no FluxID (PostgreSQL). Os campos do JSON ficam em inglês, como no frontend; a API converte para as colunas do FluxID.",
      "",
      "A API que já funciona (lacre, alertas da Oxide, sincronização) está em `/api-docs`."
    ].join("\n")
  },
  servers: [{ url: "http://localhost:3000/api/v1/app", description: "Servidor local (proposta)" }],
  tags: [
    { name: "Login e sessão", description: "Entrar, conferir a sessão, sair e recuperar a senha (decisão D3)" },
    { name: "Acesso", description: "Permissões, organizações, pessoas, papéis, convites e auditoria" },
    { name: "Cilindros", description: "As telas de cilindros que o frontend já tem (etapa 006), agora sobre o FluxID" },
    { name: "Lacre e mapa", description: "Visão geral, mapa, alertas, lacres, dispositivos, trajeto e comandos: os dados que vêm do lacre pela Oxide" }
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "Token devolvido por session-login" }
    }
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/session-login": publicFunction(fn({
        tag: "Login e sessão",
        summary: "Entrar com e-mail e senha",
        description: "Sem token. Até 3 sessões ativas por pessoa; bloqueio de 15 min após 5 falhas. Tabelas: `usuarios` e as tabelas de sessão do script `006` (a criar).",
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", format: "password" },
          revoke_session_id: { type: "string", format: "uuid", description: "Só depois de SESSION_LIMIT_REACHED" }
        },
        required: ["email", "password"],
        example: { email: "gestor@alfa.teste", password: "********" },
        success: {
          code: "AUTHENTICATED",
          description: "sessão criada",
          example: { code: "AUTHENTICATED", access_token: "eyJ...", expires_at: "2026-10-08T15:00:00Z", organizations: [{ id: "b01e1a06-...", name: "Alfa Gases Industriais Ltda" }] }
        },
        errors: {
          "401": "INVALID_CREDENTIALS",
          "403": "ACCOUNT_UNAVAILABLE",
          "409": "SESSION_LIMIT_REACHED (traz as sessões ativas)",
          "429": "RATE_LIMITED"
        }
      })),
    "/session-status": fn({
      tag: "Login e sessão",
      summary: "Conferir se a sessão continua válida",
      description: "Chamado ao abrir o app e periodicamente. Sessão de até 8 h; 30 min de inatividade encerram.",
      properties: {},
      example: {},
      success: { code: "SESSION_ACTIVE", description: "sessão válida", example: { code: "SESSION_ACTIVE", expires_at: "2026-10-08T15:00:00Z" } },
      errors: { "401": "SESSION_EXPIRED, SESSION_REVOKED ou SESSION_INVALID" }
    }),
    "/session-logout": fn({
      tag: "Login e sessão",
      summary: "Sair",
      description: "Responde SIGNED_OUT mesmo se a sessão já tiver acabado.",
      properties: {},
      example: {},
      success: { code: "SIGNED_OUT", description: "sessão encerrada", example: { code: "SIGNED_OUT" } }
    }),
    "/password-recovery": publicFunction(fn({
      tag: "Login e sessão",
      summary: "Recuperar a senha",
      description: "Sem token. Sempre responde RECOVERY_REQUEST_ACCEPTED para e-mail bem formado (não revela se o e-mail existe). Link de 1 h, uso único.",
      properties: {
        email: { type: "string", format: "email" },
        token: { type: "string", description: "Segunda etapa: token do link" },
        new_password: { type: "string", format: "password" }
      },
      example: { email: "gestor@alfa.teste" },
      success: { code: "RECOVERY_REQUEST_ACCEPTED", description: "pedido aceito", example: { code: "RECOVERY_REQUEST_ACCEPTED" } }
    })),

    "/query-permissions": fn({
      tag: "Acesso",
      summary: "O que a pessoa pode fazer (monta o menu)",
      description: "Devolve os códigos que o frontend já usa (`cylinder.read`...), calculados a partir das permissões do FluxID (`perfil_permissoes`; decisão D2).",
      properties: { organization_id: organizationId },
      example: { organization_id: "b01e1a06-1f63-4a57-a720-7cc10d76ef73" },
      success: { code: "PERMISSIONS_LISTED", description: "permissões da pessoa", example: { code: "PERMISSIONS_LISTED", tenant: ["cylinder.read", "cylinder.write", "alert.close"], global: [] } }
    }),
    "/manage-organizations": fn({
      tag: "Acesso",
      summary: "Empresas (organizações)",
      description: "Tabela `organizacoes`. Falta o convite do primeiro administrador (script `006`).",
      operations: ["list", "create", "change_status", "invite_first_admin"],
      properties: { organization_id: organizationId, status: { type: "string", enum: ["ATIVA", "INATIVA", "SUSPENSA"] } },
      example: { operation: "list" },
      success: { code: "LISTED", description: "organizações", example: { code: "LISTED", items: [{ id: "...", code: "ORG-000002", name: "Alfa Gases Industriais Ltda", status: "ATIVA" }] } }
    }),
    "/manage-membership": fn({
      tag: "Acesso",
      summary: "Pessoas da empresa",
      description: "Tabelas `usuarios` e `usuario_perfis`. Pessoa em mais de uma empresa depende da decisão D4.",
      operations: ["list", "block", "inactivate", "reactivate"],
      properties: { organization_id: organizationId, user_id: { type: "string", format: "uuid" } },
      example: { operation: "list", organization_id: "b01e1a06-..." },
      success: { code: "LISTED", description: "pessoas", example: { code: "LISTED", items: [{ user_id: "...", name: "Gestor Alfa", roles: ["ORG_ADMIN"], status: "active" }] } },
      errors: { "409": "LAST_ADMIN_REQUIRED: não pode bloquear o último administrador" }
    }),
    "/manage-access": fn({
      tag: "Acesso",
      summary: "Papéis e permissões",
      description: "Tabelas `perfis`, `perfil_permissoes` e `usuario_perfis`.",
      operations: ["list", "save_role", "set_role_active", "assign_role", "remove_role"],
      properties: { organization_id: organizationId, role_id: { type: "string" }, user_id: { type: "string" }, permissions: { type: "array", items: { type: "string" } } },
      example: { operation: "assign_role", organization_id: "b01e1a06-...", user_id: "...", role_id: "OPERADOR" },
      success: { code: "ASSIGNED", description: "papel atribuído", example: { code: "ASSIGNED" } }
    }),
    "/invite-user": fn({
      tag: "Acesso",
      summary: "Convites",
      description: "Convite de 72 h, uso único. Falta a tabela de convites (script `006`).",
      operations: ["invite", "resend", "accept"],
      properties: { organization_id: organizationId, email: { type: "string", format: "email" }, role_id: { type: "string" }, token: { type: "string" } },
      example: { operation: "invite", organization_id: "b01e1a06-...", email: "motorista@alfa.teste", role_id: "OPERADOR" },
      success: { code: "SENT", description: "convite enviado", example: { code: "SENT" } },
      errors: { "409": "INVITATION_CONFLICT", "410": "INVITATION_EXPIRED" }
    }),
    "/query-audit": fn({
      tag: "Acesso",
      summary: "Auditoria",
      description: "Tabela `auditoria`. Filtros por período, ação, resultado e quem fez; até 100 por página.",
      properties: { organization_id: organizationId, from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" }, action: { type: "string" }, cursor: { type: "string" } },
      example: { organization_id: "b01e1a06-...", from: "2026-10-01T00:00:00Z" },
      success: { code: "LISTED", description: "eventos de auditoria", example: { code: "LISTED", items: [{ action: "UPDATE", table: "alertas", actor: "Gestor Alfa", at: "2026-10-07T10:00:00Z" }], next: null } }
    }),
    "/profile-avatar": fn({
      tag: "Acesso",
      summary: "Foto da pessoa",
      description: "Onde guardar o arquivo depende da decisão D7.",
      properties: { image_base64: { type: "string" } },
      example: { image_base64: "iVBORw0KGgo..." },
      success: { code: "SAVED", description: "foto salva", example: { code: "SAVED" } }
    }),

    "/query-cylinders": fn({
      tag: "Cilindros",
      summary: "Consultar cilindros, identificadores, histórico e tipos",
      description: "Tabelas `cilindros`, `tipos_cilindro`, `identificadores_cilindro`, `testes_hidrostaticos` e `historico_cilindro` (o histórico já recebe vínculos de lacre e alertas vindos da Oxide). `get` traz também o lacre atual.",
      operations: ["list", "get", "lookup", "history", "catalog"],
      properties: {
        organization_id: organizationId,
        cylinder_id: { type: "string", format: "uuid" },
        identifier_value: { type: "string" },
        search: { type: "string" },
        status: { type: "string", enum: ["active", "inactive", "all"] },
        stock_status: { type: "string", enum: ["in_stock", "out_of_stock"], description: "Depende da decisão D1" },
        hydro_status: { type: "string" },
        cursor: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 }
      },
      example: { operation: "list", organization_id: "b01e1a06-...", status: "active", limit: 25 },
      success: { code: "LISTED", description: "cilindros", example: { code: "LISTED", items: [cylinderExample], total: 50, next: "..." } }
    }),
    "/manage-cylinders": fn({
      tag: "Cilindros",
      summary: "Cadastro, identificadores, estoque e teste hidrostático",
      description: "Cada operação grava também no histórico do cilindro e na auditoria. Nada é apagado. Códigos próprios: SERIAL_CONFLICT, IDENTIFIER_CONFLICT, IDENTIFIER_UNAVAILABLE, VERSION_CONFLICT, CYLINDER_INACTIVE, ALREADY_IN_STOCK, ALREADY_INACTIVE, JUSTIFICATION_REQUIRED, IDEMPOTENCY_PAYLOAD_CONFLICT.",
      operations: ["create", "update", "save_type", "inactivate", "reactivate", "add_identifier", "deactivate_identifier", "transfer_identifier", "stock_in", "register_test", "rectify_test"],
      properties: {
        organization_id: organizationId,
        cylinder_id: { type: "string", format: "uuid" },
        expected_version: { type: "integer" },
        serial_number: { type: "string" },
        cylinder_type_id: { type: "string", format: "uuid" },
        identifier: { type: "object", properties: { kind: { type: "string", enum: ["qr_code", "data_matrix", "nfc_tag", "hull_number"] }, value: { type: "string" } } },
        reason: { type: "string", enum: ["written_off", "lost", "condemned", "other"] },
        justification: { type: "string", minLength: 5, maxLength: 500 },
        operation_key: { type: "string", format: "uuid", description: "stock_in: repetir a mesma chave não repete a operação" },
        performed_on: { type: "string", format: "date" },
        result: { type: "string", enum: ["approved", "rejected"] }
      },
      example: { operation: "create", organization_id: "b01e1a06-...", serial_number: "SN-000051", cylinder_type_id: "...", identifier: { kind: "qr_code", value: "QR-000051" } },
      success: { code: "CREATED", description: "cilindro cadastrado", example: { code: "CREATED", cylinder: { ...cylinderExample, code: "CIL-000051", serial_number: "SN-000051" } } },
      errors: { "409": "SERIAL_CONFLICT, IDENTIFIER_CONFLICT, VERSION_CONFLICT, CYLINDER_INACTIVE, ALREADY_IN_STOCK..." }
    }),

    "/query-overview": fn({
      tag: "Lacre e mapa",
      summary: "Visão geral com dados reais",
      description: "Substitui a fonte de exemplo do frontend. Um bloco por chamada. Definição de movimentação e desempenho: decisão D6.",
      properties: {
        organization_id: organizationId,
        block: { type: "string", enum: ["indicators", "map", "movement", "situation", "recent_alerts", "recent_cylinders", "performance"] }
      },
      required: ["block"],
      example: { organization_id: "b01e1a06-...", block: "indicators" },
      success: { code: "READY", description: "dados do bloco (ou EMPTY)", example: { code: "READY", data: { cylinders: 50, in_transit: 0, with_customer: 30, open_alerts: 10 } } }
    }),
    "/query-map": fn({
      tag: "Lacre e mapa",
      summary: "Lacres e cilindros no mapa, com a cor do alerta",
      description: "Última posição válida de cada cilindro (`telemetrias`). Sem GPS (quarentena), o ponto fica na última posição conhecida com `gps: no_signal`. A cor vem do alerta aberto de maior severidade.",
      properties: {
        organization_id: organizationId,
        bbox: { type: "array", items: { type: "number" }, description: "[oeste, sul, leste, norte] da área visível" },
        alert_only: { type: "boolean" }
      },
      example: { organization_id: "b01e1a06-...", alert_only: false },
      success: {
        code: "LISTED",
        description: "pontos do mapa",
        example: { code: "LISTED", points: [{ cylinder: { code: "CIL-000001" }, seal: { code: "LCR-000001", status: "SUSPEITA_VIOLACAO" }, device: { code: "DSP-000001" }, position: { latitude: -7.2091939, longitude: -39.3063666, at: "2026-10-07T04:03:57Z" }, gps: "ok", alert: { code: "ALT-000001", type: "LACRE_VIOLADO", severity: "CRITICA" } }] }
      }
    }),
    "/query-alerts": fn({
      tag: "Lacre e mapa",
      summary: "Consultar alertas",
      description: "Tabela `alertas` (alertas vindos do lacre pela Oxide), com lacre, cilindro e última posição. Permissão do FluxID: VISUALIZAR_ALERTAS.",
      operations: ["list", "get"],
      properties: {
        organization_id: organizationId,
        alert_id: { type: "string", example: "ALT-000001" },
        status: { type: "string", enum: ["ABERTO", "EM_ANALISE", "ENCERRADO"] },
        severity: { type: "string", enum: ["BAIXA", "MEDIA", "ALTA", "CRITICA"] },
        type: { type: "string", example: "LACRE_VIOLADO" },
        cursor: { type: "string" }
      },
      example: { operation: "list", organization_id: "b01e1a06-...", status: "ABERTO" },
      success: { code: "LISTED", description: "alertas", example: { code: "LISTED", items: [{ code: "ALT-000001", type: "LACRE_VIOLADO", severity: "CRITICA", status: "ABERTO", cylinder: "CIL-000001", seal: "LCR-000001", opened_at: "2026-09-23T05:40:59Z" }], next: null } }
    }),
    "/manage-alerts": fn({
      tag: "Lacre e mapa",
      summary: "Analisar e encerrar alertas",
      description: "Permissão do FluxID: ENCERRAR_ALERTAS. `close` grava quem encerrou (usuário logado) e o motivo, e entra no histórico do cilindro. `justify` (motorista, saída de rota) fica para a fase de geofence. Onde o alerta é tratado: decisão D5.",
      operations: ["analyze", "close", "justify"],
      properties: {
        organization_id: organizationId,
        alert_id: { type: "string", example: "ALT-000001" },
        resolution_note: { type: "string" },
        justification: { type: "string" }
      },
      example: { operation: "close", organization_id: "b01e1a06-...", alert_id: "ALT-000001", resolution_note: "Lacre conferido no local" },
      success: { code: "CLOSED", description: "alerta encerrado", example: { code: "CLOSED", alert: { code: "ALT-000001", status: "ENCERRADO", closed_at: "2026-10-08T10:00:00Z" } } },
      errors: { "409": "INVALID_TRANSITION: alerta já encerrado ou transição não permitida" }
    }),
    "/query-seals": fn({
      tag: "Lacre e mapa",
      summary: "Lacres, dispositivo e cilindro atuais",
      description: "Tabelas `lacres`, `vinculos_dispositivo_lacre`, `vinculos_cilindro_lacre` e `inspecoes_lacre`.",
      operations: ["list", "get"],
      properties: { organization_id: organizationId, seal_id: { type: "string", format: "uuid" }, status: { type: "string" } },
      example: { operation: "get", organization_id: "b01e1a06-...", seal_id: "..." },
      success: { code: "FOUND", description: "lacre", example: { code: "FOUND", seal: { code: "LCR-000001", nfc_uid: "04A2B3C4D5", status: "INSTALADO", next_review_on: "2031-01-01" }, device: { code: "DSP-000001" }, cylinder: { code: "CIL-000001" } } }
    }),
    "/manage-seals": fn({
      tag: "Lacre e mapa",
      summary: "Cadastro de lacre e dispositivo, chave, vínculos e violação",
      description: "Tudo o que é cadastrado aqui chega à Oxide pelo Worker (a cada 5 min). `create_device` e `rotate_device_key` devolvem a chave **uma única vez**; o FluxID guarda só o hash (`api_key_hash`). Um vínculo ativo por vez (RN04/RN05). `confirm_violation`: o gestor confirma SUSPEITA_VIOLACAO → ROMPIDO, ou libera (P8). `inspect`: conferência física com leitura do NFC.",
      operations: ["create_seal", "create_device", "rotate_device_key", "bind_device", "bind_cylinder", "unbind", "confirm_violation", "inspect"],
      properties: {
        organization_id: organizationId,
        seal_id: { type: "string", format: "uuid" },
        device_id: { type: "string", format: "uuid" },
        cylinder_id: { type: "string", format: "uuid" },
        code: { type: "string", example: "LCR-000051" },
        nfc_uid: { type: "string" },
        hardware_id: { type: "string" },
        replace: { type: "boolean" },
        reason: { type: "string" },
        justification: { type: "string" }
      },
      example: { operation: "create_device", organization_id: "b01e1a06-...", code: "DSP-000051", hardware_id: "ESP32-AABBCCDDEEFF" },
      success: { code: "CREATED", description: "dispositivo cadastrado; a chave aparece só agora", example: { code: "CREATED", device: { code: "DSP-000051" }, api_key: "mostrada-uma-unica-vez" } },
      errors: { "409": "BINDING_CONFLICT ou CODE_CONFLICT" }
    }),
    "/query-telemetry": fn({
      tag: "Lacre e mapa",
      summary: "Trajeto, eventos e leituras sem GPS",
      description: "Tabelas `telemetrias`, `eventos_lacre`, `eventos_dispositivo` e `telemetrias_quarentena`.",
      operations: ["track", "events", "quarantine"],
      properties: {
        organization_id: organizationId,
        cylinder_id: { type: "string", format: "uuid" },
        device_id: { type: "string", format: "uuid" },
        from: { type: "string", format: "date-time" },
        to: { type: "string", format: "date-time" }
      },
      example: { operation: "track", organization_id: "b01e1a06-...", cylinder_id: "...", from: "2026-10-07T00:00:00Z", to: "2026-10-07T23:59:59Z" },
      success: { code: "LISTED", description: "posições em ordem", example: { code: "LISTED", points: [{ latitude: -7.21, longitude: -39.31, at: "2026-10-07T04:03:57Z", battery: 80 }] } }
    }),
    "/manage-commands": fn({
      tag: "Lacre e mapa",
      summary: "Travar e destravar a válvula",
      description: "Cria o comando PENDENTE na Oxide; o ESP32 busca e confirma como já faz. Só com login, permissão ENVIAR_COMANDOS e justificativa (decisão D8). Hoje não existe rota para criar comando, por segurança.",
      operations: ["send", "list"],
      properties: {
        organization_id: organizationId,
        device_id: { type: "string", example: "DSP-000001" },
        command_type: { type: "string", enum: ["TRAVAR_VALVULA", "DESTRAVAR_VALVULA"] },
        justification: { type: "string" }
      },
      example: { operation: "send", organization_id: "b01e1a06-...", device_id: "DSP-000001", command_type: "TRAVAR_VALVULA", justification: "Lacre rompido em trânsito" },
      success: { code: "QUEUED", description: "comando criado", example: { code: "QUEUED", command: { id: "CMD-000001", status: "PENDENTE" } } }
    })
  }
};

export default openApiFluxidSpec;
