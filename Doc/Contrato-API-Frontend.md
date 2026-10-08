# Contrato da API para o frontend (FluxID)

**Versão:** 1.0 — 07/10/2026 — **implementado** no backend; aguardando a validação de Natã da Silva Baracho (backend) e a revisão de aalissonalmeidaq (frontend)
**Público:** quem programa o frontend (repositório `fluxid_integra2026`) e quem programa a API do backend (este repositório).
**Base:**
- frontend na versão `5bb62ab` (etapas 001 a 006);
- banco FluxID com os scripts `sql/fluxid/001` a `006`;
- API com o Worker ([Integracao-Oxide-FluxID.md](Integracao-Oxide-FluxID.md)).

Com a API rodando, a especificação também pode ser vista no navegador, no formato do Swagger: **`http://<servidor>:3000/api-docs-fluxid`**.

Este documento diz **quais chamadas a API oferece ao frontend**, o que cada uma recebe e devolve, e **de qual tabela do FluxID** sai cada dado. As decisões D1 a D9 da versão 0.1 foram implementadas **na opção recomendada** (seção 9). Se alguma for mudada na validação, o código muda junto.

---

## 1. Resumo

- O **FluxID** (`FluxID_db`) é o banco definitivo. O banco do Supabase usado pelo frontend até agora é só de teste.
- A **mesma API** atende:
  - o **lacre**, em `/api/v1/iot/...`, como antes;
  - o **frontend**, em `/api/v1/app/...`, que é novo.
- Para o frontend mudar o mínimo possível, a API **imita o jeito como o frontend já chama o servidor**:
  - os mesmos nomes de função (`query-cylinders`, `manage-cylinders`...);
  - o mesmo corpo (`operation`, `organization_id`...);
  - os mesmos códigos de resposta (`LISTED`, `NOT_FOUND`...).

  Na prática, o frontend troca **três coisas**:
  - o **endereço base**;
  - de onde sai o **token** (seção 4);
  - remove o cabeçalho `apikey` do Supabase.
- Os nomes dos campos no JSON continuam **em inglês** (D9). A API converte para as colunas do FluxID, em português (seção 6.3).

## 2. Como fica o sistema

```text
Frontend (React, PWA) ──POST /api/v1/app/<função>──┐
                                                    ▼
                                         API do backend (Node.js + TypeScript)
                                            │        │               ▲
                                            ▼        ▼ comandos      │
ESP32 (lacre) ──POST /api/v1/iot/...──► oxide.db ──► Worker ──► FluxID (PostgreSQL)
```

- **Cadastro e consulta** do frontend leem e gravam **direto no FluxID**.
- O que vem do **lacre** entra pela Oxide e chega ao FluxID pelo Worker.
- O cadastro feito no frontend chega à Oxide pelo Worker, a cada 5 minutos: dispositivos (com o hash da chave), lacres, cilindros (com o status) e vínculos.
- O **comando** de válvula criado no frontend vai direto para a Oxide (tabela `commands`), de onde o ESP32 o busca.

## 3. Como chamar a API

| Item | Valor |
| --- | --- |
| Endereço base | `http://<servidor>:3000/api/v1/app` |
| Método | Sempre `POST`. Outro método → `405 METHOD_NOT_ALLOWED` |
| Cabeçalhos | `content-type: application/json` e `authorization: Bearer <token da sessão>` |
| Corpo | JSON com `operation` (quando a função tem mais de uma) e `organization_id` (organização ativa: é só contexto, nunca prova acesso) |
| Resposta | JSON `{ "code": "...", ... }`; o `code` nunca é sobrescrito por outro campo |
| Tamanho máximo do corpo | 1 MB |
| Navegador (CORS) | Só as origens em `APP_ORIGENS` (no `.env` do servidor). Sem a variável, valem as de desenvolvimento: `localhost:5173`, `127.0.0.1:5173`, `localhost:4173` e `localhost:3001` |

**Exemplo:**

```http
POST http://localhost:3000/api/v1/app/query-cylinders
authorization: Bearer u8Q4...
content-type: application/json

{ "operation": "list", "organization_id": "b01e1a06-1f63-4a57-a720-7cc10d76ef73", "status": "active", "limit": 25 }
```

```json
{ "code": "LISTED", "items": [ { "id": "...", "code": "CIL-000001", "serial_number": "SN-000001", "status": "active", "stock_status": "out_of_stock", "hydro_status": "em_dia", "active_identifier_count": 1, "version": 1 } ], "total": 50, "next": "MjU" }
```

**Códigos comuns:**

| Código | HTTP | Quando |
| --- | --- | --- |
| `AUTH_REQUIRED` | 401 | Sem token, sessão vencida, ou sem vínculo ativo na organização informada (traz `reason`) |
| `ACCESS_DENIED` | 403 | Autenticado, mas sem a permissão da operação |
| `NOT_FOUND` | 404 | Não existe **ou é de outra organização** (mesma resposta, para não revelar dados de outra empresa) |
| `FUNCTION_NOT_FOUND` | 404 | Nome de função desconhecido |
| `VALIDATION_FAILED` | 400 | Corpo inválido; traz `fields: [{ field, message }]` |
| `JUSTIFICATION_REQUIRED` | 400 | Falta justificativa (5 a 500 caracteres) onde ela é obrigatória |
| `METHOD_NOT_ALLOWED` | 405 | Método diferente de `POST` |
| `PAYLOAD_TOO_LARGE` | 413 | Corpo acima de 1 MB |
| `INTERNAL_ERROR` | 500 | Falha inesperada, sem detalhe |
| `UNAVAILABLE` | 503 | FluxID fora do ar ou não configurado no servidor |

**Paginação:** listas devolvem `next`, um cursor opaco. Para a próxima página, mande `cursor: next`. O `next` vem `null` quando não há mais itens.

**Regras que valem para todas as funções:**
- Quem faz a ação, e em qual organização, é decidido **no servidor**, pelo token.
- Uma organização só vê os próprios dados (RN22).
- Nada é apagado (RN21). Inativar, encerrar e desvincular preenchem datas.
- Senha, token e chave nunca aparecem em log. A chave do dispositivo aparece **uma vez**, na resposta de quem a gerou.
- Toda escrita fica na `auditoria` do FluxID, na mesma transação.

## 4. Login e sessão (D3: a API faz o login)

| Função | Entrada | Respostas |
| --- | --- | --- |
| `session-login` (sem token) | `email`, `password`, `revoke_session_id?` | **`AUTHENTICATED` 200** com `session: { access_token, refresh_token: "", expires_at }`, `access_token`, `session_id`, `user` e `organizations` (cada uma com os papéis da pessoa). Erros: `INVALID_REQUEST` 400; `INVALID_CREDENTIALS` 401; `ACCOUNT_UNAVAILABLE` 403; `SESSION_LIMIT_REACHED` 409 (com `sessions`); `RATE_LIMITED` 429 |
| `session-status` | token | `SESSION_ACTIVE` 200 (`aal: "aal1"`, `mfa_required: false`, `expires_at`). Erros 401: `SESSION_EXPIRED` (com `reason`: `timebox` ou `inactivity`), `SESSION_REVOKED` ou `SESSION_INVALID` |
| `session-logout` | token | `SIGNED_OUT` 200, mesmo se a sessão já tiver acabado |
| `password-recovery` (sem token) | `email`; depois `token` + `new_password` | Pedido: sempre `RECOVERY_REQUEST_ACCEPTED` para e-mail bem formado. Troca: `PASSWORD_UPDATED`, ou `RECOVERY_TOKEN_INVALID` (400) |

Regras:
- o token é **opaco** (não é JWT); o FluxID guarda só o hash SHA-256 (`sessoes_usuario`);
- a senha é guardada com **scrypt** (`usuarios.senha_hash`);
- a sessão dura no máximo **8 horas**; **30 minutos** sem uso a encerram (cada chamada renova);
- até **3 sessões** ativas por pessoa: a 4ª responde `SESSION_LIMIT_REACHED` com a lista; o login repetido com `revoke_session_id` encerra aquela e entra;
- **5 falhas em 15 minutos** bloqueiam o e-mail por 15 minutos;
- o pedido de recuperação vale **1 hora** e é de uso único; a troca de senha encerra todas as sessões abertas;
- o **MFA** (segundo fator) fica para uma fase seguinte.

**Ainda não há envio de e-mail.** Por isso o token de recuperação e o de convite não chegam a ninguém sozinhos:
- em teste (`APP_EXPOR_TOKENS=1`), os dois voltam na própria resposta;
- fora do teste, o servidor só registra que um token de recuperação foi gerado (sem o token).

O envio de e-mail é o próximo passo.

**Senha dos usuários que já existem no FluxID.** Os usuários da massa têm `HASH_PROVISORIO` e não conseguem entrar. A senha é definida no terminal do servidor:

```bash
npm run senha -- admin@alfagases.teste
```

A senha é digitada sem aparecer na tela e só o hash vai para o banco.

**O que muda no frontend:**
- o token passa a sair do `session.access_token` devolvido por `session-login` (antes: `supabase.auth.getSession()`);
- o endereço base muda;
- o cabeçalho `apikey` deixa de ser enviado.

O `session-service` do frontend já lê `session.access_token`, `session.refresh_token`, `sessions`, `aal`, `expires_at` e `reason` nesse formato.

## 5. Organização, pessoas, papéis e auditoria (D2, D4, D7)

| Função | Operações | Permissão | Tabelas do FluxID |
| --- | --- | --- | --- |
| `query-permissions` | — → `{ code: "PERMISSIONS_LISTED", tenant: [...], global: [...], organization_id }` | qualquer sessão | `usuario_organizacao_perfis`, `perfil_permissoes`, `permissoes` |
| `manage-organizations` | `list` (todas para a plataforma; as suas para os demais), `create`, `change_status`, `invite_first_admin` | `platform.manage` (exceto `list`) | `organizacoes`, `convites` |
| `manage-membership` | `list`, `change_status` (`active`, `blocked`, `inactive`) | `tenant.manage` | `usuario_organizacoes` (D4: uma pessoa pode estar em várias organizações) |
| `manage-access` | `list`, `assign_role`, `remove_role`; `save_role` e `set_role_active` (o papel vale para o sistema todo) | `tenant.manage`; plataforma para `save_role`/`set_role_active` e para atribuir `FLUXID_MASTER` | `perfis`, `perfil_permissoes`, `usuario_organizacao_perfis` |
| `invite-user` | `invite`, `list`, `resend`, `revoke`; **`accept` sem token** (cria a pessoa com nome e senha, ou só a vincula se o e-mail já existe) | `tenant.manage` | `convites` (7 dias, uso único) |
| `query-audit` | filtros `from`, `to`, `action`, `actor_id`, `table` | `audit.read` | `auditoria` |
| `profile-avatar` | `get`, `upload` (`content_type`, `data_base64`), `remove` | a própria pessoa | arquivo em `APP_PASTA_ARQUIVOS/fotos` (D7 a); `usuarios.foto_caminho` |

Regras:
- ninguém altera o **próprio** vínculo;
- bloquear ou inativar o vínculo corta o acesso da pessoa **àquela** organização, com resposta `AUTH_REQUIRED`;
- a foto aceita PNG, JPEG ou WEBP de até 512 KB, e o conteúdo é conferido (não basta o tipo declarado).

## 6. Cilindros (telas que o frontend já tem)

Mesmo contrato da etapa 006 do frontend (`specs/006-cilindros-e-estoque/contracts/operacoes-servidor.md`), sobre o FluxID.

### 6.1 `query-cylinders` (só leitura)

| `operation` | Permissão | Entrada | Saída |
| --- | --- | --- | --- |
| `list` | `cylinder.read` | `search?` (identificador exato, parte da série ou o código), `status?` (`active` padrão, `inactive`, `all`), `stock_status?`, `hydro_status?`, `cylinder_type_id?`, `sort?` (`serial`, `serial_desc`), `cursor?`, `limit?` (1–100) | `{ code: "LISTED", items[], total, next }` |
| `get` | `cylinder.read` | `cylinder_id` | `{ code: "FOUND", cylinder, identifiers[], tests[], hydro_status, seal }`; `seal` é o lacre atual (ou `null`) |
| `lookup` | `cylinder.read` | `identifier_value` | `{ code: "FOUND", cylinder, identifier }`; desativado → 404 com `deactivated: true` e o cilindro a que pertencia |
| `history` | `cylinder.history` | `cylinder_id`, `event_type?`, `from?`, `to?`, `order?`, `cursor?`, `limit?` | `{ code: "LISTED", events[], next }`; cada evento traz `origin` e `actor_name` |
| `catalog` | `cylinder.read` | — | `{ code: "LISTED", types[] }` |

Cada cilindro traz:
- `id`, `code`, `serial_number`, `type`;
- `status` (`active`/`inactive`) e `operational_status` (o status do FluxID: `DISPONIVEL`, `EM_TRANSITO`, `COM_CLIENTE`...);
- `stock_status`, `hydro_status`, `active_identifier_count`, `version`;
- `manufacturer`, `manufacture_year`, `working_pressure_bar`, `notes`, `inactivation_reason`;
- `hydro_last_result`, `hydro_next_due_on` e `created_at`.

**Cilindros anteriores ao catálogo de tipos.** Os 155 cilindros da massa do FluxID não têm `tipo_cilindro_id`. Eles vêm com um tipo montado a partir do texto antigo, marcado com `type.legacy: true`. Ao editar, o frontend pode escolher um tipo real.

**Situação do teste hidrostático** (mesma regra do frontend):
- `sem_teste`;
- `reprovado` (último teste reprovado);
- `vencido`;
- `a_vencer` (até 30 dias);
- `em_dia`.

Vale o último teste que não foi retificado. A data de "hoje" é a de America/Sao_Paulo.

### 6.2 `manage-cylinders` (comandos, auditados)

| `operation` | Permissão | Entrada principal | O que grava no FluxID |
| --- | --- | --- | --- |
| `create` | `cylinder.write` | `serial_number`, `cylinder_type_id?`, `manufacturer?`, `manufacture_year?`, `working_pressure_bar?`, `notes?`, `identifier { kind, value }` | `cilindros` (código `CIL-000001` sequencial, fora do estoque), `identificadores_cilindro`, histórico `CILINDRO_CRIADO` (gatilho) e `IDENTIFICADOR_ADICIONADO`. Resposta `CREATED` 201 com `cylinder_id`, `cylinder_code`, `version` |
| `update` | `cylinder.write` | `cylinder_id`, `expected_version`, campos | sobe `versao`; histórico `CILINDRO_ATUALIZADO` com antes e depois |
| `save_type` | `cylinder.write` | `gas`, `capacity_value`, `capacity_unit`, `classification`, `type_id?`, `active?` | `tipos_cilindro` → `SAVED` com `type_id` |
| `inactivate` / `reactivate` | `cylinder.deactivate` | `cylinder_id`, `reason` (só inativar), `justification` | `status = INATIVO` e `motivo_inativacao`; sai do estoque (histórico `SAIDA_ESTOQUE_INATIVACAO` se estava nele); reativar volta a `DISPONIVEL` |
| `add_identifier` / `deactivate_identifier` / `transfer_identifier` | `cylinder.identifier` | como no frontend (`confirmed: true` na transferência) | `identificadores_cilindro`; histórico de cada lado |
| `stock_in` | `cylinder.stock_in` | `identifier_value`, `operation_key` (UUID) | `situacao_estoque = EM_ESTOQUE`; cilindro com cliente ou em trânsito volta a `DISPONIVEL` e a **custódia no cliente termina**; histórico `ENTRADA_ESTOQUE`. Resposta `STOCKED` com `replayed`, `event_sequence`, `hydro_status` e `warning?` (`hydro_expired`, `hydro_rejected`) |
| `register_test` / `rectify_test` | `cylinder.test` | `performed_on`, `result`, `executor`, `report_number?`, `next_due_on?` (sem ela: 5 anos depois), `notes?`; retificar pede `test_id` e `justification` | `testes_hidrostaticos` (`numero_laudo`, `retifica_teste_id`); histórico |

Códigos próprios de cilindro:
- os mesmos do frontend: `SERIAL_CONFLICT` e `IDENTIFIER_CONFLICT` (os dois com o `cylinder_id` do dono), `IDENTIFIER_UNAVAILABLE`, `VERSION_CONFLICT` (com `current_version`), `CYLINDER_INACTIVE`, `ALREADY_IN_STOCK`, `ALREADY_INACTIVE`, `JUSTIFICATION_REQUIRED` e `IDEMPOTENCY_PAYLOAD_CONFLICT`;
- e um novo: `TEST_ALREADY_RECTIFIED`.

Regras:
- `version` sobe em `update`, `inactivate`, `reactivate` e `stock_in`;
- `stock_in` com a mesma `operation_key` devolve a primeira resposta com `replayed: true`; a mesma chave com outro identificador responde `IDEMPOTENCY_PAYLOAD_CONFLICT` (tabela `chaves_operacao`).

### 6.3 Nomes e valores: frontend × FluxID

| Frontend (JSON) | FluxID (coluna) | Valores |
| --- | --- | --- |
| `serial_number` | `cilindros.numero_serie` | — |
| `status` | `cilindros.status` | `active` = qualquer status diferente de `INATIVO`; `inactive` = `INATIVO` |
| `operational_status` | `cilindros.status` | o valor do FluxID, sem tradução |
| `stock_status` | `cilindros.situacao_estoque` (D1, script `006`) | `in_stock` ↔ `EM_ESTOQUE`, `out_of_stock` ↔ `FORA_DO_ESTOQUE` |
| `inactivation_reason` | `motivo_inativacao` | `written_off`↔`BAIXADO`, `lost`↔`EXTRAVIADO`, `condemned`↔`CONDENADO`, `other`↔`OUTRO` |
| `manufacturer`, `working_pressure_bar`, `version`, `notes` | `fabricante`, `pressao_trabalho_bar`, `versao`, `observacao` | — |
| `manufacture_year` | `data_fabricacao` | o ano; grava 1º de janeiro |
| `cylinder_type_id` | `tipo_cilindro_id` | — |
| `capacity_unit` | `capacidade_unidade` | `l`↔`L`, `m3`↔`M3`, `kg`↔`KG` |
| `classification` | `classificacao` | `medicinal`↔`MEDICINAL`, `industrial`↔`INDUSTRIAL` |
| `identifier.kind` | `identificadores_cilindro.tipo` | `qr_code`↔`QR_CODE`, `data_matrix`↔`DATA_MATRIX`, `nfc_tag`↔`NFC`, `hull_number`↔`NUMERO_CASCO` |
| `test.result` | `testes_hidrostaticos.resultado` | `approved`↔`APROVADO`, `rejected`↔`REPROVADO` |
| `test.performed_on`, `next_due_on`, `report_number`, `executor` | `data_teste`, `proximo_teste`, `numero_laudo`, `realizado_por` | — |
| `event_type` (histórico) | `historico_cilindro.tipo_evento` | os 12 do frontend, mais `seal_bound`↔`LACRE_VINCULADO`, `seal_unbound`↔`LACRE_DESVINCULADO`, `alert_opened`↔`ALERTA_REGISTRADO` e `alert_closed`↔`ALERTA_ENCERRADO` |

## 7. Lacre, mapa e alertas (telas novas, ligadas à Oxide)

### 7.1 `query-overview` — Visão geral com dados reais

Entrada: `organization_id`, `block` e `days?` (só em `movement`; padrão 14). Resposta: `{ code: "READY", data }` ou `{ code: "EMPTY" }`.

| `block` | `data` |
| --- | --- |
| `indicators` | `cylinders_total`, `in_transit`, `with_customer`, `in_stock`, `open_alerts` |
| `map` | `points` (como em `query-map`) |
| `movement` | `series: [{ day, departures, deliveries }]`: saídas e entregas por dia (D6) |
| `situation` | `by_status: [{ status, count }]` |
| `recent_alerts` | 5 alertas mais recentes |
| `recent_cylinders` | 5 cilindros mais recentes |
| `performance` | `measures`: % de cilindros lacrados com posição nas últimas 24 h; % de alertas encerrados em até 24 h (últimos 30 dias); % de testes hidrostáticos em dia (D6) |

### 7.2 `query-map` — onde estão os lacres e os cilindros

Entrada: `organization_id`, `bbox?` (`[oeste, sul, leste, norte]`), `alert_only?`. Permissão `map.read`.

```json
{
  "code": "LISTED",
  "points": [
    {
      "cylinder": { "id": "...", "code": "CIL-000001", "serial_number": "SN-000001", "status": "EM_TRANSITO" },
      "seal": { "id": "...", "code": "LCR-000001", "status": "INSTALADO" },
      "device": { "id": "...", "code": "DSP-000001" },
      "position": { "latitude": -7.2091939, "longitude": -39.3063666, "at": "2026-10-07T04:03:57Z" },
      "battery_percent": 80,
      "gps": "ok",
      "alert": { "code": "AUT-MUYWK4UE-5F58", "type": "SAIDA_ROTA", "severity": "ALTA" }
    }
  ]
}
```

- A posição é a **última telemetria válida** do cilindro.
- `gps: "no_signal"` quando a leitura mais recente foi para a quarentena; o ponto continua na última posição conhecida (P2).
- A **cor** do ponto vem do alerta aberto de maior severidade (`alert`).

### 7.3 `query-alerts` e `manage-alerts` (D5)

| Função / `operation` | Permissão | Entrada | Saída / efeito |
| --- | --- | --- | --- |
| `query-alerts` `list` | `alert.read` | `status?`, `severity?` (valor ou lista), `type?`, `cylinder_id?`, `from?`, `to?`, `cursor?`, `limit?` | `{ code: "LISTED", items[], total, next }`, abertos primeiro, por severidade |
| `query-alerts` `get` | `alert.read` | `alert_id` (o id ou o código) | `{ code: "FOUND", alert, position }`; `position` é a posição mais próxima do momento do alarme |
| `manage-alerts` `analyze` | `alert.close` | `alert_id` | `ABERTO` → `EM_ANALISE` |
| `manage-alerts` `close` | `alert.close` | `alert_id`, `resolution_note` | → `ENCERRADO`, com `encerrado_em`, `encerrado_por` (a pessoa logada) e o motivo; histórico `ALERTA_ENCERRADO` |
| `manage-alerts` `justify` | `alert.justify` | `alert_id`, `justification` | grava a justificativa (motorista, saída de rota). **Só o gestor encerra** |

Transição inválida → `INVALID_TRANSITION` 409 (com `current_status`).

**D5:** depois que o alerta é tratado aqui, `alertas.tratado_no_fluxid = true`:
- o Worker deixa de sobrescrevê-lo com o que vier da Oxide;
- o Worker copia o novo estado para a Oxide, para a regra de não repetir alerta aberto.

Cada alerta traz:
- `code`, `type`, `severity`, `status`, `title`, `description`;
- `opened_at`, `closed_at`, `closed_by`, `resolution_note`;
- `justification`, `justified_by`, `justified_at`, `handled_in_fluxid`;
- `cylinder`, `seal` e `device`.

**Alertas automáticos** (seção 7.7) têm código `AUT-...`.

### 7.4 `query-seals` e `manage-seals` — lacres, dispositivos e vínculos

| `operation` | Permissão | Entrada | Efeito |
| --- | --- | --- | --- |
| `query-seals` `list` / `get` | `seal.read` | `status?`, `search?` / `seal_id` | Lacre, dispositivo e cilindro atuais (com `binding_id`), última inspeção, `review_overdue`; `get` traz também o histórico de vínculos |
| `query-seals` `devices` | `seal.read` | — | Dispositivos, com `has_key`, o lacre atual, `synced_to_oxide` e o último contato registrado na Oxide |
| `manage-seals` `create_seal` | `seal.write` | `nfc_uid`, `manufactured_on`, `next_review_on`, `code?` | Lacre `EM_ESTOQUE` (código `LCR-000001` se não informado) |
| `manage-seals` `create_device` | `seal.write` | `hardware_id`, `firmware_version?`, `model?`, `code?` | Dispositivo ativo; a resposta traz a chave **uma única vez** (`api_key`, 48 caracteres); o FluxID guarda só o hash |
| `manage-seals` `rotate_device_key` | `seal.write` | `device_id` | Nova chave (mostrada uma vez); a antiga deixa de valer quando o Worker sincronizar o cadastro |
| `manage-seals` `set_device_active` | `seal.write` | `device_id`, `active` | Ativa ou desativa o dispositivo |
| `manage-seals` `bind_device` / `bind_cylinder` | `seal.write` | `seal_id` + `device_id` ou `cylinder_id`, `replace?` | Um vínculo ativo por vez (RN04/RN05). Sem `replace`, o conflito responde `BINDING_CONFLICT`. `bind_cylinder` exige lacre `EM_ESTOQUE` ou `REMOVIDO` e o deixa `INSTALADO`; histórico `LACRE_VINCULADO` |
| `manage-seals` `unbind` | `seal.write` | `binding_id`, `reason` | Encerra o vínculo; do cilindro, deixa o lacre `REMOVIDO` (histórico `LACRE_DESVINCULADO`) |
| `manage-seals` `confirm_violation` | `seal.write` + `alert.close` | `seal_id`, `decision` (`confirm`/`release`), `justification` | `SUSPEITA_VIOLACAO` → `ROMPIDO` ou de volta a `INSTALADO` (P8) |
| `manage-seals` `inspect` | `seal.write` | `seal_id`, `result`, `next_review_on`, `inspected_on?`, `notes?` | `inspecoes_lacre`; atualiza a próxima revisão; `INUTILIZADO` inutiliza o lacre |

Outros códigos: `SEAL_NOT_INSTALLABLE`, `DEVICE_INACTIVE`, `CODE_CONFLICT`, `NFC_CONFLICT` e `HARDWARE_ID_CONFLICT`.

### 7.5 `query-telemetry` — trajeto e eventos

| `operation` | Entrada | Saída | FluxID |
| --- | --- | --- | --- |
| `track` | `cylinder_id` ou `device_id`, `from?`, `to?`, `limit?` (até 5000) | `positions[]` em ordem | `telemetrias` |
| `events` | `seal_id` ou `device_id`, período | `events[]` do lacre e do dispositivo | `eventos_lacre`, `eventos_dispositivo` |
| `quarantine` | `device_id`, período | `readings[]` sem posição | `telemetrias_quarentena` |

### 7.6 `manage-commands` — travar e destravar a válvula (D8)

| `operation` | Permissão | Entrada | Efeito |
| --- | --- | --- | --- |
| `send` | `command.send` | `device_id`, `command_type` (`TRAVAR_VALVULA`, `DESTRAVAR_VALVULA`), `justification` | Cria o comando `PENDENTE` na Oxide; o ESP32 busca e confirma como já faz. `COMMAND_QUEUED` 201, ou `COMMAND_ALREADY_PENDING` se já havia um igual. Fica na auditoria (`AUTORIZACAO`) |
| `list` | `seal.read` | `device_id` | Últimos 100 comandos, com o resultado (`EXECUTADO`/`ERRO`) |

`DEVICE_NOT_SYNCED` (409): o dispositivo ainda não chegou à Oxide; espere a sincronização do cadastro (até 5 minutos).

### 7.7 Alertas automáticos (gerados pelo servidor)

O servidor abre alertas sozinho; eles chegam ao FluxID pelo Worker como os do lacre.

| Alerta | Quando | Onde roda |
| --- | --- | --- |
| `BATERIA_BAIXA` | telemetria com bateria abaixo de 15% | recebimento |
| `GSM_SINAL_FRACO` | sinal abaixo de -105 dBm | recebimento |
| `LACRE_ABERTO_EM_TRANSITO` | lacre `UNLOCKED`/`BROKEN` com o cilindro `EM_TRANSITO` (telemetria ou evento). Cria também o comando `TRAVAR_VALVULA` | recebimento |
| `COMANDO_FALHOU` | o ESP32 confirma um comando com `ERRO` | recebimento |
| `SEM_COMUNICACAO` | nenhum contato há mais de 30 min | Worker |
| `GPS_SEM_SINAL` | continua mandando telemetria, mas sem posição há mais de 15 min | Worker |
| `COMANDO_SEM_RESPOSTA` | comando pendente há mais de 10 min | Worker |
| `SAIDA_ROTA` | entrega `EM_ANDAMENTO` com rota: última posição mais longe da linha da rota que a margem (padrão 50 m), fora de um desvio | Worker |
| `SAIDA_GEOCERCA` | cilindro com o cliente (custódia aberta): última posição fora do raio do endereço | Worker |

Regras:
- só abre alerta para dispositivo que está num lacre que está num cilindro, porque o FluxID exige os dois no alerta;
- não repete enquanto houver um aberto do mesmo tipo para o mesmo dispositivo, nem antes de 30 minutos depois do último;
- todos os limites mudam no `.env` (`REGRA_...`), sem mudar o código.

## 8. Clientes, entregas e rotas (funções novas)

Não estavam na v0.1. Foram criadas para o operador fazer pela API o que a rota e a geocerca automáticas precisam.

| Função / `operation` | Permissão | Entrada | Efeito |
| --- | --- | --- | --- |
| `query-deliveries` `list_customers` | `cylinder.read` | `cursor?`, `limit?` | Clientes com os endereços |
| `query-deliveries` `list_deliveries` | `cylinder.read` | `status?` | Entregas com quantidade de cilindros e se tem rota |
| `query-deliveries` `get_delivery` | `cylinder.read` | `delivery_id` | Endereço (com a geocerca), cilindros, rota e desvios |
| `manage-deliveries` `create_customer` | `customer.write` | `legal_name`, `trade_name?`, `document?`, `email?` | `destinatarios` (código `CLI-000001`) |
| `manage-deliveries` `create_location` | `customer.write` | `customer_id`, `name`, `street`, `city`, `state`, `latitude`, `longitude`, `geofence_radius_meters?` (padrão 10 m, a regra do destino; de 5 a 50000), `number?`, `district?`, `zip?` | `locais_entrega` (código `LOC-000001`) |
| `manage-deliveries` `create_delivery` | `delivery.write` | `location_id`, `cylinder_ids[]`, `planned_at?`, `notes?` | Entrega `PENDENTE` (código `ENT-000001`); cilindro inativo ou já em outra entrega aberta → `CYLINDER_INACTIVE` / `CYLINDER_IN_OTHER_DELIVERY` |
| `manage-deliveries` `set_route` | `route.plan` | `delivery_id`, `points[]` (2 a 500 `{ latitude, longitude }`), `margin_meters?` (padrão 50) | Grava ou troca a rota (`rotas_entrega`) |
| `manage-deliveries` `add_deviation` | `route.plan` | `delivery_id`, `type` (`PROGRAMADO`/`JUSTIFICADO`), `start`, `end`, `justification` | Suspende a regra de rota no intervalo (`desvios_rota`) |
| `manage-deliveries` `start` | `delivery.write` | `delivery_id` | `EM_ANDAMENTO`; cilindros `EM_TRANSITO` e fora do estoque |
| `manage-deliveries` `finish` | `delivery.write` | `delivery_id` | `CONCLUIDA`; cilindros `COM_CLIENTE`; abre a **custódia** no endereço |
| `manage-deliveries` `cancel` | `delivery.write` | `delivery_id`, `reason` | `CANCELADA`; cilindros em trânsito voltam a `DISPONIVEL` |
| `manage-deliveries` `end_custody` | `delivery.write` | `cylinder_id`, `reason` | Recolhimento no cliente: encerra a custódia |

## 9. Permissões e decisões

**Permissões.** O frontend usa códigos `resource.action`; a API os calcula a partir das permissões do FluxID (D2):

| Código do frontend | Permissões do FluxID |
| --- | --- |
| `cylinder.read` | `VER_CILINDROS` |
| `seal.read`, `map.read` | `VER_CILINDROS` ou `VISUALIZAR_ALERTAS` |
| `cylinder.write`, `customer.write` | `CRIAR_CILINDRO` ou `EDITAR_CILINDRO` |
| `cylinder.deactivate` | `INATIVAR_CILINDRO` |
| `cylinder.identifier` | `GERENCIAR_IDENTIFICADORES` |
| `cylinder.stock_in` | `ENTRADA_ESTOQUE` |
| `cylinder.test` | `REGISTRAR_TESTE_HIDROSTATICO` |
| `cylinder.history` | `VER_HISTORICO_CILINDRO` |
| `seal.write` | `CRIAR_LACRE` ou `EDITAR_LACRE` |
| `alert.read` | `VISUALIZAR_ALERTAS` |
| `alert.close` | `ENCERRAR_ALERTAS` |
| `alert.justify` | `JUSTIFICAR_ALERTAS` |
| `command.send` | `ENVIAR_COMANDOS` |
| `route.plan`, `delivery.write` | `PLANEJAR_ROTAS` |
| `tenant.manage` | `CRIAR_USUARIO` ou `EDITAR_USUARIO` |
| `audit.read` | `GERAR_RELATORIOS` ou `ADMINISTRAR_SISTEMA` |
| `platform.manage` (global) | `ADMINISTRAR_SISTEMA` |

Os papéis do FluxID (script `006`):
- `FLUXID_MASTER` e `ORG_ADMIN`: tudo;
- `SUPERVISOR`: tudo, menos pessoas;
- `OPERADOR`: cadastro de cilindros e lacres, estoque, teste, histórico e justificar alerta (sem encerrar, sem comandos, sem rotas);
- `AUDITOR`: leitura, histórico e auditoria;
- `VISUALIZADOR`: só leitura.

**Decisões assumidas na implementação (todas na recomendação da v0.1):**

| # | Decisão | Implementado |
| --- | --- | --- |
| D1 | Estoque | (b) coluna própria `cilindros.situacao_estoque` |
| D2 | Permissões | (a) permissões novas no FluxID e tradução para os códigos do frontend |
| D3 | Login | (a) a API faz o login; sem MFA por enquanto |
| D4 | Pessoa em várias organizações | (a) `usuario_organizacoes` e `usuario_organizacao_perfis` |
| D5 | Onde o alerta é tratado | (a) no frontend (FluxID); a Oxide não sobrescreve mais |
| D6 | Indicadores | movimentação = saídas e entregas por dia; desempenho = 3 medidas (seção 7.1) |
| D7 | Arquivos | (a) pasta do servidor |
| D8 | Comandos pelo frontend | (a) com login, `ENVIAR_COMANDOS`, justificativa e auditoria |
| D9 | Nomes no JSON | (a) inglês |

## 10. O que entrou no FluxID (script `006`)

1. Sessões, tentativas de login, recuperação de senha e convites; `usuarios.foto_caminho`.
2. Vínculo pessoa ↔ organização e papéis por organização, copiados dos atuais.
3. 9 permissões novas e a distribuição por papel.
4. Situação de estoque (`DISPONIVEL` começa em estoque) e chaves de operação.
5. Rotas de entrega (margem padrão de 50 m) e desvios.
6. Justificativa do alerta e `tratado_no_fluxid`.
7. Gatilho que grava `CILINDRO_CRIADO` no histórico de todo cilindro novo, com a pessoa que criou.

Detalhes: [Banco_FluxID.md](Banco_FluxID.md).

## 11. Como testar

- `npm run test:app`: 45 verificações da API do frontend contra o FluxID de análise no Docker. Roda numa pasta temporária, com uma organização própria.
- `npm run simular`: o lacre do começo ao fim, com o operador pela API do frontend e as regras automáticas.
- Roteiro manual: [RoteiroDeTeste.md](Doc_tese/RoteiroDeTeste.md), seção 5.11.

## 12. Histórico do documento

| Versão | Data | Mudança |
| --- | --- | --- |
| 0.1 | 07/10/2026 | Proposta inicial, a partir dos contratos do frontend (etapas 002, 004, 005 e 006) e do FluxID com os scripts `001` a `005` |
| 1.0 | 07/10/2026 | Implementado: decisões D1–D9 na recomendação, script `006`, 23 funções (as 21 da proposta, mais `query-deliveries` e `manage-deliveries`), alertas automáticos, formato exato das respostas e dos códigos |
