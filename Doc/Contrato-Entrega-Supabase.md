# Contrato de entrega: API do lacre → Supabase

**Versão:** 1.0 — 10/10/2026 — proposta do backend, **aguardando a validação de Natã da Silva Baracho e a revisão do professor Alisson**
**Para:** quem mantém o Supabase (projeto `fluxid_integra2026`).
**De:** a API do lacre (este repositório).

Este documento diz **o que a API do lacre envia ao Supabase, em que formato, e o que ela espera de volta**. Com ele, dá para criar a função de recebimento no Supabase sem conhecer o código da API.

---

## 1. Resumo

```text
Lacre (ESP32) ──► API do lacre ──► fila local ──► Worker ──► função de recebimento (Supabase)
                                                    ▲                    │
                                                    └── dispositivos e comandos ──┘
```

- A API recebe as mensagens do lacre, valida e guarda numa fila local.
- O **Worker** (um programa que roda junto da API) faz três coisas com o Supabase, a cada 10 segundos:
  1. envia as mensagens da fila;
  2. busca os comandos de válvula pendentes;
  3. a cada 5 minutos, busca a lista de dispositivos, com o hash da chave de cada um.
- Tudo passa por **uma função de recebimento** no Supabase (decisão: API REST, com a chave `service_role`, por uma função).

## 2. Como a API chama o Supabase

| Item | Valor |
| --- | --- |
| Endereço | Um só, configurado no servidor da API em `SUPABASE_IOT_URL`. Exemplo: `https://<projeto>.supabase.co/functions/v1/iot-ingest` |
| Método | Sempre `POST` |
| Cabeçalhos | `content-type: application/json`, `authorization: Bearer <service_role>` e `apikey: <service_role>` |
| Corpo | JSON com o campo `operation` e os dados da operação |
| Tempo limite | 15 segundos por chamada |

A chave `service_role` fica só no arquivo `.env` do servidor da API. Ela não vai para o Git, para documentos nem para o lacre.

O nome da função (`iot-ingest`) é só um exemplo. Vale o endereço que for configurado.

## 3. As três operações

### 3.1 `push_messages` — enviar mensagens do lacre

**Pedido:**

```json
{
  "operation": "push_messages",
  "messages": [
    {
      "type": "TELEMETRIA",
      "origin": "lacre",
      "received_at": "2026-10-10T15:25:23.000Z",
      "message_id": "MSG-000123",
      "device_id": "DSP-000001",
      "latitude": -7.2091939,
      "longitude": -39.3063666,
      "gps_ok": true,
      "battery_percent": 87,
      "seal_status": "LOCKED",
      "satellites": 9,
      "hdop": 0.9
    }
  ]
}
```

Até 100 mensagens por chamada (`WORKER_BATCH_SIZE`).

**Resposta (HTTP 200):** um resultado por mensagem.

```json
{
  "results": [
    { "message_id": "MSG-000123", "status": "stored" }
  ]
}
```

| `status` | Significado | O que a API faz |
| --- | --- | --- |
| `stored` | Gravada agora | Marca como enviada |
| `duplicate` | Já tinha sido gravada (mesmo `message_id`) | Marca como enviada. **Reenviar nunca pode duplicar** |
| `rejected` | Não pode ser gravada; `error` diz o motivo (ex.: dispositivo sem lacre no cadastro) | Para de tentar e mostra o motivo ao gestor |
| (mensagem sem resultado) | — | Tenta de novo: 1 min, 5 min, 15 min, 1 h e 6 h; depois para e mostra ao gestor |

**Regra de ouro:** o `message_id` é único. Se a mesma mensagem chegar de novo, a função deve responder `duplicate` e **atualizar** o registro com os dados novos, sem criar outro. Isso acontece em dois casos:
- reenvio depois de uma falha de rede;
- lacre parado no mesmo lugar: a API reenvia a mesma leitura com `last_seen_at`, `battery_percent` e `gsm_signal` atualizados.

### 3.2 `list_devices` — dispositivos autorizados

**Pedido:** `{ "operation": "list_devices" }`

**Resposta (HTTP 200):**

```json
{
  "devices": [
    { "device_id": "DSP-000001", "api_key_hash": "9f86d081884c7d65...", "active": true, "firmware_version": "1.0.0" }
  ]
}
```

| Campo | Regra |
| --- | --- |
| `device_id` | Código do dispositivo. É o mesmo que o lacre manda em toda mensagem |
| `api_key_hash` | SHA-256 da chave do dispositivo, em hexadecimal (64 caracteres). A chave em texto só existe no cadastro e no lacre |
| `active` | `false` bloqueia o lacre na API (resposta `403`) |
| `firmware_version` | Opcional |

A API copia essa lista. Dispositivo que some da lista **não é apagado** na API; para bloquear, mande `active: false`.

### 3.3 `list_commands` — comandos pendentes da válvula

**Pedido:** `{ "operation": "list_commands" }`

**Resposta (HTTP 200):** só os comandos que ainda não foram confirmados.

```json
{
  "commands": [
    { "command_id": "c0a8012e-...", "device_id": "DSP-000001", "command_type": "TRAVAR_VALVULA", "created_at": "2026-10-10T15:00:00Z" }
  ]
}
```

| Campo | Regra |
| --- | --- |
| `command_id` | Identificador único do comando no Supabase (texto) |
| `command_type` | `TRAVAR_VALVULA` ou `DESTRAVAR_VALVULA`. Outro tipo é ignorado, com aviso |
| `created_at` | Opcional |

O lacre busca o comando na API e confirma. A confirmação volta ao Supabase como uma mensagem do tipo `CONFIRMACAO_COMANDO` (seção 4.4). Depois dela, o comando deve sair da lista de pendentes.

## 4. As mensagens, tipo por tipo

### 4.1 Campos que toda mensagem do lacre tem

| Campo | Tipo | Sempre vem? | Significado |
| --- | --- | --- | --- |
| `type` | texto | sim | `TELEMETRIA`, `EVENTO`, `ALERTA` ou `CONFIRMACAO_COMANDO` |
| `origin` | texto | sim | `lacre` (enviada pelo lacre) ou `servidor` (alerta aberto pela API) |
| `message_id` | texto | sim | Único. No alerta do lacre, é o `alert_id` que ele enviou |
| `device_id` | texto | sim | Código do dispositivo |
| `received_at` | data ISO 8601, em UTC | sim | Hora em que a API recebeu |
| `latitude`, `longitude` | número | sim | Posição. Nunca vêm vazias |
| `gps_ok` | verdadeiro/falso | sim | `false` = o lacre estava sem sinal de GPS e mandou a **última posição conhecida** |
| `battery_percent` | número, 0 a 100 | sim | Bateria |
| `seal_status` | texto | não | `LOCKED`, `UNLOCKED` ou `BROKEN` |
| `speed_kmh`, `gsm_signal`, `satellites`, `hdop` | número | não | Velocidade, sinal em dBm, satélites e precisão do GPS |
| `device_state` | texto | não | Estado informado pelo firmware (ex.: `OPERACIONAL`) |
| `device_attempt_count` | inteiro | não | Quantas vezes o lacre tentou enviar |
| `last_seen_at` | data ISO 8601 | não | Só na telemetria: última vez que o lacre repetiu a mesma posição |

A `CONFIRMACAO_COMANDO` não tem posição nem bateria (seção 4.4).

### 4.2 `TELEMETRIA`

Só os campos comuns. É a leitura periódica.

### 4.3 `EVENTO` e `ALERTA`

| Tipo | Campos a mais |
| --- | --- |
| `EVENTO` | `event_type` (ex.: `startup`, `seal_changed`, `hardware_failure`) e `description` (opcional) |
| `ALERTA` | `alert_type` (código do catálogo [Tipos-de-Erro.md](Tipos-de-Erro.md)), `severity` (`BAIXA`, `MEDIA`, `ALTA` ou `CRITICA`), `title` e `description` (opcional). Quando `origin` é `servidor`, vem também `source_message_id`: a mensagem que causou o alerta |

**Alertas que a API abre sozinha** (`origin: "servidor"`, `message_id` começando com `AUT-`):

| `alert_type` | Quando |
| --- | --- |
| `BATERIA_BAIXA` | A bateria cai abaixo de 15% |
| `GSM_SINAL_FRACO` | O sinal cai abaixo de -105 dBm |
| `LACRE_VIOLADO` | O lacre passa a `BROKEN` |
| `LACRE_ABERTO_SEM_AUTORIZACAO` | O lacre passa a `UNLOCKED`. A API não sabe se havia autorização: quem confere é o sistema principal |

Cada um é aberto **uma vez, na mudança** (ao cruzar o limite ou quando o estado do lacre muda), e não a cada leitura.

**O que a API não faz:** regras de rota, de geocerca e de tempo sem comunicar. Essas ficam no sistema principal, que tem os clientes, as geocercas e as viagens.

### 4.4 `CONFIRMACAO_COMANDO`

```json
{
  "type": "CONFIRMACAO_COMANDO",
  "origin": "lacre",
  "received_at": "2026-10-10T15:26:00.000Z",
  "message_id": "CONF-c0a8012e-...",
  "device_id": "DSP-000001",
  "command_id": "c0a8012e-...",
  "command_status": "EXECUTADO"
}
```

`command_status` é `EXECUTADO` ou `ERRO`. Com `ERRO`, pode vir `error_message`.

## 5. Quando algo dá errado

| Resposta do Supabase | O que a API entende | Efeito |
| --- | --- | --- |
| Sem resposta, erro de rede ou HTTP 5xx | Supabase fora do ar | A rodada para. Nada se perde e **nenhuma tentativa é gasta**. Tenta de novo em 10 segundos |
| HTTP 401, 403, 404, 408 ou 429 | Chave errada, função não encontrada ou limite de uso | Igual ao caso acima: é problema de configuração, não da mensagem |
| HTTP 400 ou 422 | O lote inteiro foi recusado | Cada mensagem do lote gasta uma tentativa |
| HTTP 200 com `rejected` | Só aquela mensagem não serve | Para de tentar aquela mensagem e mostra o motivo |

O gestor acompanha pela API: `GET /api/v1/sync/status`, `GET /api/v1/sync/problems` e `POST /api/v1/sync/retry`.

## 6. O que preciso do lado do Supabase

1. **O endereço da função de recebimento**, para configurar em `SUPABASE_IOT_URL`.
2. **A chave `service_role`**, colocada direto no `.env` do servidor por quem tem acesso (nunca por mensagem).
3. **As três operações** da seção 3. Se os nomes das operações ou dos campos precisarem ser outros, por causa das tabelas que já existem aí, me diga quais são e eu ajusto a API.
4. **As tabelas do lacre que já existem** (dispositivo e comando): os nomes e as colunas, para eu conferir se o que a API envia cobre tudo.

## 7. Como foi testado

Ainda não houve teste contra o Supabase de verdade, porque a função de recebimento não existe no repositório. A API foi testada com um **recebedor de teste** (`src/simulador/recebedor.ts`), que segue exatamente este contrato:
- `npm test`: 71 casos, incluindo Supabase fora do ar, chave recusada, mensagem recusada, mensagem sem resposta, reenvio sem duplicar e lotes;
- `npm run simular`: o percurso completo de um lacre, com 23 verificações.

O primeiro teste de verdade será com a função do Supabase no ar.

## 8. Histórico do documento

| Versão | Data | Mudança |
| --- | --- | --- |
| 1.0 | 10/10/2026 | Primeira versão, depois da decisão de usar o Supabase como banco principal, com envio pela API REST por uma função de recebimento |
