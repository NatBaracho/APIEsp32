# ESP32 - Como enviar dados para a API e armazenamento no SQLite

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

A persistência acontece no banco SQLite via backend. O banco tem tabelas como:

- `devices` — tabela de cadastro dos dispositivos conectados. Aqui ficam os identificadores, chaves de acesso e status do equipamento.
- `events` — tabela de eventos do sistema. Serve para registrar ocorrências e alterações do módulo, como startup, falhas, alarmes e mensagens de status.
- `telemetry_queue` — tabela de telemetria. Aqui ficam os dados de medição, GPS, bateria, sinal e outros valores coletados em tempo real.

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
- Em termos de banco, essa chave fica na tabela `devices`, no campo `api_key`.
- O backend valida essa chave antes de aceitar os dados do ESP32.

A chave deve ser a do dispositivo cadastrado no banco, geralmente com o padrão:

```text
auto-DSP-000001
```

O header `X-API-Key` é exigido nos POSTs de telemetria e eventos. As rotas GET de dispositivos não usam esse middleware atualmente.
O GET de telemetrias também exige `X-API-Key`, pois retorna dados armazenados dos dispositivos.

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
  "last_seen_at": "2026-10-04T15:30:00.000Z"
}
```

### Regras

- `message_id` é obrigatório
- `device_id` é obrigatório
- `message_id` deve ser único para evitar duplicidade
- `device_id` deve corresponder a um dispositivo cadastrado
- campos como `latitude`, `longitude`, `speed_kmh`, `battery_percent` e `gsm_signal` são opcionais, mas devem ser enviados quando houver dados úteis
- `last_seen_at` é opcional e aceita data/hora em ISO 8601; a coluna SQLite tem tipo `DATETIME`
- uma mensagem aceita é salva em `telemetry_queue`
- se latitude e longitude forem iguais às da última telemetria do dispositivo, a API retorna `202` e atualiza `last_seen_at` sem criar outra linha
- se o mesmo `message_id` for enviado novamente, a API responde `409 Conflict` com `{"success":false,"message":"Mensagem duplicada"}` e não grava outra linha

### Resposta esperada quando tudo estiver correto

```json
{
  "success": true,
  "message": "Telemetria recebida"
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
  "seal_status": "closed"
}
```

### Regras

- `message_id` é obrigatório
- `device_id` é obrigatório
- `event_type` é obrigatório
- `message_id` duplicado é rejeitado pela API
- um evento repetido retorna `409 Conflict` e não cria outra linha em `events`

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

## 4. Estrutura recomendada para o firmware do ESP32

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

## 5. Exemplo em C++ para ESP32

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

    String payload;
    serializeJson(doc, payload);

    HTTPClient http;
    http.begin(apiUrl);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-API-Key", apiKey);

    int httpCode = http.POST(payload);

    if (httpCode == 409) {
      Serial.println("Mensagem duplicada; não foi gravada novamente");
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

## 6. O que será salvo no banco

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

## 7. Recomendação final para o firmware

O firmware do ESP32 deve seguir este padrão:

1. gerar um `message_id` único para cada envio
2. usar o `device_id` correto do equipamento
3. preencher os campos de métricas disponíveis
4. enviar por HTTP para a API
5. incluir `X-API-Key` no header
6. evitar repetir `message_id` para não disparar duplicidade

---

## 8. Resumo prático

Se o ESP32 for enviar dados de monitoramento, o payload ideal é:

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

Se o ESP32 for enviar um evento de status, o payload ideal é:

```json
{
  "message_id": "MSG-000002",
  "device_id": "DSP-000001"
}
```

Isso é o que a API aceita e o que será armazenado no banco SQLite.
