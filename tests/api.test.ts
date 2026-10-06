import { server } from "../src/server";
import db from "../src/database/connection";

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

interface TestResult {
  name: string;
  passed: boolean;
  status?: number;
  expectedStatus?: number | number[];
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  fn: () => Promise<{ passed: boolean; status?: number; expectedStatus?: number | number[]; details?: string }>
) {
  try {
    const res = await fn();
    results.push({ name, ...res });
    const mark = res.passed ? "✅" : "❌";
    console.log(`${mark} ${name}${res.details ? ` (${res.details})` : ""}`);
  } catch (err: any) {
    results.push({ name, passed: false, error: err.message });
    console.log(`❌ ${name} -> Error: ${err.message}`);
  }
}

async function main() {
  console.log("==================================================");
  console.log("  INICIANDO SUÍTE COMPLETA DE TESTES DA API ESP32");
  console.log("==================================================\n");

  const TEST_DEVICE_ID = "DSP-TEST-AUTORUN";
  const TEST_API_KEY = "key-test-autorun-12345";
  const INACTIVE_DEVICE_ID = "DSP-TEST-INACTIVE";
  const INACTIVE_API_KEY = "key-test-inactive-12345";
  const AUTOCREATE_DEVICE_ID = "DSP-TEST-AUTOCREATE";
  const TEST_CMD_ID = "CMD-TEST-AUTORUN-001";
  const TEST_ALT_ID = "ALT-TEST-AUTORUN-001";

  // Pre-cleanup in case of dirty database
  db.prepare("DELETE FROM alerts WHERE device_id LIKE 'DSP-TEST%'").run();
  db.prepare("DELETE FROM commands WHERE device_id LIKE 'DSP-TEST%'").run();
  db.prepare("DELETE FROM telemetry_queue WHERE device_id LIKE 'DSP-TEST%'").run();
  db.prepare("DELETE FROM events WHERE device_id LIKE 'DSP-TEST%'").run();
  db.prepare("DELETE FROM devices WHERE device_id LIKE 'DSP-TEST%'").run();

  // Create inactive device for testing auth 403
  db.prepare(`
    INSERT INTO devices (device_id, api_key, firmware_version, active)
    VALUES (?, ?, '1.0.0', 0)
  `).run(INACTIVE_DEVICE_ID, INACTIVE_API_KEY);

  // Group 1: General & Documentation
  console.log("\n--- [1] Geral & Documentação ---");

  await runTest("GET / (Status da API)", async () => {
    const res = await fetch(`${BASE_URL}/`);
    const text = await res.text();
    const passed = res.status === 200 && text.includes("API ESP32 Online");
    return { passed, status: res.status, expectedStatus: 200, details: text };
  });

  await runTest("GET /api-docs/ (Swagger UI HTML)", async () => {
    const res = await fetch(`${BASE_URL}/api-docs/`);
    const text = await res.text();
    const passed = res.status === 200 && text.includes("swagger-ui");
    return { passed, status: res.status, expectedStatus: 200, details: "Swagger UI carregado" };
  });

  await runTest("GET /api-docs/swagger-ui-init.js (OpenAPI Spec)", async () => {
    const res = await fetch(`${BASE_URL}/api-docs/swagger-ui-init.js`);
    const text = await res.text();
    const passed = res.status === 200 && text.includes("API ESP32");
    return { passed, status: res.status, expectedStatus: 200, details: "Contém título 'API ESP32'" };
  });

  // Group 2: Devices
  console.log("\n--- [2] Dispositivos (/api/v1/devices) ---");

  await runTest("GET /api/v1/devices (Listar dispositivos)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/devices`);
    const json: any = await res.json();
    const passed = res.status === 200 && Array.isArray(json) && json.some((d: any) => d.device_id === "DSP-000001");
    return { passed, status: res.status, expectedStatus: 200, details: `Retornou ${json.length} dispositivos` };
  });

  await runTest("GET /api/v1/devices/:deviceId (Buscar dispositivo existente)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/devices/DSP-000001`);
    const json: any = await res.json();
    const passed = res.status === 200 && json.device_id === "DSP-000001";
    return { passed, status: res.status, expectedStatus: 200, details: `Device ID: ${json.device_id}` };
  });

  await runTest("GET /api/v1/devices/:deviceId (Dispositivo inexistente -> 404)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/devices/DSP-NONEXISTENT-999`);
    const json: any = await res.json();
    const passed = res.status === 404 && json.success === false;
    return { passed, status: res.status, expectedStatus: 404, details: json.message };
  });

  await runTest("POST /api/v1/devices (Validação sem campos obrigatórios -> 400)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const json: any = await res.json();
    const passed = res.status === 400 && json.success === false;
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
  });

  await runTest("POST /api/v1/devices (Cadastrar novo dispositivo -> 201)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: TEST_DEVICE_ID,
        api_key: TEST_API_KEY,
        firmware_version: "2.1.0"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 201 && json.success === true;
    return { passed, status: res.status, expectedStatus: 201, details: json.message };
  });

  await runTest("POST /api/v1/devices (Dispositivo duplicado -> 409)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: TEST_DEVICE_ID,
        api_key: TEST_API_KEY
      })
    });
    const json: any = await res.json();
    const passed = res.status === 409 && json.success === false;
    return { passed, status: res.status, expectedStatus: 409, details: json.message };
  });

  await runTest("POST /api/v1/devices (API Key já usada por outro dispositivo -> 409)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: "DSP-TEST-DUPKEY",
        api_key: TEST_API_KEY
      })
    });
    const json: any = await res.json();
    const exists = db.prepare("SELECT 1 FROM devices WHERE device_id = 'DSP-TEST-DUPKEY'").get();
    const passed = res.status === 409 && json.message === "API Key já está em uso" && !exists;
    return { passed, status: res.status, expectedStatus: 409, details: json.message };
  });

  await runTest("POST /api/v1/devices (active diferente de 0/1 -> 400)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: "DSP-TEST-ACTIVE7",
        api_key: "key-test-active7",
        active: 7
      })
    });
    const json: any = await res.json();
    const passed = res.status === 400 && json.success === false;
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
  });

  // Group 3: Authentication & Middleware
  console.log("\n--- [3] Autenticação & Middleware (X-API-Key) ---");

  await runTest("GET /api/v1/iot/telemetries sem X-API-Key -> 401", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`);
    const json: any = await res.json();
    const passed = res.status === 401 && json.message === "API Key obrigatória";
    return { passed, status: res.status, expectedStatus: 401, details: json.message };
  });

  await runTest("GET /api/v1/iot/telemetries com X-API-Key inválida -> 401", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      headers: { "X-API-Key": "invalid-key-xyz" }
    });
    const json: any = await res.json();
    const passed = res.status === 401 && json.message === "API Key inválida";
    return { passed, status: res.status, expectedStatus: 401, details: json.message };
  });

  await runTest("GET /api/v1/iot/telemetries com dispositivo inativo -> 403", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      headers: { "X-API-Key": INACTIVE_API_KEY }
    });
    const json: any = await res.json();
    const passed = res.status === 403 && json.message === "Dispositivo desativado";
    return { passed, status: res.status, expectedStatus: 403, details: json.message };
  });

  await runTest("GET /api/v1/iot/telemetries com X-API-Key válida -> 200", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      headers: { "X-API-Key": TEST_API_KEY }
    });
    const json: any = await res.json();
    const passed = res.status === 200 && Array.isArray(json);
    return { passed, status: res.status, expectedStatus: 200, details: `Retornou ${json.length} telemetrias` };
  });

  // Group 4: Telemetry
  console.log("\n--- [4] Telemetria (/api/v1/iot/telemetries) ---");

  await runTest("POST /api/v1/iot/telemetries sem campos obrigatórios -> 400", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({})
    });
    const json: any = await res.json();
    const passed = res.status === 400 && json.success === false;
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
  });

  await runTest("POST /api/v1/iot/telemetries com payload válido -> 202", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "MSG-TEST-TEL-001",
        device_id: TEST_DEVICE_ID,
        latitude: -8.05,
        longitude: -34.88,
        speed_kmh: 45.2,
        battery_percent: 92,
        gsm_signal: 28,
        last_seen_at: "2026-10-04T10:00:00Z"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 202 && json.success === true;
    return { passed, status: res.status, expectedStatus: 202, details: json.message };
  });

  await runTest("POST /api/v1/iot/telemetries com message_id duplicado -> 409", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "MSG-TEST-TEL-001",
        device_id: TEST_DEVICE_ID,
        latitude: -8.05,
        longitude: -34.88
      })
    });
    const json: any = await res.json();
    const passed = res.status === 409 && json.message === "Mensagem duplicada";
    return { passed, status: res.status, expectedStatus: 409, details: json.message };
  });

  await runTest("POST /api/v1/iot/telemetries mesma posição GPS -> 202 e atualiza apenas last_seen_at", async () => {
    const countBefore = (db.prepare("SELECT COUNT(*) as c FROM telemetry_queue WHERE device_id = ?").get(TEST_DEVICE_ID) as any).c;

    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "MSG-TEST-TEL-002",
        device_id: TEST_DEVICE_ID,
        latitude: -8.05,
        longitude: -34.88
      })
    });
    const json: any = await res.json();
    const countAfter = (db.prepare("SELECT COUNT(*) as c FROM telemetry_queue WHERE device_id = ?").get(TEST_DEVICE_ID) as any).c;
    const passed = res.status === 202 && countBefore === countAfter;
    return { passed, status: res.status, expectedStatus: 202, details: `Linhas mantidas em ${countAfter}` };
  });

  await runTest("POST /api/v1/iot/telemetries nova posição GPS -> 202 e insere nova linha", async () => {
    const countBefore = (db.prepare("SELECT COUNT(*) as c FROM telemetry_queue WHERE device_id = ?").get(TEST_DEVICE_ID) as any).c;

    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "MSG-TEST-TEL-003",
        device_id: TEST_DEVICE_ID,
        latitude: -8.10,
        longitude: -34.90
      })
    });
    const json: any = await res.json();
    const countAfter = (db.prepare("SELECT COUNT(*) as c FROM telemetry_queue WHERE device_id = ?").get(TEST_DEVICE_ID) as any).c;
    const passed = res.status === 202 && countAfter === countBefore + 1;
    return { passed, status: res.status, expectedStatus: 202, details: `Nova linha criada (total: ${countAfter})` };
  });

  await runTest("POST /api/v1/iot/telemetries reenvio de posição repetida -> 409", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "MSG-TEST-TEL-002",
        device_id: TEST_DEVICE_ID,
        latitude: -8.05,
        longitude: -34.88
      })
    });
    const json: any = await res.json();
    const passed = res.status === 409 && json.message === "Mensagem duplicada";
    return { passed, status: res.status, expectedStatus: 409, details: json.message };
  });

  await runTest("POST /api/v1/iot/telemetries ignora status e attempt_count do cliente -> 202", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "MSG-TEST-TEL-004",
        device_id: TEST_DEVICE_ID,
        latitude: -8.20,
        longitude: -34.95,
        status: "SYNCED",
        attempt_count: 99
      })
    });
    const row = db.prepare("SELECT status, attempt_count FROM telemetry_queue WHERE message_id = ?").get("MSG-TEST-TEL-004") as any;
    const passed = res.status === 202 && row?.status === "PENDING" && row?.attempt_count === 0;
    return { passed, status: res.status, expectedStatus: 202, details: `status=${row?.status}, attempt_count=${row?.attempt_count}` };
  });

  await runTest("POST /api/v1/iot/telemetries com latitude não numérica -> 400", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "MSG-TEST-TEL-005",
        device_id: TEST_DEVICE_ID,
        latitude: true,
        longitude: -34.95
      })
    });
    const json: any = await res.json();
    const passed = res.status === 400 && json.success === false;
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
  });

  await runTest("POST /api/v1/iot/telemetries para dispositivo inexistente -> 404", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "MSG-TEST-TEL-006",
        device_id: "DSP-TEST-NAO-EXISTE"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 404 && json.message === "Dispositivo não encontrado";
    return { passed, status: res.status, expectedStatus: 404, details: json.message };
  });

  await runTest("POST /api/v1/iot/telemetries com JSON malformado -> 400", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: "{ invalid json: 123"
    });
    const json: any = await res.json();
    const passed = res.status === 400 && json.message === "Requisição inválida";
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
  });

  // Group 5: Events
  console.log("\n--- [5] Eventos (/api/v1/iot/events) ---");

  await runTest("POST /api/v1/iot/events sem X-API-Key -> 401", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: "EVT-TEST-001", device_id: TEST_DEVICE_ID, event_type: "ALERT" })
    });
    const json: any = await res.json();
    const passed = res.status === 401 && json.message === "API Key obrigatória";
    return { passed, status: res.status, expectedStatus: 401, details: json.message };
  });

  await runTest("POST /api/v1/iot/events sem campos obrigatórios -> 400", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({ message_id: "EVT-TEST-001" })
    });
    const json: any = await res.json();
    const passed = res.status === 400 && json.success === false;
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
  });

  await runTest("POST /api/v1/iot/events com seal_status inválido -> 400", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "EVT-TEST-INV-SEAL",
        device_id: TEST_DEVICE_ID,
        event_type: "seal_changed",
        seal_status: "OPEN"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 400 && json.message.includes("seal_status deve ser LOCKED, UNLOCKED ou BROKEN");
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
  });

  await runTest("POST /api/v1/iot/events com payload válido -> 202", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "EVT-TEST-VALID-001",
        device_id: TEST_DEVICE_ID,
        event_type: "seal_locked",
        seal_status: "LOCKED"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 202 && json.success === true;
    return { passed, status: res.status, expectedStatus: 202, details: json.message };
  });

  await runTest("POST /api/v1/iot/events auto-criação de dispositivo inexistente -> 202", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "EVT-TEST-AUTOCREATE-001",
        device_id: AUTOCREATE_DEVICE_ID,
        event_type: "first_boot"
      })
    });
    const json: any = await res.json();
    const dev = db.prepare("SELECT * FROM devices WHERE device_id = ?").get(AUTOCREATE_DEVICE_ID);
    const passed = res.status === 202 && Boolean(dev);
    return { passed, status: res.status, expectedStatus: 202, details: `Dispositivo criado automaticamente: ${AUTOCREATE_DEVICE_ID}` };
  });

  await runTest("POST /api/v1/iot/events com message_id duplicado -> 409", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "EVT-TEST-VALID-001",
        device_id: TEST_DEVICE_ID,
        event_type: "seal_locked"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 409 && json.message === "Mensagem duplicada";
    return { passed, status: res.status, expectedStatus: 409, details: json.message };
  });

  // Group 6: Commands
  console.log("\n--- [6] Comandos (/api/v1/iot/commands) ---");

  // Seed a pending command
  db.prepare(`
    INSERT INTO commands (command_id, device_id, command_type, status, created_at)
    VALUES (?, ?, 'LOCK_VALVE', 'PENDENTE', datetime('now'))
  `).run(TEST_CMD_ID, TEST_DEVICE_ID);

  await runTest("GET /api/v1/iot/commands/:deviceId sem X-API-Key -> 401", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/commands/${TEST_DEVICE_ID}`);
    const json: any = await res.json();
    const passed = res.status === 401;
    return { passed, status: res.status, expectedStatus: 401, details: json.message };
  });

  await runTest("GET /api/v1/iot/commands/:deviceId com chave de outro dispositivo -> 403", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/commands/${TEST_DEVICE_ID}`, {
      headers: { "X-API-Key": "auto-DSP-000001" } // Key of DSP-000001
    });
    const json: any = await res.json();
    const passed = res.status === 403 && json.message === "API Key não pertence ao dispositivo";
    return { passed, status: res.status, expectedStatus: 403, details: json.message };
  });

  await runTest("GET /api/v1/iot/commands/:deviceId com chave correta -> 200 (Comando pendente)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/commands/${TEST_DEVICE_ID}`, {
      headers: { "X-API-Key": TEST_API_KEY }
    });
    const json: any = await res.json();
    const passed = res.status === 200 && Array.isArray(json) && json.some((c: any) => c.command_id === TEST_CMD_ID);
    return { passed, status: res.status, expectedStatus: 200, details: `Encontrou comando ${TEST_CMD_ID}` };
  });

  await runTest("POST /api/v1/iot/commands/confirm com status inválido -> 400", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/commands/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        command_id: TEST_CMD_ID,
        device_id: TEST_DEVICE_ID,
        status: "INVALID_STATUS"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 400 && json.success === false;
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
  });

  await runTest("POST /api/v1/iot/commands/confirm comando inexistente -> 404", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/commands/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        command_id: "CMD-NONEXISTENT-999",
        device_id: TEST_DEVICE_ID,
        status: "EXECUTADO"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 404 && json.success === false;
    return { passed, status: res.status, expectedStatus: 404, details: json.message };
  });

  await runTest("POST /api/v1/iot/commands/confirm confirmar como EXECUTADO -> 200", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/commands/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        command_id: TEST_CMD_ID,
        device_id: TEST_DEVICE_ID,
        status: "EXECUTADO"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 200 && json.success === true;
    return { passed, status: res.status, expectedStatus: 200, details: json.message };
  });

  await runTest("POST /api/v1/iot/commands/confirm comando já confirmado -> 409", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/commands/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        command_id: TEST_CMD_ID,
        device_id: TEST_DEVICE_ID,
        status: "EXECUTADO"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 409 && json.message === "Comando já confirmado";
    return { passed, status: res.status, expectedStatus: 409, details: json.message };
  });

  await runTest("GET /api/v1/iot/commands/:deviceId após confirmação -> lista pendente vazia", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/commands/${TEST_DEVICE_ID}`, {
      headers: { "X-API-Key": TEST_API_KEY }
    });
    const json: any = await res.json();
    const passed = res.status === 200 && Array.isArray(json) && !json.some((c: any) => c.command_id === TEST_CMD_ID);
    return { passed, status: res.status, expectedStatus: 200, details: `Comando não aparece mais em pendentes` };
  });

  // Group 7: Alerts
  console.log("\n--- [7] Alertas (/api/v1/iot/alerts) ---");

  await runTest("POST /api/v1/iot/alerts sem X-API-Key -> 401", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alert_id: TEST_ALT_ID,
        device_id: TEST_DEVICE_ID,
        alert_type: "SEAL_BROKEN",
        status_id: 1,
        severity_id: 2,
        title: "Lacre rompido"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 401;
    return { passed, status: res.status, expectedStatus: 401, details: json.message };
  });

  await runTest("POST /api/v1/iot/alerts com chave de outro dispositivo -> 403", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "auto-DSP-000001"
      },
      body: JSON.stringify({
        alert_id: TEST_ALT_ID,
        device_id: TEST_DEVICE_ID,
        alert_type: "SEAL_BROKEN",
        status_id: 1,
        severity_id: 2,
        title: "Lacre rompido"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 403 && json.message === "API Key não pertence ao dispositivo";
    return { passed, status: res.status, expectedStatus: 403, details: json.message };
  });

  await runTest("POST /api/v1/iot/alerts com alert_type inválido -> 400", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        alert_id: TEST_ALT_ID,
        device_id: TEST_DEVICE_ID,
        alert_type: "UNKNOWN_TYPE",
        status_id: 1,
        severity_id: 2,
        title: "Alerta inválido"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 400 && json.success === false;
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
  });

  await runTest("POST /api/v1/iot/alerts com status_id inexistente -> 400", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        alert_id: TEST_ALT_ID,
        device_id: TEST_DEVICE_ID,
        alert_type: "SEAL_BROKEN",
        status_id: 9999,
        severity_id: 2,
        title: "Alerta status inválido"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 400 && json.message.includes("devem existir na tabela status");
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
  });

  await runTest("POST /api/v1/iot/alerts com payload válido -> 201", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        alert_id: TEST_ALT_ID,
        device_id: TEST_DEVICE_ID,
        alert_type: "SEAL_BROKEN",
        status_id: 1,
        severity_id: 2,
        title: "Lacre rompido detectado",
        description: "Sensor detectou rompimento físico"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 201 && json.success === true && json.alert?.alert_id === TEST_ALT_ID;
    return { passed, status: res.status, expectedStatus: 201, details: `Alerta criado: ${json.alert?.title}` };
  });

  await runTest("POST /api/v1/iot/alerts com alert_id duplicado -> 409", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        alert_id: TEST_ALT_ID,
        device_id: TEST_DEVICE_ID,
        alert_type: "SEAL_BROKEN",
        status_id: 1,
        severity_id: 2,
        title: "Lacre rompido repetido"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 409 && json.message === "Alerta duplicado";
    return { passed, status: res.status, expectedStatus: 409, details: json.message };
  });

  // Post-cleanup of test records
  console.log("\n--- [8] Limpeza e Teardown ---");
  await runTest("Limpeza de registros temporários criados nos testes", async () => {
    db.prepare("DELETE FROM alerts WHERE device_id LIKE 'DSP-TEST%'").run();
    db.prepare("DELETE FROM commands WHERE device_id LIKE 'DSP-TEST%'").run();
    db.prepare("DELETE FROM telemetry_queue WHERE device_id LIKE 'DSP-TEST%'").run();
    db.prepare("DELETE FROM events WHERE device_id LIKE 'DSP-TEST%'").run();
    db.prepare("DELETE FROM devices WHERE device_id LIKE 'DSP-TEST%'").run();

    const remaining = (db.prepare("SELECT COUNT(*) as c FROM devices WHERE device_id LIKE 'DSP-TEST%'").get() as any).c;
    const passed = remaining === 0;
    return { passed, details: "Banco limpo com sucesso" };
  });

  // Summary
  const total = results.length;
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = total - passedCount;

  console.log("\n==================================================");
  console.log(`  RESULTADO FINAL DOS TESTES:`);
  console.log(`   Total de Testes: ${total}`);
  console.log(`     Passaram:     ${passedCount}`);
  console.log(`     Falharam:     ${failedCount}`);
  console.log("==================================================");

  // Close server
  server.close(() => {
    console.log("  Servidor finalizado com sucesso.");
    process.exit(failedCount > 0 ? 1 : 0);
  });
}

main().catch(err => {
  console.error("Erro fatal nos testes:", err);
  server.close(() => process.exit(1));
});
