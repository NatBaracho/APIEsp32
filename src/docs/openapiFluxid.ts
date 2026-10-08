// Documentação da API do frontend sobre o FluxID (Doc/Contrato-API-Frontend.md
// v1.0). Página /api-docs-fluxid; as funções estão em src/app.

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
  "400": "VALIDATION_FAILED: corpo inválido (traz `fields: [{ field, message }]`); JUSTIFICATION_REQUIRED quando falta justificativa (5 a 500 caracteres)",
  "401": "AUTH_REQUIRED: sem token, sessão vencida ou sem vínculo ativo na organização informada",
  "403": "ACCESS_DENIED: sem a permissão da operação",
  "404": "NOT_FOUND: não existe ou é de outra organização (mesma resposta)",
  "405": "METHOD_NOT_ALLOWED: só POST",
  "500": "INTERNAL_ERROR: falha inesperada, sem detalhe",
  "503": "UNAVAILABLE: FluxID fora do ar ou não configurado"
};

const organizationId = {
  type: "string",
  format: "uuid",
  description: "Organização ativa. É só contexto: o servidor confere pelo token se a pessoa tem vínculo ativo nela"
};

const uuid = { type: "string", format: "uuid" };
const justification = { type: "string", minLength: 5, maxLength: 500 };

function fn(doc: FunctionDoc): object {
  const properties: Record<string, object> = {};
  if (doc.operations) properties.operation = { type: "string", enum: doc.operations };
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
      description: doc.description,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", required: [...(doc.operations ? ["operation"] : []), ...(doc.required ?? [])], properties },
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

const ORG = "b01e1a06-1f63-4a57-a720-7cc10d76ef73";

const cylinderExample = {
  id: "5ff5c689-39ec-4c83-bc3a-de20caa585b6",
  code: "CIL-000001",
  serial_number: "SN-000001",
  type: { id: "3c1f...", gas: "Oxigênio", capacity_value: 50, capacity_unit: "l", classification: "medicinal", active: true },
  status: "active",
  operational_status: "COM_CLIENTE",
  stock_status: "out_of_stock",
  hydro_status: "em_dia",
  active_identifier_count: 1,
  version: 1
};

const openApiFluxidSpec = {
  openapi: "3.0.3",
  info: {
    title: "API FluxID para o frontend",
    version: "1.0.0",
    description: [
      "Contrato completo: `Doc/Contrato-API-Frontend.md` (v1.0).",
      "",
      "Todas as chamadas são `POST http://<servidor>:3000/api/v1/app/<função>`, com `authorization: Bearer <token>` (exceto login, recuperação de senha e aceite de convite) e corpo JSON. A resposta é sempre `{ \"code\": \"...\", ... }`.",
      "",
      "A API imita o jeito como o frontend já chama o servidor (mesmos nomes de função, corpo e códigos) e lê e grava direto no FluxID (PostgreSQL). Os campos do JSON ficam em inglês (D9); a API converte para as colunas do FluxID.",
      "",
      "O navegador só consegue chamar a API a partir das origens em `APP_ORIGENS` (CORS).",
      "",
      "A API do lacre (ESP32), da Oxide e da sincronização está em `/api-docs`."
    ].join("\n")
  },
  servers: [{ url: "http://localhost:3000/api/v1/app", description: "Servidor local" }],
  tags: [
    { name: "Login e sessão", description: "Entrar, conferir a sessão, sair e recuperar a senha (D3)" },
    { name: "Acesso", description: "Permissões, organizações, pessoas, papéis, convites, auditoria e foto" },
    { name: "Cilindros", description: "As telas de cilindros que o frontend já tem (etapa 006), sobre o FluxID" },
    { name: "Lacre e mapa", description: "Visão geral, mapa, alertas, lacres, dispositivos, trajeto e comandos: os dados que vêm do lacre pela Oxide" },
    { name: "Clientes e entregas", description: "Clientes, endereços com geocerca, entregas, rotas e desvios (base das regras automáticas de geocerca e rota)" }
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
      description: "Sem token. Senha conferida com scrypt. Sessão de até 8 h; 30 min sem uso encerram. Até 3 sessões ativas por pessoa (a 4ª pede `revoke_session_id`). 5 falhas em 15 min bloqueiam o e-mail por 15 min. O token é opaco; o FluxID guarda só o hash (`sessoes_usuario`).",
      properties: {
        email: { type: "string", format: "email" },
        password: { type: "string", format: "password" },
        revoke_session_id: { ...uuid, description: "Só depois de SESSION_LIMIT_REACHED: encerra essa sessão e entra" }
      },
      required: ["email", "password"],
      example: { email: "admin@alfagases.teste", password: "********" },
      success: {
        code: "AUTHENTICATED",
        description: "sessão criada",
        example: {
          code: "AUTHENTICATED",
          session: { access_token: "u8Q...", refresh_token: "", expires_at: "2026-10-08T15:30:00Z" },
          access_token: "u8Q...", expires_at: "2026-10-08T15:30:00Z", session_id: "…",
          user: { id: "…", name: "Admin Alfa" },
          organizations: [{ id: ORG, code: "ORG-000002", name: "Alfa Gases", roles: ["ORG_ADMIN"] }]
        }
      },
      errors: {
        "400": "INVALID_REQUEST: e-mail ou senha ausentes ou malformados",
        "401": "INVALID_CREDENTIALS",
        "403": "ACCOUNT_UNAVAILABLE: pessoa inativa ou sem organização ativa",
        "409": "SESSION_LIMIT_REACHED: traz `sessions` [{ session_id, started_at, last_seen_at, aal }]",
        "429": "RATE_LIMITED"
      }
    })),
    "/session-status": fn({
      tag: "Login e sessão",
      summary: "Conferir se a sessão continua válida",
      description: "Também renova a contagem de inatividade.",
      properties: {},
      example: {},
      success: { code: "SESSION_ACTIVE", description: "sessão válida", example: { code: "SESSION_ACTIVE", aal: "aal1", mfa_required: false, expires_at: "2026-10-08T15:30:00Z" } },
      errors: { "401": "SESSION_EXPIRED (com `reason`: timebox ou inactivity), SESSION_REVOKED ou SESSION_INVALID" }
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
      description: "Sem token. Pedido (`email`): sempre RECOVERY_REQUEST_ACCEPTED para e-mail bem formado (não revela quem existe); o token vale 1 h e é de uso único. **Ainda não há envio de e-mail**: em teste (`APP_EXPOR_TOKENS=1`) o token volta em `recovery_token`. Troca (`token` + `new_password`): grava a nova senha e encerra as sessões abertas.",
      properties: {
        email: { type: "string", format: "email" },
        token: { type: "string", description: "Segunda etapa: token do link" },
        new_password: { type: "string", format: "password", minLength: 8, maxLength: 128 }
      },
      example: { email: "admin@alfagases.teste" },
      success: { code: "RECOVERY_REQUEST_ACCEPTED", description: "pedido aceito (ou PASSWORD_UPDATED na troca)", example: { code: "RECOVERY_REQUEST_ACCEPTED" } },
      errors: { "400": "INVALID_REQUEST, VALIDATION_FAILED ou RECOVERY_TOKEN_INVALID" }
    })),

    "/query-permissions": fn({
      tag: "Acesso",
      summary: "O que a pessoa pode fazer (monta o menu)",
      description: "Códigos do frontend (`cylinder.read`...) calculados das permissões do FluxID nos papéis da pessoa naquela organização (D2). `global`: permissões de plataforma (`platform.manage`, `audit.read`).",
      properties: { organization_id: organizationId },
      example: { organization_id: ORG },
      success: { code: "PERMISSIONS_LISTED", description: "permissões", example: { code: "PERMISSIONS_LISTED", tenant: ["alert.close", "cylinder.read", "cylinder.write"], global: [], organization_id: ORG } }
    }),
    "/manage-organizations": fn({
      tag: "Acesso",
      summary: "Empresas (organizações)",
      description: "`list`: plataforma vê todas, os demais as suas. `create`, `change_status` e `invite_first_admin` exigem `platform.manage`.",
      operations: ["list", "create", "change_status", "invite_first_admin"],
      properties: {
        target_organization_id: uuid, legal_name: { type: "string" }, name: { type: "string" }, cnpj: { type: "string" },
        email: { type: "string", format: "email" }, status: { type: "string", enum: ["active", "inactive", "suspended"] }
      },
      example: { operation: "list" },
      success: { code: "LISTED", description: "organizações", example: { code: "LISTED", items: [{ id: ORG, code: "ORG-000002", name: "Alfa Gases", status: "active" }] } },
      errors: { "409": "CNPJ_CONFLICT" }
    }),
    "/manage-membership": fn({
      tag: "Acesso",
      summary: "Pessoas da empresa",
      description: "Permissão `tenant.manage`. Uma pessoa pode estar em várias organizações (D4: `usuario_organizacoes`). Ninguém altera o próprio vínculo.",
      operations: ["list", "change_status"],
      properties: { organization_id: organizationId, user_id: uuid, status: { type: "string", enum: ["active", "blocked", "inactive"] } },
      example: { operation: "list", organization_id: ORG },
      success: { code: "LISTED", description: "pessoas", example: { code: "LISTED", items: [{ user_id: "…", name: "Admin Alfa", roles: ["ORG_ADMIN"], status: "active" }] } }
    }),
    "/manage-access": fn({
      tag: "Acesso",
      summary: "Papéis e permissões",
      description: "`list`, `assign_role`, `remove_role`: `tenant.manage` (papel por organização). `save_role` e `set_role_active` mudam o papel no sistema todo: `platform.manage`. FLUXID_MASTER só é atribuído pela plataforma.",
      operations: ["list", "assign_role", "remove_role", "save_role", "set_role_active"],
      properties: {
        organization_id: organizationId, user_id: uuid, role_code: { type: "string", example: "OPERADOR" },
        code: { type: "string" }, name: { type: "string" }, permissions: { type: "array", items: { type: "string" }, description: "Códigos do FluxID (ex.: VER_CILINDROS)" },
        active: { type: "boolean" }
      },
      example: { operation: "assign_role", organization_id: ORG, user_id: "…", role_code: "OPERADOR" },
      success: { code: "UPDATED", description: "papel atribuído", example: { code: "UPDATED" } }
    }),
    "/invite-user": fn({
      tag: "Acesso",
      summary: "Convites",
      description: "`invite`, `list`, `resend`, `revoke`: `tenant.manage`. Convite de 7 dias, uso único. `accept` é **sem token**: cria a pessoa (nome e senha) ou só a vincula, se o e-mail já existe. Sem envio de e-mail ainda: em teste o token volta em `invite_token`.",
      operations: ["invite", "list", "resend", "revoke", "accept"],
      properties: {
        organization_id: organizationId, email: { type: "string", format: "email" }, role_code: { type: "string" }, invite_id: uuid,
        token: { type: "string" }, name: { type: "string" }, password: { type: "string", format: "password" }
      },
      example: { operation: "invite", organization_id: ORG, email: "motorista@alfagases.teste", role_code: "OPERADOR" },
      success: { code: "INVITED", description: "convite criado (INVITE_ACCEPTED, INVITE_RESENT, INVITE_REVOKED, LISTED)", example: { code: "INVITED", invite_id: "…", expires_at: "2026-10-14T12:00:00Z" } },
      errors: { "400": "INVITE_INVALID (aceite com token vencido, usado ou revogado)" }
    }),
    "/query-audit": fn({
      tag: "Acesso",
      summary: "Auditoria",
      description: "Permissão `audit.read`. Tabela `auditoria` da organização; filtros por período, ação, pessoa e tabela.",
      properties: {
        organization_id: organizationId, from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" },
        action: { type: "string", enum: ["INSERT", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "AUTORIZACAO"] }, actor_id: uuid, table: { type: "string" },
        cursor: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 }
      },
      example: { organization_id: ORG, from: "2026-10-01T00:00:00Z" },
      success: { code: "LISTED", description: "registros", example: { code: "LISTED", items: [{ action: "UPDATE", table: "alertas", note: "alert.close", actor_name: "Admin Alfa", occurred_at: "2026-10-07T10:00:00Z" }], next: null } }
    }),
    "/profile-avatar": fn({
      tag: "Acesso",
      summary: "Foto da própria pessoa",
      description: "D7 (a): arquivo na pasta do servidor (`APP_PASTA_ARQUIVOS`). PNG, JPEG ou WEBP até 512 KB, em base64; o conteúdo é conferido.",
      operations: ["get", "upload", "remove"],
      properties: { content_type: { type: "string", enum: ["image/png", "image/jpeg", "image/webp"] }, data_base64: { type: "string" } },
      example: { operation: "upload", content_type: "image/png", data_base64: "iVBORw0KGgo..." },
      success: { code: "SAVED", description: "foto salva (FOUND, NO_AVATAR, REMOVED)", example: { code: "SAVED" } }
    }),

    "/query-cylinders": fn({
      tag: "Cilindros",
      summary: "Consultar cilindros, identificadores, histórico e tipos",
      description: "Mesmo contrato da etapa 006 do frontend. `hydro_status`: em_dia, a_vencer (até 30 dias), vencido, reprovado ou sem_teste. Cilindro anterior ao catálogo de tipos vem com `type.legacy: true`. `get` traz também o lacre atual (`seal`). O histórico inclui os eventos do lacre e dos alertas vindos da Oxide (seal_bound, seal_unbound, alert_opened, alert_closed).",
      operations: ["list", "get", "lookup", "history", "catalog"],
      properties: {
        organization_id: organizationId, cylinder_id: uuid, identifier_value: { type: "string" }, search: { type: "string" },
        status: { type: "string", enum: ["active", "inactive", "all"] }, stock_status: { type: "string", enum: ["in_stock", "out_of_stock"] },
        hydro_status: { type: "string", enum: ["em_dia", "a_vencer", "vencido", "reprovado", "sem_teste"] },
        cylinder_type_id: uuid, sort: { type: "string", enum: ["serial", "serial_desc"] }, event_type: { type: "string" },
        from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" }, order: { type: "string", enum: ["asc", "desc"] },
        cursor: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 }
      },
      example: { operation: "list", organization_id: ORG, status: "active", limit: 25 },
      success: { code: "LISTED", description: "cilindros (FOUND em get e lookup)", example: { code: "LISTED", items: [cylinderExample], total: 50, next: "MjU" } }
    }),
    "/manage-cylinders": fn({
      tag: "Cilindros",
      summary: "Cadastro, identificadores, estoque e teste hidrostático",
      description: "Cada operação grava no histórico do cilindro (origem USUARIO) e na auditoria, na mesma transação. Nada é apagado. `version` sobe em update, inactivate, reactivate e stock_in. `stock_in` é idempotente pela `operation_key` (repetição devolve `replayed: true`) e encerra a custódia no cliente. Teste sem `next_due_on`: 5 anos depois.",
      operations: ["create", "update", "save_type", "inactivate", "reactivate", "add_identifier", "deactivate_identifier", "transfer_identifier", "stock_in", "register_test", "rectify_test"],
      properties: {
        organization_id: organizationId, cylinder_id: uuid, expected_version: { type: "integer" }, serial_number: { type: "string" },
        cylinder_type_id: uuid, manufacturer: { type: "string" }, manufacture_year: { type: "integer" }, working_pressure_bar: { type: "number" }, notes: { type: "string" },
        identifier: { type: "object", properties: { kind: { type: "string", enum: ["qr_code", "data_matrix", "nfc_tag", "hull_number"] }, value: { type: "string" } } },
        kind: { type: "string", enum: ["qr_code", "data_matrix", "nfc_tag", "hull_number"] }, value: { type: "string" }, identifier_id: uuid,
        target_cylinder_id: uuid, confirmed: { type: "boolean" },
        reason: { type: "string", enum: ["written_off", "lost", "condemned", "other"] }, justification,
        identifier_value: { type: "string" }, operation_key: uuid,
        gas: { type: "string" }, capacity_value: { type: "number" }, capacity_unit: { type: "string", enum: ["l", "m3", "kg"] },
        classification: { type: "string", enum: ["medicinal", "industrial"] }, type_id: uuid, active: { type: "boolean" },
        test_id: uuid, performed_on: { type: "string", format: "date" }, result: { type: "string", enum: ["approved", "rejected"] },
        report_number: { type: "string" }, executor: { type: "string" }, next_due_on: { type: "string", format: "date" }
      },
      example: { operation: "create", organization_id: ORG, serial_number: "SN-000051", cylinder_type_id: "…", identifier: { kind: "qr_code", value: "QR-000051" } },
      success: { code: "CREATED", description: "cilindro cadastrado (UPDATED, SAVED, INACTIVATED, REACTIVATED, ADDED, DEACTIVATED, TRANSFERRED, STOCKED, REGISTERED, RECTIFIED)", example: { code: "CREATED", cylinder_id: "…", cylinder_code: "CIL-000156", version: 1 } },
      errors: { "409": "SERIAL_CONFLICT, IDENTIFIER_CONFLICT, IDENTIFIER_UNAVAILABLE, VERSION_CONFLICT, CYLINDER_INACTIVE, ALREADY_IN_STOCK, ALREADY_INACTIVE, IDEMPOTENCY_PAYLOAD_CONFLICT, TEST_ALREADY_RECTIFIED" }
    }),

    "/query-overview": fn({
      tag: "Lacre e mapa",
      summary: "Visão geral com dados reais",
      description: "Um bloco por chamada; responde READY com `data` ou EMPTY. D6: movimentação = saídas e entregas por dia (`days`, padrão 14); desempenho = % com GPS nas últimas 24 h, % de alertas encerrados em até 24 h (30 dias) e % de testes hidrostáticos em dia.",
      properties: {
        organization_id: organizationId,
        block: { type: "string", enum: ["indicators", "map", "movement", "situation", "recent_alerts", "recent_cylinders", "performance"] },
        days: { type: "integer", minimum: 1, maximum: 90 }
      },
      required: ["block"],
      example: { organization_id: ORG, block: "indicators" },
      success: { code: "READY", description: "dados do bloco (ou EMPTY)", example: { code: "READY", data: { cylinders_total: 50, in_transit: 3, with_customer: 30, in_stock: 17, open_alerts: 10 } } }
    }),
    "/query-map": fn({
      tag: "Lacre e mapa",
      summary: "Lacres e cilindros no mapa, com a cor do alerta",
      description: "Última posição válida de cada cilindro (`telemetrias`). Se a leitura mais recente veio sem GPS (quarentena), o ponto fica na última posição conhecida com `gps: no_signal` (P2). `alert` é o alerta aberto de maior severidade.",
      properties: {
        organization_id: organizationId,
        bbox: { type: "array", items: { type: "number" }, description: "[oeste, sul, leste, norte]" },
        alert_only: { type: "boolean" }
      },
      example: { organization_id: ORG, alert_only: false },
      success: {
        code: "LISTED",
        description: "pontos do mapa",
        example: { code: "LISTED", points: [{ cylinder: { id: "…", code: "CIL-000001", serial_number: "SN-000001", status: "EM_TRANSITO" }, seal: { id: "…", code: "LCR-000001", status: "INSTALADO" }, device: { id: "…", code: "DSP-000001" }, position: { latitude: -7.2091939, longitude: -39.3063666, at: "2026-10-07T04:03:57Z" }, battery_percent: 80, gps: "ok", alert: { code: "AUT-MG2K1Z3A-1F2E", type: "SAIDA_ROTA", severity: "ALTA" } }] }
      }
    }),
    "/query-alerts": fn({
      tag: "Lacre e mapa",
      summary: "Consultar alertas",
      description: "Permissão `alert.read` (VISUALIZAR_ALERTAS). Alertas do lacre e os automáticos (código `AUT-…`). Ordem: abertos primeiro, por severidade. `alert_id` aceita o id ou o código. `get` traz a posição mais próxima do momento do alarme.",
      operations: ["list", "get"],
      properties: {
        organization_id: organizationId, alert_id: { type: "string" },
        status: { type: "string", enum: ["ABERTO", "EM_ANALISE", "ENCERRADO"] }, severity: { type: "string", enum: ["BAIXA", "MEDIA", "ALTA", "CRITICA"] },
        type: { type: "string" }, cylinder_id: uuid, from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" },
        cursor: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 }
      },
      example: { operation: "list", organization_id: ORG, status: "ABERTO" },
      success: { code: "LISTED", description: "alertas", example: { code: "LISTED", items: [{ code: "AUT-MG2K1Z3A-1F2E", type: "SAIDA_ROTA", severity: "ALTA", status: "ABERTO", cylinder: { code: "CIL-000001" }, seal: { code: "LCR-000001" }, opened_at: "2026-10-07T12:00:00Z" }], total: 1, next: null } }
    }),
    "/manage-alerts": fn({
      tag: "Lacre e mapa",
      summary: "Analisar, encerrar e justificar alertas",
      description: "`analyze` e `close`: `alert.close` (ENCERRAR_ALERTAS). `justify`: `alert.justify` (motorista explica, só o gestor encerra). D5: o alerta tratado aqui fica marcado (`tratado_no_fluxid`) e a Oxide não o sobrescreve mais; o Worker espelha o novo estado na Oxide.",
      operations: ["analyze", "close", "justify"],
      properties: { organization_id: organizationId, alert_id: { type: "string" }, resolution_note: justification, justification },
      example: { operation: "close", organization_id: ORG, alert_id: "AUT-MG2K1Z3A-1F2E", resolution_note: "Desvio por obra na via, conferido com o motorista" },
      success: { code: "UPDATED", description: "alerta atualizado (JUSTIFIED no justify)", example: { code: "UPDATED", alert: { code: "AUT-MG2K1Z3A-1F2E", status: "ENCERRADO", closed_at: "2026-10-08T10:00:00Z", closed_by: "Admin Alfa" } } },
      errors: { "409": "INVALID_TRANSITION (traz `current_status`)" }
    }),
    "/query-seals": fn({
      tag: "Lacre e mapa",
      summary: "Lacres e dispositivos",
      description: "Permissão `seal.read`. `list`/`get`: lacre, dispositivo e cilindro atuais, última inspeção, revisão vencida e o histórico de vínculos. `devices`: dispositivos com o último contato registrado na Oxide.",
      operations: ["list", "get", "devices"],
      properties: { organization_id: organizationId, seal_id: uuid, status: { type: "string" }, search: { type: "string" }, cursor: { type: "string" }, limit: { type: "integer" } },
      example: { operation: "get", organization_id: ORG, seal_id: "…" },
      success: { code: "FOUND", description: "lacre (LISTED em list e devices)", example: { code: "FOUND", seal: { code: "LCR-000001", nfc_uid: "04A2B3C4D5", status: "INSTALADO", next_review_on: "2031-01-01", device: { code: "DSP-000001", binding_id: "…" }, cylinder: { code: "CIL-000001", binding_id: "…" } }, bindings: [] } }
    }),
    "/manage-seals": fn({
      tag: "Lacre e mapa",
      summary: "Cadastro de lacre e dispositivo, chave, vínculos, violação e inspeção",
      description: "Permissão `seal.write`. Tudo chega à Oxide pelo Worker (cadastro a cada 5 min). `create_device` e `rotate_device_key` devolvem a chave **uma única vez** (`api_key`); o FluxID guarda só o hash. Um vínculo ativo por vez (RN04/RN05): sem `replace`, conflito responde BINDING_CONFLICT. `bind_cylinder` deixa o lacre INSTALADO; `unbind` do cilindro o deixa REMOVIDO. `confirm_violation` (também exige `alert.close`): SUSPEITA_VIOLACAO → ROMPIDO (`confirm`) ou INSTALADO (`release`) (P8).",
      operations: ["create_seal", "create_device", "rotate_device_key", "set_device_active", "bind_device", "bind_cylinder", "unbind", "confirm_violation", "inspect"],
      properties: {
        organization_id: organizationId, seal_id: uuid, device_id: uuid, cylinder_id: uuid, binding_id: uuid,
        code: { type: "string", description: "Opcional: sem ele, LCR-000001 / DSP-000001 sequenciais" },
        nfc_uid: { type: "string" }, manufactured_on: { type: "string", format: "date" }, next_review_on: { type: "string", format: "date" },
        hardware_id: { type: "string" }, firmware_version: { type: "string" }, model: { type: "string" }, active: { type: "boolean" },
        replace: { type: "boolean" }, reason: justification, justification, decision: { type: "string", enum: ["confirm", "release"] },
        result: { type: "string", enum: ["APROVADO", "APROVADO_COM_RESTRICAO", "REPROVADO", "INUTILIZADO"] }, inspected_on: { type: "string", format: "date" }
      },
      example: { operation: "create_device", organization_id: ORG, hardware_id: "ESP32-AABBCCDDEEFF", firmware_version: "1.0.0" },
      success: { code: "CREATED", description: "cadastrado (BOUND, UNBOUND, KEY_ROTATED, UPDATED, INSPECTED)", example: { code: "CREATED", device_id: "…", device_code: "DSP-000052", api_key: "mostrada-uma-unica-vez" } },
      errors: { "409": "BINDING_CONFLICT, SEAL_NOT_INSTALLABLE, CYLINDER_INACTIVE, DEVICE_INACTIVE, CODE_CONFLICT, NFC_CONFLICT, HARDWARE_ID_CONFLICT, INVALID_TRANSITION" }
    }),
    "/query-telemetry": fn({
      tag: "Lacre e mapa",
      summary: "Trajeto, eventos e leituras sem GPS",
      description: "Permissão `seal.read`. `track`: posições em ordem (até 5000). `events`: eventos do lacre e do dispositivo. `quarantine`: leituras sem posição.",
      operations: ["track", "events", "quarantine"],
      properties: {
        organization_id: organizationId, cylinder_id: uuid, device_id: uuid, seal_id: uuid,
        from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" }, limit: { type: "integer", maximum: 5000 }
      },
      example: { operation: "track", organization_id: ORG, cylinder_id: "…", from: "2026-10-07T00:00:00Z" },
      success: { code: "LISTED", description: "posições (events, readings)", example: { code: "LISTED", positions: [{ at: "2026-10-07T04:03:57Z", latitude: -7.21, longitude: -39.31, speed_kmh: 42, battery_percent: 80, gsm_signal: -71 }] } }
    }),
    "/manage-commands": fn({
      tag: "Lacre e mapa",
      summary: "Travar e destravar a válvula",
      description: "D8: `send` exige `command.send` (ENVIAR_COMANDOS) e justificativa, e fica na auditoria. Cria o comando PENDENTE na Oxide; o ESP32 busca e confirma como já faz. Não duplica um pendente do mesmo tipo. O dispositivo precisa já ter chegado à Oxide (sincronização de cadastro). `list`: últimos 100 comandos.",
      operations: ["send", "list"],
      properties: {
        organization_id: organizationId, device_id: uuid,
        command_type: { type: "string", enum: ["TRAVAR_VALVULA", "DESTRAVAR_VALVULA"] }, justification
      },
      example: { operation: "send", organization_id: ORG, device_id: "…", command_type: "TRAVAR_VALVULA", justification: "Lacre aberto em trânsito" },
      success: { code: "COMMAND_QUEUED", description: "comando criado (COMMAND_ALREADY_PENDING se já havia um)", example: { code: "COMMAND_QUEUED", command_id: "CMD-MG2K1Z3A-0B1C" } },
      errors: { "409": "DEVICE_INACTIVE ou DEVICE_NOT_SYNCED" }
    }),

    "/query-deliveries": fn({
      tag: "Clientes e entregas",
      summary: "Clientes, endereços e entregas",
      description: "Permissão `cylinder.read`. `get_delivery` traz endereço (com a geocerca), cilindros, rota e desvios.",
      operations: ["list_customers", "list_deliveries", "get_delivery"],
      properties: { organization_id: organizationId, delivery_id: uuid, status: { type: "string", enum: ["PENDENTE", "EM_ANDAMENTO", "CONCLUIDA", "CANCELADA"] }, cursor: { type: "string" }, limit: { type: "integer" } },
      example: { operation: "get_delivery", organization_id: ORG, delivery_id: "…" },
      success: { code: "FOUND", description: "entrega (LISTED nas listas)", example: { code: "FOUND", delivery: { code: "ENT-000001", status: "EM_ANDAMENTO", location: { name: "Hospital Central", latitude: -7.23, longitude: -39.32, geofence_radius_meters: 200 }, cylinders: [{ code: "CIL-000001" }], route: { points: [{ latitude: -7.21, longitude: -39.31 }, { latitude: -7.23, longitude: -39.32 }], margin_meters: 50 }, deviations: [] } } }
    }),
    "/manage-deliveries": fn({
      tag: "Clientes e entregas",
      summary: "Cadastrar clientes e endereços, planejar entregas e rotas",
      description: "Clientes e endereços: `customer.write`. Entregas: `delivery.write`. Rota e desvios: `route.plan` (PLANEJAR_ROTAS). `start` põe os cilindros EM_TRANSITO (vale a regra SAIDA_ROTA); `finish` põe COM_CLIENTE e abre a custódia no endereço (vale a regra SAIDA_GEOCERCA); `cancel` devolve os em trânsito a DISPONIVEL; `end_custody` encerra a custódia (recolhimento). A margem da rota tem padrão de 50 m. Desvio PROGRAMADO ou JUSTIFICADO suspende a regra de rota no intervalo.",
      operations: ["create_customer", "create_location", "create_delivery", "set_route", "add_deviation", "start", "finish", "cancel", "end_custody"],
      properties: {
        organization_id: organizationId, customer_id: uuid, location_id: uuid, delivery_id: uuid, cylinder_id: uuid,
        legal_name: { type: "string" }, trade_name: { type: "string" }, document: { type: "string" }, email: { type: "string", format: "email" },
        name: { type: "string" }, street: { type: "string" }, number: { type: "string" }, district: { type: "string" }, city: { type: "string" },
        state: { type: "string", minLength: 2, maxLength: 2 }, zip: { type: "string" }, latitude: { type: "number" }, longitude: { type: "number" },
        geofence_radius_meters: { type: "integer", minimum: 10, maximum: 50000, description: "Padrão 200" },
        cylinder_ids: { type: "array", items: uuid }, planned_at: { type: "string", format: "date-time" },
        points: { type: "array", items: { type: "object", properties: { latitude: { type: "number" }, longitude: { type: "number" } } }, minItems: 2, maxItems: 500 },
        margin_meters: { type: "integer", minimum: 5, maximum: 5000 },
        type: { type: "string", enum: ["PROGRAMADO", "JUSTIFICADO"] }, start: { type: "string", format: "date-time" }, end: { type: "string", format: "date-time" },
        justification, reason: justification
      },
      example: { operation: "set_route", organization_id: ORG, delivery_id: "…", points: [{ latitude: -7.21, longitude: -39.31 }, { latitude: -7.23, longitude: -39.32 }], margin_meters: 50 },
      success: { code: "SAVED", description: "rota gravada (CREATED, STARTED, FINISHED, CANCELLED, CUSTODY_ENDED)", example: { code: "SAVED", route_id: "…" } },
      errors: { "409": "CYLINDER_INACTIVE, CYLINDER_IN_OTHER_DELIVERY, DELIVERY_FINISHED, INVALID_TRANSITION, CONFLICT" }
    })
  }
};

export default openApiFluxidSpec;
