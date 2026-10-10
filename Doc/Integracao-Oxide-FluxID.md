# Integração Oxide ⇄ FluxID

> **Referência histórica (10/10/2026).** O Worker descrito aqui enviava os dados ao FluxID em PostgreSQL. O banco principal passou a ser o **Supabase**, e a Oxide foi reduzida a três tabelas. As decisões P1, P6 e P7 continuam valendo; o resto foi substituído por [Contrato-Entrega-Supabase.md](Contrato-Entrega-Supabase.md) e [Oxidedb.md](Oxidedb.md).

**Versão:** 2.0 — 07/10/2026 (Worker implementado, testado e aprovado por Natã da Silva Baracho em 07/10/2026)
**Público:** equipe do projeto, quem mantém a API Oxide e quem vai construir a API do frontend sobre o FluxID.
**Base:** API Oxide, `oxide.db` e dump `sql/fluxid/FluxID.sql` de 23/09/2026 com os scripts `sql/fluxid/001` a `005`.

Este documento diz **como cada dado da Oxide vira um registro do FluxID**, como o **cadastro oficial do FluxID volta para a Oxide** e quais **decisões** orientam o Worker (seção 5). A versão 1.1 era só o plano; desde a 2.0, tudo o que está aqui foi implementado (`src/worker/` e scripts `004` e `005`). A verificação técnica e o teste formal da IA (Roteiro v1.10, sem falhas) estão no relatório `Doc/Doc_tese/Relatorio-de-Teste-2026-10-07-01h30.md`; questionário com 15/15 sim, aprovado por Natã da Silva Baracho em 07/10/2026.

---

## 1. Fluxo da sincronização

```text
ESP32 (lacre) → API Oxide → oxide.db (fila: PENDING)
                                ↓   Worker (npm run worker), a cada 10 s
                                ↓   1. traz o cadastro do FluxID (a cada 5 min)
                                ↓   2. envia telemetria, eventos e alertas
                                ↓      (cada linha numa transação no FluxID)
                           FluxID (PostgreSQL) ← banco principal, lido pelo frontend
```

O que acontece com cada linha da fila da Oxide:

| Situação na Oxide | Significado | O que o Worker faz |
| --- | --- | --- |
| `PENDING`, sem próxima tentativa | Nova, pronta | Envia na próxima rodada |
| `PROCESSING` | Sendo enviada | Se o Worker parar no meio, volta a `PENDING` na próxima vez que ele subir |
| `SYNCED` | Gravada no FluxID | Nada; reenviar não duplica |
| `PENDING`, com próxima tentativa | **Esperando uma condição** (ex.: evento de dispositivo sem lacre, P3) | Tenta de novo em 5 min, **sem contar tentativa** |
| `ERROR`, com próxima tentativa | Falhou; nova tentativa agendada | Tenta de novo na hora marcada |
| `ERROR`, sem próxima tentativa | **Parada**: acabaram as tentativas ou o caso não tem como seguir | Nada; aparece para o gestor (seção 6) |

- **Tentativas (P6):** envio inicial e mais **5 novas tentativas**, esperando 1 min, 5 min, 15 min, 1 h e 6 h. Depois disso a linha fica parada para o gestor. (Interpretação a validar: "5 tentativas com espera 1 min … 6 h" foi lido como 5 esperas, ou seja, 6 envios no total.)
- **FluxID fora do ar ou sem rede:** a rodada é registrada como `FALHOU` e **nenhuma tentativa é gasta**, porque nada chegou a ser enviado. As linhas continuam `PENDING` e seguem na próxima rodada.
- **Idempotência:** tudo é gravado pela chave da Oxide (`message_id` ou `alert_id`). Reenviar a mesma linha não duplica nada no FluxID.
- **Registro:** cada rodada vira uma linha em `sync_logs` na Oxide (início, fim, `OK`/`PARCIAL`/`FALHOU` e um resumo do que foi enviado).

## 2. Identificação: quem é quem

| Oxide | FluxID | Como encontrar |
| --- | --- | --- |
| `device_id` (ex.: `DSP-000001`) | `dispositivos.id` (UUID) e `organizacao_id` | `dispositivos.codigo = device_id` |
| `telemetry_queue.lacre_id` (ex.: `LCR-000001`) | `lacre_id` (UUID) | `lacres.codigo`. É o lacre do vínculo ativo **no recebimento** (gravado pela Oxide) |
| `telemetry_queue.cilindro_id` (ex.: `CIL-000001`) | `cilindro_id` (UUID) | `cilindros.codigo` |
| `alert_id` | `alertas.codigo` | Direto (P7) |
| `seal_assignments`, `cylinder_assignments` | `vinculos_dispositivo_lacre`, `vinculos_cilindro_lacre` | **O FluxID é a fonte** (seção 4). A Oxide guarda o id do FluxID em `fluxid_id` |
| `devices.api_key_hash` | `dispositivos.api_key_hash` | SHA-256 da chave, em hexadecimal (seção 4) |

Dispositivo da Oxide sem correspondente em `dispositivos`: a linha fica em `ERROR` com "dispositivo não cadastrado no FluxID" e segue a regra das tentativas. Depois de cadastrar o dispositivo no FluxID, o gestor manda a linha de volta para a fila (`POST /api/v1/sync/retry`).

## 3. Oxide → FluxID: conversão dos dados

### 3.1 Telemetria: `telemetry_queue` → `telemetrias` (ou quarentena)

| Oxide | FluxID | Regra |
| --- | --- | --- |
| `message_id` | `message_id` | Direto (único) |
| `device_id` | `dispositivo_id` | Seção 2 |
| `lacre_id`, `cilindro_id` (códigos) | `lacre_id`, `cilindro_id` (colunas novas do `004`) | Para o mapa saber onde está cada lacre e cilindro. Código desconhecido no FluxID → vazio |
| `latitude`, `longitude` | `latitude`, `longitude` | **Obrigatórias** na tabela principal (mapa do dashboard) |
| `speed_kmh`, `battery_percent`, `gsm_signal` | `velocidade_kmh`, `bateria_percentual`, `sinal_gsm` | Direto |
| `payload_json` | `payload_raw` (JSONB) | O payload original mais um bloco `oxide` com `seal_status`, `device_attempt_count`, `error_type`, `last_seen_at` e os códigos de lacre e cilindro |
| — | `data_coleta` | Hora de chegada ao FluxID (`DEFAULT now()`, P1) |
| `last_repeat_message_id` | — | Não sincroniza (controle de reenvio da Oxide) |

**Sem posição (P2):** vai para `telemetrias_quarentena`, com os mesmos dados e `motivo = SEM_POSICAO`. Fica só armazenada; não gera alerta. No mapa, o lacre continua na última posição conhecida.

### 3.2 Eventos: `events` → `eventos_lacre` ou `eventos_dispositivo`

| `seal_status` da Oxide | Destino | `tipo` |
| --- | --- | --- |
| `LOCKED` | `eventos_lacre` | `FECHAMENTO` |
| `UNLOCKED` | `eventos_lacre` | `ABERTURA_NAO_AUTORIZADA` (`autorizado = false`) |
| `BROKEN` | `eventos_lacre` | `VIOLACAO` |
| vazio (ex.: `startup`, falha) | `eventos_dispositivo` (P4) | o `event_type` enviado |

- **Lacre do evento:** o do vínculo **ativo** do dispositivo no FluxID.
- **Sem lacre vinculado (P3):** o evento do lacre **espera** na Oxide, sem gastar tentativa, até o vínculo existir.
- **Estado do lacre (P8):** um evento novo de `VIOLACAO` ou `ABERTURA_NAO_AUTORIZADA` passa o lacre de `INSTALADO` para `SUSPEITA_VIOLACAO`. Só o gestor confirma `ROMPIDO`. `FECHAMENTO` não muda o estado do lacre.
- Colunas novas em `eventos_lacre` (script `004`): `dispositivo_id`, `codigo_erro` (o `error_type` da Oxide) e `payload_raw`.
- `ocorrido_em`: hora de chegada ao FluxID (P1).

### 3.3 Alertas: `alerts` → `alertas`

| Oxide | FluxID | Regra |
| --- | --- | --- |
| `alert_id` | `codigo` | Direto (P7) |
| `alert_type` | `tipo` | Direto: os 28 códigos do catálogo (P5, script `004`) |
| `severity`, `status`, `title`, `description` | `severidade`, `status`, `titulo`, `descricao` | Direto |
| `created_at` | `aberto_em` | Direto (UTC) |
| `device_id` | `dispositivo_id` (coluna nova), `organizacao_id` | Seção 2 |
| `device_id` + `created_at` | `lacre_id`, `cilindro_id` | **Obrigatórios** (script `003`): o par do vínculo **válido no momento do alerta**, não o de agora |
| `resolved_at` | `encerrado_em` | Direto |
| `resolved_by` | `encerrado_por_nome` (coluna nova) | Texto. `encerrado_por` (usuário do FluxID) fica para a API do frontend |
| `resolution_note` | `motivo_encerramento` (coluna nova) | Direto |

Casos especiais:

- **Sem lacre ou sem cilindro naquela data:** o alerta **não vai** ao FluxID e fica parado na Oxide, com a explicação, para o gestor. O sistema nunca preenche com um vínculo de outro momento.
  - Exceções, só para códigos de cadastro: sem cilindro, `LACRE_SEM_CILINDRO`, `DISPOSITIVO_SEM_LACRE`, `DISPOSITIVO_NAO_CADASTRADO` e `CHAVE_INVALIDA`; sem lacre, só os três últimos.
- **Código já usado no FluxID por outro alerta** (ex.: a massa de testes já tem `ALT-000001`): o alerta fica parado para o gestor.
- **Análise e encerramento na Oxide** (`PATCH /api/v1/iot/alerts/{alert_id}/status`): o alerta volta para a fila. O Worker **atualiza** o mesmo alerta no FluxID (status, encerramento, quem e motivo).
- **Gatilho FLX-26 (script `004`):** o FluxID recusa qualquer alerta cujo par lacre + cilindro não tinha vínculo naquela data, mesmo que gravado por outra via.
- **Histórico do cilindro (script `005`):** todo alerta com cilindro entra sozinho no histórico do cilindro (`ALERTA_REGISTRADO`, e `ALERTA_ENCERRADO` ao encerrar), com origem `OXIDE`.

**Alerta no mapa:** o alerta não guarda posição; o dashboard o desenha na **posição atual** do lacre (última telemetria válida).

### 3.4 Comandos

O FluxID não tem tabela de comandos. Os comandos (`TRAVAR_VALVULA`, `DESTRAVAR_VALVULA`) continuam **só na Oxide** (decisão da entrega D). Criar comandos pelo frontend fica para a API do frontend.

## 4. FluxID → Oxide: o cadastro oficial

A cada 5 minutos (e quando o Worker sobe), o Worker traz do FluxID para a cópia da Oxide:

| FluxID | Oxide | Regra |
| --- | --- | --- |
| `dispositivos` (`codigo`, `ativo`, `versao_firmware`, `api_key_hash`) | `devices` | Atualiza ou cria. Dispositivo criado assim recebe uma chave em texto aleatória e inutilizável: ele só autentica pelo hash |
| `lacres` (`codigo`, `uid_nfc`, `status`) | `seals` | Atualiza ou cria |
| `cilindros` (`codigo`, `numero_serie`, `status`) | `cylinders` | Atualiza ou cria |
| `vinculos_dispositivo_lacre`, `vinculos_cilindro_lacre` | `seal_assignments`, `cylinder_assignments` | Atualiza pelo `fluxid_id`. Um vínculo ativo do FluxID **encerra** o vínculo ativo local que o contradiz (motivo "Encerrado pela sincronização") |

- **O FluxID manda:** o que vem de lá sobrescreve a cópia. O que só existe na Oxide (cadastro provisório) é mantido. **Nada é apagado.**
- Tudo numa transação da Oxide: ou a cópia inteira é atualizada, ou nada. Conflitos (ex.: UID NFC repetido) ficam listados no resumo da rodada.
- **Chave por hash:** quando o dispositivo tem `api_key_hash`, a Oxide confere `SHA-256(X-API-Key)` com ele, e a chave em texto guardada deixa de valer. Sem hash, vale a chave em texto do cadastro provisório. A chave em texto só existe no cadastro: quem cadastra no FluxID gera a chave, grava o hash e repassa a chave ao firmware.

## 5. Decisões

### 5.1 Decisões P1 a P8 (fechadas em 06/10/2026)

Decididas por **Natã da Silva Baracho**. Registro conferido por questionário (6/6 sim) e **aprovado por Natã da Silva Baracho** em 06/10/2026.

| # | Tema | Decisão | Onde está implementada |
| --- | --- | --- | --- |
| P1 | Data da telemetria e do evento | O FluxID grava **sempre a hora de chegada** | `DEFAULT now()` no `004`; o Worker não envia data |
| P2 | Telemetria sem GPS | Quarentena em tabela separada, só armazenada | `telemetrias_quarentena` (`004`); `pushTelemetry.ts` |
| P3 | Evento de dispositivo sem lacre | Espera na Oxide até haver vínculo | Situação "aguardando" (seção 1); `pushEvents.ts` |
| P4 | Eventos sem estado de lacre | Tabela de eventos do dispositivo | `eventos_dispositivo` (`004`) |
| P5 | Tipos de alerta | Todos os códigos do catálogo | `CHECK` de `alertas.tipo` (`004`), com os tipos antigos do dump convertidos |
| P6 | Tentativas | 1 min, 5 min, 15 min, 1 h, 6 h; depois, gestor | `retry.ts` |
| P7 | Código do alerta | `alert_id` da Oxide | `pushAlerts.ts` |
| P8 | Estado do lacre pelo Worker | Só `SUSPEITA_VIOLACAO`; o gestor confirma | `pushEvents.ts` |
| — | Alerta no mapa | Na posição atual do lacre | Sem posição no alerta |

**Efeito aceito (P1 + P6):** um dado que demorou a chegar ao FluxID fica com a hora em que chegou, não com a hora da leitura.

### 5.2 Escolhas feitas na implementação (aprovado por Natã da Silva Baracho em 07/10/2026)

| # | Escolha | Motivo |
| --- | --- | --- |
| I1 | "5 tentativas" = envio inicial + 5 novas tentativas | Usa as 5 esperas aprovadas (1 min … 6 h) |
| I2 | FluxID fora do ar não gasta tentativa | Nada foi enviado; evita parar linhas por causa de queda de rede |
| I3 | Alerta sem lacre ou cilindro na data e código repetido **param na hora** (sem novas tentativas) | Tentar de novo não muda o passado; precisa do gestor |
| I4 | `sync_items` não foi criada; `sync_logs` sim | O estado de cada item já fica na própria fila |
| I5 | Quem encerrou o alerta vai como texto (`encerrado_por_nome`) | A Oxide não conhece os usuários do FluxID |
| I6 | Lacre do evento = vínculo ativo do dispositivo **na chegada** ao FluxID | `events` não tem data na Oxide (P1) |
| I7 | Rotas de acompanhamento abertas e provisórias (`/api/v1/sync/*`) | Mesmo padrão de `/devices` até o controle por perfil |

## 6. Operação

**Rodar o Worker** (ao lado da API, em outro terminal):

1. Copiar `.env.example` para `.env` e preencher `FLUXID_DATABASE_URL`. O `.env` fica fora do git e **a senha nunca vai para documento**.
2. Rodar:
   - `npm run worker`: roda sem parar (Ctrl+C encerra ao fim da rodada);
   - `npm run worker -- --once`: uma rodada e sai.

**Acompanhar** (rotas abertas e provisórias, no Swagger, grupo "Sincronização"):

| Rota | Para quê |
| --- | --- |
| `GET /api/v1/sync/status` | Quantas linhas estão pendentes, aguardando, com nova tentativa, paradas e sincronizadas em cada fila; últimas 5 rodadas |
| `GET /api/v1/sync/problems?queue=telemetry\|events\|alerts` | Linhas com problema e o motivo |
| `POST /api/v1/sync/retry` `{ "queue": "...", "key": "..." }` | Depois de corrigir a causa, manda a linha de volta para a fila (zera as tentativas) |

**Ordem dos scripts no FluxID:** `001` → `002` → `003` → `004` → `005` (seção 17 do `Banco_FluxID.md`).

## 7. Situação

1. ✅ Scripts `001` a `005` validados no FluxID de análise no Docker.
2. ✅ Decisões P1 a P8 fechadas e implementadas.
3. ✅ Worker, chave por hash e cadastro de volta implementados. Verificação técnica feita pela IA no Docker.
4. ✅ Teste formal da IA (Roteiro v1.10, seção 5.10) em 07/10/2026, sem falhas.
5. ✅ Validação de Natã da Silva Baracho: questionário 15/15 sim (07/10/2026).
6. ⏳ Aplicar `001` a `005` no `FluxID_db` principal e gerar o novo dump.
