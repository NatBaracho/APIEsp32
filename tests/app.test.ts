// Teste da API do frontend (/api/v1/app) contra o FluxID de análise no Docker
// (127.0.0.1:54329). npm run test:app
//
// Roda numa pasta temporária com uma oxide.db nova (script do Oxidedb.md):
// o oxide.db do projeto e o banco principal do FluxID não são tocados. Cria
// uma organização e pessoas próprias da rodada (códigos ORG-T<rodada>...).

import { createHash } from "crypto";
import path from "path";
import { Pool } from "pg";
import { prepararAmbiente, validarFluxid } from "../src/simulador/ambiente";

const PROJETO = path.resolve(__dirname, "..");
const PORTA = Number(process.env.APP_TEST_PORT ?? 3198);
const fluxidUrl = validarFluxid(process.env.FLUXID_DATABASE_URL);
const ambiente = prepararAmbiente(PROJETO, PORTA, fluxidUrl);
process.chdir(ambiente.pasta);
process.env.PORT = String(PORTA);
process.env.APP_EXPOR_TOKENS = "1";

type Resultado = { nome: string; passou: boolean; detalhe: string };
const resultados: Resultado[] = [];
const SENHA = "Senha-de-teste-123";
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));

async function teste(nome: string, corpo: () => Promise<{ passou: boolean; detalhe?: string }>): Promise<void> {
  try {
    const { passou, detalhe } = await corpo();
    resultados.push({ nome, passou, detalhe: detalhe ?? "" });
    console.log(`${passou ? "✅" : "❌"} ${nome}${detalhe ? ` (${detalhe})` : ""}`);
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    resultados.push({ nome, passou: false, detalhe });
    console.log(`❌ ${nome} (erro: ${detalhe})`);
  }
}

async function main(): Promise<void> {
  // Só depois do chdir: a Oxide aberta é a da pasta temporária
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { server } = require("../src/server") as typeof import("../src/server");
  const db = (require("../src/database/connection") as typeof import("../src/database/connection")).default;
  const { runCycle } = require("../src/worker/runner") as typeof import("../src/worker/runner");
  const { hashSenha, fecharFluxid } = require("../src/app/base") as typeof import("../src/app/base");
  /* eslint-enable @typescript-eslint/no-require-imports */

  const fluxid = new Pool({ connectionString: fluxidUrl, max: 3 });
  const rodada = ambiente.rodada;
  const BASE = `http://127.0.0.1:${PORTA}`;
  const worker = (cadastro = false) => runCycle(fluxid, { batchSize: 500, withCadastro: cadastro });
  const sql = async (texto: string, valores: unknown[] = []) => (await fluxid.query(texto, valores)).rows;

  const chamar = async (funcao: string, corpo: Record<string, unknown> = {}, token?: string, metodo = "POST") => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const init: RequestInit = { method: metodo, headers };
    if (metodo === "POST") init.body = JSON.stringify(corpo);
    const res = await fetch(`${BASE}/api/v1/app/${funcao}`, init);
    return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
  };
  const iot = async (rota: string, corpo: unknown, chave: string, metodo = "POST") => {
    const init: RequestInit = { method: metodo, headers: { "content-type": "application/json", "x-api-key": chave } };
    if (metodo === "POST") init.body = JSON.stringify(corpo);
    const res = await fetch(`${BASE}/api/v1/iot${rota}`, init);
    return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
  };

  console.log(`\nTeste da API do frontend — rodada ${rodada}; pasta ${ambiente.pasta}\n`);

  // ------------------------------------------------------------ preparação
  const [org] = await sql(`
    INSERT INTO public.organizacoes (codigo, razao_social, nome_fantasia, cnpj, email, status)
    VALUES ($1, $2, $3, $4, $5, 'ATIVA') RETURNING id`,
    [`ORG-T${rodada}`, `Teste App ${rodada} Ltda`, `Teste App ${rodada}`, String(Date.now()).padStart(14, "7").slice(-14), `org-t${rodada.toLowerCase()}@fluxid.teste`]);
  const ORG = org.id as string;
  const pessoas: Record<string, { id: string; email: string; papel: string }> = {};
  for (const [chave, papel] of [["admin", "ORG_ADMIN"], ["operador", "OPERADOR"], ["leitor", "VISUALIZADOR"]] as const) {
    const email = `${chave}-t${rodada.toLowerCase()}@fluxid.teste`;
    const [u] = await sql(`
      INSERT INTO public.usuarios (organizacao_id, codigo, nome, email, senha_hash, ativo)
      VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [ORG, `USR-T${rodada}-${chave.slice(0, 3).toUpperCase()}`, `${chave[0]!.toUpperCase()}${chave.slice(1)} ${rodada}`, email, hashSenha(SENHA)]);
    await sql("INSERT INTO public.usuario_organizacoes (usuario_id, organizacao_id, status) VALUES ($1, $2, 'ATIVO')", [u.id, ORG]);
    await sql(`INSERT INTO public.usuario_organizacao_perfis (usuario_id, organizacao_id, perfil_id)
               SELECT $1, $2, id FROM public.perfis WHERE codigo = $3`, [u.id, ORG, papel]);
    pessoas[chave] = { id: u.id, email, papel };
  }
  const outraOrg = (await sql("SELECT id FROM public.organizacoes WHERE codigo = 'ORG-000003'"))[0]?.id as string | undefined;
  const cilindroDeOutraOrg = outraOrg ? (await sql("SELECT id FROM public.cilindros WHERE organizacao_id = $1 LIMIT 1", [outraOrg]))[0]?.id : undefined;

  const login = async (quem: string, senha = SENHA) => chamar("session-login", { email: pessoas[quem]!.email, password: senha });

  // ------------------------------------------------------ 1. login e sessão
  console.log("--- [1] Login e sessão ---");
  let ADMIN = "";
  let OPERADOR = "";
  let LEITOR = "";

  await teste("Função inexistente -> 404; GET -> 405; sem token -> 401 AUTH_REQUIRED", async () => {
    const a = await chamar("nao-existe", {}, "x");
    const b = await chamar("query-cylinders", {}, undefined, "GET");
    const c = await chamar("query-cylinders", { organization_id: ORG });
    return { passou: a.status === 404 && b.status === 405 && b.json.code === "METHOD_NOT_ALLOWED" && c.status === 401 && c.json.code === "AUTH_REQUIRED", detalhe: `${a.status}/${b.status}/${c.status}` };
  });

  await teste("session-login sem senha -> 400 INVALID_REQUEST; senha errada e e-mail desconhecido -> 401 INVALID_CREDENTIALS", async () => {
    const a = await chamar("session-login", { email: pessoas.admin!.email });
    const b = await login("admin", "errada-123");
    const c = await chamar("session-login", { email: `ninguem-${rodada}@fluxid.teste`, password: SENHA });
    return { passou: a.json.code === "INVALID_REQUEST" && b.status === 401 && b.json.code === "INVALID_CREDENTIALS" && c.json.code === "INVALID_CREDENTIALS", detalhe: `${a.status}/${b.status}/${c.status}` };
  });

  await teste("session-login correto -> 200 AUTHENTICATED (session.access_token, organizações e papéis)", async () => {
    const r = await login("admin");
    ADMIN = r.json.session?.access_token ?? "";
    const orgInfo = (r.json.organizations ?? []).find((o: any) => o.id === ORG);
    const hash = createHash("sha256").update(ADMIN).digest("hex");
    const guardado = await sql("SELECT 1 FROM public.sessoes_usuario WHERE token_hash = $1", [hash]);
    return { passou: r.status === 200 && r.json.code === "AUTHENTICATED" && ADMIN.length > 20 && orgInfo?.roles?.includes("ORG_ADMIN") && guardado.length === 1, detalhe: `expira ${r.json.expires_at}; FluxID guarda só o hash` };
  });
  OPERADOR = (await login("operador")).json.session?.access_token ?? "";
  LEITOR = (await login("leitor")).json.session?.access_token ?? "";

  await teste("session-status -> SESSION_ACTIVE (aal1); sem token -> SESSION_INVALID", async () => {
    const a = await chamar("session-status", {}, ADMIN);
    const b = await chamar("session-status", {});
    return { passou: a.json.code === "SESSION_ACTIVE" && a.json.aal === "aal1" && b.status === 401 && b.json.code === "SESSION_INVALID", detalhe: a.json.expires_at };
  });

  await teste("Organização sem vínculo (outra empresa) -> 401 AUTH_REQUIRED", async () => {
    const r = await chamar("query-cylinders", { operation: "list", organization_id: outraOrg ?? ORG.replace(/.$/, "0") }, ADMIN);
    return { passou: r.status === 401 && r.json.code === "AUTH_REQUIRED", detalhe: r.json.reason };
  });

  await teste("4ª sessão -> 409 SESSION_LIMIT_REACHED com as sessões; com revoke_session_id entra", async () => {
    await login("leitor");
    await login("leitor");
    const quarta = await login("leitor");
    const sessoes = quarta.json.sessions ?? [];
    const revogar = sessoes.find((s: any) => true)?.session_id;
    const entrou = await chamar("session-login", { email: pessoas.leitor!.email, password: SENHA, revoke_session_id: revogar });
    const antiga = await chamar("session-status", {}, LEITOR);
    LEITOR = entrou.json.session?.access_token ?? LEITOR;
    return { passou: quarta.status === 409 && sessoes.length === 3 && entrou.status === 200 && antiga.json.code === "SESSION_REVOKED", detalhe: `sessões listadas: ${sessoes.length}; a primeira foi encerrada` };
  });

  await teste("5 falhas seguidas bloqueiam o e-mail -> 429 RATE_LIMITED (mesmo com a senha certa)", async () => {
    for (let i = 0; i < 5; i++) await chamar("session-login", { email: pessoas.operador!.email, password: `errada-${i}` });
    const r = await login("operador");
    await sql("DELETE FROM public.tentativas_login WHERE email_hash = $1", [createHash("sha256").update(pessoas.operador!.email).digest("hex")]);
    return { passou: r.status === 429 && r.json.code === "RATE_LIMITED", detalhe: `${r.status}; bloqueio limpo para seguir o teste` };
  });

  await teste("30 min sem uso -> SESSION_EXPIRED (inactivity)", async () => {
    const r = await login("admin");
    const token = r.json.session.access_token;
    await sql("UPDATE public.sessoes_usuario SET ultimo_acesso_em = now() - interval '31 minutes' WHERE token_hash = $1", [createHash("sha256").update(token).digest("hex")]);
    const s = await chamar("session-status", {}, token);
    return { passou: s.status === 401 && s.json.code === "SESSION_EXPIRED" && s.json.reason === "inactivity", detalhe: s.json.reason };
  });

  await teste("Recuperação de senha: pedido sempre aceito; token troca a senha uma vez só e encerra as sessões", async () => {
    const desconhecido = await chamar("password-recovery", { email: `ninguem-${rodada}@fluxid.teste` });
    const pedido = await chamar("password-recovery", { email: pessoas.leitor!.email });
    const token = pedido.json.recovery_token;
    const troca = await chamar("password-recovery", { token, new_password: "Nova-senha-456" });
    const deNovo = await chamar("password-recovery", { token, new_password: "Outra-senha-789" });
    const statusAntigo = await chamar("session-status", {}, LEITOR);
    const novoLogin = await login("leitor", "Nova-senha-456");
    LEITOR = novoLogin.json.session?.access_token ?? "";
    return {
      passou: desconhecido.json.code === "RECOVERY_REQUEST_ACCEPTED" && !desconhecido.json.recovery_token && Boolean(token) &&
        troca.json.code === "PASSWORD_UPDATED" && deNovo.json.code === "RECOVERY_TOKEN_INVALID" && statusAntigo.json.code === "SESSION_REVOKED" && novoLogin.status === 200,
      detalhe: "token de uso único; sessão antiga revogada"
    };
  });

  // --------------------------------------------------------- 2. permissões
  console.log("\n--- [2] Permissões ---");
  await teste("query-permissions: admin tem cylinder.write e command.send; visualizador só leitura", async () => {
    const a = await chamar("query-permissions", { organization_id: ORG }, ADMIN);
    const l = await chamar("query-permissions", { organization_id: ORG }, LEITOR);
    const passou = a.json.code === "PERMISSIONS_LISTED" && a.json.tenant.includes("cylinder.write") && a.json.tenant.includes("command.send") &&
      l.json.tenant.includes("cylinder.read") && !l.json.tenant.includes("cylinder.write") && !l.json.tenant.includes("command.send");
    return { passou, detalhe: `admin ${a.json.tenant?.length}; visualizador ${l.json.tenant?.join(",")}` };
  });

  // ----------------------------------------------------------- 3. cilindros
  console.log("\n--- [3] Cilindros ---");
  let TIPO = "";
  let CIL = "";
  let CIL2 = "";
  const qr = `QR-T${rodada}-1`;

  await teste("save_type cria o tipo; catalog lista", async () => {
    const r = await chamar("manage-cylinders", { operation: "save_type", organization_id: ORG, gas: "Oxigênio", capacity_value: 50, capacity_unit: "l", classification: "medicinal" }, ADMIN);
    TIPO = r.json.type_id;
    const c = await chamar("query-cylinders", { operation: "catalog", organization_id: ORG }, ADMIN);
    return { passou: r.json.code === "SAVED" && c.json.types?.some((t: any) => t.id === TIPO && t.capacity_unit === "l"), detalhe: TIPO };
  });

  await teste("Visualizador não cadastra cilindro -> 403 ACCESS_DENIED", async () => {
    const r = await chamar("manage-cylinders", { operation: "create", organization_id: ORG, serial_number: `SN-T${rodada}-X`, identifier: { kind: "qr_code", value: "QR-X" } }, LEITOR);
    return { passou: r.status === 403 && r.json.code === "ACCESS_DENIED", detalhe: String(r.status) };
  });

  await teste("create -> 201 CREATED; histórico com CILINDRO_CRIADO (feito pela pessoa) e IDENTIFICADOR_ADICIONADO; auditoria", async () => {
    const r = await chamar("manage-cylinders", { operation: "create", organization_id: ORG, cylinder_type_id: TIPO, serial_number: `SN-T${rodada}-1`, manufacturer: "White Martins", manufacture_year: 2024, working_pressure_bar: 200, identifier: { kind: "qr_code", value: qr } }, OPERADOR);
    CIL = r.json.cylinder_id;
    const h = await chamar("query-cylinders", { operation: "history", organization_id: ORG, cylinder_id: CIL, order: "asc" }, OPERADOR);
    const eventos = (h.json.events ?? []).map((e: any) => `${e.event_type}:${e.actor_name}`);
    const auditoria = await sql("SELECT 1 FROM public.auditoria WHERE registro_id = $1 AND observacao = 'cylinder.create'", [CIL]);
    const passou = r.status === 201 && r.json.code === "CREATED" && /^CIL-\d{6}$/.test(r.json.cylinder_code) &&
      eventos[0] === `cylinder_created:Operador ${rodada}` && eventos[1]?.startsWith("identifier_added") && auditoria.length === 1;
    return { passou, detalhe: `${r.json.cylinder_code}; ${eventos.join(", ")}` };
  });

  await teste("Série repetida -> 409 SERIAL_CONFLICT (com o dono); identificador ativo repetido -> 409 IDENTIFIER_CONFLICT", async () => {
    const a = await chamar("manage-cylinders", { operation: "create", organization_id: ORG, serial_number: `SN-T${rodada}-1`, identifier: { kind: "qr_code", value: "QR-OUTRO" } }, ADMIN);
    const b = await chamar("manage-cylinders", { operation: "create", organization_id: ORG, serial_number: `SN-T${rodada}-2`, identifier: { kind: "qr_code", value: qr.toLowerCase() } }, ADMIN);
    return { passou: a.json.code === "SERIAL_CONFLICT" && a.json.cylinder_id === CIL && b.json.code === "IDENTIFIER_CONFLICT" && b.json.cylinder_id === CIL, detalhe: `${a.status}/${b.status} (comparação sem maiúsc./minúsc.)` };
  });

  await teste("list com busca pelo identificador e get com tipo, identificadores e situação do teste", async () => {
    const l = await chamar("query-cylinders", { operation: "list", organization_id: ORG, search: qr }, ADMIN);
    const g = await chamar("query-cylinders", { operation: "get", organization_id: ORG, cylinder_id: CIL }, ADMIN);
    const passou = l.json.code === "LISTED" && l.json.total === 1 && l.json.items[0].id === CIL && l.json.items[0].stock_status === "out_of_stock" &&
      g.json.code === "FOUND" && g.json.cylinder.type.id === TIPO && g.json.identifiers.length === 1 && g.json.hydro_status === "sem_teste" && g.json.cylinder.manufacture_year === 2024;
    return { passou, detalhe: `hydro=${g.json.hydro_status}; versão ${g.json.cylinder?.version}` };
  });

  await teste("update com versão antiga -> 409 VERSION_CONFLICT; com a versão certa -> versão 2", async () => {
    const velho = await chamar("manage-cylinders", { operation: "update", organization_id: ORG, cylinder_id: CIL, expected_version: 9, serial_number: `SN-T${rodada}-1`, notes: "x" }, ADMIN);
    const certo = await chamar("manage-cylinders", { operation: "update", organization_id: ORG, cylinder_id: CIL, expected_version: 1, serial_number: `SN-T${rodada}-1`, cylinder_type_id: TIPO, notes: "Revisado" }, ADMIN);
    return { passou: velho.json.code === "VERSION_CONFLICT" && certo.json.code === "UPDATED" && certo.json.version === 2, detalhe: `versão ${certo.json.version}` };
  });

  await teste("stock_in -> STOCKED; repetir a chave -> replayed; chave com outro pedido -> IDEMPOTENCY_PAYLOAD_CONFLICT; outra chave -> ALREADY_IN_STOCK", async () => {
    const chave = crypto.randomUUID();
    const a = await chamar("manage-cylinders", { operation: "stock_in", organization_id: ORG, identifier_value: qr, operation_key: chave }, OPERADOR);
    const b = await chamar("manage-cylinders", { operation: "stock_in", organization_id: ORG, identifier_value: qr, operation_key: chave }, OPERADOR);
    const c = await chamar("manage-cylinders", { operation: "stock_in", organization_id: ORG, identifier_value: "QR-OUTRO-VALOR", operation_key: chave }, OPERADOR);
    const d = await chamar("manage-cylinders", { operation: "stock_in", organization_id: ORG, identifier_value: qr, operation_key: crypto.randomUUID() }, OPERADOR);
    const passou = a.json.code === "STOCKED" && a.json.replayed === false && b.json.replayed === true && b.json.event_sequence === a.json.event_sequence &&
      c.json.code === "IDEMPOTENCY_PAYLOAD_CONFLICT" && d.json.code === "ALREADY_IN_STOCK";
    return { passou, detalhe: `sequência ${a.json.event_sequence}; hydro ${a.json.hydro_status}` };
  });

  await teste("register_test -> em_dia; rectify sem justificativa -> JUSTIFICATION_REQUIRED; com justificativa -> RECTIFIED (uma vez só)", async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const r = await chamar("manage-cylinders", { operation: "register_test", organization_id: ORG, cylinder_id: CIL, performed_on: hoje, result: "approved", executor: "Lab Teste", report_number: "LAUDO-1" }, OPERADOR);
    const g = await chamar("query-cylinders", { operation: "get", organization_id: ORG, cylinder_id: CIL }, OPERADOR);
    const sem = await chamar("manage-cylinders", { operation: "rectify_test", organization_id: ORG, test_id: r.json.test_id, performed_on: hoje, result: "approved", executor: "Lab Teste" }, OPERADOR);
    const com = await chamar("manage-cylinders", { operation: "rectify_test", organization_id: ORG, test_id: r.json.test_id, performed_on: hoje, result: "approved", executor: "Lab Teste", report_number: "LAUDO-1A", justification: "Número do laudo corrigido" }, OPERADOR);
    const deNovo = await chamar("manage-cylinders", { operation: "rectify_test", organization_id: ORG, test_id: r.json.test_id, performed_on: hoje, result: "approved", executor: "Lab Teste", justification: "Segunda correção" }, OPERADOR);
    const passou = r.json.code === "REGISTERED" && g.json.hydro_status === "em_dia" && sem.json.code === "JUSTIFICATION_REQUIRED" && com.json.code === "RECTIFIED" && deNovo.json.code === "TEST_ALREADY_RECTIFIED";
    return { passou, detalhe: `próximo teste ${g.json.cylinder?.hydro_next_due_on}` };
  });

  await teste("inactivate -> INACTIVATED (sai do estoque); de novo -> ALREADY_INACTIVE; update inativo -> CYLINDER_INACTIVE; reactivate", async () => {
    const a = await chamar("manage-cylinders", { operation: "inactivate", organization_id: ORG, cylinder_id: CIL, reason: "other", justification: "Teste de inativação" }, ADMIN);
    const b = await chamar("manage-cylinders", { operation: "inactivate", organization_id: ORG, cylinder_id: CIL, reason: "other", justification: "Teste de inativação" }, ADMIN);
    const c = await chamar("manage-cylinders", { operation: "update", organization_id: ORG, cylinder_id: CIL, expected_version: 4, serial_number: `SN-T${rodada}-1` }, ADMIN);
    const d = await chamar("manage-cylinders", { operation: "reactivate", organization_id: ORG, cylinder_id: CIL, justification: "Voltou à operação" }, ADMIN);
    const h = await chamar("query-cylinders", { operation: "history", organization_id: ORG, cylinder_id: CIL, event_type: "stock_out_inactivation" }, ADMIN);
    const passou = a.json.code === "INACTIVATED" && b.json.code === "ALREADY_INACTIVE" && c.json.code === "CYLINDER_INACTIVE" && d.json.code === "REACTIVATED" && h.json.events?.length === 1;
    return { passou, detalhe: `versão final ${d.json.version}` };
  });

  await teste("Identificadores: desativar, reusar o valor -> IDENTIFIER_UNAVAILABLE, transferir para outro cilindro", async () => {
    const outro = await chamar("manage-cylinders", { operation: "create", organization_id: ORG, cylinder_type_id: TIPO, serial_number: `SN-T${rodada}-2`, identifier: { kind: "hull_number", value: `CASCO-T${rodada}-2` } }, ADMIN);
    CIL2 = outro.json.cylinder_id;
    const add = await chamar("manage-cylinders", { operation: "add_identifier", organization_id: ORG, cylinder_id: CIL, kind: "nfc_tag", value: `NFC-T${rodada}-1` }, ADMIN);
    const des = await chamar("manage-cylinders", { operation: "deactivate_identifier", organization_id: ORG, identifier_id: add.json.identifier_id, justification: "Etiqueta danificada" }, ADMIN);
    const reuso = await chamar("manage-cylinders", { operation: "add_identifier", organization_id: ORG, cylinder_id: CIL2, kind: "nfc_tag", value: `NFC-T${rodada}-1` }, ADMIN);
    const transf = await chamar("manage-cylinders", { operation: "transfer_identifier", organization_id: ORG, value: `NFC-T${rodada}-1`, target_cylinder_id: CIL2, justification: "Etiqueta reaproveitada", confirmed: true }, ADMIN);
    const look = await chamar("query-cylinders", { operation: "lookup", organization_id: ORG, identifier_value: `nfc-t${rodada.toLowerCase()}-1` }, ADMIN);
    const passou = add.status === 201 && des.json.code === "DEACTIVATED" && reuso.json.code === "IDENTIFIER_UNAVAILABLE" && transf.json.code === "TRANSFERRED" && look.json.cylinder?.id === CIL2;
    return { passou, detalhe: "o valor agora aponta para o segundo cilindro" };
  });

  await teste("Cilindro de outra organização -> 404 NOT_FOUND (mesma resposta de inexistente)", async () => {
    const r = await chamar("query-cylinders", { operation: "get", organization_id: ORG, cylinder_id: cilindroDeOutraOrg ?? crypto.randomUUID() }, ADMIN);
    return { passou: r.status === 404 && r.json.code === "NOT_FOUND", detalhe: String(r.status) };
  });

  // ------------------------------------------------- 4. lacre e dispositivo
  console.log("\n--- [4] Lacre, dispositivo e vínculos ---");
  let LACRE = "";
  let DISP = "";
  let DISP_CODIGO = "";
  let CHAVE = "";

  await teste("create_seal e create_device (a chave aparece uma vez; o FluxID guarda só o hash)", async () => {
    const s = await chamar("manage-seals", { operation: "create_seal", organization_id: ORG, code: `LCR-T${rodada}`, nfc_uid: `UID-T${rodada}`, manufactured_on: "2026-01-01", next_review_on: "2027-01-01" }, OPERADOR);
    const d = await chamar("manage-seals", { operation: "create_device", organization_id: ORG, code: `DSP-T${rodada}`, hardware_id: `ESP32-T${rodada}`, firmware_version: "1.0.0" }, ADMIN);
    LACRE = s.json.seal_id; DISP = d.json.device_id; DISP_CODIGO = d.json.device_code; CHAVE = d.json.api_key;
    const [guardado] = await sql("SELECT api_key_hash FROM public.dispositivos WHERE id = $1", [DISP]);
    const passou = s.status === 201 && d.status === 201 && CHAVE.length === 48 && guardado.api_key_hash === createHash("sha256").update(CHAVE).digest("hex");
    return { passou, detalhe: `${s.json.seal_code} / ${DISP_CODIGO}` };
  });

  await teste("bind_device e bind_cylinder (lacre INSTALADO; histórico do cilindro com LACRE_VINCULADO); conflito sem replace -> 409", async () => {
    const a = await chamar("manage-seals", { operation: "bind_device", organization_id: ORG, seal_id: LACRE, device_id: DISP }, OPERADOR);
    const b = await chamar("manage-seals", { operation: "bind_cylinder", organization_id: ORG, seal_id: LACRE, cylinder_id: CIL }, OPERADOR);
    const c = await chamar("manage-seals", { operation: "bind_cylinder", organization_id: ORG, seal_id: LACRE, cylinder_id: CIL2 }, OPERADOR);
    const g = await chamar("query-seals", { operation: "get", organization_id: ORG, seal_id: LACRE }, OPERADOR);
    const h = await chamar("query-cylinders", { operation: "history", organization_id: ORG, cylinder_id: CIL, event_type: "seal_bound" }, OPERADOR);
    const passou = a.status === 201 && b.status === 201 && c.json.code === "BINDING_CONFLICT" && g.json.seal.status === "INSTALADO" &&
      g.json.seal.device?.code === DISP_CODIGO && g.json.seal.cylinder?.id === CIL && h.json.events?.length === 1;
    return { passou, detalhe: `lacre ${g.json.seal?.status}` };
  });

  // --------------------------------------------- 5. integração com a Oxide
  console.log("\n--- [5] Integração com a Oxide (Worker) ---");
  await espera(1500);

  await teste("Worker traz o cadastro feito pela API: dispositivo (com o hash), lacre, cilindro e vínculos", async () => {
    const r = await worker(true);
    const d = db.prepare("SELECT api_key_hash FROM devices WHERE device_id = ?").get(DISP_CODIGO) as any;
    const vinc = db.prepare("SELECT seal_code FROM seal_assignments WHERE device_id = ? AND ended_at IS NULL").get(DISP_CODIGO) as any;
    return { passou: Boolean(d?.api_key_hash) && vinc?.seal_code === `LCR-T${rodada}`, detalhe: `rodada ${r.status}` };
  });

  await teste("ESP32 envia telemetria com a chave gerada pela API -> 202; Worker leva ao FluxID; query-map mostra o ponto", async () => {
    const t = await iot("/telemetries", { message_id: `MSG-T${rodada}-1`, device_id: DISP_CODIGO, latitude: -7.2100, longitude: -39.3100, battery_percent: 90, gsm_signal: -70, seal_status: "LOCKED" }, CHAVE);
    await worker();
    const m = await chamar("query-map", { organization_id: ORG }, LEITOR);
    const ponto = (m.json.points ?? []).find((p: any) => p.cylinder.id === CIL);
    const trilha = await chamar("query-telemetry", { operation: "track", organization_id: ORG, cylinder_id: CIL }, LEITOR);
    return { passou: t.status === 202 && ponto?.gps === "ok" && ponto?.device?.code === DISP_CODIGO && trilha.json.positions?.length === 1, detalhe: `ponto ${ponto?.position?.latitude}, ${ponto?.position?.longitude}` };
  });

  // ---------------------------------------------------------- 6. comandos
  console.log("\n--- [6] Comandos pelo frontend ---");
  await teste("manage-commands: sem justificativa -> 400; operador sem ENVIAR_COMANDOS -> 403; admin -> COMMAND_QUEUED; repetido -> COMMAND_ALREADY_PENDING", async () => {
    const sem = await chamar("manage-commands", { operation: "send", organization_id: ORG, device_id: DISP, command_type: "TRAVAR_VALVULA" }, ADMIN);
    const op = await chamar("manage-commands", { operation: "send", organization_id: ORG, device_id: DISP, command_type: "TRAVAR_VALVULA", justification: "Teste do operador" }, OPERADOR);
    const ok = await chamar("manage-commands", { operation: "send", organization_id: ORG, device_id: DISP, command_type: "TRAVAR_VALVULA", justification: "Teste de travamento" }, ADMIN);
    const rep = await chamar("manage-commands", { operation: "send", organization_id: ORG, device_id: DISP, command_type: "TRAVAR_VALVULA", justification: "Teste de travamento" }, ADMIN);
    const auditoria = await sql("SELECT 1 FROM public.auditoria WHERE registro_id = $1 AND acao = 'AUTORIZACAO'", [DISP]);
    const passou = sem.json.code === "JUSTIFICATION_REQUIRED" && op.status === 403 && ok.json.code === "COMMAND_QUEUED" && rep.json.code === "COMMAND_ALREADY_PENDING" && rep.json.command_id === ok.json.command_id && auditoria.length >= 1;
    return { passou, detalhe: ok.json.command_id };
  });

  await teste("ESP32 busca o comando criado pelo frontend e confirma EXECUTADO; list mostra o histórico", async () => {
    const pend = await iot(`/commands/${DISP_CODIGO}`, undefined, CHAVE, "GET");
    const cmd = pend.json?.[0];
    const conf = await iot("/commands/confirm", { command_id: cmd?.command_id, device_id: DISP_CODIGO, status: "EXECUTADO" }, CHAVE);
    const l = await chamar("manage-commands", { operation: "list", organization_id: ORG, device_id: DISP }, LEITOR);
    return { passou: cmd?.command_type === "TRAVAR_VALVULA" && conf.status === 200 && l.json.items?.[0]?.status === "EXECUTADO", detalhe: cmd?.command_id };
  });

  // ----------------------------------------------------------- 7. alertas
  console.log("\n--- [7] Alertas (D5: tratados no FluxID) ---");
  const ALERTA = `ALT-T${rodada}-1`;
  await teste("Alerta do lacre chega ao FluxID; query-alerts list e get (com a posição)", async () => {
    const a = await iot("/alerts", { alert_id: ALERTA, device_id: DISP_CODIGO, alert_type: "LACRE_VIOLADO", title: "Lacre violado (teste)" }, CHAVE);
    await worker();
    const l = await chamar("query-alerts", { operation: "list", organization_id: ORG, status: "ABERTO" }, LEITOR);
    const g = await chamar("query-alerts", { operation: "get", organization_id: ORG, alert_id: ALERTA }, LEITOR);
    const passou = a.status === 201 && l.json.items?.some((i: any) => i.code === ALERTA && i.cylinder?.id === CIL) && g.json.alert?.seal?.id === LACRE && g.json.position !== null;
    return { passou, detalhe: `${l.json.total} aberto(s)` };
  });

  await teste("analyze -> EM_ANALISE; operador justifica; visualizador não encerra (403); admin encerra com o nome dele", async () => {
    const an = await chamar("manage-alerts", { operation: "analyze", organization_id: ORG, alert_id: ALERTA }, ADMIN);
    const ju = await chamar("manage-alerts", { operation: "justify", organization_id: ORG, alert_id: ALERTA, justification: "Lacre conferido, sem dano aparente" }, OPERADOR);
    const no = await chamar("manage-alerts", { operation: "close", organization_id: ORG, alert_id: ALERTA, resolution_note: "Tentativa sem permissão" }, LEITOR);
    const fe = await chamar("manage-alerts", { operation: "close", organization_id: ORG, alert_id: ALERTA, resolution_note: "Vistoria concluída no local" }, ADMIN);
    const [linha] = await sql("SELECT status, encerrado_por, tratado_no_fluxid, justificado_por FROM public.alertas WHERE codigo = $1", [ALERTA]);
    const passou = an.json.alert?.status === "EM_ANALISE" && ju.json.code === "JUSTIFIED" && no.status === 403 && fe.json.alert?.status === "ENCERRADO" &&
      fe.json.alert?.closed_by === `Admin ${rodada}` && linha.encerrado_por === pessoas.admin!.id && linha.tratado_no_fluxid && linha.justificado_por === pessoas.operador!.id;
    return { passou, detalhe: `${linha.status}; tratado_no_fluxid=${linha.tratado_no_fluxid}` };
  });

  await teste("Worker espelha o encerramento na Oxide e não sobrescreve o FluxID com o estado antigo", async () => {
    db.prepare("UPDATE alerts SET sync_status = 'PENDING' WHERE alert_id = ?").run(ALERTA);
    const r = await worker();
    const oxide = db.prepare("SELECT status, resolved_by FROM alerts WHERE alert_id = ?").get(ALERTA) as any;
    const [linha] = await sql("SELECT status FROM public.alertas WHERE codigo = $1", [ALERTA]);
    return { passou: oxide.status === "ENCERRADO" && oxide.resolved_by === `Admin ${rodada}` && linha.status === "ENCERRADO" && (r.regras?.espelhados_do_fluxid ?? 0) >= 1, detalhe: `Oxide ${oxide.status}; FluxID ${linha.status}` };
  });

  // ------------------------------------------ 8. entregas, rota e geocerca
  console.log("\n--- [8] Cliente, entrega, rota e geocerca automáticas ---");
  let CLIENTE = "";
  let LOCAL = "";
  let ENTREGA = "";
  // Rota em linha reta para o leste; cliente no fim da rota
  const ROTA = [{ latitude: -7.21, longitude: -39.31 }, { latitude: -7.21, longitude: -39.28 }];
  const CLIENTE_POS = { latitude: -7.21, longitude: -39.28 };

  await teste("Cliente, endereço com geocerca (200 m) e entrega do cilindro; rota com margem de 50 m", async () => {
    const c = await chamar("manage-deliveries", { operation: "create_customer", organization_id: ORG, legal_name: `Hospital Teste ${rodada}`, trade_name: "Hospital Teste" }, ADMIN);
    CLIENTE = c.json.customer_id;
    const l = await chamar("manage-deliveries", { operation: "create_location", organization_id: ORG, customer_id: CLIENTE, name: "Hospital Teste — doca", street: "Rua A", city: "Juazeiro do Norte", state: "CE", ...CLIENTE_POS, geofence_radius_meters: 200 }, ADMIN);
    LOCAL = l.json.location_id;
    const e = await chamar("manage-deliveries", { operation: "create_delivery", organization_id: ORG, location_id: LOCAL, cylinder_ids: [CIL] }, ADMIN);
    ENTREGA = e.json.delivery_id;
    const r = await chamar("manage-deliveries", { operation: "set_route", organization_id: ORG, delivery_id: ENTREGA, points: ROTA }, ADMIN);
    const dup = await chamar("manage-deliveries", { operation: "create_delivery", organization_id: ORG, location_id: LOCAL, cylinder_ids: [CIL] }, ADMIN);
    const g = await chamar("query-deliveries", { operation: "get_delivery", organization_id: ORG, delivery_id: ENTREGA }, LEITOR);
    const passou = c.status === 201 && l.status === 201 && e.status === 201 && r.json.code === "SAVED" && dup.json.code === "CYLINDER_IN_OTHER_DELIVERY" &&
      g.json.delivery?.route?.margin_meters === 50 && g.json.delivery?.location?.geofence_radius_meters === 200;
    return { passou, detalhe: `${e.json.delivery_code}; margem ${g.json.delivery?.route?.margin_meters} m` };
  });

  await teste("start -> cilindro EM_TRANSITO (e chega à Oxide na sincronização do cadastro)", async () => {
    const s = await chamar("manage-deliveries", { operation: "start", organization_id: ORG, delivery_id: ENTREGA }, ADMIN);
    await worker(true);
    const oxide = db.prepare("SELECT status FROM cylinders WHERE cylinder_code = (SELECT cylinder_code FROM cylinder_assignments WHERE seal_code = ? AND ended_at IS NULL)").get(`LCR-T${rodada}`) as any;
    return { passou: s.json.code === "STARTED" && s.json.delivery?.cylinders?.[0]?.status === "EM_TRANSITO" && oxide?.status === "EM_TRANSITO", detalhe: `Oxide: ${oxide?.status}` };
  });

  await teste("Posição sobre a rota (até 50 m) não gera alerta", async () => {
    await iot("/telemetries", { message_id: `MSG-T${rodada}-2`, device_id: DISP_CODIGO, latitude: -7.2102, longitude: -39.30, seal_status: "LOCKED" }, CHAVE);
    await worker();
    const n = (await sql("SELECT count(*)::int AS n FROM public.alertas WHERE cilindro_id = $1 AND tipo = 'SAIDA_ROTA'", [CIL]))[0].n;
    return { passou: n === 0, detalhe: "≈22 m da linha" };
  });

  await teste("Posição a ~330 m da rota -> SAIDA_ROTA automático no FluxID (lacre e cilindro do alerta corretos)", async () => {
    await iot("/telemetries", { message_id: `MSG-T${rodada}-3`, device_id: DISP_CODIGO, latitude: -7.2130, longitude: -39.295, seal_status: "LOCKED" }, CHAVE);
    await worker();
    const r = await worker();
    const linhas = await sql("SELECT codigo, lacre_id, severidade, descricao FROM public.alertas WHERE cilindro_id = $1 AND tipo = 'SAIDA_ROTA'", [CIL]);
    return { passou: linhas.length === 1 && linhas[0].lacre_id === LACRE && linhas[0].codigo.startsWith("AUT-") && linhas[0].severidade === "ALTA", detalhe: `${linhas[0]?.descricao}; regras: ${JSON.stringify(r.regras?.alertas_criados)}` };
  });

  await teste("Desvio justificado suspende a regra de rota no intervalo (sem alerta novo após encerrar o anterior)", async () => {
    const [a] = await sql("SELECT codigo FROM public.alertas WHERE cilindro_id = $1 AND tipo = 'SAIDA_ROTA'", [CIL]);
    await chamar("manage-alerts", { operation: "close", organization_id: ORG, alert_id: a.codigo, resolution_note: "Desvio por obra na via" }, ADMIN);
    await worker();
    const agora = Date.now();
    const d = await chamar("manage-deliveries", { operation: "add_deviation", organization_id: ORG, delivery_id: ENTREGA, type: "JUSTIFICADO", start: new Date(agora - 60000).toISOString(), end: new Date(agora + 3600000).toISOString(), justification: "Obra na via principal" }, ADMIN);
    db.prepare("UPDATE alerts SET created_at = datetime('now', '-2 hours') WHERE alert_id = ?").run(a.codigo);
    await iot("/telemetries", { message_id: `MSG-T${rodada}-4`, device_id: DISP_CODIGO, latitude: -7.2140, longitude: -39.294, seal_status: "LOCKED" }, CHAVE);
    await worker();
    await worker();
    const n = (await sql("SELECT count(*)::int AS n FROM public.alertas WHERE cilindro_id = $1 AND tipo = 'SAIDA_ROTA'", [CIL]))[0].n;
    return { passou: d.status === 201 && n === 1, detalhe: `alertas SAIDA_ROTA: ${n}` };
  });

  await teste("Lacre aberto em trânsito -> LACRE_ABERTO_EM_TRANSITO (CRITICA) e TRAVAR_VALVULA automático", async () => {
    await iot("/telemetries", { message_id: `MSG-T${rodada}-5`, device_id: DISP_CODIGO, latitude: -7.2101, longitude: -39.29, seal_status: "UNLOCKED" }, CHAVE);
    await worker();
    const linhas = await sql("SELECT severidade FROM public.alertas WHERE cilindro_id = $1 AND tipo = 'LACRE_ABERTO_EM_TRANSITO'", [CIL]);
    const cmd = db.prepare("SELECT command_id FROM commands WHERE device_id = ? AND status = 'PENDENTE' AND command_type = 'TRAVAR_VALVULA'").get(DISP_CODIGO) as any;
    return { passou: linhas.length === 1 && linhas[0].severidade === "CRITICA" && Boolean(cmd), detalhe: cmd?.command_id };
  });

  await teste("finish -> COM_CLIENTE e custódia aberta no endereço; dentro dos 200 m não alerta", async () => {
    const f = await chamar("manage-deliveries", { operation: "finish", organization_id: ORG, delivery_id: ENTREGA }, ADMIN);
    const cust = await sql("SELECT local_entrega_id FROM public.custodias WHERE cilindro_id = $1 AND data_fim IS NULL", [CIL]);
    await espera(1100);
    await iot("/telemetries", { message_id: `MSG-T${rodada}-6`, device_id: DISP_CODIGO, latitude: -7.2105, longitude: -39.2802, seal_status: "LOCKED" }, CHAVE);
    await worker(true);
    const n = (await sql("SELECT count(*)::int AS n FROM public.alertas WHERE cilindro_id = $1 AND tipo = 'SAIDA_GEOCERCA'", [CIL]))[0].n;
    return { passou: f.json.code === "FINISHED" && cust[0]?.local_entrega_id === LOCAL && n === 0, detalhe: "≈60 m do cliente" };
  });

  await teste("Cilindro a ~1,1 km do cliente -> SAIDA_GEOCERCA automático", async () => {
    await iot("/telemetries", { message_id: `MSG-T${rodada}-7`, device_id: DISP_CODIGO, latitude: -7.2200, longitude: -39.2800, seal_status: "LOCKED" }, CHAVE);
    await worker();
    await worker();
    const linhas = await sql("SELECT descricao FROM public.alertas WHERE cilindro_id = $1 AND tipo = 'SAIDA_GEOCERCA'", [CIL]);
    return { passou: linhas.length === 1, detalhe: linhas[0]?.descricao };
  });

  await teste("Mapa: cor do ponto = alerta aberto de maior severidade; overview com indicadores e desempenho", async () => {
    const m = await chamar("query-map", { organization_id: ORG, alert_only: true }, LEITOR);
    const ponto = (m.json.points ?? []).find((p: any) => p.cylinder.id === CIL);
    const ind = await chamar("query-overview", { organization_id: ORG, block: "indicators" }, LEITOR);
    const des = await chamar("query-overview", { organization_id: ORG, block: "performance" }, LEITOR);
    const mov = await chamar("query-overview", { organization_id: ORG, block: "movement" }, LEITOR);
    const passou = ponto?.alert?.severity === "CRITICA" && ind.json.code === "READY" && ind.json.data.with_customer === 1 && des.json.data?.measures?.length === 3 && mov.json.code === "READY";
    return { passou, detalhe: `alerta do ponto: ${ponto?.alert?.type}; abertos ${ind.json.data?.open_alerts}` };
  });

  // ---------------------------------------------------- 9. pessoas e acesso
  console.log("\n--- [9] Pessoas, convites, auditoria e foto ---");
  await teste("Convite: admin convida; aceite sem login cria a pessoa; ela entra com o papel do convite", async () => {
    const email = `convidado-t${rodada.toLowerCase()}@fluxid.teste`;
    const c = await chamar("invite-user", { operation: "invite", organization_id: ORG, email, role_code: "AUDITOR" }, ADMIN);
    const op = await chamar("invite-user", { operation: "invite", organization_id: ORG, email: "x@fluxid.teste", role_code: "AUDITOR" }, OPERADOR);
    const a = await chamar("invite-user", { operation: "accept", token: c.json.invite_token, name: `Convidado ${rodada}`, password: "Senha-convidado-1" });
    const repetido = await chamar("invite-user", { operation: "accept", token: c.json.invite_token, name: "x", password: "Senha-convidado-1" });
    const l = await chamar("session-login", { email, password: "Senha-convidado-1" });
    const p = await chamar("query-permissions", { organization_id: ORG }, l.json.session?.access_token);
    const passou = c.status === 201 && op.status === 403 && a.json.code === "INVITE_ACCEPTED" && repetido.json.code === "INVITE_INVALID" && l.status === 200 && p.json.tenant?.includes("audit.read");
    return { passou, detalhe: `permissões do convidado: ${p.json.tenant?.join(",")}` };
  });

  await teste("manage-membership lista as pessoas; bloquear o operador corta o acesso dele à organização", async () => {
    const l = await chamar("manage-membership", { operation: "list", organization_id: ORG }, ADMIN);
    const b = await chamar("manage-membership", { operation: "change_status", organization_id: ORG, user_id: pessoas.operador!.id, status: "blocked" }, ADMIN);
    const tentativa = await chamar("query-cylinders", { operation: "list", organization_id: ORG }, OPERADOR);
    await chamar("manage-membership", { operation: "change_status", organization_id: ORG, user_id: pessoas.operador!.id, status: "active" }, ADMIN);
    return { passou: l.json.items?.length === 4 && b.json.code === "UPDATED" && tentativa.status === 401, detalhe: `${l.json.items?.length} pessoas; bloqueado -> ${tentativa.status}` };
  });

  await teste("manage-access: atribuir SUPERVISOR ao operador dá command.send; FLUXID_MASTER só pela plataforma (403)", async () => {
    const a = await chamar("manage-access", { operation: "assign_role", organization_id: ORG, user_id: pessoas.operador!.id, role_code: "SUPERVISOR" }, ADMIN);
    const p = await chamar("query-permissions", { organization_id: ORG }, OPERADOR);
    const m = await chamar("manage-access", { operation: "assign_role", organization_id: ORG, user_id: pessoas.operador!.id, role_code: "FLUXID_MASTER" }, ADMIN);
    await chamar("manage-access", { operation: "remove_role", organization_id: ORG, user_id: pessoas.operador!.id, role_code: "SUPERVISOR" }, ADMIN);
    return { passou: a.json.code === "UPDATED" && p.json.tenant?.includes("command.send") && m.status === 403, detalhe: "papel removido depois" };
  });

  await teste("query-audit traz as ações da organização (login, cadastro, alerta); organização: admin não cria empresa (403)", async () => {
    const a = await chamar("query-audit", { organization_id: ORG, limit: 100 }, ADMIN);
    const notas = new Set((a.json.items ?? []).map((i: any) => i.note));
    const org2 = await chamar("manage-organizations", { operation: "create", legal_name: "X", name: "X", cnpj: "11222333000181", email: "x@x.teste" }, ADMIN);
    const lista = await chamar("manage-organizations", { operation: "list" }, ADMIN);
    const passou = notas.has("cylinder.create") && notas.has("alert.close") && notas.has("delivery.start") && org2.status === 403 && lista.json.items?.some((o: any) => o.id === ORG);
    return { passou, detalhe: `${a.json.items?.length} registros` };
  });

  await teste("profile-avatar: PNG salvo e lido; conteúdo que não é PNG -> 400", async () => {
    const up = await chamar("profile-avatar", { operation: "upload", content_type: "image/png", data_base64: PNG_1X1 }, ADMIN);
    const get = await chamar("profile-avatar", { operation: "get" }, ADMIN);
    const ruim = await chamar("profile-avatar", { operation: "upload", content_type: "image/png", data_base64: Buffer.from("não é imagem").toString("base64") }, ADMIN);
    return { passou: up.json.code === "SAVED" && get.json.data_base64 === PNG_1X1 && ruim.status === 400, detalhe: get.json.content_type };
  });

  await teste("session-logout -> SIGNED_OUT; o token deixa de valer", async () => {
    const s = await chamar("session-logout", {}, ADMIN);
    const depois = await chamar("query-permissions", { organization_id: ORG }, ADMIN);
    return { passou: s.json.code === "SIGNED_OUT" && depois.status === 401, detalhe: String(depois.status) };
  });

  // ------------------------------------------------------------- resumo
  const falhas = resultados.filter(r => !r.passou);
  console.log("\n==================================================");
  console.log(`  API do frontend — rodada ${rodada}`);
  console.log(`   Total: ${resultados.length}   Passaram: ${resultados.length - falhas.length}   Falharam: ${falhas.length}`);
  console.log("==================================================");
  console.log(`Dados da rodada no FluxID de análise: organização ORG-T${rodada}.`);

  await fluxid.end();
  await fecharFluxid();
  server.close();
  process.exitCode = falhas.length ? 1 : 0;
}

main().catch(erro => {
  console.error("Teste interrompido:", erro);
  process.exit(1);
});
