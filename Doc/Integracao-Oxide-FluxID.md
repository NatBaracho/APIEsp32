# Plano de Integração Oxide → FluxID

**Versão:** 1.1 — 06/10/2026 (decisões P1 a P8 fechadas por Natã da Silva Baracho)
**Público:** equipe do projeto e quem for implementar o Worker de sincronização.
**Base:** API Oxide após as entregas A e C, `oxide.db` atual e dump `sql/fluxid/FluxID.sql` de 23/09/2026 com os ajustes de `sql/fluxid/001_ajustes_estrutura.sql`.

Este documento diz **como cada dado da Oxide vira um registro do FluxID** e registra as **decisões** que orientam o Worker (seção 5). Nada aqui está implementado ainda.

---

## 1. Fluxo da sincronização

```text
ESP32 → Oxide API → oxide.db (status PENDING)
                         ↓  Worker lê as linhas PENDING
                         ↓  marca PROCESSING
                         ↓  converte (seção 3) e grava no FluxID numa transação
                         ↓  sucesso → SYNCED      falha → ERROR, attempt_count + 1, last_error
                    FluxID (PostgreSQL)
```

- As colunas `status`, `attempt_count` e `last_error` de `telemetry_queue` e `events` existem para isso e são controladas só pelo servidor.
- **Idempotência:** o Worker grava usando o `message_id`. No FluxID, `telemetrias.message_id` é único, e `eventos_lacre.message_id` passou a existir (único quando informado). Reprocessar a mesma linha não duplica nada.
- Linhas em `ERROR` são tentadas de novo até **5 vezes**, com espera crescente (1 min, 5 min, 15 min, 1 h, 6 h). Depois disso ficam paradas em erro e aparecem para o gestor resolver (decisão P6). O dado nunca é apagado da Oxide.
- Linhas que **esperam** uma condição combinada (ex.: evento de dispositivo sem lacre, decisão P3) não contam como tentativa.

## 2. Identificação: quem é quem

| Oxide | FluxID | Como encontrar |
| --- | --- | --- |
| `device_id` (ex.: `DSP-000001`) | `dispositivos.id` (UUID) | `dispositivos.codigo = device_id` — os códigos já seguem o mesmo padrão |
| — | `organizacao_id` | O da linha de `dispositivos` encontrada |
| `telemetry_queue.lacre_id` (ex.: `LCR-000001`) | `lacre_id` (UUID) | `lacres.codigo = lacre_id`. A Oxide já grava o código do vínculo ativo no recebimento (entrega B) |
| `telemetry_queue.cilindro_id` (ex.: `CIL-000001`) | `cilindro_id` (UUID) | `cilindros.codigo = cilindro_id` |
| `seal_assignments`, `cylinder_assignments` | `vinculos_dispositivo_lacre`, `vinculos_cilindro_lacre` | Mesmo modelo (início, fim, motivo). Quando o Worker existir, o FluxID passa a ser a fonte e a cópia da Oxide é atualizada a partir dele |
| `api_key` | `dispositivos.api_key_hash` | SHA-256 da chave, em hexadecimal (ver seção 4) |

Dispositivo da Oxide sem correspondente em `dispositivos` não é sincronizado: a linha fica em `ERROR` com `last_error = "dispositivo não cadastrado no FluxID"`.

## 3. Conversão dos dados

### 3.1 Telemetria: `telemetry_queue` → `telemetrias`

| Oxide | FluxID | Regra |
| --- | --- | --- |
| `message_id` | `message_id` | Direto |
| `device_id` | `dispositivo_id` | Seção 2 |
| `latitude`, `longitude` | `latitude`, `longitude` | Direto e **obrigatórias**: alimentam o mapa do dashboard. Telemetria sem posição vai para a quarentena (decisão P2) |
| `speed_kmh` | `velocidade_kmh` | Direto |
| `battery_percent` | `bateria_percentual` | Direto |
| `gsm_signal` | `sinal_gsm` | Direto |
| `payload_json` | `payload_raw` (JSONB) | Direto; inclui `seal_status` e `attempt_count` enviados pelo ESP32 |
| — | `data_coleta` (obrigatória) | Gerada pelo FluxID na chegada (`DEFAULT now()`), decisão P1. A Oxide não envia data |
| `seal_status`, `device_attempt_count` | — | Sem coluna no FluxID; ficam em `payload_raw` |
| `last_repeat_message_id` | — | Não sincroniza: é só controle de reenvio da Oxide |

Posições repetidas não geram linha nova na Oxide; por isso só a primeira telemetria de uma sequência repetida chega ao FluxID.

**Telemetria sem GPS (decisão P2):** vai para uma tabela separada de quarentena no FluxID (ex.: `telemetrias_quarentena`, mesmos campos sem a obrigatoriedade de posição), **só armazenada** para análise quando for preciso. Não gera alerta automático. No mapa, o lacre continua na **última posição conhecida** da tabela `telemetrias`.

### 3.2 Estado do lacre: `seal_status` e eventos → `eventos_lacre` e `lacres.status`

| Oxide (`seal_status`) | `eventos_lacre.tipo` | `lacres.status` sugerido |
| --- | --- | --- |
| `LOCKED` | `FECHAMENTO` | `INSTALADO` |
| `UNLOCKED` | `ABERTURA_NAO_AUTORIZADA` (`autorizado = false`), salvo autorização registrada (RN09) | `SUSPEITA_VIOLACAO` |
| `BROKEN` | `VIOLACAO` | `SUSPEITA_VIOLACAO` (vira `ROMPIDO` após análise) |

| Oxide (`events`) | FluxID (`eventos_lacre`) | Regra |
| --- | --- | --- |
| `message_id` | `message_id` | Novo campo do script 001 |
| `device_id` | `lacre_id` (obrigatório) | Pelo vínculo ativo dispositivo → lacre. Sem vínculo, o evento **espera** na Oxide até o vínculo existir (decisão P3) |
| `seal_status` | `tipo` | Tabela acima |
| `event_type`, `payload_json` | `descricao` | Texto do tipo e resumo do payload |
| — | `ocorrido_em` (obrigatório) | Gerada pelo FluxID na chegada (`DEFAULT now()`), decisão P1 |
| — | `telemetria_id` | Opcional: telemetria do mesmo dispositivo mais próxima no tempo |

Eventos **sem** `seal_status` (ex.: `startup`, falha de hardware) vão para uma **nova tabela de eventos do dispositivo** no FluxID (decisão P4): o evento mostra como o lacre e o cilindro se comportam (ativo, violado, abertura não autorizada).

**Estado do lacre (decisão P8):** o Worker só marca `SUSPEITA_VIOLACAO`; a mudança para `ROMPIDO` (ou a liberação) é confirmada pelo gestor.

### 3.3 Alertas: `alerts` → `alertas`

| Oxide | FluxID | Regra |
| --- | --- | --- |
| `alert_type` (código do catálogo, ex.: `LACRE_VIOLADO`) | `tipo` | **Direto**: desde a entrega de alertas em português, a Oxide grava os códigos de [Tipos-de-Erro.md](Tipos-de-Erro.md) |
| — | — | O FluxID passa a aceitar **todos os códigos** do catálogo em `alertas.tipo` (decisão P5, script `004`). Enquanto isso não for aplicado, códigos como `VIOLACAO_LACRE` do dump antigo correspondem a `LACRE_VIOLADO` (seção 7 de `Tipos-de-Erro.md`) |
| `severity` | `severidade` | **Direto** (entrega C: mesmos valores) |
| `status` | `status` | **Direto** (entrega C: mesmos valores) |
| `title`, `description` | `titulo`, `descricao` | Direto |
| `created_at` | `aberto_em` | Direto |
| `resolved_at` | `encerrado_em` | Direto |
| `resolved_by` | `encerrado_por` | Texto na Oxide; no FluxID é o usuário. O Worker precisa mapear o nome para o usuário (a definir) |
| `resolution_note` | — | Motivo do encerramento; sem coluna própria no dump: guardar na descrição ou em coluna nova do script `004` (a definir) |
| `alert_id` | `codigo` | **Direto** (decisão P7): a API Oxide gera o alerta e o envia; o FluxID não cria outro código |
| `device_id` + `created_at` | `organizacao_id`, `lacre_id`, `cilindro_id` | **Obrigatórios** (script `003`): lacre e cilindro do vínculo **válido na data do alerta** (`vinculos_dispositivo_lacre` e `vinculos_cilindro_lacre`, por `data_inicio`/`data_fim`), não o vínculo atual. Sem vínculo naquela data, o alerta **não é enviado** e fica em `ERROR` na Oxide para o gestor. Exceção: códigos de cadastro (`LACRE_SEM_CILINDRO`, `DISPOSITIVO_SEM_LACRE`, `DISPOSITIVO_NAO_CADASTRADO`, `CHAVE_INVALIDA`) |

**Alerta no mapa:** o alerta não guarda posição; o dashboard o desenha como ponto/cor na **posição atual** do lacre (última telemetria válida).

### 3.4 Comandos

O FluxID não tem tabela de comandos. Decisão da entrega D: os comandos (`TRAVAR_VALVULA`, `DESTRAVAR_VALVULA`) ficam **só na Oxide** por enquanto; criar ou não uma tabela no FluxID será decidido junto com o Worker.

Os tipos de alerta já usam os códigos em português do catálogo [Tipos-de-Erro.md](Tipos-de-Erro.md), sem conversão na seção 3.3.

## 4. Chave de API do dispositivo

Decisão de Natã da Silva Baracho: a chave fica no FluxID, **guardada apenas como hash** (`dispositivos.api_key_hash`, SHA-256 em hexadecimal, script 001).

Consequências para implementar junto com o Worker:

1. A chave em texto só existe no momento do cadastro: quem cadastra o dispositivo no FluxID gera a chave, grava o hash e repassa a chave para o firmware.
2. Como hash não pode ser revertido, o Worker leva para a Oxide **o hash**, não a chave.
3. A Oxide passa a guardar `api_key_hash` e a comparar `SHA-256(X-API-Key)` com ele, em vez da chave em texto. É uma mudança na API Oxide, a ser feita na entrega do Worker.
4. Até lá, o `POST /api/v1/devices` da Oxide continua como cadastro provisório.

## 5. Decisões (fechadas em 06/10/2026)

Decididas por **Natã da Silva Baracho**. Registro conferido por questionário (6/6 sim) e **aprovado por Natã da Silva Baracho** em 06/10/2026.

| # | Tema | Decisão |
| --- | --- | --- |
| P1 | Data da telemetria e do evento | A Oxide não envia data. O FluxID grava **sempre a hora de chegada** (`DEFAULT now()` em `telemetrias.data_coleta` e `eventos_lacre.ocorrido_em`), para auditoria e relatórios |
| P2 | Telemetria sem GPS | Quarentena em **tabela separada** no FluxID, só armazenada para análise. A tabela `telemetrias` continua exigindo latitude e longitude, porque alimenta o mapa do dashboard |
| P3 | Evento de dispositivo sem lacre vinculado | Espera na Oxide até haver vínculo; o lacre fica disponível para receber cilindro, cliente e endereço |
| P4 | Eventos sem estado de lacre (`startup`, falhas) | Nova tabela de eventos do dispositivo no FluxID |
| P5 | Tipos de alerta | `alertas.tipo` passa a aceitar todos os códigos do catálogo `Tipos-de-Erro.md` |
| P6 | Limite de tentativas do Worker | 5 tentativas (1 min, 5 min, 15 min, 1 h, 6 h); depois fica em erro para o gestor resolver |
| P7 | Código do alerta | A API Oxide gera o alerta; o FluxID usa o `alert_id` como `codigo` |
| P8 | `lacres.status` pelo Worker | Worker só marca `SUSPEITA_VIOLACAO`; o gestor confirma |
| — | Alerta no mapa | Desenhado na posição atual do lacre (o alerta não guarda posição) |

**Consequência a observar (P1 + P6):** como a data é a da chegada ao FluxID, um dado que demorou a ser enviado (Oxide sem internet ou novas tentativas do Worker) fica com a hora em que chegou, não com a hora da leitura.

**Mudanças no FluxID que essas decisões pedem** (script `sql/fluxid/004`, na entrega do Worker; o `003` é o do alerta com cilindro e lacre obrigatórios): `DEFAULT now()` nas duas datas; tabela de quarentena; tabela de eventos do dispositivo; `CHECK` de `alertas.tipo` com os códigos do catálogo.

## 6. Ordem sugerida

1. Aplicar `sql/fluxid/001_ajustes_estrutura.sql` e `002_correcao_massa_de_testes.sql` no FluxID e gerar um novo dump.
2. Entrega D (catálogo de comandos), já decidindo a seção 3.4.
3. ✅ Entrega B (associação): cópia provisória na Oxide no mesmo modelo do FluxID, com `error_type` registrando dispositivo sem lacre, lacre sem cilindro e lacre aberto em trânsito.
4. ✅ Decisões P1 a P8 fechadas (seção 5).
5. Implementar o Worker e a chave por hash na Oxide (seção 4), testando primeiro num FluxID de análise no Docker (o container `fluxid-analise` (imagem `postgis/postgis:18-3.6`, porta `127.0.0.1:54329`, senha gerada na hora e não registrada) já existe desde 07/10/2026).
