# ESP32 - Como enviar dados para a API e armazenamento no SQLite

> **Substituído (10/10/2026).** Os exemplos deste documento são do contrato antigo, em que posição e bateria eram opcionais. O contrato atual do lacre está em [Guia-Firmware-Lacre-IoT.md](Guia-Firmware-Lacre-IoT.md) (versão 2.0): posição e bateria obrigatórias e `gps_ok`.

> **Para quem programa o lacre:** o guia principal é o [Guia-Firmware-Lacre-IoT.md](Guia-Firmware-Lacre-IoT.md) (o que enviar, quando, o que fazer com cada resposta, fila sem rede e exemplo em C++). Este documento traz os exemplos detalhados de cada payload.

## Visão geral

Este documento foi criado para orientar a pessoa que está programando o módulo ESP32 sobre quais informações devem ser enviadas para a API, para que sejam armazenadas no banco SQLite pela aplicação backend.

A API recebe os dados do ESP32 e salva as informações em `oxide.db` por meio dos endpoints HTTP definidos no projeto.

A comunicação é feita por HTTP/JSON. Os endpoints de telemetria e eventos exigem que o ESP32 envie:

- header `X-API-Key` com a chave do dispositivo
- payload JSON com os campos esperados

## Estrutura da API

A API está versionada em `/api/v1` e possui os principais endpoints:

- `POST /api/v1/iot/telemetries` — envia dados de telemetria do dispositivo
- `GET /api/v1/iot/telemetries` — lista telemetrias, da mais recente para a mais antiga
- `POST /api/v1/iot/events` — envia eventos do sistema/dispositivo
- `GET /api/v1/devices` — lista dispositivos
- `GET /api/v1/devices/:deviceId` — consulta um dispositivo
- `GET /api/v1/iot/commands/:deviceId` — busca comandos pendentes do dispositivo
- `POST /api/v1/iot/commands/confirm` — confirma execução ou erro do comando
- `POST /api/v1/iot/alerts` — registra alerta para o dispositivo

A persistência acontece no banco SQLite via backend. O banco tem tabelas como:

- `devices` — tabela de cadastro dos dispositivos conectados. Aqui ficam os identificadores, chaves de acesso e status do equipamento.
- `devices.device_status_id`, `valve_status_id` e `seal_status_id` — IDs opcionais de estado do dispositivo, válvula e lacre; dispositivos antigos podem apresentar `NULL` até esses campos serem preenchidos.
- `events` — tabela de eventos do sistema. Serve para registrar ocorrências e alterações do módulo, como startup, falhas, alarmes e mensagens de status.
- `telemetry_queue` — tabela de telemetria. Aqui ficam os dados de medição, GPS, bateria, sinal e outros valores coletados em tempo real.
- `status` — catálogo de códigos e descrições para os estados do dispositivo e do lacre.
- `alerts` — alertas associados a um dispositivo; os tipos são os códigos em português do catálogo `Tipos-de-Erro.md` (ex.: `LACRE_VIOLADO`, `GPS_INATIVO`, `BATERIA_BAIXA`).

> Observação importante: quando o código fala em `device_id`, ele se refere ao identificador do equipamento que está enviando os dados; `message_id` é o identificador único da mensagem daquele envio; `X-API-Key` é a chave de autenticação do dispositivo para acessar a API.

---

## 1. Requisito obrigatório: chave da API

Cada POST de telemetria ou evento deve incluir o header:

```http
X-API-Key: abc123
```

### Comentário explicativo

- `X-API-Key` é a chave de autenticação do equipamento.
- Ela identifica quem está enviando os dados.
- Em termos de banco, essa chave fica na tabela `devices`: no campo `api_key` (cadastro provisório) ou só como hash em `api_key_hash` (cadastro oficial vindo do FluxID). **Para o firmware não muda nada:** ele sempre envia a chave em texto no header.
- O backend valida essa chave antes de aceitar os dados do ESP32.

A chave deve ser a **do próprio dispositivo** informado em `device_id`. Com a chave de outro dispositivo, a API responde `403` com `{"success":false,"message":"API Key não pertence ao dispositivo"}`.

O dispositivo precisa estar **cadastrado antes** de enviar dados. O cadastro oficial fica no FluxID, e o Worker o traz para a Oxide a cada 5 minutos. Quem cadastra no FluxID gera a chave e a passa para o firmware (o FluxID guarda só o hash). Para testes sem o FluxID, o cadastro provisório continua em `POST /api/v1/devices` com `device_id` e `api_key` (veja a seção 1.3 do [Desenvolvimento.md](Desenvolvimento.md)). Dispositivo não cadastrado recebe `404` com `{"success":false,"message":"Dispositivo não encontrado"}`; a API não cria dispositivos automaticamente.

O lacre e o cilindro do dispositivo também são cadastrados e vinculados pela equipe (rotas `/api/v1/seals`, `/api/v1/cylinders` e `/api/v1/assignments`, seção 1.3 do Desenvolvimento). O firmware **não precisa enviar** `lacre_id` nem `cilindro_id`: a API preenche esses campos pelo vínculo ativo e ignora o que vier no payload. Se o dispositivo enviar sem lacre vinculado, a telemetria é aceita normalmente e fica marcada com `error_type = DISPOSITIVO_SEM_LACRE` para a equipe corrigir o cadastro.

O header `X-API-Key` é exigido nos POSTs de telemetria e eventos. As rotas de dispositivos (`/api/v1/devices`) são abertas, mas não mostram a `api_key`: guarde a chave no momento do cadastro.
O GET de telemetrias também exige `X-API-Key`, pois retorna dados armazenados dos dispositivos.
As rotas de comandos exigem a chave do próprio dispositivo consultado ou informado na confirmação.
O registro de alertas também exige `X-API-Key` correspondente ao `device_id` enviado.

Se a chave não for enviada, a API responde com:

```json
{
  "success": false,
  "message": "API Key obrigatória"
}
```

Se a chave for inválida:

```json
{
  "success": false,
  "message": "API Key inválida"
}
```

---

## 2. Endpoint de telemetria

### URL

```http
POST http://<IP_DA_API>/api/v1/iot/telemetries
```

### Finalidade

Enviar dados em tempo real do ESP32, como:

- latitude
- longitude
- velocidade
- nível da bateria
- intensidade do sinal GSM
- identificador da mensagem
- identificador do dispositivo

### Campos obrigatórios

Para a telemetria, o payload deve ter, pelo menos:

```json
{
  "message_id": "MSG-000001",
  "device_id": "DSP-000001"
}
```

### Comentário explicativo de cada campo

- `message_id`: identificador único da mensagem enviada pelo ESP32. Esse valor nunca deve se repetir para a mesma operação. Na API, ele é usado para evitar duplicidade.
- `device_id`: identificador do equipamento que está enviando os dados. Esse valor deve bater com o registro existente na tabela `devices`.
- `latitude`: latitude do módulo, em caso de monitoramento móvel ou GPS.
- `longitude`: longitude do módulo.
- `speed_kmh`: velocidade em km/h.
- `battery_percent`: percentual da bateria.
- `gsm_signal`: intensidade do sinal de celular.
- `last_seen_at`: data/hora da última leitura, opcional e no formato ISO 8601; se omitido, fica `NULL` no SQLite.
- `seal_status`: estado do lacre do cilindro: `LOCKED` (fechado), `UNLOCKED` (aberto) ou `BROKEN` (rompido).
- `attempt_count`: quantas vezes o ESP32 já tentou enviar esta mensagem (inteiro ≥ 0); gravado em `device_attempt_count`.

> Em termos do banco, `message_id` e `device_id` são informações centrais para relacionar cada envio ao equipamento correto e ao evento/telemetria correspondente.

### Payload completo de exemplo

```json
{
  "message_id": "MSG-000001",
  "device_id": "DSP-000001",
  "latitude": -7.2091939,
  "longitude": -39.3063666,
  "speed_kmh": 21.98,
  "battery_percent": 57.33,
  "gsm_signal": -64,
  "last_seen_at": "2026-10-04T15:30:00.000Z",
  "seal_status": "LOCKED",
  "attempt_count": 1
}
```

### Regras

- `message_id` é obrigatório
- `device_id` é obrigatório
- `message_id` deve ser único para evitar duplicidade
- `device_id` deve corresponder a um dispositivo cadastrado; caso contrário a API responde `404` com `{"success":false,"message":"Dispositivo não encontrado"}`
- campos como `latitude`, `longitude`, `speed_kmh`, `battery_percent` e `gsm_signal` são opcionais, mas devem ser enviados quando houver dados úteis
- esses campos precisam ser números JSON (ex.: `-7.2091939`), não texto (`"-7.2091939"`); tipo inválido retorna `400` com `Campo <nome> com tipo inválido`
- `latitude` e `longitude` vão **juntas** (ou nenhuma, quando o GPS ainda não tem posição), com latitude entre -90 e 90 e longitude entre -180 e 180; fora disso a API responde `400`
- `seal_status`, quando enviado, deve ser `LOCKED`, `UNLOCKED` ou `BROKEN`; outro valor retorna `400`
- `attempt_count`, quando enviado, deve ser inteiro ≥ 0; outro valor retorna `400`
- não envie `status`: o estado da fila (`PENDING`, `SYNCED`...) é controlado pelo servidor; o estado do lacre vai em `seal_status`
- `last_seen_at` é opcional e aceita data/hora em ISO 8601; a coluna SQLite tem tipo `DATETIME`
- uma mensagem aceita é salva em `telemetry_queue`
- se latitude, longitude e `seal_status` forem iguais aos da última telemetria do dispositivo, a API retorna `200` com `{"success":true,"message":"Posição já registrada; data e hora atualizadas"}` e atualiza só `last_seen_at`, sem criar outra linha
- se o lacre mudar de estado no mesmo lugar (ex.: `LOCKED` → `BROKEN`), a API grava uma nova linha e retorna `202`
- se o mesmo `message_id` for enviado novamente, inclusive o de uma posição repetida, a API responde `409 Conflict` com `{"success":false,"message":"Mensagem duplicada"}` e não grava outra linha

### Resposta esperada quando tudo estiver correto

```json
{
  "success": true,
  "message": "Telemetria recebida"
}
```

### Resposta quando a posição já existe

Status HTTP: `200 OK`.

```json
{
  "success": true,
  "message": "Posição já registrada; data e hora atualizadas"
}
```

### Resposta esperada em caso de erro de validação

```json
{
  "success": false,
  "message": "message_id e device_id são obrigatórios"
}
```

### Resposta para mensagem duplicada

```json
{
  "success": false,
  "message": "Mensagem duplicada"
}
```

---

## 3. Endpoint de eventos

### URL

```http
POST http://<IP_DA_API>/api/v1/iot/events
```

### Finalidade

Enviar eventos do sistema ou do módulo ESP32, como:

- inicialização do equipamento
- falha de sensor
- reinicialização
- ativação de alarme
- mudança de estado
- sincronização

### Campos obrigatórios

O evento deve incluir `message_id`, `device_id` e `event_type`:

```json
{
  "message_id": "EVT-000001",
  "device_id": "DSP-000001",
  "event_type": "door_open"
}
```

### Comentário explicativo

- `message_id` funciona como chave de identificação do evento.
- `device_id` liga o evento ao equipamento correto na tabela `devices`.
- `event_type` descreve o tipo de ocorrência.
- Os eventos ficam na tabela `events`, e são usados para registrar ocorrências e mudanças de estado do módulo.
- Se o mesmo `message_id` for enviado novamente, a API entende como mensagem duplicada e bloqueia a gravação.

### Exemplo de evento válido

```json
{
  "message_id": "EVT-000002",
  "device_id": "DSP-000001",
  "event_type": "sensor_failure",
  "seal_status": "LOCKED"
}
```

### Regras

- `message_id` é obrigatório
- `device_id` é obrigatório
- `event_type` é obrigatório
- quando informado, `seal_status` deve ser `LOCKED`, `UNLOCKED` ou `BROKEN`; o campo é gravado em `events.seal_status`
- quando informado, `attempt_count` (tentativas de envio do ESP32) deve ser inteiro ≥ 0 e é gravado em `events.device_attempt_count`
- `message_id` duplicado é rejeitado pela API
- um evento repetido retorna `409 Conflict` e não cria outra linha em `events`

`ACTIVE` e `INACTIVE` descrevem o estado do dispositivo e correspondem a `devices.active = 1` e `devices.active = 0`. Não use esses dois códigos em `seal_status`. O campo `events.status` é definido pelo servidor e registra o processamento da fila (`PENDING`, `PROCESSING`, `SYNCED` ou `ERROR`); não o envie no payload do evento.

O catálogo `status` existe para manter código, nome e descrição consistentes. Ele é separado do campo `events.status` porque esse campo já controla a fila de sincronização; o estado do lacre é enviado em `seal_status`.

### Resposta de evento duplicado

Status HTTP: `409 Conflict`.

```json
{
  "success": false,
  "message": "Mensagem duplicada"
}
```

### Resposta bem-sucedida

```json
{
  "success": true,
  "message": "Evento recebido"
}
```

---

### Registrar alerta

```http
POST http://<IP_DA_API>/api/v1/iot/alerts
X-API-Key: auto-DSP-000001
Content-Type: application/json
```

```json
{
  "alert_id": "ALT-000001",
  "device_id": "DSP-000001",
  "alert_type": "LACRE_VIOLADO",
  "severity": "CRITICA",
  "title": "Lacre rompido",
  "description": "Alerta enviado pelo dispositivo"
}
```

Os tipos aceitos são os 28 códigos em português do catálogo [Tipos-de-Erro.md](Tipos-de-Erro.md). Os mais usados pelo firmware: `LACRE_VIOLADO`, `GPS_INATIVO`, `BATERIA_BAIXA`, `DISPOSITIVO_FALHA` e `GSM_SINAL_FRACO`. Outro valor retorna `400`. **Transição:** firmwares que ainda mandam `SEAL_BROKEN`, `GEOFENCE_EXIT`, `LOW_BATTERY`, `DEVICE_ERROR`, `COMMAND_FAILURE` ou `COMMUNICATION_LOST` continuam funcionando, e a API grava o código em português; atualize o firmware quando puder. `severity` é opcional e aceita `BAIXA`, `MEDIA`, `ALTA` ou `CRITICA`; sem ela, vale a severidade sugerida no catálogo. O alerta nasce sempre com `status` `ABERTO`. Firmwares antigos que ainda enviam `status_id` e `severity_id` continuam funcionando: esses campos são ignorados.

Em caso de sucesso, a API retorna `201 Created` com o alerta criado:

```json
{
  "success": true,
  "alert": {
    "id": 1,
    "alert_id": "ALT-000001",
    "device_id": "DSP-000001",
    "alert_type": "LACRE_VIOLADO",
    "severity": "CRITICA",
    "status": "ABERTO",
    "title": "Lacre rompido",
    "description": "Alerta enviado pelo dispositivo",
    "created_at": "2026-10-05 00:00:00",
    "resolved_at": null,
    "resolved_by": null,
    "resolution_note": null
  }
}
```

O envio de alertas foi validado por requisição HTTP, com os códigos em português e com os nomes antigos convertidos: a API respondeu `201` e o alerta foi confirmado no SQLite. A análise e o encerramento do alerta são feitos pelo gestor (`PATCH /api/v1/iot/alerts/{alert_id}/status`), não pelo firmware.

## 4. Estrutura recomendada para o firmware do ESP32

### Consultar comandos pendentes

```http
GET http://<IP_DA_API>/api/v1/iot/commands/DSP-000001
X-API-Key: auto-DSP-000001
```

A resposta é uma lista em ordem de criação. Comandos confirmados deixam de ser retornados. O campo `command_type` é sempre `TRAVAR_VALVULA` ou `DESTRAVAR_VALVULA`: o firmware deve reconhecer exatamente esses nomes.

### Confirmar comando executado

```http
POST http://<IP_DA_API>/api/v1/iot/commands/confirm
X-API-Key: auto-DSP-000001
Content-Type: application/json
```

```json
{
  "command_id": "CMD-000001",
  "device_id": "DSP-000001",
  "status": "EXECUTADO"
}
```

Em caso de falha, envie `status: "ERRO"` e, opcionalmente, `error_message`. Os únicos estados aceitos na confirmação são `EXECUTADO` e `ERRO`.

Os tipos de erro e ocorrências que a equipe usa (lacre violado, GPS sem sinal, saída de rota etc.) estão no catálogo [Tipos-de-Erro.md](Tipos-de-Erro.md).

---

## 5. Estrutura recomendada para o firmware do ESP32

A pessoa que estiver programando o ESP32 deve enviar dados em JSON no seguinte padrão:

### Telemetria em tempo real

```json
{
  "message_id": "MSG-000001",
  "device_id": "DSP-000001",
  "latitude": -7.2091939,
  "longitude": -39.3063666,
  "speed_kmh": 21.98,
  "battery_percent": 57.33,
  "gsm_signal": -64
}
```

### Evento de status

```json
{
  "message_id": "EVT-000002",
  "device_id": "DSP-000001",
  "event_type": "sensor_failure"
}
```

---

## 6. Exemplo em C++ para ESP32

Abaixo está um exemplo de como o ESP32 pode montar o JSON e enviar para a API usando HTTP:

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <stdint.h>

const char *wifiSSID = "SUA_REDE";
const char *wifiPassword = "SUA_SENHA";
const char *apiUrl = "http://192.168.0.10:3000/api/v1/iot/telemetries";
const char *apiKey = "abc123";
uint32_t messageSequence = 0;

void setup() {
  Serial.begin(115200);

  WiFi.begin(wifiSSID, wifiPassword);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("WiFi conectado");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    StaticJsonDocument<256> doc;

    String messageId = "MSG-ESP32-" + String(++messageSequence);
    doc["message_id"] = messageId;
    doc["device_id"] = "DSP-000001";
    doc["latitude"] = -7.2091939;
    doc["longitude"] = -39.3063666;
    doc["speed_kmh"] = 21.98;
    doc["battery_percent"] = 57.33;
    doc["gsm_signal"] = -64;
    doc["seal_status"] = "LOCKED";  // LOCKED, UNLOCKED ou BROKEN, conforme o sensor do lacre
    doc["attempt_count"] = 1;       // incrementar a cada reenvio da mesma mensagem

    String payload;
    serializeJson(doc, payload);

    HTTPClient http;
    http.begin(apiUrl);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-API-Key", apiKey);

    int httpCode = http.POST(payload);

    if (httpCode == 202) {
      Serial.println("Telemetria gravada");
    } else if (httpCode == 200) {
      Serial.println("Posição já registrada; data e hora atualizadas");
    } else if (httpCode == 409) {
      Serial.println("Mensagem duplicada; não foi gravada novamente");
    } else if (httpCode == 400 || httpCode == 404) {
      // Erro no payload ou dispositivo não cadastrado: reenviar não resolve
      Serial.println(http.getString());
    } else if (httpCode > 0) {
      String response = http.getString();
      Serial.println(response);
    } else {
      Serial.println("Erro ao enviar dados");
    }

    http.end();
  }

  delay(60000);
}
```

O exemplo incrementa a sequência durante a execução. Em firmware de produção, mantenha o identificador único também após reinicializações (por exemplo, com sequência persistida em NVS). Em caso de retry da mesma leitura, reutilize o mesmo `message_id`; gere outro somente para uma nova mensagem.

---

## 7. O que será salvo no banco

A API recebe os dados do ESP32 e salva a informação no SQLite, na tabela principal de telemetria e/ou eventos.

### Comentário de nomenclatura do banco

- `devices`: representa cada equipamento conectado. É onde ficam o `device_id` e o `api_key`.
- `events`: representa registros de eventos e ocorrências do módulo, como inicialização, falha, alarme, mudança de estado e sincronização.
- `telemetry_queue`: representa dados de monitoramento e leitura contínua do equipamento, como GPS, velocidade, nível da bateria e potência do sinal.
- `message_id`: identifica cada mensagem de forma única para evitar duplicidade na gravação.
- `X-API-Key`: chave de autenticação enviada no header; ela é validada antes que qualquer dado seja salvo.

Telemetrias aceitas são inseridas em `telemetry_queue` e eventos em `events`. A restrição única no SQLite complementa a verificação dos services para impedir duplicatas mesmo na persistência.

Em termos práticos, para o desenvolvedor do ESP32, o que importa é saber que ele deve enviar:

- `message_id`: identificador único da mensagem
- `device_id`: identificador do equipamento
- valores de sensores ou localização que forem relevantes para o monitoramento

Esses dados são enviados pela API para o banco de dados e ficam armazenados para consulta, análise e sincronização posterior.

---

## 8. Recomendação final para o firmware

O firmware do ESP32 deve seguir este padrão:

1. gerar um `message_id` único para cada envio
2. usar o `device_id` correto do equipamento
3. preencher os campos de métricas disponíveis
4. enviar por HTTP para a API
5. incluir `X-API-Key` no header
6. evitar repetir `message_id` para não disparar duplicidade
7. tratar cada código de resposta conforme a tabela da seção 1.5 do [Desenvolvimento.md](Desenvolvimento.md): `200`, `202` e `409` são sucesso; `400`, `401`, `403` e `404` não devem ser reenviados; `500` ou falta de resposta são reenviados com o mesmo `message_id` e `attempt_count + 1`

---

## 9. Resumo prático

Se o ESP32 for enviar dados de monitoramento, o payload ideal é:

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

Se o ESP32 for enviar um evento de status, o payload ideal é (o `event_type` é obrigatório; sem ele, a API responde `400`):

```json
{
  "message_id": "EVT-000002",
  "device_id": "DSP-000001",
  "event_type": "seal_changed",
  "seal_status": "BROKEN"
}
```

Isso é o que a API aceita e o que será armazenado no banco SQLite.
