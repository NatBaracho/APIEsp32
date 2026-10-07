# API Oxide (ESP32) — Desenvolvimento

Este documento tem três partes:

- **Parte 1 — Como a API funciona:** guia para a equipe, principalmente para quem programa o ESP32 em C++. Explica o papel da Oxide, como o dispositivo se conecta, o que enviar, o que a API responde e onde cada dado fica no banco.
- **Parte 2 — Histórico de desenvolvimento e testes:** registro do que foi construído, dos erros corrigidos e dos testes executados (material da tese). A numeração original das seções foi mantida para que as referências dos relatórios continuem válidas.
- **Parte 3 — Histórico de PRs por funcionalidade:** o que cada pull request mudou, separado em API, Oxide, FluxID e Worker.

Documentos relacionados:

- [ESP32-envio-de-dados.md](ESP32-envio-de-dados.md): payloads de exemplo e código C++ para o firmware.
- [Regras-de-Negocio-e-Banco-Oxide.md](Regras-de-Negocio-e-Banco-Oxide.md): regras detalhadas e schema do SQLite.
- [Oxidedb.md](Oxidedb.md): script de criação do banco.
- [Integracao-Oxide-FluxID.md](Integracao-Oxide-FluxID.md): como cada dado da Oxide vira um registro do FluxID.
- [Tipos-de-Erro.md](Tipos-de-Erro.md): catálogo de tipos de erro e ocorrências operacionais (lacre, cilindro, GPS, rota, comunicação, comandos).
- [Doc_tese/PlanoDeTeste.md](Doc_tese/PlanoDeTeste.md) e [Doc_tese/RoteiroDeTeste.md](Doc_tese/RoteiroDeTeste.md): como a API é testada.
- Swagger, com a API rodando: `http://<IP_DA_API>:3000/api-docs`.

---

# Parte 1 — Como a API funciona

## 1.1 O papel da Oxide

A Oxide não é apenas uma API. Ela é a **camada de integração, segurança e controle operacional** entre o ESP32 e o FluxID: a ponte entre o mundo físico (dispositivos, lacres e válvulas) e o mundo de negócio (FluxID).

```text
ESP32 (no lacre do cilindro: GPS + modem GSM)
   ↓  HTTP + JSON
Oxide API (Node.js + TypeScript)
   ↓
Oxide DB (SQLite, oxide.db) — fila local
   ↓
Worker (futuro)
   ↓
FluxID (PostgreSQL) — banco principal
```

O que a Oxide faz hoje:

| Função | Como |
| --- | --- |
| Recebe dados do ESP32 | Telemetrias (latitude, longitude, velocidade, bateria, sinal GSM, estado do lacre) e eventos (lacre rompido, reinício, falha de hardware...) |
| Autentica dispositivos | Header `X-API-Key`, conferido contra a tabela `devices`; a chave precisa ser do próprio `device_id` enviado |
| Evita duplicidade | `message_id` é a chave de idempotência: mesma mensagem = mesma operação |
| Mantém fila local | Grava no `oxide.db` (tabelas `telemetry_queue`, `events`, `commands`, `alerts`) até o Worker sincronizar |
| Executa regras operacionais | Valida o payload, detecta duplicidade, controla posições repetidas e atualiza `last_seen_at` |
| Gerencia comandos | O ESP32 consulta comandos pendentes (ex.: travar ou destravar a válvula) e confirma `EXECUTADO` ou `ERRO` |
| Gerencia alertas | Tipos do catálogo [Tipos-de-Erro.md](Tipos-de-Erro.md) (ex.: `LACRE_VIOLADO`, `BATERIA_BAIXA`, `SEM_COMUNICACAO`); listagem, análise e encerramento pelo gestor |

### Quem faz o quê: API, Oxide, Worker e FluxID

| Parte | O que é |
| --- | --- |
| **API** | O programa Node.js + TypeScript (`src/`) que conversa com o ESP32 |
| **Oxide** | O banco local `oxide.db` (SQLite), usado pela API |
| **Worker** | Programa que vai levar os dados da Oxide para o FluxID (ainda não existe) |
| **FluxID** | O banco principal (PostgreSQL), base do sistema de negócio e do dashboard |

**API — faz hoje**
- Recebe por HTTP as telemetrias, os eventos, os alertas e as confirmações de comando do ESP32, e responde com os códigos da seção 1.5.
- Autentica cada dispositivo pela `X-API-Key`, que precisa ser do próprio `device_id`.
- Valida o que chega: tipos, faixa de latitude e longitude, `seal_status` e listas fechadas (severidade, comandos).
- Evita duplicidade pelo `message_id` e não grava de novo uma posição repetida, só atualiza a data e a hora.
- Preenche o lacre e o cilindro da telemetria pelo vínculo ativo e marca o `error_type` (`DISPOSITIVO_SEM_LACRE`, `LACRE_SEM_CILINDRO`, `LACRE_ABERTO_EM_TRANSITO`).
- Gera os alertas com os códigos em português do catálogo e a severidade sugerida nele. O código do alerta é o que vai para o FluxID (decisão P7). Na transição, os nomes antigos em inglês enviados pelo firmware são convertidos.
- Lista os alertas e deixa o gestor passar um alerta para `EM_ANALISE` e `ENCERRADO`, registrando quem encerrou e o motivo.
- Oferece as rotas provisórias de cadastro (`/devices`, `/seals`, `/cylinders`, `/assignments`) e o Swagger.

**API — fará**
- Alertas e comandos automáticos a partir do `error_type`: geofence, saída de rota (alerta ao motorista e ao gestor), lacre aberto → `TRAVAR_VALVULA`.
- Conferir a chave pelo hash vindo do FluxID, em vez da chave em texto.

**Oxide — faz hoje**
- É a **fila local**: `telemetry_queue` e `events` ficam com `status = PENDING` até o Worker sincronizar. Se o FluxID estiver fora do ar, nada se perde.
- Guarda os comandos (`commands`) e os alertas (`alerts`).
- Guarda a **cópia provisória** do cadastro: `devices`, `seals`, `cylinders` e os vínculos com histórico (`seal_assignments`, `cylinder_assignments`).
- Protege as regras no próprio banco: chave única, `active` só 0 ou 1, catálogo de comandos, tipo, severidade e status do alerta (alerta `ENCERRADO` sempre com data), um vínculo ativo por lacre, cilindro e dispositivo (RN04, RN05).
- As tabelas são criadas e migradas automaticamente quando a API inicia.

**Oxide — fará**
- Receber do Worker o cadastro oficial, os vínculos e o hash da chave do FluxID, no lugar da cópia provisória.

**Worker — fará** (nada implementado ainda; regras em [Integracao-Oxide-FluxID.md](Integracao-Oxide-FluxID.md))
- Ler as linhas `PENDING`, converter e gravar no FluxID numa transação, marcando `SYNCED` ou `ERROR`, sem duplicar (`message_id`).
- Tentar até 5 vezes (1 min, 5 min, 15 min, 1 h, 6 h); depois deixar o dado para o gestor (P6).
- Fazer o evento sem lacre esperar o vínculo (P3) e mandar a telemetria sem GPS para a quarentena (P2).
- Só marcar o lacre como `SUSPEITA_VIOLACAO`; quem confirma é o gestor (P8).
- Trazer do FluxID para a Oxide o cadastro, os vínculos e o hash da chave.

**FluxID — faz hoje**
- **Cadastro oficial:** organizações, usuários, perfis e permissões, destinatários e locais de entrega, cilindros, lacres, dispositivos e vínculos.
- **Isolamento entre empresas** (RN22): cada organização só vê os próprios dados.
- **Logística e conformidade:** movimentações, entregas, custódia, testes hidrostáticos, inspeções e auditoria.
- **Histórico definitivo** de telemetrias, eventos do lacre e alertas. A posição é obrigatória porque alimenta o mapa do dashboard, com os lacres e os cilindros pelo Brasil e os alertas como pontos e cores. A data é gravada na chegada, para auditoria e relatórios (P1).

**FluxID — fará**
- Aplicar no `FluxID_db` os scripts `sql/fluxid/001` e `002`, que já foram validados.
- Com o Worker, receber o script `003`:
  - datas automáticas;
  - tabela de quarentena;
  - tabela de eventos do dispositivo;
  - tipos de alerta do catálogo.

**Resumo:** a Oxide é uma plataforma intermediária de ingestão IoT. Ela autentica dispositivos, recebe telemetrias e eventos, controla comandos e alertas, armazena os dados temporariamente em SQLite e prepara a sincronização com o PostgreSQL do FluxID. Deixou de ser apenas uma API de telemetria e está se tornando o núcleo de controle operacional dos dispositivos.

## 1.2 Como o ESP32 se conecta

| Item | Valor |
| --- | --- |
| Endereço base | `http://<IP_DA_API>:3000/api/v1` |
| Formato | JSON, com o header `Content-Type: application/json` |
| Autenticação | Header `X-API-Key: <chave do dispositivo>` em todas as rotas `/iot/...` |
| Tamanho máximo do corpo | 100 KB (acima disso: `413`) |
| Teste rápido | `GET http://<IP_DA_API>:3000/` responde `API ESP32 Online` |

A chave deve ser a do **próprio** dispositivo informado em `device_id`. Com a chave de outro dispositivo, a API responde `403`.

## 1.3 Antes de enviar: cadastro do dispositivo

O cadastro **oficial** de dispositivo, lacre e cilindro fica no **FluxID**. Enquanto o Worker não traz esse cadastro para a Oxide, o dispositivo é cadastrado **uma vez** direto na Oxide (procedimento provisório):

```http
POST http://<IP_DA_API>:3000/api/v1/devices
Content-Type: application/json

{ "device_id": "DSP-000010", "api_key": "chave-do-lacre-10", "firmware_version": "1.0.0" }
```

- `201`: cadastrado. A mesma `api_key` vai no firmware.
- `409`: `device_id` ou `api_key` já existem.
- Um dispositivo **não cadastrado** recebe `404` em telemetria e eventos. A API **não** cria dispositivos automaticamente.
- `GET /devices` e `GET /devices/:deviceId` são abertos para a equipe consultar, mas **não mostram a `api_key`**. Guarde a chave no momento do cadastro.

### Cadastro do lacre, do cilindro e dos vínculos (provisório)

Para a API saber a que lacre e cilindro cada dispositivo pertence, cadastre também (rotas abertas, sem chave, até o Worker trazer os dados do FluxID):

```http
POST /api/v1/seals          { "seal_code": "LCR-000010", "nfc_uid": "04A2B3C4D5" }
POST /api/v1/cylinders      { "cylinder_code": "CIL-000010", "serial_number": "SN-123456" }
POST /api/v1/assignments/device-seal    { "device_id": "DSP-000010", "seal_code": "LCR-000010" }
POST /api/v1/assignments/seal-cylinder  { "seal_code": "LCR-000010", "cylinder_code": "CIL-000010" }
```

- Um lacre tem **um** cilindro ativo e um cilindro **um** lacre ativo (RN04); um lacre tem **um** dispositivo ativo (RN05). Conflito → `409`.
- **Troca:** envie `"replace": true`; o vínculo antigo é encerrado ("Substituído por novo vínculo") e o novo é criado na mesma operação.
- **Encerrar:** `POST /api/v1/assignments/seal-cylinder/{id}/end` (ou `device-seal/{id}/end`) com `{ "reason": "..." }`. Nada é apagado: o vínculo fica no histórico com data de fim e motivo.
- **Estado do lacre:** ao ser instalado num cilindro vira `INSTALADO` (só se estiver `EM_ESTOQUE` ou `REMOVIDO`); ao sair do cilindro vira `REMOVIDO` (um lacre violado ou rompido mantém o estado). `INSTALADO` não pode ser definido manualmente.
- **Histórico:** `GET /api/v1/assignments/seal-cylinder?cylinder_code=CIL-000010` (também `?device_id=`, `?seal_code=`, `?active=true`), do mais recente ao mais antigo.
- Estado do cilindro (ex.: `EM_TRANSITO`): `POST /api/v1/cylinders/{codigo}/status`.

## 1.4 Rotas usadas pelo ESP32

| Método e rota | Para quê | Respostas |
| --- | --- | --- |
| `POST /iot/telemetries` | Enviar posição, bateria, sinal e estado do lacre | `202` nova; `200` posição repetida; `400`; `401`; `403`; `404`; `409` |
| `POST /iot/events` | Enviar ocorrências (reinício, falha, mudança do lacre) | `202`; `400`; `401`; `403`; `404`; `409` |
| `GET /iot/commands/:deviceId` | Buscar comandos pendentes | `200` (lista); `401`; `403`; `404` |
| `POST /iot/commands/confirm` | Confirmar execução de um comando | `200`; `400`; `401`; `403`; `404`; `409` |
| `POST /iot/alerts` | Registrar um alerta | `201`; `400`; `401`; `403`; `404`; `409` |

Rotas de alertas para a equipe e o gestor (abertas e provisórias, até o controle por perfil do FluxID): `GET /iot/alerts?status=&device_id=` (lista, do mais recente ao mais antigo) e `PATCH /iot/alerts/{alert_id}/status` (analisar ou encerrar).

Rotas de apoio para a equipe: `GET /iot/telemetries` (lista as telemetrias de todos os dispositivos, da mais recente para a mais antiga; exige uma chave válida) e `GET/POST /devices`, `/seals`, `/cylinders` e `/assignments` (seção 1.3).

### Telemetria — exemplo

```json
{
  "message_id": "MSG-000001",
  "device_id": "DSP-000001",
  "latitude": -7.2091939,
  "longitude": -39.3063666,
  "speed_kmh": 21.98,
  "battery_percent": 57.33,
  "gsm_signal": -64,
  "seal_status": "LOCKED",
  "attempt_count": 1
}
```

- Obrigatórios: `message_id` e `device_id` (texto).
- Números (`latitude`, `longitude`, `speed_kmh`, `battery_percent`, `gsm_signal`) vão como número JSON, **não** como texto.
- `latitude` e `longitude` vão **juntas**, com latitude entre -90 e 90 e longitude entre -180 e 180. Sem posição do GPS, não envie nenhuma das duas.
- `seal_status`: `LOCKED` (fechado), `UNLOCKED` (aberto) ou `BROKEN` (rompido).
- `attempt_count`: quantas vezes o ESP32 já tentou enviar esta mensagem (inteiro ≥ 0).
- **Posição repetida:** se latitude, longitude e `seal_status` forem iguais aos da última telemetria do dispositivo, a API responde `200 "Posição já registrada; data e hora atualizadas"`, atualiza só a data e hora e não cria outra linha. Se o lacre mudar de estado no mesmo lugar (ex.: `LOCKED` → `BROKEN`), é gravada uma linha nova (`202`).

### Evento — exemplo

```json
{ "message_id": "EVT-000001", "device_id": "DSP-000001", "event_type": "seal_changed", "seal_status": "BROKEN", "attempt_count": 1 }
```

- Obrigatórios: `message_id`, `device_id` e `event_type`. O `event_type` é texto livre (ex.: `startup`, `seal_changed`, `hardware_failure`).

### Alerta — exemplo

```json
{ "alert_id": "ALT-000001", "device_id": "DSP-000001", "alert_type": "LACRE_VIOLADO", "severity": "CRITICA", "title": "Lacre rompido" }
```

- Obrigatórios: `alert_id`, `device_id`, `alert_type` e `title`.
- `alert_type`: um dos 28 códigos de [Tipos-de-Erro.md](Tipos-de-Erro.md) (ex.: `LACRE_VIOLADO`, `GPS_INATIVO`, `BATERIA_BAIXA`, `DISPOSITIVO_FALHA`). Outro valor → `400`.
- **Transição:** os nomes antigos continuam aceitos e são gravados em português: `SEAL_BROKEN` → `LACRE_VIOLADO`, `GEOFENCE_EXIT` → `SAIDA_GEOCERCA`, `LOW_BATTERY` → `BATERIA_BAIXA`, `DEVICE_ERROR` → `DISPOSITIVO_FALHA`, `COMMAND_FAILURE` → `COMANDO_FALHOU`, `COMMUNICATION_LOST` → `SEM_COMUNICACAO`. Atualize o firmware para os códigos em português quando puder.
- `severity` é opcional (`BAIXA`, `MEDIA`, `ALTA`, `CRITICA`). Sem ela, vale a severidade sugerida no catálogo (ex.: `LACRE_VIOLADO` → `CRITICA`; `SEM_COMUNICACAO` e `COMANDO_FALHOU` → `ALTA`; `DISPOSITIVO_FALHA` → `MEDIA`; `BATERIA_BAIXA` → `BAIXA`).
- O alerta nasce sempre `ABERTO`. Campos antigos `status_id` e `severity_id` são ignorados.

### Análise e encerramento de alertas (gestor)

```http
PATCH /api/v1/iot/alerts/ALT-000001/status   { "status": "EM_ANALISE" }
PATCH /api/v1/iot/alerts/ALT-000001/status   { "status": "ENCERRADO", "resolved_by": "Maria (gestora)", "resolution_note": "Lacre conferido no local" }
```

- Caminhos: `ABERTO` → `EM_ANALISE` → `ENCERRADO`, ou `ABERTO` → `ENCERRADO`. Encerrar exige `resolved_by` e `resolution_note` (`400` sem eles); a data é preenchida sozinha.
- `ENCERRADO` é final: tentar mudar de novo → `409` ("um problema novo gera um alerta novo"). Transição repetida → `409`; alerta inexistente → `404`.

## 1.5 O que o firmware faz com cada resposta

| Código | Significado | O que o ESP32 deve fazer |
| --- | --- | --- |
| `202` | Dado novo gravado | Sucesso. A próxima leitura usa um `message_id` novo |
| `200` | Posição já registrada (telemetria) ou consulta/confirmação ok | Sucesso. Não reenviar |
| `201` | Alerta criado | Sucesso |
| `409` | Mensagem já recebida (mesmo `message_id`) ou comando já confirmado | Tratar como **sucesso**. Não reenviar |
| `400` | Payload inválido (campo ausente, tipo errado, valor fora da lista) | **Não reenviar** o mesmo payload; registrar no log. É erro de firmware |
| `401` | `X-API-Key` ausente ou inválida | Conferir a chave configurada. Não insistir |
| `403` | Dispositivo desativado ou chave de outro dispositivo | Conferir `device_id` e chave. Não insistir |
| `404` | Dispositivo não cadastrado (ou comando inexistente) | Cadastrar o dispositivo (seção 1.3). Não insistir |
| `413` | Corpo maior que 100 KB | Reduzir o payload |
| `500`, sem resposta ou tempo esgotado | Falha do servidor ou da rede | **Reenviar** com o **mesmo** `message_id` e `attempt_count + 1`, aguardando um intervalo crescente entre as tentativas |

## 1.6 Regras do `message_id` e do reenvio

- Cada leitura nova recebe um `message_id` **único** para aquele dispositivo. Sugestão: prefixo + sequência guardada na memória não volátil (NVS), para não repetir depois de um reinício.
- O reenvio de **uma mesma leitura** usa o **mesmo** `message_id`. Assim, se a primeira tentativa chegou e só a resposta se perdeu, a API responde `409` e nada é duplicado.
- O `attempt_count` só informa quantas tentativas o ESP32 fez; ele não muda a regra de duplicidade.

## 1.7 Ciclo de comandos

```text
1. ESP32 → GET /iot/commands/DSP-000001        (com a própria X-API-Key)
2. API   → [ { "command_id": "CMD-1", "command_type": "TRAVAR_VALVULA", "status": "PENDENTE", ... } ]
3. ESP32 executa o comando na válvula
4. ESP32 → POST /iot/commands/confirm
           { "command_id": "CMD-1", "device_id": "DSP-000001", "status": "EXECUTADO" }
           ou { ..., "status": "ERRO", "error_message": "motor travado" }
5. API   → 200 "Comando confirmado"   (409 se já estava confirmado)
```

- A lista traz só comandos `PENDENTE`, do mais antigo para o mais novo.
- Tipos de comando aceitos: `TRAVAR_VALVULA` e `DESTRAVAR_VALVULA`. O firmware precisa reconhecer exatamente esses nomes.
- Os comandos são criados pelo sistema, não por rota aberta: hoje direto no banco e, no futuro, pelos comandos automáticos (ex.: lacre rompido → `TRAVAR_VALVULA`). Isso evita que qualquer pessoa destrave uma válvula pela API.
- Comandos ficam só na Oxide; a tabela no FluxID será decidida na fase do Worker.

## 1.8 Onde cada campo fica no banco

### Telemetria → tabela `telemetry_queue`

| Campo enviado | Coluna | Observação |
| --- | --- | --- |
| `message_id` | `message_id` | Único |
| `device_id` | `device_id` | Precisa existir em `devices` |
| `latitude`, `longitude`, `speed_kmh`, `battery_percent`, `gsm_signal` | Mesmo nome | Opcionais |
| `seal_status` | `seal_status` | `LOCKED`, `UNLOCKED`, `BROKEN` |
| `attempt_count` | `device_attempt_count` | Tentativas de envio do ESP32 |
| `last_seen_at` | `last_seen_at` | Opcional, ISO 8601. Na posição repetida, o servidor grava a hora atual (UTC, `AAAA-MM-DD HH:MM:SS`) |
| `lacre_id`, `cilindro_id` | Mesmo nome | **Não vêm do ESP32:** a API preenche pelo vínculo ativo do dispositivo no momento do recebimento (o que vier no payload é ignorado) |
| — | `error_type` | Código do catálogo `Tipos-de-Erro.md` detectado no recebimento, sem gerar alerta: `LACRE_ABERTO_EM_TRANSITO`, `DISPOSITIVO_SEM_LACRE` ou `LACRE_SEM_CILINDRO` |
| `payload_json` (ou o corpo inteiro) | `payload_json` | Guarda o JSON original recebido |
| `status` | — | **Ignorado** (fica só em `payload_json`). Não enviar |
| — | `status`, `attempt_count`, `last_error` | Controle do Worker: começa `PENDING` e `0` |
| — | `last_repeat_message_id` | `message_id` da última posição repetida |

### Evento → tabela `events`

| Campo enviado | Coluna |
| --- | --- |
| `message_id`, `device_id`, `seal_status`, `payload_json` | Mesmo nome |
| `event_type` | `message_type` |
| `attempt_count` | `device_attempt_count` |
| — | `error_type`: código do catálogo detectado no recebimento (ex.: `LACRE_ABERTO_EM_TRANSITO`) |
| — | `status` (`PENDING`), `attempt_count` (`0`), `last_error`: controle do Worker |

### Comandos e alertas

- `commands`: `command_id`, `device_id`, `command_type` (`TRAVAR_VALVULA`, `DESTRAVAR_VALVULA`), `status` (`PENDENTE` → `EXECUTADO`/`ERRO`), `created_at`, `executed_at`, `error_message`. O banco rejeita comando pendente com outro tipo.
- `alerts`: `alert_id`, `device_id`, `alert_type`, `severity` (`BAIXA`, `MEDIA`, `ALTA`, `CRITICA`), `status` (`ABERTO`, `EM_ANALISE`, `ENCERRADO`), `title`, `description`, `created_at`, `resolved_at`, `resolved_by`, `resolution_note`. Tipo, severidade e status usam os mesmos valores do FluxID e são protegidos por `CHECK`.

### Associação

- `seals`: `seal_code`, `nfc_uid`, `status` (estados de `lacres` do FluxID).
- `cylinders`: `cylinder_code`, `serial_number`, `status` (estados de `cilindros` do FluxID).
- `seal_assignments` (dispositivo ↔ lacre) e `cylinder_assignments` (lacre ↔ cilindro): `started_at`, `ended_at`, `end_reason`. Vínculo ativo = `ended_at` vazio.

### Estados da fila

`status` em `telemetry_queue` e `events` é o estado da **sincronização** com o FluxID (`PENDING` → `PROCESSING` → `SYNCED` ou `ERROR`), não o estado do dispositivo ou do lacre. Quando há posições repetidas, só a linha original (a mais antiga) segue para o FluxID.

## 1.9 O que ainda não existe

- Worker de sincronização com o FluxID.
- Cadastro e vínculos vindos do FluxID (por isso `/devices`, `/seals`, `/cylinders` e `/assignments` são provisórios).
- Criação automática de comandos e verificação dos tipos de erro do catálogo (`Tipos-de-Erro.md`), como saída de rota e GPS sem sinal.
- Justificativa do motorista na saída de rota (fica para a entrega de geofence e rota).
- Geofence, comandos automáticos e alertas automáticos a partir do `error_type`.

## 1.10 Estado atual

- API em funcionamento, validada pela suíte automatizada (`npm test`, 86/86) e pelo Roteiro de Teste completo no `oxide.db` real.
- Próximas entregas: geofence e rota; regras e alertas automáticos (incluindo comandos automáticos); Worker (decisões P1 a P8 já fechadas na seção 5 do plano de integração).
- Pendências conhecidas: firmware do ESP32 precisa enviar `seal_status` e `attempt_count` e tratar as respostas da seção 1.5; `nodemon` com vulnerabilidade apenas em desenvolvimento.

---

# Parte 2 — Histórico de desenvolvimento e testes

Registro em ordem cronológica. Descreve o estado da API **no momento de cada registro**; quando um comportamento mudou depois, há uma nota indicando a mudança. Para o comportamento atual, use a Parte 1.

## 2.1 Estrutura do código (referência para quem mantém a API)

| Pasta/arquivo | Conteúdo |
| --- | --- |
| `src/server.ts` | Inicializa o Express, registra rotas, Swagger e o tratamento de erros |
| `src/database/connection.ts` | Conexão `better-sqlite3`, criação de tabelas e migrações automáticas |
| `src/Middleware/` | `apiKeyMiddleware.ts` (chave válida, chave do próprio dispositivo) e `Errohandler.ts` |
| `src/routes/` | Rotas de dispositivos, telemetria, eventos, comandos, alertas e associação (`assetRoutes.ts`: lacres, cilindros e vínculos) |
| `src/controllers/` | Validação do payload e montagem das respostas HTTP |
| `src/services/` | Regras de negócio (duplicidade, posição repetida, cadastro) |
| `src/repositories/` | Consultas SQL de cada tabela (inclui `SealRepository`, `CylinderRepository` e `AssignmentRepository`) |
| `src/models/` | Tipos de dados |
| `src/docs/openapi.ts` | Especificação do Swagger |
| `tests/api.test.ts` | Suíte automatizada (`npm test`) |

## 4. Observações técnicas iniciais

- O projeto teve ajustes para corrigir imports, nomes de arquivos e inconsistências no schema do SQLite.
- O banco possuía nomes reais de colunas diferentes de algumas convenções iniciais do código, sendo necessário alinhar as queries ao schema real.
- A conexão com SQLite e a API foram validadas com requisições HTTP reais, retornando os status esperados para telemetria e eventos.

## 5. Histórico de erros e correções (fase inicial)

### 5.1 Middleware com caminho incorreto
- Problema: a rota de telemetria e a rota de eventos importavam `../middlewares/apiKeyMiddleware`, mas o diretório real do projeto era `src/Middleware/apiKeyMiddleware.ts`. Isso fazia o código apontar para um arquivo inexistente e quebrava a autenticação.
- Como foi consertado: o import foi ajustado para `../Middleware/apiKeyMiddleware` nos arquivos `src/routes/telemetryRoutes.ts` e `src/routes/eventRoute.ts`.
- Resultado: a autenticação por API key voltou a ser resolvida corretamente.

### 5.2 Falta de import do middleware na rota de eventos
- Problema: o arquivo `src/routes/eventRoute.ts` usava `apiKeyMiddleware` no `router.post(...)`, mas o `import` correspondente não estava presente. Isso gerava erro de referência e a rota não era registrada corretamente.
- Como foi consertado: foi adicionado o import do middleware.
- Resultado: a rota de eventos passou a validar a chave `X-API-Key` antes de processar o payload.

### 5.3 Inconsistência de nomes de colunas no SQLite
- Problema: o código utilizava nomes de colunas diferentes dos que existem no banco. Isso causava falhas em consultas por campos inexistentes e interrompia a persistência de dados.
- Como foi consertado: os repositórios e queries foram alinhados ao schema real do SQLite, incluindo nomes de colunas e valores padrão compatíveis com o banco.
- Resultado: gravações e consultas passaram a funcionar com o padrão real da base.

### 5.4 Erro de chave estrangeira ao receber evento com device inexistente
- Problema: ao criar eventos, a aplicação tentava gravar um registro referente a um `device_id` que ainda não existia no banco, gerando falha de integridade referencial.
- Como foi consertado: foi implementada a criação automática do dispositivo antes de salvar o evento (`ensureDeviceExists`).
- Resultado: a API passou a aceitar eventos mesmo quando o dispositivo ainda não havia sido cadastrado manualmente.
- **Nota (06/10/2026, entrega A):** a criação automática foi removida por segurança (gerava a chave previsível `auto-<device_id>`). Hoje um evento de dispositivo não cadastrado recebe `404`. Ver 7.14.

### 5.5 Problemática de tipagem em `req.params` no `DeviceController`
- Problema: o valor de `req.params.deviceId` poderia ser `undefined` e o código trabalhava com a variável como se fosse sempre string válida.
- Como foi consertado: a leitura do parâmetro foi normalizada em uma variável local e validada com checagem de tipo antes da busca no repositório.
- Resultado: a rota `GET /api/v1/devices/:deviceId` passou a responder corretamente.

### 5.6 Prefixo de API inconsistente
- Problema: as rotas do sistema estavam sendo montadas com prefixos divergentes.
- Como foi consertado: foi padronizado o uso de `API_PREFIX = "/api/v1"` em `src/server.ts`.
- Resultado: a API passou a seguir a convenção `/api/v1/...` de forma consistente.

## 6. Testes da fase inicial (antes da suíte automatizada)

### 6.1 Validação de compilação
- Comando executado: `npx tsc --noEmit`. Resultado: sucesso, sem erros de TypeScript.

### 6.2 Validação do servidor
- Comando executado: `npm start`. Resultado: servidor iniciado corretamente na porta 3000.

### 6.3 Casos de teste executados

| # | Caso | Resultado obtido na época |
| --- | --- | --- |
| 1 | `GET /` | `200 API ESP32 Online` |
| 2 | `GET /api/v1/devices/DSP-000001` | `200` com o dispositivo |
| 3 | `POST /iot/telemetries` válido | `202 Telemetria recebida` |
| 4 | `POST /iot/events` válido | `202 Evento recebido` |
| 5 | `POST /iot/events` com `message_id` duplicado | `409 Mensagem duplicada` |
| 6 | `POST /iot/telemetries` sem `device_id` | `400` |
| 7 | `POST /iot/events` sem `X-API-Key` | `401 API Key obrigatória` |
| 8 | `POST /iot/events` com `X-API-Key` inválida | `401 API Key inválida` |
| 9 | `GET /api-docs` | `200`, Swagger UI |
| 10 | `GET /api-docs/swagger-ui-init.js` | `200`, título `API ESP32`, rotas e `X-API-Key` |
| 11 | `POST /iot/events` sem `event_type` | `400` |
| 12 | `POST /iot/telemetries` sem `device_id` | `400` |
| 13 | `GET /devices` e `GET /devices/DSP-000001` | `200`, sem criar registros |
| 14 | `POST /devices` com `device_id` existente | `409 Dispositivo duplicado` |
| 15 | `POST /iot/events` com `message_id` existente | `409`, nenhuma linha nova |
| 16 | Duas telemetrias com o mesmo `message_id` | `202` e `409`, uma linha |
| 17 | Duplicatas em `devices`, `events`, `telemetry_queue` | Zero |
| 18 | Telemetria com `last_seen_at` | `202`, valor ISO 8601 gravado em `DATETIME` |
| 19 | Duas telemetrias com a mesma posição | Ambas `202`, uma linha. **Hoje:** a repetição responde `200` (ver 7.12) |
| 20 | Duas telemetrias sem coordenadas | Ambas `202`, duas linhas |
| 21 | `GET /iot/telemetries` com e sem chave | `200` decrescente; `401` sem chave |
| 22 | JSON malformado | `400 Requisição inválida` |
| 23 | Evento com `seal_status: LOCKED` | `202`, `status = PENDING` |
| 24 | Evento com `seal_status: closed` | `400`, nenhuma linha |
| 25 | Migração das colunas de status de `devices` | Colunas adicionadas sem recriar a tabela |
| 26 | Schema de `commands` | Default `PENDENTE`, `command_id` único, FK com `CASCADE`/`RESTRICT` |
| 27 | Comandos pendentes e confirmação | `200`, `409` na reconfirmação, `403` com outra chave, `400` status inválido |
| 28 | Schema de `alerts` | `alert_id` único, três FKs |
| 29 | `POST /iot/alerts` | `201`, `409`, `400`, `403` |
| 30 | Alerta `SEAL_BROKEN` | `201`, gravado (em cópia temporária do banco) |

Observação: um corpo JSON literal `null` é rejeitado pelo parser JSON do Express antes de chegar ao controller, com status `400`.

### 6.4 Processo de validação
- Validação assistida por IA: compilação TypeScript, chamadas HTTP e conferência do Swagger.
- Validação humana: revisão e conferência dos resultados por Natã da Silva Baracho. A partir de 06/10/2026, cada entrega tem relatório próprio em `Doc_tese/Relatorio-de-Teste-AAAA-MM-DD-HHhMM.md`, com questionário de validação.

## 7. Evolução da API (erros identificados e correções)

### 7.1 Erro de coluna no SQLite
- Problema: `SqliteError: table events has no column named message_type`. O banco tinha colunas com grafia incorreta (`messge_tyoe`, `seel_status`, `firmware_versin `).
- Correção: migração em `src/database/connection.ts` que renomeia automaticamente as colunas (`messge_tyoe` → `message_type`, `seel_status` → `seal_status`, `firmware_versin ` → `firmware_version`) e `INSERT` alinhado ao schema final.
- Resultado: eventos válidos voltaram a responder `202` em vez de `500`.

### 7.2 Resposta 404 inicial na documentação Swagger
- Problema: a primeira chamada a `GET /api-docs` retornou `404`, porque o processo da porta 3000 era anterior à inclusão do Swagger.
- Correção: reinício da API com `npm start`.
- Resultado: `GET /api-docs` e `GET /api-docs/swagger-ui-init.js` passaram a retornar `200`.

### 7.3 Duplicidade de dispositivo não era informada pelo controller
- Problema: o service detectava o `device_id` existente, mas o endpoint podia responder sucesso.
- Correção: o controller passou a responder `409 Dispositivo duplicado`.

### 7.4 Telemetria não usava o service nem persistia na fila
- Problema: o controller só registrava a mensagem no console; o schema da fila tinha nomes legados e campos opcionais obrigatórios.
- Correção: controller ligado ao service; a inicialização normaliza nomes e migra a tabela preservando linhas e IDs.
- Resultado: primeira chamada `202`, repetida `409`, uma linha por `message_id`.

### 7.5 Inclusão de `last_seen_at` na fila
- A inicialização adiciona `last_seen_at DATETIME` quando a coluna não existe; o Swagger documenta o formato ISO 8601. Omitido, o campo fica `NULL`.

### 7.6 Repetição da última posição
- Regra criada: coordenadas iguais às da última telemetria do dispositivo não geram nova linha; só atualizam `last_seen_at`.
- Resultado na época: a repetição respondia `202`. **Mudou em 06/10/2026:** passou a responder `200`, a considerar também o estado do lacre e a guardar o `message_id` para detectar reenvio (ver 7.11 e 7.12).

### 7.7 Middleware global de erros
- Problema: import com nome errado (`errorHandler` × `Errohandler.ts`) e erros do parser JSON convertidos em `500`.
- Correção: import alinhado; o middleware preserva status HTTP válidos.
- Resultado: JSON malformado retorna `400`.

### 7.8 Catálogo de status para dispositivos e eventos
- A tabela `status` guarda código, nome e descrição de `ACTIVE`, `INACTIVE`, `LOCKED`, `UNLOCKED` e `BROKEN`, separada de `events.status`, que representa a sincronização da fila. Criada e semeada de forma idempotente por `connection.ts`.

### 7.9 Tabela de comandos
- `connection.ts` cria `commands` com FK para `devices.device_id`; default `PENDENTE`, `command_id` único. Na época não havia rota nem repository; depois foram criadas as rotas de consulta e confirmação (`CommandRepository`).

### 7.10 Tabela de alertas
- `connection.ts` cria `alerts` com FK para dispositivo e duas FKs para `status`. Tipos previstos: `SEAL_BROKEN`, `GEOFENCE_EXIT`, `LOW_BATTERY`, `DEVICE_ERROR`, `COMMAND_FAILURE`, `COMMUNICATION_LOST`.
- Pendência: o catálogo `status` não tem severidades, embora `severity_id` aponte para ele.

### 7.11 Correções da revisão do plano de teste (06/10/2026)
A análise do código contra o Plano de Teste encontrou falhas reproduzidas em uma cópia do `oxide.db`:

| Problema | Correção | Resultado |
| --- | --- | --- |
| Reenvio do `message_id` de uma posição repetida respondia `202`, quebrando a idempotência (RN14). | Primeira versão com a tabela `telemetry_position_repeats`; substituída em 7.12 pela coluna `last_repeat_message_id`. | Reenvio retorna `409 Mensagem duplicada`. |
| O cliente definia `status` e `attempt_count` da telemetria (ex.: `SYNCED`), o que faria o Worker ignorar a linha. O mesmo valia para `attempt_count` de eventos. | Repositories gravam sempre `PENDING` e `0`; o campo `status` saiu do exemplo do Swagger. | Valores do cliente ignorados. |
| `POST /devices` aceitava `api_key` já usada por outro dispositivo. | `DeviceService` verifica a chave (`409 API Key já está em uso`) e a inicialização cria `idx_devices_api_key`. O middleware passou a buscar por `findByApiKey`. | Chave duplicada rejeitada. |
| `active` aceitava qualquer valor; o `oxide.db` real não tinha o `CHECK` do script. | Validação no controller (`400`) e triggers que reproduzem o `CHECK`. | `active` fora de `0`/`1` rejeitado na API e no banco. |
| Tipos inválidos (`latitude: true`, `payload_json` objeto) e `device_id` inexistente geravam `500`. | Validação de tipos no controller e verificação do dispositivo no service; violação `UNIQUE` convertida em `409`. | `400` para tipo inválido e `404` para dispositivo inexistente. |

Compilação aprovada e suíte com 46/46 (seis casos novos).

### 7.12 Ajustes definidos na validação (06/10/2026)
Na validação da 7.11, Natã da Silva Baracho recusou a tabela `telemetry_position_repeats` e explicou o papel do ESP32: ele fica no lacre do cilindro, informa se o lacre está fechado, aberto ou rompido e conta as próprias tentativas de envio. Ajustes aprovados:

| Decisão | Implementação |
| --- | --- |
| Guardar o `message_id` da posição repetida sem tabela nova | Coluna `telemetry_queue.last_repeat_message_id` com índice; guarda só a repetição mais recente de cada linha. |
| Avisar o ESP32 que a posição já existe | Resposta `200 Posição já registrada; data e hora atualizadas` (dado novo continua `202`). |
| Estado do lacre na telemetria | Campo `seal_status` (`LOCKED`, `UNLOCKED`, `BROKEN`), validado (`400`) e gravado em coluna própria. |
| Rompimento no mesmo lugar não pode se perder | Só é repetição quando posição **e** `seal_status` são iguais; mudança de estado gera nova linha. |
| Tentativas de envio do ESP32 | `attempt_count` do payload vai para `device_attempt_count` (telemetria e eventos), inteiro ≥ 0; `attempt_count` da fila continua sendo do Worker. |

Compilação aprovada, suíte com 50/50 (quatro casos novos) e Roteiro de Teste v1.2 executado de ponta a ponta. Validação registrada em [Relatorio-de-Teste-2026-10-06-15h14.md](Doc_tese/Relatorio-de-Teste-2026-10-06-15h14.md), **aprovada por Natã da Silva Baracho**.

### 7.13 Teste completo no banco real e remoção do `sqlite3` (06/10/2026)
- Como foi testado: Roteiro de Teste v1.2 executado por completo no `oxide.db` real, com backup antes e restauração depois. O checksum SHA-256 do banco foi igual antes e depois. O FluxID ficou fora desta rodada por decisão do responsável.
- Resultado: compilação sem erros, suíte 50/50, 77 respostas HTTP iguais ao esperado e todas as verificações de banco conforme. A migração das colunas novas funcionou no banco real.
- Achado fora do roteiro: o `npm audit` aponta 3 vulnerabilidades altas no `nodemon` (via `chokidar`/`braces`), ferramenta usada só no `npm run dev`. O conserto automático rebaixaria o `nodemon`, por isso não foi aplicado.
- Correção: a dependência `sqlite3`, que não era usada (a API usa `better-sqlite3`), foi removida. Uma rodada curta repetiu compilação, suíte (50/50) e `npm start` (`GET /` → `200`). Uma instalação do zero (`npm ci`) também foi testada e o `better-sqlite3` carregou normalmente.
- Validação registrada em [Relatorio-de-Teste-2026-10-06-15h49.md](Doc_tese/Relatorio-de-Teste-2026-10-06-15h49.md), **aprovada por Natã da Silva Baracho**.

### 7.14 Entrega A — segurança (06/10/2026)
Decisões de Natã da Silva Baracho, considerando que a API precisa ficar aberta para a equipe e para o montador do lacre testar sem impedimento:

| Achado | Decisão | Implementação |
| --- | --- | --- |
| SEG-01: `GET /devices` expunha `api_key` | Rotas continuam abertas, sem a chave nas respostas | `DeviceService` devolve o dispositivo sem `api_key`; Swagger atualizado |
| AUT-08/09: telemetria e eventos aceitavam chave de outro dispositivo | Exigir a chave do próprio `device_id` | `apiKeyDeviceMiddleware` nas rotas `POST /iot/telemetries` e `POST /iot/events` (`403`) |
| SEG-04: evento criava dispositivo com chave previsível | Remover a criação automática | `ensureDeviceExists` removido; dispositivo não cadastrado recebe `404` |
| SEG-02: `POST /devices` aberto | Manter aberto | Provisório até o Worker trazer o cadastro oficial do FluxID |
| SEG-03: listagem geral de telemetrias | Manter | Equipe acompanha os testes de todos os lacres |

Na mesma entrega, este documento foi reorganizado em duas partes para servir de guia a quem programa o ESP32. Compilação aprovada, suíte com 52/52 (dois casos novos) e Roteiro de Teste v1.4 executado por completo no `oxide.db` real, com checksum idêntico antes e depois. Validação registrada em [Relatorio-de-Teste-2026-10-06-17h35.md](Doc_tese/Relatorio-de-Teste-2026-10-06-17h35.md), **aprovada por Natã da Silva Baracho**.

### 7.15 Entrega C — severidade dos alertas e faixa de coordenadas (06/10/2026)
Decisões de Natã da Silva Baracho:

| Achado | Decisão | Implementação |
| --- | --- | --- |
| ALT-12: `severity_id` e `status_id` apontavam para a tabela `status`, que só tem estados de dispositivo/lacre | Severidade e status em texto, com os mesmos valores do FluxID | Colunas `severity` (`BAIXA`, `MEDIA`, `ALTA`, `CRITICA`) e `status` (`ABERTO`, `EM_ANALISE`, `ENCERRADO`) com `CHECK`; severidade padrão por tipo; status sempre `ABERTO` na criação |
| Firmware antigo envia `status_id`/`severity_id` | Não quebrar o ESP32 | Campos ignorados |
| Bancos com a tabela `alerts` antiga | Preservar os alertas | Migração automática e transacional em `connection.ts` |
| TEL-13: coordenadas fora da faixa aceitas | Rejeitar | `400` para latitude fora de -90 a 90, longitude fora de -180 a 180 ou só uma das duas; `0,0` continua aceito |

Compilação aprovada, suíte com 55/55 (três casos novos e um substituído), migração testada com alertas antigos gravados e Roteiro de Teste v1.5 executado por completo no `oxide.db` real, com checksum idêntico antes e depois. Validação registrada em [Relatorio-de-Teste-2026-10-06-19h28.md](Doc_tese/Relatorio-de-Teste-2026-10-06-19h28.md), **aprovada por Natã da Silva Baracho**.

### 7.16 Entrega E — banco FluxID e plano de integração (06/10/2026)
- Análise do dump `FluxID.sql` e do `Banco_FluxID.md`: estrutura coerente com as regras de negócio, documento desatualizado em contagens, valores aceitos e índices, e massa de testes com incoerências de negócio e nomes de empresas reais.
- Decisões de Natã da Silva Baracho: scripts versionados em `sql/fluxid/` (001 estrutura, 002 massa), chave do dispositivo guardada como hash no FluxID, nomes fictícios Alfa e Beta Gases, correção dos cilindros reprovados e dos lacres violados, ativos livres para a Beta e matriz de perfis e permissões.
- Validação: servidor PostgreSQL 18.6 temporário, separado do banco principal (o Docker ficou para depois, por exigir habilitar a virtualização na BIOS). Dump restaurado sem erros; scripts executados duas vezes (a segunda sem alterações); coerência e regras novas conferidas; servidor apagado ao final.
- Documentos: `Banco_FluxID.md` v3.1 e novo `Integracao-Oxide-FluxID.md`, com as tabelas de conversão e as decisões pendentes P1 a P8 para o Worker.
- Validação registrada em [Relatorio-de-Teste-2026-10-06-20h00.md](Doc_tese/Relatorio-de-Teste-2026-10-06-20h00.md), **aprovada por Natã da Silva Baracho**.
- Ocorrência no envio: logo após o merge do PR #4, um revert (PR #5) foi mesclado sem intenção e desfez a entrega na `main`. O conteúdo foi reaplicado sem nenhuma alteração por um novo pull request, conferido como idêntico ao aprovado.

### 7.17 Entrega D — catálogo de comandos e tipos de erro (06/10/2026)
Decisões de Natã da Silva Baracho:

| Tema | Decisão | Implementação |
| --- | --- | --- |
| Tipos de comando | Só `TRAVAR_VALVULA` e `DESTRAVAR_VALVULA` | `models/Command.ts` e `CHECK` na tabela `commands` |
| Regra no banco | Comando `PENDENTE` só com tipo do catálogo; histórico pode guardar tipos antigos; status só `PENDENTE`, `EXECUTADO`, `ERRO` | `CHECK` com migração automática e transacional |
| Comandos antigos | `LOCK_VALVE` → `TRAVAR_VALVULA`; `UNLOCK_VALVE` → `DESTRAVAR_VALVULA`; pendente desconhecido → `ERRO` "tipo de comando descontinuado" | Migração em `connection.ts` |
| Criação de comandos | Sem rota aberta (risco de destravar válvula) | Criação pelo banco até os comandos automáticos |
| Onde ficam | Só na Oxide | Tabela no FluxID decidida na fase do Worker |
| Tipos de erro | Catálogo único de ocorrências operacionais, em português | Novo `Doc/Tipos-de-Erro.md` v1.0 com 27 códigos, regras de posição e trânsito e fluxo da saída de rota |

Regras de operação definidas no catálogo: o lacre não sai de 10 m do destino final; o cilindro não sai da rota sem desvio justificado antes ou programado (alerta ao motorista e ao gestor, justificativa do motorista, liberação só pelo gestor); em trânsito o lacre fica sempre fechado. Decidido também que o `alert_type` da Oxide passará a usar os códigos em português.

Compilação aprovada, suíte com 57/57 (dois casos novos), migração testada com comandos antigos e Roteiro de Teste v1.6 executado por completo no `oxide.db` real, com checksum idêntico antes e depois. Validação registrada em [Relatorio-de-Teste-2026-10-06-20h35.md](Doc_tese/Relatorio-de-Teste-2026-10-06-20h35.md), **aprovada por Natã da Silva Baracho**.

### 7.18 Entrega B — associação dispositivo → lacre → cilindro (06/10/2026)
Decisões de Natã da Silva Baracho:

| Tema | Decisão | Implementação |
| --- | --- | --- |
| Onde a associação vive | Cópia provisória na Oxide, nos mesmos códigos e estados do FluxID | Tabelas `seals`, `cylinders`, `seal_assignments`, `cylinder_assignments` |
| Regras | RN04, RN05; conflito `409`; nada apagado (RN21) | Índices únicos parciais `ended_at IS NULL`; encerrar = preencher `ended_at` e `end_reason` |
| Troca | `replace: true` encerra e cria na mesma operação | Transação em `AssignmentService` |
| Estado do lacre | Segue o vínculo: `INSTALADO` ao instalar (só de `EM_ESTOQUE`/`REMOVIDO`), `REMOVIDO` ao sair | `AssignmentService` e `SealService` |
| Rotas | Abertas e provisórias, como `/devices` | `/seals`, `/cylinders`, `/assignments`, no Swagger (grupo "Associação") |
| Telemetria | `lacre_id`/`cilindro_id` sempre do vínculo ativo | `TelemetryService` |
| Erros do catálogo | Só registrar, sem alerta | Coluna `error_type` em `telemetry_queue` e `events`; novo código `DISPOSITIVO_SEM_LACRE` |

Compilação aprovada, suíte com 71/71 (14 casos novos) executada duas vezes seguidas e Roteiro de Teste v1.7 executado por completo no `oxide.db` real: as 67 respostas anteriores idênticas à rodada da entrega D e as 17 da nova seção 5.9 conforme, com checksum idêntico antes e depois. Validação registrada em [Relatorio-de-Teste-2026-10-06-21h31.md](Doc_tese/Relatorio-de-Teste-2026-10-06-21h31.md), **aprovada por Natã da Silva Baracho**.

### 7.19 Decisões P1 a P8 da integração com o FluxID (06/10/2026)
Natã da Silva Baracho fechou as decisões pendentes do plano de integração (seção 5 de [Integracao-Oxide-FluxID.md](Integracao-Oxide-FluxID.md), v1.1):

- **P1:** a Oxide não envia data; o FluxID grava sempre a hora de chegada.
- **P2:** telemetria sem GPS vai para uma quarentena separada no FluxID, só armazenada. A tabela principal continua exigindo posição, porque alimenta o mapa do dashboard.
- **P3:** evento sem lacre vinculado espera o vínculo.
- **P4:** eventos sem estado de lacre vão para uma tabela de eventos do dispositivo.
- **P5:** o FluxID aceita todos os códigos do catálogo de erros como tipo de alerta.
- **P6:** o Worker faz 5 tentativas com espera crescente e depois deixa o dado para o gestor.
- **P7:** a API Oxide gera o alerta e o código.
- **P8:** o Worker só marca suspeita de violação, e o gestor confirma.
- O alerta aparece no mapa na posição atual do lacre.

Nenhum código foi alterado: as decisões orientam a entrega do Worker. Registro conferido por questionário (6/6 sim), **aprovado por Natã da Silva Baracho** em 06/10/2026.

### 7.20 Alertas em português, análise e encerramento (06/10/2026)
Decisões de Natã da Silva Baracho:

| Tema | Decisão | Implementação |
| --- | --- | --- |
| Tipos aceitos | Os 28 códigos do catálogo `Tipos-de-Erro.md` (mesma lista do FluxID, P5) | `alertTypes` em `models/Alert.ts`; `CHECK` em `alerts.alert_type` |
| Transição | Nomes antigos em inglês aceitos e gravados em português, até nova decisão | `normalizeAlertType` |
| Severidade padrão | A sugerida no catálogo (`SEM_COMUNICACAO` passa de `MEDIA` para `ALTA`) | `defaultSeverityByType` |
| Alertas já gravados | Migração automática; tipo desconhecido vira `DISPOSITIVO_FALHA` com o original na descrição | `migrateAlertTypes` em `connection.ts` |
| Analisar e encerrar | `PATCH /iot/alerts/{alert_id}/status`; `ABERTO` → `EM_ANALISE` → `ENCERRADO` ou direto; `ENCERRADO` é final; encerrar exige `resolved_by` e `resolution_note` | `AlertService`; colunas novas; `CHECK` de `ENCERRADO` com data |
| Listagem | `GET /iot/alerts` com filtros `status` e `device_id` | `AlertRepository.list` |
| Acesso | Rotas abertas e provisórias, como `/devices` | `alertRoutes.ts` |

Compilação aprovada, suíte com 86/86 (15 casos novos) em quatro rodadas, migração testada em cópias do banco (formato anterior à entrega C e formato das entregas C a B), BD-14 com 86/86 num banco criado só pelo script do `Oxidedb.md` e Roteiro de Teste v1.8 completo no `oxide.db` real, com checksum idêntico antes e depois e as demais seções idênticas à rodada da entrega B. Validação registrada em [Relatorio-de-Teste-2026-10-06-23h40.md](Doc_tese/Relatorio-de-Teste-2026-10-06-23h40.md), **aprovada por Natã da Silva Baracho**.

## 9. Suíte de testes automatizados (`npm test`)

A suíte `tests/api.test.ts` cobre hoje 86 casos de ponta a ponta:

1. **Geral & Documentação:** `/`, `/api-docs/` e `/api-docs/swagger-ui-init.js`.
2. **Dispositivos:** listagem e busca sem `api_key`, `404`, validação `400`, criação `201`, `device_id` duplicado (`409`), `api_key` já usada (`409`) e `active` inválido (`400`).
3. **Autenticação:** `401` sem header, `401` com chave inválida, `403` para dispositivo inativo e `200` com chave válida.
4. **Telemetria:** campos obrigatórios (`400`), payload válido (`202`), `message_id` duplicado (`409`), posição repetida (`200`, sem nova linha), posição nova (nova linha), reenvio de posição repetida (`409`), `attempt_count` em `device_attempt_count`, tipo inválido (`400`), dispositivo inexistente (`404`), chave de outro dispositivo (`403`), `seal_status` inválido (`400`), mudança do lacre na mesma posição (nova linha), `attempt_count` negativo (`400`), latitude fora da faixa (`400`), só latitude (`400`) e JSON malformado (`400`).
5. **Eventos:** sem chave (`401`), campos obrigatórios (`400`), `seal_status` inválido (`400`), evento válido (`202`), `attempt_count` em `device_attempt_count`, dispositivo não cadastrado (`404`, sem criação), chave de outro dispositivo (`403`) e duplicidade (`409`).
6. **Comandos:** sem chave (`401`), chave de outro dispositivo (`403`), pendentes (`200`), status inválido (`400`), comando inexistente (`404`), confirmação (`200`), reconfirmação (`409`) e lista após confirmação, rejeição pelo banco de comando pendente fora do catálogo e de status desconhecido.
7. **Alertas:** sem chave (`401`), chave de outro dispositivo (`403`), tipo inválido e `toString` (`400`), severidade inválida (`400`), nome antigo convertido para português com severidade padrão (`201`), severidade informada com campos antigos ignorados (`201`), duplicidade (`409`), código do catálogo (`201`), `CHECK` de tipo, listagem e filtros, transições `EM_ANALISE`/`ENCERRADO` (`200`), transição repetida e reabertura (`409`), encerrar sem motivo (`400`), inexistente (`404`) e `CHECK` de encerramento.
8. **Associação:** cadastro de lacres e cilindros (inclusive duplicidades), vínculos, conflitos RN04/RN05, lacre danificado que não instala, troca com `replace`, encerramento, histórico, `INSTALADO` manual bloqueado, telemetria com lacre e cilindro do vínculo e os três `error_type`.
9. **Limpeza:** remoção dos registros `DSP-TEST%`, `LCR-TEST%` e `CIL-TEST%` ao final.

### Correção no cadastro de dispositivos (fase inicial)
- Problema: quando `active` era omitido, o valor chegava como `undefined`, virava `NULL` e violava o `NOT NULL` (erro `500`).
- Correção: valores padrão `device.active ?? 1` e `device.firmware_version ?? null`.

---

# Parte 3 — Histórico de PRs por funcionalidade

Todos os PRs abaixo foram mesclados na `main` em 06/10/2026, com validação **aprovada por Natã da Silva Baracho**. Esta parte e a seção "Quem faz o quê" (1.1) foram conferidas por questionário (6/6 sim) e **aprovadas por Natã da Silva Baracho** em 06/10/2026. O PR que mexeu em mais de uma parte aparece em cada grupo, só com o que mudou naquela parte. A cada novo PR, esta parte é atualizada.

## 3.1 API

| PR | Entrega | O que mudou na API |
| --- | --- | --- |
| #1 | Revisão do plano de teste | Posição repetida → `200` sem nova linha; reenvio dessa posição → `409`; novo `seal_status`; `attempt_count` do ESP32 gravado à parte; `api_key` exclusiva (`409`); `active` só 0 ou 1; tipos inválidos → `400`; dispositivo inexistente → `404` (antes `500`); dependência `sqlite3` removida |
| #2 | A — Segurança | `GET /devices` sem `api_key`; telemetria e eventos exigem a chave do próprio dispositivo (`403`); evento não cria mais dispositivo (`404`) |
| #3 | C — Severidade e coordenadas | Alerta com `severity` (`BAIXA` a `CRITICA`, padrão por tipo) e `status` sempre `ABERTO`; campos antigos ignorados; latitude e longitude fora da faixa ou incompletas → `400` |
| #7 | D — Catálogo de comandos | Comandos só `TRAVAR_VALVULA` e `DESTRAVAR_VALVULA`; leitura e confirmação pelo ESP32 sem mudança; sem rota aberta para criar comando |
| #8 | B — Associação | Rotas `/seals`, `/cylinders` e `/assignments` (abertas e provisórias); troca com `replace`; telemetria recebe lacre e cilindro do vínculo ativo; `error_type` registrado no recebimento |
| #12 | Alertas em português | `alert_type` com os 28 códigos do catálogo (nomes antigos convertidos); severidade padrão do catálogo; `GET /iot/alerts` com filtros; `PATCH /iot/alerts/{alert_id}/status` para analisar e encerrar, com quem e motivo |

## 3.2 Oxide (`oxide.db`)

| PR | Entrega | O que mudou no banco local |
| --- | --- | --- |
| #1 | Revisão do plano de teste | Colunas `last_repeat_message_id`, `seal_status` e `device_attempt_count`; índice único da `api_key`; triggers do `active` |
| #3 | C — Severidade e coordenadas | Tabela `alerts` com `severity` e `status` em texto e `CHECK`; migração automática dos alertas antigos |
| #7 | D — Catálogo de comandos | `CHECK` do catálogo e do status em `commands`; migração de `LOCK_VALVE`/`UNLOCK_VALVE` e de pendentes desconhecidos |
| #8 | B — Associação | Tabelas `seals`, `cylinders`, `seal_assignments` e `cylinder_assignments`, com índices de vínculo ativo único e `ON DELETE RESTRICT`; coluna `error_type` em telemetria e eventos; `Oxidedb.md` v1.5 validado |
| #12 | Alertas em português | `alerts` com `CHECK` do catálogo em `alert_type`, colunas `resolved_by` e `resolution_note` e `CHECK` de `ENCERRADO` com data; migração automática dos tipos em inglês; `Oxidedb.md` v1.6 validado |

## 3.3 FluxID

| PR | Entrega | O que mudou no FluxID |
| --- | --- | --- |
| #3 | C — Severidade e coordenadas | A Oxide passou a usar os mesmos valores de severidade e status de alerta do FluxID |
| #4 | E — Banco FluxID | Análise do dump; scripts `001` (UUID automático, índice da última posição, `message_id` em eventos, `api_key_hash`, faixa de coordenadas) e `002` (massa de testes com Alfa e Beta, cilindros e lacres coerentes, RBAC); `Banco_FluxID.md` v3.1. Validados num PostgreSQL temporário; ainda não aplicados no `FluxID_db` |
| #5 e #6 | E — Correção | O #5 desfez a entrega E sem querer (botão "Revert"); o #6 a reaplicou com conteúdo idêntico |
| #7 | D — Catálogo de erros | `Tipos-de-Erro.md`: catálogo em português com o equivalente de cada código no FluxID |
| #8 | B — Associação | A cópia provisória da Oxide segue os mesmos códigos e estados de lacres, cilindros e vínculos do FluxID |
| #9 | Decisões P1 a P8 | Data gravada na chegada, quarentena para telemetria sem GPS, tabela de eventos do dispositivo, tipos de alerta do catálogo (script `003` futuro) |
| #12 | Alertas em português | A Oxide já usa os mesmos códigos de alerta que o FluxID vai aceitar (P5); `resolved_by` e `resolution_note` correspondem a `alertas.encerrado_por` e ao motivo do encerramento |

## 3.4 Worker

Ainda não implementado. O que já foi preparado:

| PR | Entrega | O que foi preparado |
| --- | --- | --- |
| #1 | Revisão do plano de teste | `status` e `attempt_count` da fila ficam reservados ao Worker (o ESP32 usa `device_attempt_count`) |
| #4 | E — Banco FluxID | `Integracao-Oxide-FluxID.md`: fluxo, identificação e conversão de cada dado; chave por hash |
| #8 | B — Associação | Mapeamento dos vínculos da Oxide para os do FluxID |
| #9 | Decisões P1 a P8 | Regras do Worker: data, quarentena, espera de vínculo, eventos do dispositivo, tipos de alerta, 5 tentativas, código do alerta e suspeita de violação |
| #12 | Alertas em português | O tipo do alerta passa direto, sem conversão; falta mapear `resolved_by` (texto) para o usuário do FluxID |
