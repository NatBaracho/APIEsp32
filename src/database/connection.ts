import Database from "better-sqlite3";
import path from "path";
import { PREFIXO_SEM_CHAVE, hashApiKey, marcaSemChave } from "../utils/apiKeyHash";

// Oxide: fila local da API (oxide.db), com três tabelas.
//   devices   - quem pode enviar (chave do lacre), o último estado conhecido
//               e o vínculo atual (identificador do lacre, cilindro e cliente)
//   mensagens - fila única de tudo o que o lacre manda, até chegar ao Supabase
//   commands  - comandos da válvula que o lacre busca e confirma
// O cadastro de lacres, cilindros e clientes, o histórico de vínculos e o
// tratamento dos alertas ficam só no banco principal.

const databasePath = path.resolve(process.cwd(), "oxide.db");
const db: Database.Database = new Database(databasePath);

db.pragma("foreign_keys = ON");
// WAL: quem lê não trava quem grava, e a API e o Worker gravam sem fila longa.
// Cria os arquivos oxide.db-wal e oxide.db-shm ao lado do banco; para copiar
// o banco com a API ligada, usar sempre npm run backup
db.pragma("journal_mode = WAL");
// Gravação garantida (padrão): cada mensagem só é dada como recebida depois de
// estar no disco, e um corte de energia não leva o que a API já confirmou ao
// lacre. Com GRAVACAO_GARANTIDA=false a API fica mais rápida, mas um corte de
// energia pode levar as mensagens do último instante (o banco não corrompe)
db.pragma(`synchronous = ${process.env.GRAVACAO_GARANTIDA === "false" ? "NORMAL" : "FULL"}`);

const tabelaExiste = (nome: string): boolean =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome));

const colunasDe = (tabela: string): string[] =>
  (db.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>).map(c => c.name);

// Definição das três tabelas. Uma tabela que já existe com outra definição
// (banco criado por uma versão anterior) é refeita neste formato.
const tabelas: Array<[string, string]> = [
  ["devices", `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL UNIQUE,
    api_key TEXT NOT NULL,
    -- SHA-256 da chave, vindo do banco principal; quando existe, a chave em texto deixa de valer
    api_key_hash TEXT,
    firmware_version TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    -- Último estado recebido: base da posição repetida e dos alertas automáticos
    last_contact_at DATETIME,
    last_latitude REAL,
    last_longitude REAL,
    last_gps_ok INTEGER,
    last_seal_status TEXT,
    last_battery_percent REAL,
    last_signal INTEGER,
    last_telemetry_message_id TEXT,
    last_repeat_message_id TEXT,
    -- Identificador do lacre, gerado pela API na primeira ativação. É com ele
    -- que o sistema principal vincula o cilindro e o cliente
    seal_code TEXT UNIQUE,
    activation_status TEXT NOT NULL DEFAULT 'INATIVO' CHECK (activation_status IN ('ATIVO', 'INATIVO')),
    activated_at DATETIME,
    deactivated_at DATETIME,
    -- Vínculo atual, mandado pelo sistema principal: cilindro e cliente
    binding_id TEXT,
    cylinder_code TEXT,
    customer_code TEXT,
    customer_name TEXT,
    bound_at DATETIME,
    -- Vínculo que o próprio lacre encerrou ao desativar: não volta, mesmo que
    -- o sistema principal ainda o mande
    ended_binding TEXT,
    -- Alerta de vínculo já aberto para a situação atual (para não repetir)
    binding_alert TEXT
  )`],
  ["mensagens", `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    tipo TEXT NOT NULL
      CHECK (tipo IN ('TELEMETRIA', 'EVENTO', 'ALERTA', 'CONFIRMACAO_COMANDO', 'ATIVACAO')),
    -- A mensagem já validada, no formato que vai para o banco principal
    payload_json TEXT NOT NULL,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'PENDING'
      CHECK (status IN ('PENDING', 'PROCESSING', 'SYNCED', 'ERROR', 'ARQUIVADA')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at DATETIME,
    synced_at DATETIME,
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
      ON UPDATE CASCADE ON DELETE RESTRICT
  )`],
  ["commands", `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDENTE'
      CHECK (status IN ('PENDENTE', 'EXECUTADO', 'ERRO')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    executed_at DATETIME,
    error_message TEXT,
    CHECK (status <> 'PENDENTE' OR command_type IN ('TRAVAR_VALVULA', 'DESTRAVAR_VALVULA')),
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
      ON UPDATE CASCADE ON DELETE RESTRICT
  )`]
];

// Só o que vem depois do nome, sem diferença de espaços: é o que se compara
const definicao = (sql: string): string => sql.slice(sql.indexOf("(")).replace(/\s+/g, " ").trim();
const definicaoAtual = (tabela: string): string =>
  definicao((db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabela) as { sql: string }).sql);

const tabelasAntigas = [
  "cylinder_assignments", "seal_assignments", "seals", "cylinders",
  "alerts", "events", "telemetry_queue", "sync_logs", "sync_items", "status"
].filter(tabelaExiste);
const tabelasARefazer = tabelas
  .filter(([nome, sql]) => tabelaExiste(nome) && definicaoAtual(nome) !== definicao(sql))
  .map(([nome]) => nome);
const modeloAntigo = tabelasAntigas.length > 0 || tabelasARefazer.length > 0;

// Migração do modelo antigo (filas separadas, lacres, cilindros, vínculos).
// 1. Cópia de segurança do arquivo inteiro, antes de qualquer mudança.
// 2. As tabelas que continuam (devices, commands) são refeitas no formato
//    atual, com os mesmos dados.
// 3. O que estava nas filas antigas vai para mensagens. A leitura antiga que
//    tem posição e bateria entra na fila (PENDING) e segue para o banco
//    principal, no formato atual. A que não tem (o banco principal exige as
//    duas) fica guardada como ARQUIVADA e não é enviada.
// 4. As tabelas que saíram do modelo são removidas.
if (modeloAntigo) {
  const carimbo = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  // Modelo antigo (filas separadas) ou só uma tabela de versão anterior
  const antigo = tabelasAntigas.length > 0;
  const copia = `${databasePath}.bak-antes-da-${antigo ? "fila-unica" : "atualizacao"}-${carimbo}`;
  db.prepare("VACUUM INTO ?").run(copia);
  console.log(`📦 ${antigo ? "Modelo antigo encontrado" : "Banco de versão anterior encontrado"}. Cópia de segurança: ${copia}`);
}

db.pragma("foreign_keys = OFF");
db.transaction(() => {
  for (const [nome, sql] of tabelas) {
    if (!tabelaExiste(nome)) {
      db.exec(`CREATE TABLE ${nome} ${sql}`);
    } else if (tabelasARefazer.includes(nome)) {
      db.exec(`CREATE TABLE ${nome}_novo ${sql}`);
      const novas = new Set(colunasDe(`${nome}_novo`));
      const comuns = colunasDe(nome).filter(c => novas.has(c)).map(c => `"${c}"`).join(", ");
      db.exec(`INSERT INTO ${nome}_novo (${comuns}) SELECT ${comuns} FROM ${nome}`);
      db.exec(`DROP TABLE ${nome}`);
      db.exec(`ALTER TABLE ${nome}_novo RENAME TO ${nome}`);
    }
  }

  if (tabelasAntigas.length === 0) return;
  const filas: Array<[string, string, string]> = [
    ["telemetry_queue", "message_id", "TELEMETRIA"],
    ["events", "message_id", "EVENTO"],
    ["alerts", "alert_id", "ALERTA"]
  ];
  // Leituras antigas completas: convertidas para o formato atual e enviadas.
  // json_patch remove os campos opcionais vazios
  const colunasTelemetria = tabelasAntigas.includes("telemetry_queue") ? new Set(colunasDe("telemetry_queue")) : new Set<string>();
  if (["latitude", "longitude", "battery_percent"].every(c => colunasTelemetria.has(c))) {
    const opcional = (coluna: string): string => (colunasTelemetria.has(coluna) ? `, '${coluna}', "${coluna}"` : "");
    const enviadas = db.prepare(`
      INSERT OR IGNORE INTO mensagens (message_id, device_id, tipo, payload_json, status)
      SELECT message_id, device_id, 'TELEMETRIA', json_patch('{}', json_object(
        'type', 'TELEMETRIA', 'origin', 'lacre', 'legacy', json('true'),
        'received_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        'message_id', message_id, 'device_id', device_id,
        'latitude', latitude, 'longitude', longitude, 'gps_ok', json('true'), 'battery_percent', battery_percent
        ${opcional("seal_status")}${opcional("speed_kmh")}${opcional("gsm_signal")}
        ${opcional("device_attempt_count")}${opcional("last_seen_at")}
      )), 'PENDING'
      FROM telemetry_queue
      WHERE device_id IN (SELECT device_id FROM devices)
        AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
        AND battery_percent BETWEEN 0 AND 100
    `).run().changes;
    console.log(`   telemetry_queue: ${enviadas} leitura(s) completa(s) na fila para o banco principal`);
  }

  for (const [tabela, chave, tipo] of filas) {
    if (!tabelasAntigas.includes(tabela)) continue;
    const pares = colunasDe(tabela).map(c => `'${c}', "${c}"`).join(", ");
    const guardadas = db.prepare(`
      INSERT OR IGNORE INTO mensagens (message_id, device_id, tipo, payload_json, status)
      SELECT ${chave}, device_id, '${tipo}', json_object(${pares}), 'ARQUIVADA'
      FROM ${tabela}
      WHERE device_id IN (SELECT device_id FROM devices)
    `).run().changes;
    console.log(`   ${tabela}: ${guardadas} linha(s) sem posição ou bateria guardada(s) como ARQUIVADA`);
  }
  for (const tabela of tabelasAntigas) db.exec(`DROP TABLE ${tabela}`);
})();
db.pragma("foreign_keys = ON");
if (tabelasARefazer.length > 0) console.log(`   Tabelas refeitas no formato atual: ${tabelasARefazer.join(", ")}`);
if (tabelasAntigas.length > 0) console.log(`   Tabelas removidas: ${tabelasAntigas.join(", ")}`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_mensagens_fila ON mensagens (status, next_attempt_at, id);
  CREATE INDEX IF NOT EXISTS idx_mensagens_device ON mensagens (device_id, id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_api_key_hash
    ON devices(api_key_hash) WHERE api_key_hash IS NOT NULL;
`);
const chavesRepetidas = db.prepare("SELECT api_key FROM devices GROUP BY api_key HAVING COUNT(*) > 1").all();
if (chavesRepetidas.length === 0) {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_api_key ON devices(api_key)");
} else {
  console.warn("⚠️ Existem API Keys duplicadas em devices; índice único não criado");
}

const soltas = db.pragma("foreign_key_check") as unknown[];
if (soltas.length > 0) console.warn(`⚠️ ${soltas.length} linha(s) apontam para um dispositivo que não existe`);

// Chave em texto de versão anterior: fica só o hash. O lacre continua
// entrando com a mesma chave
const comChaveEmTexto = db.prepare("SELECT device_id, api_key FROM devices WHERE api_key_hash IS NULL AND api_key NOT LIKE ?")
  .all(`${PREFIXO_SEM_CHAVE}%`) as Array<{ device_id: string; api_key: string }>;
if (comChaveEmTexto.length > 0) {
  const trocar = db.prepare("UPDATE devices SET api_key_hash = ?, api_key = ? WHERE device_id = ?");
  db.transaction(() => {
    for (const d of comChaveEmTexto) trocar.run(hashApiKey(d.api_key), marcaSemChave(), d.device_id);
  }).immediate();
  console.log(`🔐 ${comChaveEmTexto.length} dispositivo(s): a chave em texto foi trocada pelo hash`);
}

console.log("✅ SQLite conectado:", databasePath);

export default db;
