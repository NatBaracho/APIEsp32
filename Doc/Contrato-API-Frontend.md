# Contrato da API para o frontend (FluxID)

> **Proposta não seguida (10/10/2026).** Ficou decidido que a API do lacre **não atende o frontend**: o frontend fala direto com o Supabase, que é o banco principal. Este documento fica só como registro. O que vale hoje: [Contrato-Entrega-Supabase.md](Contrato-Entrega-Supabase.md).

**Versão:** 0.1 — 07/10/2026 — **proposta aprovada por Natã da Silva Baracho (backend) em 07/10/2026**, aguardando a aprovação de aalissonalmeidaq (frontend)
**Público:** quem programa o frontend (repositório `fluxid_integra2026`) e quem programa a API do backend (este repositório).
**Base:**
- frontend na versão `5bb62ab` (etapas 001 a 006);
- banco FluxID com os scripts `sql/fluxid/001` a `005`;
- API Oxide com o Worker ([Integracao-Oxide-FluxID.md](Integracao-Oxide-FluxID.md)).

Com a API rodando, a proposta também pode ser vista no navegador, no formato do Swagger: **`http://<servidor>:3000/api-docs-fluxid`** (página separada da API atual, marcada como proposta).

Este documento diz **quais chamadas a API vai oferecer ao frontend**, o que cada uma recebe e devolve, e **de qual tabela do FluxID** sai cada dado. Nada aqui está implementado ainda. Primeiro vocês dois aprovam o contrato e as decisões da seção 9; depois a API é feita em entregas pequenas, com teste.

---

## 1. Resumo

- O **FluxID** (`FluxID_db`) é o banco definitivo. O banco do Supabase usado pelo frontend até agora é só de teste.
- A **mesma API** deste projeto atende o **lacre** (`/api/v1/iot/...`, como hoje) e o **frontend** (`/api/v1/app/...`, novo).
- Para o frontend mudar o mínimo possível, a API **imita o jeito como o frontend já chama o servidor**:
  - mesmos nomes de função (`query-cylinders`, `manage-cylinders`...);
  - mesmo corpo (`operation`, `organization_id`...);
  - mesmos códigos de resposta (`LISTED`, `NOT_FOUND`...).

  Na prática, o frontend troca o **endereço base** e a **forma de login** (seção 4).
- Os nomes dos campos no JSON continuam **em inglês**, como o frontend já usa. A API converte para as colunas do FluxID, que estão em português (seção 6.3).

## 2. Como fica o sistema

```text
Frontend (React, PWA) ──POST /api/v1/app/<função>──┐
                                                    ▼
                                         API do backend (Node.js + TypeScript)
                                            │                       ▲
                                            ▼                       │
ESP32 (lacre) ──POST /api/v1/iot/...──► oxide.db ──► Worker ──► FluxID (PostgreSQL)
```

- Tudo o que é **cadastro e consulta** do frontend lê e grava **direto no FluxID**.
- Tudo o que vem do **lacre** entra pela Oxide e chega ao FluxID pelo Worker, como já funciona.

## 3. Como chamar a API

O frontend já tem um ponto único de saída (`createFunctionTransport`): toda chamada é `POST <base>/<nome-da-função>`. A API aceita exatamente isso.

| Item | Valor |
| --- | --- |
| Endereço base | `http://<servidor>:3000/api/v1/app` |
| Método | Sempre `POST` (outro método → `405 METHOD_NOT_ALLOWED`) |
| Cabeçalhos | `content-type: application/json` e `authorization: Bearer <token da sessão>` (seção 4). O `apikey` do Supabase deixa de existir |
| Corpo | JSON com `operation` (quando a função tem mais de uma) e `organization_id` (organização ativa; é só contexto, nunca prova acesso) |
| Resposta | JSON `{ "code": "...", ... }` |

**Exemplo:**

```http
POST http://localhost:3000/api/v1/app/query-cylinders
authorization: Bearer eyJhbGciOi...
content-type: application/json

{ "operation": "list", "organization_id": "b01e1a06-...", "status": "active", "limit": 25 }
```

```json
{ "code": "LISTED", "items": [ { "id": "...", "serial_number": "SN-000001", "status": "active", "stock_status": "out_of_stock", "hydro_status": "valid", "active_identifier_count": 1, "version": 1 } ], "total": 50, "next": "..." }
```

**Códigos comuns** (os mesmos do frontend):

| Código | HTTP | Quando |
| --- | --- | --- |
| `AUTH_REQUIRED` | 401 | Sem token, token inválido ou sessão vencida |
| `ACCESS_DENIED` | 403 | Autenticado, mas sem a permissão da operação |
| `NOT_FOUND` | 404 | Não existe **ou é de outra organização** (mesma resposta, para não revelar dados de outra empresa) |
| `VALIDATION_FAILED` | 400 | Corpo inválido; traz `fields: [{ field, message }]` |
| `METHOD_NOT_ALLOWED` | 405 | Método diferente de `POST` |
| `INTERNAL_ERROR` | 500 | Falha inesperada, sem detalhe |

**Regras que valem para todas as funções:**
- Quem faz a ação e em qual organização é decidido **no servidor**, pelo token.
- Uma organização só vê os próprios dados (RN22).
- Nada é apagado (RN21).
- Senha, token e chave nunca aparecem em resposta nem em log.

## 4. Login e sessão

**Hoje, no frontend:** o login é do Supabase Auth, nas funções `session-login`, `session-status` e `session-logout`, mais a recuperação de senha e o MFA. O token vem de `supabase.auth.getSession()`.

**Proposta:** a API passa a fazer o login, com os **mesmos nomes de função e os mesmos códigos** que o frontend já trata.

| Função | Entrada | Respostas |
| --- | --- | --- |
| `session-login` | `email`, `password`, `revoke_session_id?` | `AUTHENTICATED` 200 (com `access_token`, `expires_at` e a lista de organizações da pessoa); `INVALID_CREDENTIALS` 401; `ACCOUNT_UNAVAILABLE` 403; `SESSION_LIMIT_REACHED` 409 (com as sessões ativas); `RATE_LIMITED` 429 |
| `session-status` | token | `SESSION_ACTIVE` 200 (`expires_at`); `SESSION_EXPIRED`, `SESSION_REVOKED` e `SESSION_INVALID` 401 |
| `session-logout` | token | `SIGNED_OUT` 200, mesmo se a sessão já tiver acabado |
| `password-recovery` | `email` / depois `token` + `new_password` | Sempre `RECOVERY_REQUEST_ACCEPTED` para e-mail bem formado; o link vale 1 hora e é de uso único |

Regras propostas (as mesmas do frontend):
- token de 1 hora;
- sessão de no máximo 8 horas;
- 30 minutos de inatividade encerram a sessão;
- até 3 sessões ativas por pessoa;
- bloqueio por 15 minutos após 5 falhas de login.

**O que muda no frontend:** o lugar de onde sai o token (`supabase.auth.getSession()` → o token devolvido por `session-login`) e o endereço base. As telas e os códigos continuam iguais.

**O que falta no FluxID** (script `006`, depois da aprovação):
- tabela de sessões;
- tabela de tentativas de login;
- tabela de pedidos de recuperação de senha;
- tabela de convites;
- senha guardada como hash forte (hoje `usuarios.senha_hash` tem `HASH_PROVISORIO` na massa).

O **MFA** (segundo fator) fica para uma fase seguinte (decisão D3).

## 5. Organização, pessoas, papéis e auditoria

| Função | Operações | Tabelas do FluxID | Situação no FluxID |
| --- | --- | --- | --- |
| `query-permissions` | — (devolve `{ code: "PERMISSIONS_LISTED", tenant: [...], global: [...] }`) | `usuario_perfis`, `perfil_permissoes`, `permissoes` | Existe, mas com códigos diferentes (decisão D2) |
| `manage-organizations` | `list`, `create`, `change_status`, `invite_first_admin` | `organizacoes` | Existe; falta convite |
| `manage-membership` | `list`, alterar vínculo (bloquear, inativar, reativar) | `usuarios`, `usuario_perfis` | **No FluxID cada pessoa pertence a uma só organização** (decisão D4) |
| `manage-access` | `list`, `save_role`, `set_role_active`, `assign_role`, `remove_role` | `perfis`, `perfil_permissoes`, `usuario_perfis` | Existe; falta papel personalizado por organização |
| `invite-user` | convidar, `resend`, `accept` | — | **Falta** a tabela de convites |
| `query-audit` | listar por período, ação, resultado e quem fez | `auditoria` | Existe |
| `profile-avatar` | foto da pessoa | — | **Falta** onde guardar o arquivo (decisão D7) |

## 6. Cilindros (telas que o frontend já tem)

Mesmo contrato da etapa 006 do frontend (`specs/006-cilindros-e-estoque/contracts/operacoes-servidor.md`), agora sobre o FluxID.

### 6.1 `query-cylinders` (só leitura)

| `operation` | Entrada | Saída | De onde vem no FluxID |
| --- | --- | --- | --- |
| `list` | `search?`, `status?`, `stock_status?`, `hydro_status?`, `cylinder_type_id?`, `sort?`, `cursor?`, `limit?` (1–100) | `{ code: "LISTED", items[], total, next }` | `cilindros` + `tipos_cilindro` + `identificadores_cilindro` + último `testes_hidrostaticos` |
| `get` | `cylinder_id` | `{ code: "FOUND", cylinder, identifiers[], tests[], hydro_status }` | Os mesmos, mais o **lacre atual** (`vinculos_cilindro_lacre`) — campo novo `seal` (seção 7) |
| `lookup` | `identifier_value` | `{ code: "FOUND", cylinder, identifier }` ou `NOT_FOUND` (com `deactivated` quando for o caso) | `identificadores_cilindro` |
| `history` | `cylinder_id`, `event_type?`, `from?`, `to?`, `order?`, `cursor?`, `limit?` | `{ code: "LISTED", events[], next }` | `historico_cilindro` (já recebe vínculos de lacre e alertas da Oxide) |
| `catalog` | — | `{ code: "LISTED", types[] }` | `tipos_cilindro` |

### 6.2 `manage-cylinders` (comandos, auditados)

| `operation` | Entrada principal | O que grava no FluxID |
| --- | --- | --- |
| `create` | dados do cilindro + `identifier { kind, value }` | `cilindros`, `identificadores_cilindro`, `historico_cilindro` (`CILINDRO_CRIADO`, `IDENTIFICADOR_ADICIONADO`), `auditoria` |
| `update` | `cylinder_id`, `expected_version`, campos | `cilindros` (sobe `versao`), histórico `CILINDRO_ATUALIZADO` |
| `save_type` | `gas`, `capacity_value`, `capacity_unit`, `classification`, `type_id?`, `active?` | `tipos_cilindro` |
| `inactivate` / `reactivate` | `cylinder_id`, `reason`, `justification` | `cilindros.status = INATIVO` e `motivo_inativacao`; histórico |
| `add_identifier` / `deactivate_identifier` / `transfer_identifier` | conforme o frontend | `identificadores_cilindro`; histórico |
| `stock_in` | `identifier_value`, `operation_key` (UUID) | **Depende da decisão D1** (estoque); histórico `ENTRADA_ESTOQUE` |
| `register_test` / `rectify_test` | conforme o frontend | `testes_hidrostaticos` (`numero_laudo`, `retifica_teste_id`); histórico |

Códigos próprios de cilindro, iguais aos do frontend:
- `SERIAL_CONFLICT`, `IDENTIFIER_CONFLICT`, `IDENTIFIER_UNAVAILABLE`, `VERSION_CONFLICT`, `CYLINDER_INACTIVE`, `ALREADY_IN_STOCK`, `ALREADY_INACTIVE`, `JUSTIFICATION_REQUIRED`;
- `IDEMPOTENCY_PAYLOAD_CONFLICT`, que precisa de uma tabela de chaves de operação no FluxID (script `006`).

### 6.3 Nomes e valores: frontend × FluxID

| Frontend (JSON) | FluxID (coluna) | Valores |
| --- | --- | --- |
| `serial_number` | `cilindros.numero_serie` | — |
| `status` | `cilindros.status` | `active` = qualquer status diferente de `INATIVO`; `inactive` = `INATIVO` |
| `inactivation_reason` | `motivo_inativacao` | `written_off`↔`BAIXADO`, `lost`↔`EXTRAVIADO`, `condemned`↔`CONDENADO`, `other`↔`OUTRO` |
| `stock_status` | — | **Decisão D1** |
| `manufacturer`, `working_pressure_bar`, `version` | `fabricante`, `pressao_trabalho_bar`, `versao` | — |
| `cylinder_type_id` | `tipo_cilindro_id` | — |
| `capacity_unit` | `capacidade_unidade` | `l`↔`L`, `m3`↔`M3`, `kg`↔`KG` |
| `classification` | `classificacao` | `medicinal`↔`MEDICINAL`, `industrial`↔`INDUSTRIAL` |
| `identifier.kind` | `identificadores_cilindro.tipo` | `qr_code`↔`QR_CODE`, `data_matrix`↔`DATA_MATRIX`, `nfc_tag`↔`NFC`, `hull_number`↔`NUMERO_CASCO` |
| `test.result` | `testes_hidrostaticos.resultado` | `approved`↔`APROVADO`, `rejected`↔`REPROVADO` |
| `test.performed_on`, `next_due_on`, `report_number`, `executor` | `data_teste`, `proximo_teste`, `numero_laudo`, `realizado_por` | — |
| `event_type` (histórico) | `historico_cilindro.tipo_evento` | `cylinder_created`↔`CILINDRO_CRIADO`, `stock_in`↔`ENTRADA_ESTOQUE`… e os novos `seal_bound`↔`LACRE_VINCULADO`, `seal_unbound`↔`LACRE_DESVINCULADO`, `alert_opened`↔`ALERTA_REGISTRADO`, `alert_closed`↔`ALERTA_ENCERRADO` |

## 7. Lacre, mapa e alertas (telas novas, ligadas à Oxide)

Estas funções levam ao frontend o que vem do lacre. Os dados chegam ao FluxID pelo Worker; a API só lê o FluxID, e em alguns casos grava nele.

### 7.1 `query-overview` — Visão geral com dados reais

Substitui a fonte de exemplo (`sampleOverviewSource`). Entrada: `organization_id`, `block`.

| `block` | Saída | De onde vem |
| --- | --- | --- |
| `indicators` | Cilindros totais, em trânsito, com cliente, alertas abertos | `cilindros.status`, `alertas.status` |
| `map` | Pontos: lacre, cilindro, última posição, situação | Seção 7.2 |
| `movement` | Série por dia: telemetrias ou entregas no período | `telemetrias.data_coleta` ou `entregas` (decisão D6) |
| `situation` | Cilindros por status (rosca) | `cilindros.status` |
| `recent_alerts` | 5 alertas mais recentes | `alertas` |
| `recent_cylinders` | 5 cilindros mais recentes | `cilindros.criado_em` |
| `performance` | 3 medidas operacionais | Decisão D6 |

Resposta: `{ code: "READY", data }` ou `{ code: "EMPTY" }`, para o frontend mostrar os estados `ready` e `empty` que já existem.

### 7.2 `query-map` — onde estão os lacres e os cilindros

Entrada: `organization_id`, `bbox?` (área visível do mapa), `alert_only?`.

```json
{
  "code": "LISTED",
  "points": [
    {
      "cylinder": { "id": "...", "code": "CIL-000001", "serial_number": "SN-000001" },
      "seal": { "code": "LCR-000001", "status": "SUSPEITA_VIOLACAO" },
      "device": { "code": "DSP-000001" },
      "position": { "latitude": -7.2091939, "longitude": -39.3063666, "at": "2026-10-07T04:03:57Z" },
      "gps": "ok",
      "alert": { "code": "ALT-000001", "type": "LACRE_VIOLADO", "severity": "CRITICA" }
    }
  ]
}
```

- A posição é a **última telemetria válida** do cilindro (`telemetrias`, índice `cilindro_id, data_coleta`).
- `gps: "no_signal"` quando a telemetria mais recente foi para a quarentena; o ponto continua na **última posição conhecida** (decisão P2).
- A **cor** do ponto vem do alerta aberto de maior severidade do cilindro (decisão de 06/10/2026: alertas como pontos e cores, na posição atual do lacre).

### 7.3 `query-alerts` e `manage-alerts`

| Função / `operation` | Entrada | Saída / efeito | FluxID |
| --- | --- | --- | --- |
| `query-alerts` `list` | `status?`, `severity?`, `type?`, `cylinder_id?`, `from?`, `to?`, `cursor?`, `limit?` | `{ code: "LISTED", items[], next }` | `alertas` + lacre e cilindro |
| `query-alerts` `get` | `alert_id` | `{ code: "FOUND", alert, cylinder, seal, position }` | `alertas`, última posição |
| `manage-alerts` `analyze` | `alert_id` | `ABERTO` → `EM_ANALISE` | `alertas.status`; `auditoria` |
| `manage-alerts` `close` | `alert_id`, `resolution_note` | → `ENCERRADO`, com `encerrado_em`, `encerrado_por` (o usuário logado) e o motivo | `alertas`; histórico `ALERTA_ENCERRADO`; `auditoria` |
| `manage-alerts` `justify` (motorista, saída de rota) | `alert_id`, `justification` | Registra a justificativa; só o gestor encerra | **Fase de geofence e rota** |

Permissões do FluxID: `VISUALIZAR_ALERTAS` para ler e `ENCERRAR_ALERTAS` para analisar e encerrar. **Decisão D5:** onde o alerta passa a ser tratado (frontend × rota da Oxide).

### 7.4 `query-seals` e `manage-seals` — lacres, dispositivos e vínculos

| `operation` | Entrada | Efeito | FluxID |
| --- | --- | --- | --- |
| `query-seals` `list` / `get` | filtros / `seal_id` | Lacre, estado, dispositivo e cilindro atuais, próxima revisão | `lacres`, `vinculos_*`, `inspecoes_lacre` |
| `manage-seals` `create_seal` | `code`, `nfc_uid`, `manufactured_on`, `next_review_on` | Cadastra o lacre (`EM_ESTOQUE`) | `lacres` |
| `manage-seals` `create_device` | `code`, `hardware_id`, `firmware_version?` | Cadastra o dispositivo e **gera a chave**: a resposta traz a chave **uma única vez** (`api_key`) e o FluxID guarda só o hash | `dispositivos.api_key_hash` |
| `manage-seals` `rotate_device_key` | `device_id` | Nova chave (mostrada uma vez); a antiga deixa de valer quando o Worker sincronizar | `dispositivos.api_key_hash` |
| `manage-seals` `bind_device` / `bind_cylinder` | `seal_id` + `device_id` ou `cylinder_id`, `replace?` | Vínculo com histórico; um ativo por vez (RN04/RN05) | `vinculos_dispositivo_lacre`, `vinculos_cilindro_lacre`; histórico `LACRE_VINCULADO` |
| `manage-seals` `unbind` | `binding_id`, `reason` | Encerra o vínculo | idem; histórico `LACRE_DESVINCULADO` |
| `manage-seals` `confirm_violation` | `seal_id`, `justification` | Gestor confirma `SUSPEITA_VIOLACAO` → `ROMPIDO`, ou libera (decisão P8) | `lacres.status`; `auditoria` |
| `manage-seals` `inspect` | `seal_id`, resultado, observação | Conferência física (leitura do NFC na auditoria) | `inspecoes_lacre` |

**Ligação com a Oxide:** tudo o que é cadastrado aqui chega à Oxide pelo Worker, a cada 5 minutos: dispositivos com o hash da chave, lacres, cilindros e vínculos. Não é preciso cadastrar duas vezes.

### 7.5 `query-telemetry` — trajeto e eventos

| `operation` | Entrada | Saída | FluxID |
| --- | --- | --- | --- |
| `track` | `cylinder_id` ou `device_id`, `from`, `to` | Posições em ordem (trajeto no mapa) | `telemetrias` |
| `events` | `seal_id` ou `device_id`, período | Eventos do lacre e do dispositivo | `eventos_lacre`, `eventos_dispositivo` |
| `quarantine` | `device_id`, período | Leituras sem GPS | `telemetrias_quarentena` |

### 7.6 `manage-commands` — travar e destravar a válvula

| `operation` | Entrada | Efeito |
| --- | --- | --- |
| `send` | `device_id`, `command_type` (`TRAVAR_VALVULA`, `DESTRAVAR_VALVULA`), `justification` | Cria o comando `PENDENTE` na Oxide (`commands`); o ESP32 busca e confirma como já faz |
| `list` | `device_id` | Comandos e confirmações (`EXECUTADO`/`ERRO`) |

**Atenção:** hoje não existe nenhuma rota para criar comando, por segurança (entrega D). Esta função só poderia existir **com login e permissão** (decisão D8).

## 8. Permissões: frontend × FluxID

O frontend usa códigos detalhados (`resource.action`); o FluxID tem códigos mais amplos.

| Frontend | FluxID hoje | Proposta |
| --- | --- | --- |
| `cylinder.read` | — | Nova `VER_CILINDROS` |
| `cylinder.write` | `CRIAR_CILINDRO`, `EDITAR_CILINDRO` | Usar as duas |
| `cylinder.deactivate` | — | Nova `INATIVAR_CILINDRO` |
| `cylinder.identifier` | — | Nova `GERENCIAR_IDENTIFICADORES` |
| `cylinder.stock_in` | — | Nova `ENTRADA_ESTOQUE` |
| `cylinder.test` | — | Nova `REGISTRAR_TESTE_HIDROSTATICO` |
| `cylinder.history` | — | Nova `VER_HISTORICO_CILINDRO` |
| `tenant.manage`, `audit.read`, `platform.manage`... | `ADMINISTRAR_SISTEMA`, `CRIAR_USUARIO`, `EDITAR_USUARIO`, `GERAR_RELATORIOS` | Mapear um a um (decisão D2) |
| (novas) alertas, lacres, comandos | `VISUALIZAR_ALERTAS`, `ENCERRAR_ALERTAS`, `CRIAR_LACRE`, `EDITAR_LACRE` | Usar; criar `ENVIAR_COMANDOS` |

A API devolve ao frontend os **códigos do frontend** em `query-permissions`, calculados a partir das permissões do FluxID. Assim, o menu e as telas dele não mudam.

## 9. Decisões para vocês dois

| # | Decisão | Opções | Recomendação |
| --- | --- | --- | --- |
| D1 | **Estoque** (`in_stock`/`out_of_stock`) | (a) `cilindros.status = DISPONIVEL` é "em estoque"; (b) coluna própria de estoque no FluxID | (b): estoque e status respondem perguntas diferentes (onde está × em que condição está) |
| D2 | **Permissões** | (a) criar no FluxID as permissões que faltam (seção 8); (b) usar só as atuais, mais amplas | (a) |
| D3 | **Login** | (a) a API faz o login (seção 4), sem MFA no começo; (b) continuar com o Supabase Auth só para o login | (a): o FluxID é o banco definitivo; MFA numa fase seguinte |
| D4 | **Pessoa em mais de uma organização** | (a) tabela de vínculos pessoa ↔ organização no FluxID, como o frontend; (b) uma organização por pessoa, como o FluxID hoje | (a), se houver motoristas ou gestores atendendo mais de uma empresa |
| D5 | **Onde o alerta é tratado** | (a) pelo frontend, no FluxID; a rota da Oxide fica só para testes; (b) nos dois lugares | (a). Hoje o Worker sobrescreve o FluxID quando o alerta muda na Oxide; com (a), isso deixa de acontecer |
| D6 | **Indicadores da visão geral** | Definir "movimentação" e "desempenho" | Movimentação = entregas por dia; desempenho = % de cilindros com GPS em dia, alertas encerrados no prazo e testes hidrostáticos em dia |
| D7 | **Arquivos** (foto da pessoa) | (a) pasta do servidor; (b) armazenamento em nuvem | (a) no começo |
| D8 | **Comandos pelo frontend** | (a) liberar com login + `ENVIAR_COMANDOS` + justificativa; (b) não liberar | (a), com auditoria |
| D9 | **Nomes no JSON** | (a) inglês, como o frontend já usa; (b) português, como o FluxID | (a): menos mudança no frontend |

## 10. O que precisa entrar no FluxID (script `006`, depois das decisões)

1. Sessões, tentativas de login, recuperação de senha e convites (D3).
2. Vínculo pessoa ↔ organização e papéis por organização, se D4 = (a).
3. Permissões novas (D2) e `ENVIAR_COMANDOS` (D8).
4. Situação de estoque, se D1 = (b).
5. Chaves de operação para idempotência (`stock_in` e criação).
6. Senha com hash forte para os usuários de teste.

## 11. Ordem sugerida de implementação

| Etapa | Entrega | Depende de |
| --- | --- | --- |
| 1 | Base `/api/v1/app`, login e sessão, `query-permissions` | D3, D2, script `006` |
| 2 | Cilindros: `query-cylinders` e `manage-cylinders` (telas que já existem) | D1, D9 |
| 3 | Mapa, alertas e visão geral: `query-map`, `query-alerts`, `manage-alerts`, `query-overview` | D5, D6 |
| 4 | Lacres e dispositivos: `query-seals`, `manage-seals`, `query-telemetry` | — |
| 5 | Pessoas, papéis, organizações, convites e auditoria | D4, D7 |
| 6 | Comandos pelo frontend | D8 |

Cada etapa segue o fluxo combinado: perguntas, código, testes, questionário, documentação e PR.

## 12. Histórico do documento

| Versão | Data | Mudança |
| --- | --- | --- |
| 0.1 | 07/10/2026 | Proposta inicial, a partir dos contratos do frontend (etapas 002, 004, 005 e 006) e do FluxID com os scripts `001` a `005`. **Aguardando aprovação** |
