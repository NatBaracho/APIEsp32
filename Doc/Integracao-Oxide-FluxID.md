# Plano de Integração Oxide → FluxID

**Versão:** 1.0 — 06/10/2026 (entrega E)
**Público:** equipe do projeto e quem for implementar o Worker de sincronização.
**Base:** API Oxide após as entregas A e C, `oxide.db` atual e dump `FluxID.sql` de 23/09/2026 com os ajustes de `sql/fluxid/001_ajustes_estrutura.sql`.

Este documento diz **como cada dado da Oxide vira um registro do FluxID** e lista **o que ainda precisa ser decidido** antes de implementar o Worker. Nada aqui está implementado ainda.

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
- Linhas em `ERROR` são tentadas de novo depois; o limite de tentativas ainda será definido (decisão P6).

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
| `latitude`, `longitude` | `latitude`, `longitude` | Direto. O FluxID exige as duas: telemetria sem posição segue a decisão P2 |
| `speed_kmh` | `velocidade_kmh` | Direto |
| `battery_percent` | `bateria_percentual` | Direto |
| `gsm_signal` | `sinal_gsm` | Direto |
| `payload_json` | `payload_raw` (JSONB) | Direto; inclui `seal_status` e `attempt_count` enviados pelo ESP32 |
| `last_seen_at` ou hora de recebimento | `data_coleta` (obrigatória) | **Decisão P1** |
| `seal_status`, `device_attempt_count` | — | Sem coluna no FluxID; ficam em `payload_raw` |
| `last_repeat_message_id` | — | Não sincroniza: é só controle de reenvio da Oxide |

Posições repetidas não geram linha nova na Oxide; por isso só a primeira telemetria de uma sequência repetida chega ao FluxID.

### 3.2 Estado do lacre: `seal_status` e eventos → `eventos_lacre` e `lacres.status`

| Oxide (`seal_status`) | `eventos_lacre.tipo` | `lacres.status` sugerido |
| --- | --- | --- |
| `LOCKED` | `FECHAMENTO` | `INSTALADO` |
| `UNLOCKED` | `ABERTURA_NAO_AUTORIZADA` (`autorizado = false`), salvo autorização registrada (RN09) | `SUSPEITA_VIOLACAO` |
| `BROKEN` | `VIOLACAO` | `SUSPEITA_VIOLACAO` (vira `ROMPIDO` após análise) |

| Oxide (`events`) | FluxID (`eventos_lacre`) | Regra |
| --- | --- | --- |
| `message_id` | `message_id` | Novo campo do script 001 |
| `device_id` | `lacre_id` (obrigatório) | Pelo vínculo ativo dispositivo → lacre. Sem vínculo: decisão P3 |
| `seal_status` | `tipo` | Tabela acima |
| `event_type`, `payload_json` | `descricao` | Texto do tipo e resumo do payload |
| — | `ocorrido_em` (obrigatório) | **Decisão P1** (a tabela `events` não tem data) |
| — | `telemetria_id` | Opcional: telemetria do mesmo dispositivo mais próxima no tempo |

Eventos **sem** `seal_status` (ex.: `startup`, falha de hardware) não têm tipo equivalente em `eventos_lacre`: decisão P4.

### 3.3 Alertas: `alerts` → `alertas`

| Oxide | FluxID | Regra |
| --- | --- | --- |
| `alert_type` `SEAL_BROKEN` | `tipo` `VIOLACAO_LACRE` | Conversão |
| `GEOFENCE_EXIT` | `SAIDA_GEOCERCA` | Conversão |
| `LOW_BATTERY` | `BATERIA_BAIXA` | Conversão |
| `COMMUNICATION_LOST` | `SEM_COMUNICACAO` | Conversão |
| `DEVICE_ERROR`, `COMMAND_FAILURE` | — | Sem equivalente no `CHECK`: decisão P5 |
| `severity` | `severidade` | **Direto** (entrega C: mesmos valores) |
| `status` | `status` | **Direto** (entrega C: mesmos valores) |
| `title`, `description` | `titulo`, `descricao` | Direto |
| `created_at` | `aberto_em` | Direto |
| `resolved_at` | `encerrado_em` | Direto |
| `alert_id` | `codigo` | Direto se seguir o padrão `ALT-000001` e não colidir; senão, o FluxID gera (decisão P7) |
| `device_id` | `organizacao_id`, `lacre_id`, `cilindro_id` | Seção 2 |

### 3.4 Comandos

O FluxID não tem tabela de comandos. Decisão da entrega D: os comandos (`TRAVAR_VALVULA`, `DESTRAVAR_VALVULA`) ficam **só na Oxide** por enquanto; criar ou não uma tabela no FluxID será decidido junto com o Worker.

Os tipos de alerta seguirão os códigos em português do catálogo [Tipos-de-Erro.md](Tipos-de-Erro.md), o que reduz as conversões da seção 3.3.

## 4. Chave de API do dispositivo

Decisão de Natã da Silva Baracho: a chave fica no FluxID, **guardada apenas como hash** (`dispositivos.api_key_hash`, SHA-256 em hexadecimal, script 001).

Consequências para implementar junto com o Worker:

1. A chave em texto só existe no momento do cadastro: quem cadastra o dispositivo no FluxID gera a chave, grava o hash e repassa a chave para o firmware.
2. Como hash não pode ser revertido, o Worker leva para a Oxide **o hash**, não a chave.
3. A Oxide passa a guardar `api_key_hash` e a comparar `SHA-256(X-API-Key)` com ele, em vez da chave em texto. É uma mudança na API Oxide, a ser feita na entrega do Worker.
4. Até lá, o `POST /api/v1/devices` da Oxide continua como cadastro provisório.

## 5. Decisões pendentes

| # | Decisão | Opções principais |
| --- | --- | --- |
| P1 | Data da telemetria e do evento | (a) Oxide passa a gravar `received_at` ao receber; `data_coleta` = `last_seen_at` do ESP32 ou `received_at`. (b) ESP32 passa a enviar sempre a data da leitura |
| P2 | Telemetria sem GPS | (a) Não sincroniza (fica só na Oxide). (b) Quarentena para análise. (c) FluxID passa a aceitar coordenadas nulas |
| P3 | Evento de dispositivo sem lacre vinculado | (a) Fica em `ERROR` até haver vínculo. (b) Só registra na Oxide |
| P4 | Eventos sem estado de lacre (`startup`, falhas) | (a) Ficam só na Oxide. (b) Nova tabela de eventos do dispositivo no FluxID |
| P5 | Alertas `DEVICE_ERROR` e `COMMAND_FAILURE` | (a) Acrescentar ao `CHECK` de `alertas.tipo`. (b) Ficam só na Oxide |
| P6 | Limite de tentativas do Worker | Ex.: 5 tentativas com intervalo crescente; depois exige ação manual |
| P7 | Código do alerta no FluxID | (a) Usar o `alert_id` da Oxide. (b) FluxID gera `ALT-xxxxxx` e guarda o `alert_id` como referência |
| P8 | Atualização de `lacres.status` pelo Worker | (a) Worker atualiza conforme a seção 3.2. (b) Só a API do FluxID/operador altera |

## 6. Ordem sugerida

1. Aplicar `sql/fluxid/001_ajustes_estrutura.sql` e `002_correcao_massa_de_testes.sql` no FluxID e gerar um novo dump.
2. Entrega D (catálogo de comandos), já decidindo a seção 3.4.
3. ✅ Entrega B (associação): cópia provisória na Oxide no mesmo modelo do FluxID, com `error_type` registrando dispositivo sem lacre, lacre sem cilindro e lacre aberto em trânsito.
4. Fechar as decisões P1 a P8.
5. Implementar o Worker e a chave por hash na Oxide (seção 4), testando primeiro num FluxID de análise (Docker).
