import { server } from "../src/server";
import db from "../src/database/connection";
import openApiSpec from "../src/docs/openapi";

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
  db.prepare("DELETE FROM cylinder_assignments WHERE seal_code LIKE 'LCR-TEST%' OR cylinder_code LIKE 'CIL-TEST%'").run();
  db.prepare("DELETE FROM seal_assignments WHERE device_id LIKE 'DSP-TEST%' OR seal_code LIKE 'LCR-TEST%'").run();
  db.prepare("DELETE FROM seals WHERE seal_code LIKE 'LCR-TEST%'").run();
  db.prepare("DELETE FROM cylinders WHERE cylinder_code LIKE 'CIL-TEST%'").run();
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

  await runTest("Swagger: toda rota tem um grupo declarado (sem grupo default)", async () => {
    const spec = openApiSpec as any;
    const declared = new Set((spec.tags ?? []).map((tag: any) => tag.name));
    const semGrupo: string[] = [];
    for (const [path, operations] of Object.entries<any>(spec.paths)) {
      for (const [method, operation] of Object.entries<any>(operations)) {
        const tags: string[] = operation.tags ?? [];
        if (tags.length === 0 || !tags.every(tag => declared.has(tag))) {
          semGrupo.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    return { passed: semGrupo.length === 0, details: semGrupo.length === 0 ? `${declared.size} grupos` : `sem grupo: ${semGrupo.join(", ")}` };
  });

  // Group 2: Devices
  console.log("\n--- [2] Dispositivos (/api/v1/devices) ---");

  await runTest("GET /api/v1/devices (Listar dispositivos)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/devices`);
    const json: any = await res.json();
    const passed =
      res.status === 200 &&
      Array.isArray(json) &&
      json.some((d: any) => d.device_id === "DSP-000001") &&
      json.every((d: any) => !("api_key" in d));
    return { passed, status: res.status, expectedStatus: 200, details: `Retornou ${json.length} dispositivos, sem api_key` };
  });

  await runTest("GET /api/v1/devices/:deviceId (Buscar dispositivo existente)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/devices/DSP-000001`);
    const json: any = await res.json();
    const passed = res.status === 200 && json.device_id === "DSP-000001" && !("api_key" in json);
    return { passed, status: res.status, expectedStatus: 200, details: `Device ID: ${json.device_id}, sem api_key` };
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

  await runTest("POST /api/v1/iot/telemetries mesma posição GPS -> 200 e atualiza apenas last_seen_at", async () => {
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
    const passed =
      res.status === 200 &&
      json.message === "Posição já registrada; data e hora atualizadas" &&
      countBefore === countAfter;
    return { passed, status: res.status, expectedStatus: 200, details: `Linhas mantidas em ${countAfter}` };
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

  await runTest("POST /api/v1/iot/telemetries grava attempt_count do ESP32 em device_attempt_count -> 202", async () => {
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
    const row = db.prepare("SELECT status, attempt_count, device_attempt_count FROM telemetry_queue WHERE message_id = ?").get("MSG-TEST-TEL-004") as any;
    const passed =
      res.status === 202 &&
      row?.status === "PENDING" &&
      row?.attempt_count === 0 &&
      row?.device_attempt_count === 99;
    return { passed, status: res.status, expectedStatus: 202, details: `status=${row?.status}, attempt_count=${row?.attempt_count}, device_attempt_count=${row?.device_attempt_count}` };
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

  await runTest("POST /api/v1/iot/telemetries com chave de outro dispositivo -> 403", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "auto-DSP-000001"
      },
      body: JSON.stringify({
        message_id: "MSG-TEST-OTHER-KEY",
        device_id: TEST_DEVICE_ID,
        latitude: -8.35,
        longitude: -34.98
      })
    });
    const json: any = await res.json();
    const row = db.prepare("SELECT 1 FROM telemetry_queue WHERE message_id = ?").get("MSG-TEST-OTHER-KEY");
    const passed = res.status === 403 && json.message === "API Key não pertence ao dispositivo" && !row;
    return { passed, status: res.status, expectedStatus: 403, details: json.message };
  });

  await runTest("POST /api/v1/iot/telemetries com latitude fora da faixa -> 400", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "MSG-TEST-TEL-011",
        device_id: TEST_DEVICE_ID,
        latitude: 91,
        longitude: -34.9
      })
    });
    const json: any = await res.json();
    const row = db.prepare("SELECT 1 FROM telemetry_queue WHERE message_id = ?").get("MSG-TEST-TEL-011");
    const passed = res.status === 400 && json.message === "latitude deve estar entre -90 e 90 e longitude entre -180 e 180" && !row;
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
  });

  await runTest("POST /api/v1/iot/telemetries só com latitude -> 400", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "MSG-TEST-TEL-012",
        device_id: TEST_DEVICE_ID,
        latitude: -8.4
      })
    });
    const json: any = await res.json();
    const passed = res.status === 400 && json.message === "latitude e longitude devem ser enviadas juntas";
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
  });

  await runTest("POST /api/v1/iot/telemetries com seal_status inválido -> 400", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "MSG-TEST-TEL-007",
        device_id: TEST_DEVICE_ID,
        latitude: -8.25,
        longitude: -34.96,
        seal_status: "OPEN"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 400 && json.message === "seal_status deve ser LOCKED, UNLOCKED ou BROKEN";
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
  });

  await runTest("POST /api/v1/iot/telemetries mesma posição com lacre alterado -> 202 e nova linha", async () => {
    const send = (messageId: string, sealStatus: string) =>
      fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": TEST_API_KEY
        },
        body: JSON.stringify({
          message_id: messageId,
          device_id: TEST_DEVICE_ID,
          latitude: -8.30,
          longitude: -34.97,
          seal_status: sealStatus
        })
      });

    await send("MSG-TEST-TEL-008", "LOCKED");
    const countBefore = (db.prepare("SELECT COUNT(*) as c FROM telemetry_queue WHERE device_id = ?").get(TEST_DEVICE_ID) as any).c;
    const res = await send("MSG-TEST-TEL-009", "BROKEN");
    const countAfter = (db.prepare("SELECT COUNT(*) as c FROM telemetry_queue WHERE device_id = ?").get(TEST_DEVICE_ID) as any).c;
    const row = db.prepare("SELECT seal_status FROM telemetry_queue WHERE message_id = ?").get("MSG-TEST-TEL-009") as any;
    const passed = res.status === 202 && countAfter === countBefore + 1 && row?.seal_status === "BROKEN";
    return { passed, status: res.status, expectedStatus: 202, details: `seal_status=${row?.seal_status}, linhas ${countBefore} -> ${countAfter}` };
  });

  await runTest("POST /api/v1/iot/telemetries com attempt_count negativo -> 400", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/telemetries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "MSG-TEST-TEL-010",
        device_id: TEST_DEVICE_ID,
        attempt_count: -1
      })
    });
    const json: any = await res.json();
    const passed = res.status === 400 && json.success === false;
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
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

  await runTest("POST /api/v1/iot/events grava attempt_count do ESP32 em device_attempt_count -> 202", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        message_id: "EVT-TEST-ATTEMPT",
        device_id: TEST_DEVICE_ID,
        event_type: "startup",
        attempt_count: 3
      })
    });
    const row = db.prepare("SELECT status, attempt_count, device_attempt_count FROM events WHERE message_id = ?").get("EVT-TEST-ATTEMPT") as any;
    const passed =
      res.status === 202 &&
      row?.status === "PENDING" &&
      row?.attempt_count === 0 &&
      row?.device_attempt_count === 3;
    return { passed, status: res.status, expectedStatus: 202, details: `attempt_count=${row?.attempt_count}, device_attempt_count=${row?.device_attempt_count}` };
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

  await runTest("POST /api/v1/iot/events para dispositivo não cadastrado -> 404, sem criação automática", async () => {
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
    const passed = res.status === 404 && json.message === "Dispositivo não encontrado" && !dev;
    return { passed, status: res.status, expectedStatus: 404, details: `${json.message}; dispositivo criado: ${Boolean(dev)}` };
  });

  await runTest("POST /api/v1/iot/events com chave de outro dispositivo -> 403", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "auto-DSP-000001"
      },
      body: JSON.stringify({
        message_id: "EVT-TEST-OTHER-KEY",
        device_id: TEST_DEVICE_ID,
        event_type: "startup"
      })
    });
    const json: any = await res.json();
    const row = db.prepare("SELECT 1 FROM events WHERE message_id = ?").get("EVT-TEST-OTHER-KEY");
    const passed = res.status === 403 && json.message === "API Key não pertence ao dispositivo" && !row;
    return { passed, status: res.status, expectedStatus: 403, details: json.message };
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
    VALUES (?, ?, 'TRAVAR_VALVULA', 'PENDENTE', datetime('now'))
  `).run(TEST_CMD_ID, TEST_DEVICE_ID);

  await runTest("Banco rejeita comando PENDENTE com tipo fora do catálogo", async () => {
    let erro = "";
    try {
      db.prepare(`
        INSERT INTO commands (command_id, device_id, command_type, status, created_at)
        VALUES ('CMD-TEST-TIPO-INVALIDO', ?, 'LIGAR_SIRENE', 'PENDENTE', datetime('now'))
      `).run(TEST_DEVICE_ID);
    } catch (error: any) {
      erro = error.message;
    }
    const passed = erro.includes("CHECK constraint failed");
    return { passed, details: erro || "inserção aceita indevidamente" };
  });

  await runTest("Banco aceita histórico com tipo antigo e rejeita status desconhecido", async () => {
    db.prepare(`
      INSERT INTO commands (command_id, device_id, command_type, status, created_at, executed_at)
      VALUES ('CMD-TEST-HISTORICO', ?, 'LOCK_VALVE', 'EXECUTADO', datetime('now'), datetime('now'))
    `).run(TEST_DEVICE_ID);
    let erro = "";
    try {
      db.prepare(`
        INSERT INTO commands (command_id, device_id, command_type, status, created_at)
        VALUES ('CMD-TEST-STATUS', ?, 'TRAVAR_VALVULA', 'FALHOU', datetime('now'))
      `).run(TEST_DEVICE_ID);
    } catch (error: any) {
      erro = error.message;
    }
    const historico = db.prepare("SELECT 1 FROM commands WHERE command_id = 'CMD-TEST-HISTORICO'").get();
    const passed = Boolean(historico) && erro.includes("CHECK constraint failed");
    return { passed, details: `histórico aceito: ${Boolean(historico)}; status FALHOU: ${erro || "aceito indevidamente"}` };
  });

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
        title: "Alerta inválido"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 400 && json.success === false;
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
  });

  await runTest("POST /api/v1/iot/alerts com severity inválida -> 400", async () => {
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
        severity: "URGENTE",
        title: "Alerta com severidade inválida"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 400 && json.message === "severity deve ser BAIXA, MEDIA, ALTA ou CRITICA";
    return { passed, status: res.status, expectedStatus: 400, details: json.message };
  });

  await runTest("POST /api/v1/iot/alerts com nome antigo SEAL_BROKEN -> 201 gravado como LACRE_VIOLADO", async () => {
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
        title: "Lacre rompido detectado",
        description: "Sensor detectou rompimento físico"
      })
    });
    const json: any = await res.json();
    const passed =
      res.status === 201 &&
      json.success === true &&
      json.alert?.alert_id === TEST_ALT_ID &&
      json.alert?.alert_type === "LACRE_VIOLADO" &&
      json.alert?.severity === "CRITICA" &&
      json.alert?.status === "ABERTO";
    return { passed, status: res.status, expectedStatus: 201, details: `alert_type=${json.alert?.alert_type}, severity=${json.alert?.severity} (padrão do tipo), status=${json.alert?.status}` };
  });

  await runTest("POST /api/v1/iot/alerts com severity informada e campos antigos ignorados -> 201", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/iot/alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": TEST_API_KEY
      },
      body: JSON.stringify({
        alert_id: "ALT-TEST-AUTORUN-002",
        device_id: TEST_DEVICE_ID,
        alert_type: "LOW_BATTERY",
        severity: "ALTA",
        status: "ENCERRADO",
        status_id: 9999,
        severity_id: 9999,
        title: "Bateria baixa"
      })
    });
    const json: any = await res.json();
    const passed =
      res.status === 201 &&
      json.alert?.alert_type === "BATERIA_BAIXA" &&
      json.alert?.severity === "ALTA" &&
      json.alert?.status === "ABERTO" &&
      !("status_id" in json.alert) &&
      !("severity_id" in json.alert);
    return { passed, status: res.status, expectedStatus: 201, details: `severity=${json.alert?.severity}, status=${json.alert?.status}` };
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
        title: "Lacre rompido repetido"
      })
    });
    const json: any = await res.json();
    const passed = res.status === 409 && json.message === "Alerta duplicado";
    return { passed, status: res.status, expectedStatus: 409, details: json.message };
  });

  const alertCall = async (method: string, path: string, body?: unknown, key?: string) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (key) headers["X-API-Key"] = key;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(`${BASE_URL}/api/v1/iot/alerts${path}`, init);
    return { status: res.status, json: (await res.json()) as any };
  };

  await runTest("POST /api/v1/iot/alerts com código do catálogo SEM_COMUNICACAO -> 201 (severidade padrão ALTA)", async () => {
    const r = await alertCall("POST", "", {
      alert_id: "ALT-TEST-AUTORUN-003",
      device_id: TEST_DEVICE_ID,
      alert_type: "SEM_COMUNICACAO",
      title: "Dispositivo sem comunicação"
    }, TEST_API_KEY);
    const passed = r.status === 201 && r.json.alert?.alert_type === "SEM_COMUNICACAO" && r.json.alert?.severity === "ALTA";
    return { passed, status: r.status, expectedStatus: 201, details: `alert_type=${r.json.alert?.alert_type}, severity=${r.json.alert?.severity}` };
  });

  await runTest("POST /api/v1/iot/alerts com alert_type toString -> 400", async () => {
    const r = await alertCall("POST", "", {
      alert_id: "ALT-TEST-AUTORUN-004",
      device_id: TEST_DEVICE_ID,
      alert_type: "toString",
      title: "Tipo inválido"
    }, TEST_API_KEY);
    return { passed: r.status === 400, status: r.status, expectedStatus: 400, details: r.json.message };
  });

  await runTest("Banco rejeita alerta com tipo fora do catálogo (CHECK)", async () => {
    let rejected = false;
    try {
      db.prepare(`
        INSERT INTO alerts (alert_id, device_id, alert_type, severity, status, title)
        VALUES ('ALT-TEST-AUTORUN-DB', ?, 'SEAL_BROKEN', 'CRITICA', 'ABERTO', 'Tipo antigo direto no banco')
      `).run(TEST_DEVICE_ID);
    } catch (err: any) {
      rejected = String(err.code).startsWith("SQLITE_CONSTRAINT");
    }
    return { passed: rejected, details: rejected ? "CHECK de alert_type barrou SEAL_BROKEN" : "inserção aceita" };
  });

  await runTest("GET /api/v1/iot/alerts?device_id= -> 200 com os 3 alertas, do mais recente ao mais antigo", async () => {
    const r = await alertCall("GET", `?device_id=${TEST_DEVICE_ID}`);
    const ids = (r.json.alerts ?? []).map((a: any) => a.alert_id);
    const passed = r.status === 200 && r.json.total === 3 && ids[0] === "ALT-TEST-AUTORUN-003" && ids[2] === TEST_ALT_ID;
    return { passed, status: r.status, expectedStatus: 200, details: `total=${r.json.total} [${ids.join(", ")}]` };
  });

  await runTest("GET /api/v1/iot/alerts?status=XYZ -> 400", async () => {
    const r = await alertCall("GET", "?status=XYZ");
    return { passed: r.status === 400, status: r.status, expectedStatus: 400, details: r.json.message };
  });

  await runTest("PATCH /alerts/:id/status em alerta inexistente -> 404", async () => {
    const r = await alertCall("PATCH", "/ALT-TEST-NAO-EXISTE/status", { status: "EM_ANALISE" });
    return { passed: r.status === 404, status: r.status, expectedStatus: 404, details: r.json.message };
  });

  await runTest("PATCH /alerts/:id/status com status ABERTO -> 400", async () => {
    const r = await alertCall("PATCH", `/${TEST_ALT_ID}/status`, { status: "ABERTO" });
    return { passed: r.status === 400, status: r.status, expectedStatus: 400, details: r.json.message };
  });

  await runTest("PATCH /alerts/:id/status ENCERRADO sem resolved_by/resolution_note -> 400", async () => {
    const r = await alertCall("PATCH", `/${TEST_ALT_ID}/status`, { status: "ENCERRADO", resolved_by: "Gestor" });
    return { passed: r.status === 400, status: r.status, expectedStatus: 400, details: r.json.message };
  });

  await runTest("PATCH /alerts/:id/status ABERTO -> EM_ANALISE -> 200", async () => {
    const r = await alertCall("PATCH", `/${TEST_ALT_ID}/status`, { status: "EM_ANALISE" });
    const passed = r.status === 200 && r.json.alert?.status === "EM_ANALISE" && r.json.alert?.resolved_at === null;
    return { passed, status: r.status, expectedStatus: 200, details: `status=${r.json.alert?.status}` };
  });

  await runTest("PATCH /alerts/:id/status EM_ANALISE de novo -> 409", async () => {
    const r = await alertCall("PATCH", `/${TEST_ALT_ID}/status`, { status: "EM_ANALISE" });
    return { passed: r.status === 409, status: r.status, expectedStatus: 409, details: r.json.message };
  });

  await runTest("PATCH /alerts/:id/status EM_ANALISE -> ENCERRADO -> 200 com data, quem e motivo", async () => {
    const r = await alertCall("PATCH", `/${TEST_ALT_ID}/status`, {
      status: "ENCERRADO",
      resolved_by: "Gestor de teste",
      resolution_note: "Lacre substituído e cilindro conferido"
    });
    const a = r.json.alert;
    const passed = r.status === 200 && a?.status === "ENCERRADO" && !!a?.resolved_at &&
      a?.resolved_by === "Gestor de teste" && a?.resolution_note === "Lacre substituído e cilindro conferido";
    return { passed, status: r.status, expectedStatus: 200, details: `status=${a?.status}, resolved_at=${a?.resolved_at}` };
  });

  await runTest("PATCH /alerts/:id/status em alerta ENCERRADO -> 409 (não reabre)", async () => {
    const r = await alertCall("PATCH", `/${TEST_ALT_ID}/status`, { status: "EM_ANALISE" });
    const passed = r.status === 409 && r.json.message === "Alerta já encerrado; um problema novo gera um alerta novo";
    return { passed, status: r.status, expectedStatus: 409, details: r.json.message };
  });

  await runTest("PATCH /alerts/:id/status ABERTO -> ENCERRADO direto -> 200", async () => {
    const r = await alertCall("PATCH", "/ALT-TEST-AUTORUN-002/status", {
      status: "ENCERRADO",
      resolved_by: "Gestor de teste",
      resolution_note: "Bateria trocada"
    });
    return { passed: r.status === 200 && r.json.alert?.status === "ENCERRADO", status: r.status, expectedStatus: 200, details: `status=${r.json.alert?.status}` };
  });

  await runTest("Banco rejeita alerta ENCERRADO sem data de encerramento (CHECK)", async () => {
    let rejected = false;
    try {
      db.prepare("UPDATE alerts SET status = 'ENCERRADO', resolved_at = NULL WHERE alert_id = 'ALT-TEST-AUTORUN-003'").run();
    } catch (err: any) {
      rejected = String(err.code).startsWith("SQLITE_CONSTRAINT");
    }
    return { passed: rejected, details: rejected ? "CHECK barrou ENCERRADO sem resolved_at" : "atualização aceita" };
  });

  await runTest("GET /api/v1/iot/alerts?status=ENCERRADO&device_id= -> 200 com os 2 encerrados", async () => {
    const r = await alertCall("GET", `?status=ENCERRADO&device_id=${TEST_DEVICE_ID}`);
    const passed = r.status === 200 && r.json.total === 2 && r.json.alerts.every((a: any) => a.status === "ENCERRADO");
    return { passed, status: r.status, expectedStatus: 200, details: `total=${r.json.total}` };
  });

  // Group 9: Association device → seal → cylinder
  console.log("\n--- [9] Associação dispositivo → lacre → cilindro ---");

  const api = async (method: string, path: string, body?: unknown, key?: string) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (key) headers["X-API-Key"] = key;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(`${BASE_URL}/api/v1${path}`, init);
    return { status: res.status, json: (await res.json()) as any };
  };
  const sealStatus = (code: string) =>
    (db.prepare("SELECT status FROM seals WHERE seal_code = ?").get(code) as any)?.status;

  await runTest("POST /seals cadastra lacres -> 201 (EM_ESTOQUE por padrão)", async () => {
    const a = await api("POST", "/seals", { seal_code: "LCR-TEST-1", nfc_uid: "NFC-TEST-1" });
    const b = await api("POST", "/seals", { seal_code: "LCR-TEST-2", nfc_uid: "NFC-TEST-2" });
    const c = await api("POST", "/seals", { seal_code: "LCR-TEST-3", nfc_uid: "NFC-TEST-3", status: "DANIFICADO" });
    const passed = a.status === 201 && b.status === 201 && c.status === 201 && a.json.seal?.status === "EM_ESTOQUE";
    return { passed, status: a.status, expectedStatus: 201, details: `${a.json.seal?.seal_code} ${a.json.seal?.status}` };
  });

  await runTest("POST /seals duplicado, UID NFC repetido -> 409; status INSTALADO no cadastro -> 400", async () => {
    const dup = await api("POST", "/seals", { seal_code: "LCR-TEST-1", nfc_uid: "NFC-TEST-9" });
    const nfc = await api("POST", "/seals", { seal_code: "LCR-TEST-9", nfc_uid: "NFC-TEST-1" });
    const inst = await api("POST", "/seals", { seal_code: "LCR-TEST-8", nfc_uid: "NFC-TEST-8", status: "INSTALADO" });
    const passed = dup.status === 409 && nfc.status === 409 && inst.status === 400;
    return { passed, details: `${dup.status} / ${nfc.status} / ${inst.status}` };
  });

  await runTest("POST /cylinders cadastra -> 201; número de série repetido -> 409", async () => {
    const a = await api("POST", "/cylinders", { cylinder_code: "CIL-TEST-1", serial_number: "SER-TEST-1" });
    const b = await api("POST", "/cylinders", { cylinder_code: "CIL-TEST-2", serial_number: "SER-TEST-2" });
    const dup = await api("POST", "/cylinders", { cylinder_code: "CIL-TEST-9", serial_number: "SER-TEST-1" });
    const passed = a.status === 201 && b.status === 201 && a.json.cylinder?.status === "DISPONIVEL" && dup.status === 409;
    return { passed, details: `${a.status} / ${b.status} / ${dup.status}` };
  });

  await runTest("POST /assignments/device-seal vincula -> 201; dispositivo com lacre ativo -> 409", async () => {
    const link = await api("POST", "/assignments/device-seal", { device_id: TEST_DEVICE_ID, seal_code: "LCR-TEST-1" });
    const conflict = await api("POST", "/assignments/device-seal", { device_id: TEST_DEVICE_ID, seal_code: "LCR-TEST-2" });
    const passed = link.status === 201 && link.json.assignment?.ended_at === null && conflict.status === 409;
    return { passed, details: `${link.status} / ${conflict.status} ${conflict.json.message}` };
  });

  await runTest("POST /assignments/seal-cylinder vincula -> 201 e lacre vira INSTALADO", async () => {
    const link = await api("POST", "/assignments/seal-cylinder", { seal_code: "LCR-TEST-1", cylinder_code: "CIL-TEST-1" });
    const passed = link.status === 201 && sealStatus("LCR-TEST-1") === "INSTALADO";
    return { passed, status: link.status, expectedStatus: 201, details: `lacre ${sealStatus("LCR-TEST-1")}` };
  });

  await runTest("Cilindro com lacre ativo -> 409; lacre DANIFICADO não instala -> 409", async () => {
    const busy = await api("POST", "/assignments/seal-cylinder", { seal_code: "LCR-TEST-2", cylinder_code: "CIL-TEST-1" });
    const damaged = await api("POST", "/assignments/seal-cylinder", { seal_code: "LCR-TEST-3", cylinder_code: "CIL-TEST-2" });
    const passed = busy.status === 409 && damaged.status === 409 && damaged.json.message.includes("DANIFICADO");
    return { passed, details: `${busy.status} / ${damaged.status} ${damaged.json.message}` };
  });

  await runTest("Telemetria recebe lacre e cilindro do vínculo (payload ignorado), sem error_type", async () => {
    const res = await api("POST", "/iot/telemetries", {
      message_id: "MSG-TEST-ASC-1", device_id: TEST_DEVICE_ID,
      latitude: -8.9, longitude: -35.0, lacre_id: "LCR-FALSO", cilindro_id: "CIL-FALSO"
    }, TEST_API_KEY);
    const row = db.prepare("SELECT lacre_id, cilindro_id, error_type FROM telemetry_queue WHERE message_id = 'MSG-TEST-ASC-1'").get() as any;
    const passed = res.status === 202 && row?.lacre_id === "LCR-TEST-1" && row?.cilindro_id === "CIL-TEST-1" && row?.error_type === null;
    return { passed, status: res.status, expectedStatus: 202, details: `${row?.lacre_id} / ${row?.cilindro_id} / ${row?.error_type}` };
  });

  await runTest("Telemetria enviada antes do vínculo ficou com error_type DISPOSITIVO_SEM_LACRE", async () => {
    const row = db.prepare("SELECT lacre_id, error_type FROM telemetry_queue WHERE message_id = 'MSG-TEST-TEL-001'").get() as any;
    const passed = row?.lacre_id === null && row?.error_type === "DISPOSITIVO_SEM_LACRE";
    return { passed, details: `${row?.error_type}` };
  });

  await runTest("Evento de lacre aberto com cilindro EM_TRANSITO -> error_type LACRE_ABERTO_EM_TRANSITO", async () => {
    const transit = await api("POST", "/cylinders/CIL-TEST-1/status", { status: "EM_TRANSITO" });
    const ev = await api("POST", "/iot/events", {
      message_id: "EVT-TEST-ASC-1", device_id: TEST_DEVICE_ID, event_type: "seal_changed", seal_status: "UNLOCKED"
    }, TEST_API_KEY);
    const row = db.prepare("SELECT error_type FROM events WHERE message_id = 'EVT-TEST-ASC-1'").get() as any;
    const passed = transit.status === 200 && ev.status === 202 && row?.error_type === "LACRE_ABERTO_EM_TRANSITO";
    return { passed, details: `${row?.error_type}` };
  });

  await runTest("Troca do lacre do cilindro (replace) -> antigo encerrado e REMOVIDO, novo INSTALADO", async () => {
    const swap = await api("POST", "/assignments/seal-cylinder", { seal_code: "LCR-TEST-2", cylinder_code: "CIL-TEST-1", replace: true });
    const old = db.prepare("SELECT ended_at, end_reason FROM cylinder_assignments WHERE seal_code = 'LCR-TEST-1'").get() as any;
    const passed =
      swap.status === 201 && old?.ended_at !== null && old?.end_reason === "Substituído por novo vínculo" &&
      sealStatus("LCR-TEST-1") === "REMOVIDO" && sealStatus("LCR-TEST-2") === "INSTALADO";
    return { passed, details: `antigo ${sealStatus("LCR-TEST-1")}, novo ${sealStatus("LCR-TEST-2")}` };
  });

  await runTest("Telemetria de lacre sem cilindro -> error_type LACRE_SEM_CILINDRO", async () => {
    await api("POST", "/iot/telemetries", { message_id: "MSG-TEST-ASC-2", device_id: TEST_DEVICE_ID, latitude: -8.91, longitude: -35.01 }, TEST_API_KEY);
    const row = db.prepare("SELECT lacre_id, cilindro_id, error_type FROM telemetry_queue WHERE message_id = 'MSG-TEST-ASC-2'").get() as any;
    const passed = row?.lacre_id === "LCR-TEST-1" && row?.cilindro_id === null && row?.error_type === "LACRE_SEM_CILINDRO";
    return { passed, details: `${row?.lacre_id} / ${row?.cilindro_id} / ${row?.error_type}` };
  });

  await runTest("Encerrar vínculo -> 200 e lacre REMOVIDO; encerrar de novo -> 409", async () => {
    const active = db.prepare("SELECT id FROM cylinder_assignments WHERE seal_code = 'LCR-TEST-2' AND ended_at IS NULL").get() as any;
    const end = await api("POST", `/assignments/seal-cylinder/${active.id}/end`, { reason: "Retirada para manutenção" });
    const again = await api("POST", `/assignments/seal-cylinder/${active.id}/end`, {});
    const passed = end.status === 200 && end.json.assignment?.end_reason === "Retirada para manutenção" && sealStatus("LCR-TEST-2") === "REMOVIDO" && again.status === 409;
    return { passed, details: `${end.status} / ${again.status}; lacre ${sealStatus("LCR-TEST-2")}` };
  });

  await runTest("Histórico do cilindro preserva todos os vínculos, do mais recente ao mais antigo", async () => {
    const res = await api("GET", "/assignments/seal-cylinder?cylinder_code=CIL-TEST-1");
    const codes = Array.isArray(res.json) ? res.json.map((a: any) => a.seal_code) : [];
    const passed = res.status === 200 && codes.length === 2 && codes[0] === "LCR-TEST-2" && codes[1] === "LCR-TEST-1" && res.json.every((a: any) => a.ended_at !== null);
    return { passed, status: res.status, expectedStatus: 200, details: codes.join(" → ") };
  });

  await runTest("Status INSTALADO manual -> 409 (só pelo vínculo)", async () => {
    const res = await api("POST", "/seals/LCR-TEST-1/status", { status: "INSTALADO" });
    const passed = res.status === 409;
    return { passed, status: res.status, expectedStatus: 409, details: res.json.message };
  });

  // Post-cleanup of test records
  console.log("\n--- [8] Limpeza e Teardown ---");
  await runTest("Limpeza de registros temporários criados nos testes", async () => {
    db.prepare("DELETE FROM cylinder_assignments WHERE seal_code LIKE 'LCR-TEST%' OR cylinder_code LIKE 'CIL-TEST%'").run();
    db.prepare("DELETE FROM seal_assignments WHERE device_id LIKE 'DSP-TEST%' OR seal_code LIKE 'LCR-TEST%'").run();
    db.prepare("DELETE FROM seals WHERE seal_code LIKE 'LCR-TEST%'").run();
    db.prepare("DELETE FROM cylinders WHERE cylinder_code LIKE 'CIL-TEST%'").run();
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
