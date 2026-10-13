# ESP32 — Como enviar dados para a API

**Versão:** 2.3, de 12/10/2026.

> **Para quem programa o lacre:** o guia principal é o [Guia-Firmware-Lacre-IoT.md](Guia-Firmware-Lacre-IoT.md) (quando enviar cada coisa, fila sem rede e como ligar o envio no firmware). Este documento é o complemento: traz o exemplo de cada mensagem, campo por campo, e de cada resposta.

## Visão geral

O lacre (ESP32) envia dados à API por HTTP, em JSON. A API confere a chave do dispositivo, valida a mensagem, guarda numa fila local (`oxide.db`) e a entrega ao banco principal (Supabase).

Toda mensagem do lacre precisa de:

- o cabeçalho `X-API-Key`, com a chave do próprio dispositivo;
- o cabeçalho `Content-Type: application/json`;
- `device_id`, `latitude`, `longitude` e `battery_percent` no corpo.

O lacre **não envia** o cilindro nem o cliente. O sistema faz esse vínculo pelo identificador do lacre, que a API gera na ativação (seção 2).

## Rotas

Todas começam com `http://<IP_DA_API>:3000/api/v1`.

- **A porta é a 3000** (muda com `PORT` no arquivo `.env` do servidor).
- `<IP_DA_API>` é o IP do computador onde a API está ligada, por exemplo `192.168.0.10`. No Windows, ele aparece com o comando `ipconfig`, na linha "Endereço IPv4". O lacre precisa estar na mesma rede.
- `localhost` só funciona no próprio computador da API; no firmware, use o IP.
- Para conferir antes de gravar o firmware: abrir `http://<IP_DA_API>:3000` no navegador deve mostrar "API ESP32 Online", e `http://<IP_DA_API>:3000/api-docs` abre a documentação interativa.

| Rota | Para quê | Seção |
| --- | --- | --- |
| `POST /iot/activations` | Avisar que o lacre foi ativado ou desativado | 2 |
| `POST /iot/telemetries` | Leitura periódica: posição, bateria, sinal e estado do lacre | 3 |
| `POST /iot/events` | Avisar que algo aconteceu | 4 |
| `POST /iot/alerts` | Avisar de um problema identificado pelo lacre | 5 |
| `GET /iot/commands/{device_id}` | Buscar comandos de válvula pendentes | 6 |
| `POST /iot/commands/confirm` | Confirmar o comando executado | 6 |

Rotas para a equipe acompanhar os testes (exigem a chave de administrador, `X-Admin-Key`; não são para o firmware): `GET /iot/messages`, `GET /devices` e `GET /devices/{device_id}`.

Deixaram de existir: `GET /iot/telemetries` (a consulta agora é `GET /iot/messages?type=TELEMETRIA`) e as rotas de lacres, cilindros e vínculos.

---

## 1. Chave do dispositivo

```http
X-API-Key: <chave do dispositivo>
```

O firmware sempre envia a chave em texto, no cabeçalho. A chave e o `device_id` têm de ser do **mesmo** dispositivo.

### 1.1 De onde vem a chave

- **Lacre em uso:** o dispositivo é cadastrado no sistema principal. Quem cadastra gera a chave e a entrega uma única vez, para gravar no firmware; o sistema guarda só o hash. O Worker traz o cadastro para a API a cada 5 minutos.
- **Teste de bancada:** a equipe cadastra o dispositivo direto na API e escolhe a chave (seção 1.2).

| Pergunta | Resposta |
| --- | --- |
| A API gera a chave do dispositivo? | Não. Quem cadastra escolhe a chave e a envia no campo `api_key` |
| Dá para ver a chave no banco? | Não. A Oxide guarda só o hash. O texto `sem-chave-em-texto:...` da coluna `api_key` é um marcador: não é a chave e não autentica |
| Perdi a chave. Dá para recuperar? | Não. Cadastre um dispositivo novo, com outra chave, e grave no lacre |
| Dá para trocar a chave de um dispositivo que já existe? | Pela API, não: `POST /devices` com um `device_id` repetido responde `409`. A troca é feita no cadastro do sistema principal, e o Worker a traz |
| A chave de administrador serve para o lacre? | Não. `X-Admin-Key` é da equipe; o lacre usa `X-API-Key`, a chave do próprio dispositivo |

### 1.2 Cadastrar um dispositivo de teste com uma chave conhecida

1. Gere uma chave forte, no terminal do computador da API:

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```

2. Com a API ligada, cadastre o dispositivo. É preciso a chave de administrador (`X-Admin-Key`), que está no `.env` do servidor:

   ```http
   POST http://<IP_DA_API>:3000/api/v1/devices
   X-Admin-Key: <chave de administrador>
   Content-Type: application/json

   { "device_id": "DSP-TESTE-01", "api_key": "<a chave gerada no passo 1>", "firmware_version": "1.0.0" }
   ```

   Resposta esperada: `201`.

3. Grave no firmware o `device_id` e a chave do passo 1. **Anote a chave nessa hora:** depois do cadastro ela não aparece mais em lugar nenhum.

No banco do projeto já existe o dispositivo de teste `DSP-ESP32-01`, cadastrado em 12/10/2026. A chave dele foi entregue a quem programa o firmware e não está em nenhum documento.

### 1.3 Antes do primeiro envio

- **API ligada:** `npm start` (ou `npm run servico`) no computador da API.
- **Mesma rede:** o lacre precisa estar na mesma rede do computador da API.
- **IP certo:** `<IP_DA_API>` é o "Endereço IPv4" que aparece no comando `ipconfig`. Ele pode mudar quando o roteador reinicia.
- **Firewall do Windows:** a porta 3000 precisa estar liberada para entrada. Num terminal aberto como administrador: `netsh advfirewall firewall add rule name="API do lacre 3000" dir=in action=allow protocol=TCP localport=3000`.
- **Teste rápido:** abrir `http://<IP_DA_API>:3000` no navegador de um celular na mesma rede deve mostrar "API ESP32 Online". Se não abrir, o problema é a rede ou o firewall, não o firmware.

### 1.4 Respostas da conferência da chave

| Situação | Resposta |
| --- | --- |
| Sem o cabeçalho | `401` `{"success":false,"message":"API Key obrigatória"}` |
| Chave que não existe | `401` `{"success":false,"message":"API Key inválida"}` |
| Dispositivo desativado | `403` `{"success":false,"message":"Dispositivo desativado"}` |
| Chave de outro dispositivo | `403` `{"success":false,"message":"API Key não pertence ao dispositivo"}` |
| `device_id` não cadastrado | `404` `{"success":false,"message":"Dispositivo não encontrado"}` |
| Sem `device_id` | `400` `{"success":false,"message":"device_id é obrigatório"}` |

A API não cria dispositivo sozinha.

---

## 2. Ativação — `POST /iot/activations`

O lacre avisa que está **ativo** (ligado e pronto) ou que foi **desativado**. É por este aviso que o sistema sabe quais lacres estão ativos e pode vincular o cilindro e o cliente.

```json
{
  "message_id": "ATV-DSP000001-000001",
  "device_id": "DSP-000001",
  "status": "ATIVO",
  "latitude": -7.2091939,
  "longitude": -39.3063666,
  "gps_ok": true,
  "battery_percent": 97
}
```

| Campo | Obrigatório | Regra |
| --- | --- | --- |
| `message_id` | Sim | Único por mensagem |
| `device_id` | Sim | O código cadastrado |
| `status` | Sim | `ATIVO` ou `INATIVO` |
| `latitude`, `longitude`, `battery_percent` | Sim | Como na leitura (seção 3) |

Resposta `202`:

```json
{ "success": true, "message": "Lacre ativado", "activation_status": "ATIVO", "seal_code": "LCR-JKFL6VBR" }
```

- `seal_code` é o **identificador do lacre**. A API o gera na primeira ativação e ele nunca muda. O firmware pode guardar, mas não precisa enviar em nenhuma mensagem.
- Envie `ATIVO` toda vez que o lacre ligar ou reiniciar. Repetir não cria outro identificador.
- Envie `INATIVO` só no desligamento de propósito (fim de uso). Isso encerra o vínculo com o cilindro e o cliente. Queda de energia não precisa avisar.

| Situação | Resposta |
| --- | --- |
| `status` diferente de `ATIVO` e `INATIVO` | `400` `{"success":false,"message":"status deve ser ATIVO ou INATIVO"}` |
| Sem posição ou sem bateria | `400` `{"success":false,"message":"latitude, longitude e battery_percent são obrigatórios"}` |
| Mesmo `message_id` de novo | `409` `{"success":false,"message":"Mensagem duplicada"}` (tratar como sucesso) |

---

## 3. Leitura (telemetria) — `POST /iot/telemetries`

### Mínimo aceito

```json
{
  "message_id": "MSG-000001",
  "device_id": "DSP-000001",
  "latitude": -7.2091939,
  "longitude": -39.3063666,
  "battery_percent": 57.33
}
```

### Exemplo completo

```json
{
  "message_id": "MSG-000001",
  "device_id": "DSP-000001",
  "latitude": -7.2091939,
  "longitude": -39.3063666,
  "gps_ok": true,
  "battery_percent": 57.33,
  "seal_status": "LOCKED",
  "speed_kmh": 21.98,
  "gsm_signal": -64,
  "satelites": 9,
  "hdop": 0.9,
  "device_state": "OPERACIONAL",
  "attempt_count": 1
}
```

### Campos

| Campo | Obrigatório | Regra |
| --- | --- | --- |
| `message_id` | **Sim** | Único por mensagem. No reenvio da mesma leitura, use o mesmo |
| `device_id` | **Sim** | O código cadastrado |
| `latitude`, `longitude` | **Sim** | Números. Latitude de -90 a 90; longitude de -180 a 180 |
| `battery_percent` | **Sim** | Número de 0 a 100 |
| `gps_ok` | Não | `true` ou `false`. Sem sinal de GPS, envie a **última posição conhecida** com `gps_ok: false`. Padrão: `true` |
| `seal_status` | Recomendado | `LOCKED` (fechado), `UNLOCKED` (aberto) ou `BROKEN` (rompido) |
| `speed_kmh` | Não | Velocidade em km/h |
| `gsm_signal` | Não | Força do sinal de rede, em dBm (ex.: `-64`) |
| `satelites` | Não | Quantidade de satélites (também aceito como `satellites`) |
| `hdop` | Não | Precisão do GPS |
| `device_state` | Não | Texto com o estado do firmware (ex.: `OPERACIONAL`) |
| `attempt_count` | Recomendado | Inteiro maior ou igual a 0: em qual tentativa de envio a mensagem está |

- Os números vão como número JSON (`-7.2091939`), não como texto (`"-7.2091939"`).
- Não envie `status`, `last_seen_at`, `lacre_id` nem `cilindro_id`: esses dados são do servidor.

### Respostas

| Situação | Resposta |
| --- | --- |
| Leitura nova | `202` `{"success":true,"message":"Telemetria recebida"}` |
| Mesma posição e mesmo estado do lacre da leitura anterior | `200` `{"success":true,"message":"Posição já registrada; data e hora atualizadas"}` |
| Mesmo `message_id` de novo | `409` `{"success":false,"message":"Mensagem duplicada"}` |
| Sem `message_id` ou sem `device_id` | `400` `{"success":false,"message":"message_id e device_id são obrigatórios"}` |
| Sem posição ou sem bateria | `400` `{"success":false,"message":"latitude, longitude e battery_percent são obrigatórios"}` |
| Número enviado como texto | `400` `{"success":false,"message":"Campo latitude com tipo inválido"}` |
| Posição fora da faixa | `400` `{"success":false,"message":"latitude deve estar entre -90 e 90 e longitude entre -180 e 180"}` |
| Bateria fora da faixa | `400` `{"success":false,"message":"battery_percent deve estar entre 0 e 100"}` |
| `seal_status` desconhecido | `400` `{"success":false,"message":"seal_status deve ser LOCKED, UNLOCKED ou BROKEN"}` |

**Lacre parado.** Com a mesma posição, o mesmo `gps_ok` e o mesmo `seal_status` da leitura anterior, a API não cria outra linha: atualiza só a data e a hora da anterior e responde `200`. Se o lacre mudar de estado no mesmo lugar (por exemplo, `LOCKED` para `BROKEN`), a API grava uma leitura nova e responde `202`.

---

## 4. Evento — `POST /iot/events`

```json
{
  "message_id": "EVT-000002",
  "device_id": "DSP-000001",
  "event_type": "seal_changed",
  "seal_status": "BROKEN",
  "latitude": -7.2091939,
  "longitude": -39.3063666,
  "battery_percent": 86
}
```

| Campo | Obrigatório | Regra |
| --- | --- | --- |
| `event_type` | **Sim** | Texto com o tipo do evento. Exemplos: `startup`, `seal_changed`, `hardware_failure`, `sensor_failure` |
| `description` | Não | Texto livre |
| Demais campos | — | Os mesmos da leitura; posição e bateria continuam obrigatórias |

| Situação | Resposta |
| --- | --- |
| Evento recebido | `202` `{"success":true,"message":"Evento recebido"}` |
| Sem `event_type` | `400` `{"success":false,"message":"message_id, device_id e event_type são obrigatórios"}` |
| Mesmo `message_id` de novo | `409` `{"success":false,"message":"Mensagem duplicada"}` |

---

## 5. Alerta — `POST /iot/alerts`

Para problema que o próprio lacre identifica.

```json
{
  "alert_id": "ALT-000001",
  "device_id": "DSP-000001",
  "alert_type": "GPS_INATIVO",
  "title": "GPS não responde",
  "description": "Módulo GPS sem resposta há 2 minutos",
  "latitude": -7.2091939,
  "longitude": -39.3063666,
  "gps_ok": false,
  "battery_percent": 86
}
```

| Campo | Obrigatório | Regra |
| --- | --- | --- |
| `alert_id` | **Sim** | Único por alerta (faz o papel do `message_id`) |
| `alert_type` | **Sim** | Um código do catálogo [Tipos-de-Erro.md](Tipos-de-Erro.md). Outro valor: `400` |
| `title` | **Sim** | Texto curto |
| `severity` | Não | `BAIXA`, `MEDIA`, `ALTA` ou `CRITICA`. Sem ela, vale a do catálogo |
| `description` | Não | Texto livre |
| Posição e bateria | **Sim** | Como na leitura |

Resposta `201`:

```json
{
  "success": true,
  "message": "Alerta registrado",
  "alert": { "alert_id": "ALT-000001", "alert_type": "GPS_INATIVO", "severity": "ALTA", "title": "GPS não responde", "description": "Módulo GPS sem resposta há 2 minutos" }
}
```

Mesmo `alert_id` de novo: `409` `{"success":false,"message":"Alerta duplicado"}` (tratar como sucesso).

**Alertas que o firmware não precisa enviar.** A API abre sozinha, a partir das mensagens:

| Alerta | Quando |
| --- | --- |
| `BATERIA_BAIXA` | `battery_percent` cai abaixo de 15 |
| `GSM_SINAL_FRACO` | `gsm_signal` cai abaixo de -105 |
| `LACRE_VIOLADO` | `seal_status` passa a `BROKEN` |
| `LACRE_ABERTO_SEM_AUTORIZACAO` | `seal_status` passa a `UNLOCKED` |
| `LACRE_SEM_CILINDRO` | O lacre está ativo e continua enviando sem cilindro vinculado, 10 minutos depois da ativação |

Se o firmware mandar esses também, o alerta fica duplicado.

Firmwares antigos que ainda mandam `SEAL_BROKEN`, `GEOFENCE_EXIT`, `LOW_BATTERY`, `DEVICE_ERROR`, `COMMAND_FAILURE` ou `COMMUNICATION_LOST` continuam funcionando: a API grava o código em português. Atualize o firmware quando puder.

A análise e o encerramento dos alertas são feitos no sistema principal, não na API.

---

## 6. Comandos de válvula

### Buscar os pendentes

```http
GET http://<IP_DA_API>:3000/api/v1/iot/commands/DSP-000001
X-API-Key: <chave do dispositivo>
```

Resposta `200`, com uma lista na ordem de criação (lista vazia = nada a fazer):

```json
[ { "command_id": "CMD-000001", "device_id": "DSP-000001", "command_type": "TRAVAR_VALVULA", "status": "PENDENTE" } ]
```

`command_type` é sempre `TRAVAR_VALVULA` ou `DESTRAVAR_VALVULA`.

### Confirmar

```http
POST http://<IP_DA_API>:3000/api/v1/iot/commands/confirm
```

```json
{ "command_id": "CMD-000001", "device_id": "DSP-000001", "status": "EXECUTADO" }
```

Se falhar: `"status": "ERRO"` e, se quiser, `"error_message": "motor não respondeu"`.

| Situação | Resposta |
| --- | --- |
| Confirmado | `200` |
| Comando que não existe para este dispositivo | `404` |
| Comando já confirmado | `409` (tratar como sucesso) |
| `status` diferente de `EXECUTADO` e `ERRO` | `400` |

Os comandos são criados no sistema principal. Não existe rota para o lacre criar comando.

---

## 7. O que fazer com cada resposta

| Resposta | Significado | O que o firmware faz |
| --- | --- | --- |
| `200`, `201`, `202` | Recebido | Segue em frente |
| `409` | A API já tinha a mensagem | Dá por entregue; não reenvia |
| `400` | Mensagem incompleta ou com valor inválido | Não reenvia igual: é erro do firmware |
| `401`, `403`, `404` | Chave ou cadastro | Não insiste; conferir a chave e o cadastro |
| `413` | Corpo acima de 32 KB | Não reenvia igual; reduzir o conteúdo |
| `429` | Passou de 120 mensagens por minuto, ou o endereço errou a chave vezes demais | Espera os segundos do cabeçalho `Retry-After` e envia de novo, com o mesmo `message_id` |
| `500` ou sem resposta | Falha da API ou da rede | Guarda e tenta de novo, com o **mesmo** `message_id` e `attempt_count + 1` |

---

## 8. Exemplo em C++ para ESP32

O exemplo avisa a ativação ao ligar e envia uma leitura por minuto. Os valores de GPS e de bateria estão fixos só para mostrar o formato.

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char *wifiSSID = "SUA_REDE";
const char *wifiPassword = "SUA_SENHA";
const char *apiBase = "http://192.168.0.10:3000/api/v1/iot";
const char *apiKey = "CHAVE_DO_DISPOSITIVO";
const char *deviceId = "DSP-000001";
uint32_t sequencia = 0;  // em produção, guardar na NVS para não repetir depois de reiniciar

// Envia o JSON e devolve o código HTTP (ou menor que zero, sem resposta)
int enviar(const char *rota, const String &payload, String *resposta = nullptr) {
  HTTPClient http;
  http.begin(String(apiBase) + rota);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", apiKey);
  int codigo = http.POST(payload);
  if (resposta && codigo > 0) *resposta = http.getString();
  http.end();
  return codigo;
}

// Campos que toda mensagem precisa ter
void camposComuns(JsonDocument &doc, const char *prefixo) {
  doc["message_id"] = String(prefixo) + "-DSP000001-" + String(++sequencia);
  doc["device_id"] = deviceId;
  doc["latitude"] = -7.2091939;     // do GPS; sem sinal, a última posição conhecida
  doc["longitude"] = -39.3063666;
  doc["gps_ok"] = true;             // false quando a posição é a última conhecida
  doc["battery_percent"] = 57.33;   // obrigatório
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(wifiSSID, wifiPassword);
  while (WiFi.status() != WL_CONNECTED) delay(500);

  // Ao ligar: avisa que o lacre está ativo
  StaticJsonDocument<256> doc;
  camposComuns(doc, "ATV");
  doc["status"] = "ATIVO";
  String payload, resposta;
  serializeJson(doc, payload);
  int codigo = enviar("/activations", payload, &resposta);
  if (codigo == 202) Serial.println(resposta);  // traz o seal_code, o identificador do lacre
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    StaticJsonDocument<384> doc;
    camposComuns(doc, "MSG");
    doc["seal_status"] = "LOCKED";  // LOCKED, UNLOCKED ou BROKEN, conforme o sensor
    doc["speed_kmh"] = 21.98;
    doc["gsm_signal"] = -64;
    doc["attempt_count"] = 1;       // somar 1 a cada reenvio da mesma mensagem

    String payload;
    serializeJson(doc, payload);
    int codigo = enviar("/telemetries", payload);

    if (codigo == 202 || codigo == 200 || codigo == 409) {
      Serial.println("Leitura entregue");
    } else if (codigo >= 400 && codigo < 500) {
      Serial.println("Recusada: conferir a mensagem, a chave e o cadastro");  // reenviar não resolve
    } else {
      Serial.println("Sem resposta: guardar e reenviar com o mesmo message_id");
    }
  }
  delay(60000);
}
```

---

## 9. O que fica guardado

| O quê | Onde |
| --- | --- |
| Toda mensagem do lacre (ativação, leitura, evento, alerta e confirmação de comando) | Tabela `mensagens`, a fila única. A coluna `tipo` diz o que é cada linha |
| Chave do dispositivo (só o hash), último estado, identificador do lacre e vínculo com o cilindro e o cliente | Tabela `devices` |
| Comandos de válvula | Tabela `commands` |

A API guarda as mensagens até o Worker entregá-las ao banco principal. O cadastro de lacres, cilindros e clientes fica só no banco principal. Detalhes: [Oxidedb.md](Oxidedb.md) e [Como-o-Sistema-se-Comporta.md](Como-o-Sistema-se-Comporta.md).

---

## 10. Resumo para o firmware

1. Ao ligar, avisar a ativação (`POST /iot/activations`, `status: "ATIVO"`).
2. Em toda mensagem, enviar `device_id`, `latitude`, `longitude` e `battery_percent`, com a chave no cabeçalho `X-API-Key`.
3. Gerar um `message_id` novo para cada mensagem nova; no reenvio, repetir o mesmo.
4. Sem sinal de GPS, enviar a última posição com `gps_ok: false`.
5. Informar o estado do lacre em `seal_status`; a API abre os alertas de lacre aberto ou rompido.
6. Buscar os comandos com frequência e confirmar cada um.
7. Tratar `200`, `201`, `202` e `409` como sucesso; não reenviar `400`, `401`, `403`, `404` e `413`; em `429`, esperar e reenviar; reenviar em `500` ou sem resposta.
8. Não insistir quando a chave for recusada (`401` ou `403`): muitas tentativas seguidas bloqueiam o endereço por até 1 minuto.

---

## 11. Histórico do documento

| Versão | Data | Mudança |
| --- | --- | --- |
| 1.x | até 07/10/2026 | Contrato antigo: posição e bateria opcionais, tabelas `telemetry_queue`, `events` e `alerts`, rotas de lacres e cilindros na API, cadastro no FluxID |
| 2.0 | 10/10/2026 | Reescrito para o contrato atual: posição e bateria obrigatórias, `gps_ok`, aviso de ativação com o identificador do lacre, fila única, alertas automáticos e Supabase como banco principal |
| 2.1 | 10/10/2026 | Porta (3000) e endereço da API explícitos na seção de rotas |
| 2.2 | 11/10/2026 | Respostas `429` e `413`; rotas da equipe com chave de administrador |
| 2.3 | 12/10/2026 | Seção 1 ampliada: de onde vem a chave do dispositivo, como cadastrar um dispositivo de teste com chave conhecida, o que conferir na rede antes do primeiro envio |
