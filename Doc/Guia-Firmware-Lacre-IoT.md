# Guia do firmware do lacre IoT (ESP32)

**Versão:** 2.0 — 10/10/2026 — **aprovado por Natã da Silva Baracho em 10/10/2026**
**Para:** quem programa o lacre IoT (repositório `fluxid-firmware`, ESP32-C3 em C++)
**Base:** API do lacre com a fila única e o envio ao Supabase

Este guia é o **contrato entre o lacre e o servidor**: o que o lacre envia, quando envia, o que recebe de volta e o que fazer com cada resposta. É tudo o que o firmware precisa saber. Para testar cada rota no navegador, use o Swagger: `http://<IP_DA_API>:3000/api-docs`.

> **O que mudou da versão 1.0 para a 2.0**
> - **Posição e bateria passaram a ser obrigatórias** em toda mensagem (leitura, evento e alerta).
> - Sem sinal de GPS, o lacre manda a **última posição conhecida** com `gps_ok: false`. Antes, mandava a leitura sem posição.
> - O servidor aceita `satelites` e `hdop`, que o firmware já lê.
> - O banco principal passou a ser o Supabase. Para o lacre nada muda: ele só fala com esta API.

---

## 1. Visão em uma página

```text
Lacre (ESP32: GPS + rede + sensor do lacre)
   │  HTTP + JSON, com a chave do dispositivo no cabeçalho X-API-Key
   ▼
API do lacre ──► fila local ──► Supabase (banco principal, telas, mapa, alertas)
   ▲
   └── comandos (travar/destravar a válvula) que o lacre busca e confirma
```

| O lacre faz | O servidor faz (o lacre **não** precisa) |
| --- | --- |
| Lê GPS, bateria e o estado do lacre | Sabe a que **lacre**, **cilindro** e **cliente** o dispositivo pertence (pelo cadastro) |
| Envia **leituras**, **eventos** e **alertas** | Abre sozinho os alertas de **bateria baixa**, **sinal fraco** e **lacre aberto ou rompido** |
| Busca e **confirma comandos** | Confere rota, geocerca e tempo sem comunicar (no sistema principal) |
| Guarda o que não conseguiu enviar e reenvia | Grava a data oficial e não duplica nada |

## 2. Antes do primeiro envio

1. **Cadastro do dispositivo.** É feito no sistema principal por quem administra. Ele gera a **chave** do dispositivo e a entrega **uma única vez**. O banco guarda só o hash: uma chave perdida não pode ser recuperada, só trocada.
2. **No firmware**, configure:

   | Item | Exemplo |
   | --- | --- |
   | Endereço da API | `http://<IP_DA_API>:3000/api/v1` |
   | `device_id` | `DSP-000001` (o código cadastrado) |
   | Chave | a recebida no cadastro (guardar em área protegida, ex.: NVS) |

3. **Para testar na bancada**, a equipe pode cadastrar um dispositivo provisório:

   ```http
   POST http://<IP_DA_API>:3000/api/v1/devices
   Content-Type: application/json

   { "device_id": "DSP-TESTE-01", "api_key": "chave-de-teste-01", "firmware_version": "1.0.0" }
   ```

## 3. Regras para todas as mensagens

| Regra | Detalhe |
| --- | --- |
| Formato | `POST` com `Content-Type: application/json` e `X-API-Key: <chave>` |
| Chave | Sempre a do **próprio** `device_id` do corpo. Chave de outro dispositivo → `403` |
| **Posição** | `latitude` e `longitude` **sempre**, como número. Sem elas → `400` |
| **Bateria** | `battery_percent` **sempre**, de 0 a 100. Sem ela → `400` |
| Sem sinal de GPS | Mande a **última posição válida** e `"gps_ok": false`. Com GPS, mande `true` ou não mande o campo |
| Números | Vão como **número** JSON, nunca como texto (`-7.21`, e não `"-7.21"`) |
| `message_id` | **Único por mensagem** (ex.: `MSG-DSP000001-000123`). Guarde a sequência em NVS, para não repetir depois de reiniciar |
| Reenvio | Reenvie a **mesma** mensagem, com o **mesmo** `message_id` e `attempt_count + 1`. Mensagem nova = `message_id` novo |
| Texto | Evite acentos nos valores (ex.: `startup`, `sensor_failure`) |

**Antes do primeiro sinal de GPS** (o lacre acabou de ligar e ainda não tem nenhuma posição): não há o que enviar. Espere a primeira posição válida. O firmware atual já faz isso.

## 4. As mensagens

### 4.1 Campos comuns (leitura, evento e alerta)

| Campo | Obrigatório | Regra |
| --- | --- | --- |
| `device_id` | **Sim** | O código cadastrado |
| `latitude`, `longitude` | **Sim** | Latitude de -90 a 90, longitude de -180 a 180 |
| `battery_percent` | **Sim** | Número de 0 a 100 |
| `gps_ok` | Não | `false` quando a posição é a última conhecida. Padrão: `true` |
| `seal_status` | Recomendado | `LOCKED` (fechado), `UNLOCKED` (aberto) ou `BROKEN` (rompido) |
| `satelites` | Não | Quantidade de satélites (também aceito como `satellites`) |
| `hdop` | Não | Precisão do GPS |
| `speed_kmh` | Não | Velocidade |
| `gsm_signal` | Não | Força do sinal de rede, em dBm (ex.: `-71`). Vale para GSM e para o RSSI do WiFi |
| `device_state` | Não | Estado do firmware (ex.: `OPERACIONAL`, `LACRE_ROMPIDO`, `ERRO`, `MANUTENCAO`) |
| `attempt_count` | Recomendado | Inteiro ≥ 0: em qual tentativa de envio esta mensagem está |

### 4.2 Leitura periódica — `POST /iot/telemetries`

```json
{
  "message_id": "MSG-DSP000001-000123",
  "device_id": "DSP-000001",
  "latitude": -7.209194,
  "longitude": -39.306367,
  "gps_ok": true,
  "battery_percent": 87,
  "seal_status": "LOCKED",
  "satelites": 9,
  "hdop": 0.9,
  "attempt_count": 1
}
```

Campo a mais: `message_id` (**obrigatório**).

Respostas:
- `202`: gravada;
- `200` "Posição já registrada": a posição e o estado do lacre são os mesmos da última leitura. O servidor só atualiza a data e a hora. Tratar como sucesso;
- `409`: mensagem já recebida.

### 4.3 Evento (algo aconteceu) — `POST /iot/events`

```json
{
  "message_id": "EVT-DSP000001-000045",
  "device_id": "DSP-000001",
  "event_type": "seal_changed",
  "seal_status": "BROKEN",
  "latitude": -7.209194,
  "longitude": -39.306367,
  "battery_percent": 86
}
```

Campos a mais: `message_id` e `event_type` (**obrigatórios**). Use em `event_type`:
- `seal_changed`: o estado do lacre mudou (mande o novo `seal_status`);
- `startup`: ligou ou reiniciou;
- `hardware_failure` ou `sensor_failure`: falha.

Respostas: `202` gravado; `409` mensagem já recebida.

### 4.4 Alerta (o lacre identificou um problema) — `POST /iot/alerts`

```json
{
  "alert_id": "ALT-DSP000001-000007",
  "device_id": "DSP-000001",
  "alert_type": "GPS_INATIVO",
  "title": "GPS nao responde",
  "latitude": -7.209194,
  "longitude": -39.306367,
  "gps_ok": false,
  "battery_percent": 80
}
```

| Campo a mais | Obrigatório | Regra |
| --- | --- | --- |
| `alert_id` | **Sim** | Único, como o `message_id` |
| `alert_type` | **Sim** | Um código do catálogo (seção 5) |
| `title` | **Sim** | Texto curto |
| `severity` | Não | `BAIXA`, `MEDIA`, `ALTA` ou `CRITICA`. Sem ela, vale a do catálogo |
| `description` | Não | Texto livre (ex.: leitura do sensor) |

Respostas: `201` criado; `409` "Alerta duplicado" (tratar como sucesso).

### 4.5 Comandos (travar e destravar a válvula)

1. **Buscar** os pendentes: `GET /iot/commands/DSP-000001` (com `X-API-Key`). Resposta `200` com uma lista, na ordem de criação:

   ```json
   [ { "command_id": "c0a8012e-...", "device_id": "DSP-000001", "command_type": "TRAVAR_VALVULA", "status": "PENDENTE" } ]
   ```

   `command_type` é sempre `TRAVAR_VALVULA` ou `DESTRAVAR_VALVULA`. Lista vazia = nada a fazer.

2. **Executar** e **confirmar**: `POST /iot/commands/confirm`

   ```json
   { "command_id": "c0a8012e-...", "device_id": "DSP-000001", "status": "EXECUTADO" }
   ```

   Se falhar: `"status": "ERRO"` e `"error_message": "motor nao respondeu"`.

   Respostas: `200` confirmado; `409` "Comando já confirmado" (tratar como sucesso); `404` comando não encontrado para este dispositivo.

A busca de comandos também conta como "o lacre está vivo". Busque com frequência.

## 5. Quando enviar o quê

| Situação no lacre | O que enviar |
| --- | --- |
| Funcionamento normal | **Leitura** periódica com `seal_status` |
| Ligou ou reiniciou | **Evento** `startup` |
| O lacre mudou de estado (fechou, abriu, rompeu) | **Evento** `seal_changed` com o novo `seal_status`. O servidor abre o alerta sozinho |
| GPS funcionando, mas sem sinal | **Leitura** com a última posição e `gps_ok: false` |
| Módulo GPS não responde | **Alerta** `GPS_INATIVO`, com a última posição e `gps_ok: false` |
| Falha de hardware ou de sensor | **Evento** `hardware_failure`/`sensor_failure` e **alerta** `DISPOSITIVO_FALHA` |
| Comando falhou | Confirmar com `ERRO` e o motivo em `error_message` |

**Não envie** (o servidor resolve):
- o lacre e o cilindro: vêm do cadastro;
- alerta de bateria baixa, de sinal fraco e de lacre aberto ou rompido: o servidor abre a partir de `battery_percent`, `gsm_signal` e `seal_status`. Se o firmware mandar também, o alerta fica duplicado.

**Estados do firmware.** O `enum EstadoDispositivo` do lacre pode ir no campo `device_state`, só para acompanhamento. O que vale para o servidor é:

| Estado do firmware | O que o servidor usa |
| --- | --- |
| `OPERACIONAL` | leituras normais |
| `LACRE_ROMPIDO` | `seal_status: "BROKEN"` (obrigatório mandar assim) |
| `ERRO` | evento `hardware_failure` e alerta `DISPOSITIVO_FALHA` |
| `NAO_CADASTRADO` | o lacre recebeu `401` ou `404`: não insistir |
| `DESATIVADO` | o lacre recebeu `403`: não insistir |
| `MANUTENCAO` | só informativo |

Os demais códigos de alerta estão em [Tipos-de-Erro.md](Tipos-de-Erro.md).

## 6. O que fazer com cada resposta

| Resposta | Significado | O que o firmware faz |
| --- | --- | --- |
| `200`, `201`, `202` | Recebido | Apagar da fila local e seguir |
| `409` | Já recebido antes (mensagem, alerta ou comando) | **Tratar como sucesso**; apagar da fila; não reenviar |
| `400` | Corpo inválido (campo faltando, tipo errado, valor fora da lista) | **Não reenviar**; registrar no log do lacre. É erro do firmware |
| `401` | Chave ausente ou errada, ou lacre ainda não cadastrado | Conferir a chave configurada; não insistir |
| `403` | Chave de outro dispositivo, ou dispositivo desativado | Conferir `device_id` e chave; não insistir |
| `404` | Dispositivo não cadastrado | Avisar a equipe; não insistir |
| `413` | Corpo grande demais | Não reenviar; reduzir o conteúdo |
| `500` ou sem resposta | Problema no servidor ou na rede | **Reenviar** a mesma mensagem, com o mesmo `message_id` e `attempt_count + 1` |

## 7. Sem rede: fila local e reenvio

- Guarde no próprio lacre (memória flash) as mensagens que não foram confirmadas e envie **as mais antigas primeiro**.
- Espere um pouco mais a cada falha seguida (ex.: 10 s, 30 s, 1 min, 5 min) para não gastar bateria nem dados.
- Uma mensagem só sai da fila com `200`, `201`, `202` ou `409`. Com `400`, `401`, `403`, `404` ou `413`, registre o erro e descarte (reenviar não resolve).
- A data oficial é a da **chegada** ao servidor.

## 8. Como ligar o envio no firmware atual

O firmware já lê o GPS e monta o JSON (`MontarJson()` em `JSON.cpp`); o envio em `HTTP.cpp` está desligado esperando este contrato. O que falta:

1. **Em `JSON.cpp`**, acrescentar ao JSON:
   - `message_id` (sequência guardada em NVS);
   - `device_id`;
   - `battery_percent` (a leitura da bateria);
   - `gps_ok`;
   - `seal_status`.
2. **Em `HTTP.cpp`**, ligar o envio com o cabeçalho `X-API-Key` e tratar as respostas da seção 6.
3. **Em `main.cpp`**, quando a posição não for válida, enviar a última posição válida com `gps_ok: false` (hoje o firmware só imprime "localização inválida").

Exemplo, no estilo do código atual:

```cpp
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>

const char* API_BASE  = "http://192.168.0.10:3000/api/v1";
const char* DEVICE_ID = "DSP-000001";
const char* API_KEY   = "chave-recebida-no-cadastro";

Preferences prefs;

// message_id único, que não se repete depois de reiniciar (sequência em NVS)
String NovoId(const char* prefixo) {
  uint32_t seq = prefs.getUInt("seq", 0) + 1;
  prefs.putUInt("seq", seq);
  char id[48];
  snprintf(id, sizeof(id), "%s-%s-%06lu", prefixo, DEVICE_ID, (unsigned long)seq);
  return String(id);
}

// gpsOk = false: dadosGPS guarda a última posição válida
String MontarJson(const String& id, bool gpsOk, float bateria, const char* estadoLacre, uint8_t tentativa) {
  JsonDocument doc;
  doc["message_id"] = id;
  doc["device_id"] = DEVICE_ID;
  doc["latitude"] = round(dadosGPS.latitude * 1000000.0) / 1000000.0;
  doc["longitude"] = round(dadosGPS.longitude * 1000000.0) / 1000000.0;
  doc["gps_ok"] = gpsOk;
  doc["battery_percent"] = bateria;
  doc["seal_status"] = estadoLacre;          // LOCKED, UNLOCKED ou BROKEN
  doc["satelites"] = dadosGPS.satelites;
  doc["hdop"] = dadosGPS.hdop;
  doc["attempt_count"] = tentativa;

  String dados;
  serializeJson(doc, dados);
  return dados;
}

// Devolve true quando a mensagem pode sair da fila local
bool EnviarDados(const char* rota, const String& dados) {
  HTTPClient Http;
  Http.begin(String(API_BASE) + rota);
  Http.addHeader("Content-Type", "application/json");
  Http.addHeader("X-API-Key", API_KEY);
  int codigo = Http.POST(dados);
  String corpo = Http.getString();
  Http.end();

  switch (codigo) {
    case 200: case 201: case 202: case 409:
      return true;                                   // recebido
    case 400: case 401: case 403: case 404: case 413:
      Serial.printf("Erro %d (nao reenviar): %s\n", codigo, corpo.c_str());
      return true;                                   // descartar: reenviar nao resolve
    default:
      return false;                                  // 500 ou sem resposta: reenviar depois
  }
}

// Uso: EnviarDados("/iot/telemetries", MontarJson(NovoId("MSG"), LocalizacaoValida(), LerBateria(), "LOCKED", 1));
```

`LerBateria()` é a função de leitura da bateria, que entra no lacre depois dos testes. **Até ela entrar, o servidor recusa as mensagens (`400`)**, porque a bateria é obrigatória.

Buscar e confirmar comandos:

```cpp
void VerificarComandos() {
  HTTPClient Http;
  Http.begin(String(API_BASE) + "/iot/commands/" + DEVICE_ID);
  Http.addHeader("X-API-Key", API_KEY);
  if (Http.GET() == 200) {
    JsonDocument lista;
    deserializeJson(lista, Http.getString());
    for (JsonObject cmd : lista.as<JsonArray>()) {
      const char* tipo = cmd["command_type"];
      bool ok = strcmp(tipo, "TRAVAR_VALVULA") == 0 ? TravarValvula() : DestravarValvula();
      JsonDocument conf;
      conf["command_id"] = cmd["command_id"];
      conf["device_id"] = DEVICE_ID;
      conf["status"] = ok ? "EXECUTADO" : "ERRO";
      if (!ok) conf["error_message"] = "valvula nao respondeu";
      String json;
      serializeJson(conf, json);
      EnviarDados("/iot/commands/confirm", json);
    }
  }
  Http.end();
}
```

## 9. Como testar

| Teste | Como |
| --- | --- |
| Cada rota, à mão | Swagger (`/api-docs`), botão **Authorize** com a chave |
| Pelo terminal | `curl -X POST http://<IP>:3000/api/v1/iot/telemetries -H "Content-Type: application/json" -H "X-API-Key: <chave>" -d "{...}"` |
| Ver o que chegou | `GET /api/v1/iot/messages?device_id=DSP-000001` |
| Percurso completo de referência | A equipe do backend roda `npm run simular`, que faz exatamente o que o lacre deve fazer |

**Lista de conferência do firmware:**

- [ ] Leitura com posição e bateria → `202`; repetida na mesma posição → `200`.
- [ ] Leitura sem bateria ou sem posição → `400` (e o firmware não reenvia).
- [ ] Mesma mensagem reenviada → `409`, e o firmware trata como sucesso.
- [ ] Sem sinal de GPS → leitura com a última posição e `gps_ok: false` → `202`.
- [ ] Mudança do lacre → evento `seal_changed` com o novo `seal_status`.
- [ ] Reinício → evento `startup`.
- [ ] Chave errada → `401`, e o firmware não fica insistindo.
- [ ] Sem rede → mensagens guardadas e enviadas depois, na ordem, sem `message_id` novo.
- [ ] Comando `TRAVAR_VALVULA` executado e confirmado; reconfirmar → `409` tratado como sucesso.
- [ ] Depois de reiniciar, o `message_id` continua sem repetir.

## 10. Ainda a definir (combinar com o backend)

| Item | Situação |
| --- | --- |
| Intervalo das leituras e da busca de comandos | A definir (ex.: leitura a cada 1 min em movimento e 15 min parado; comandos a cada 30 s) |
| Leitura da bateria no lacre | A função existe e entra depois dos testes. Sem ela, o servidor recusa as mensagens |
| Limites de bateria baixa e de sinal fraco | 15% e -105 dBm. Mudam no servidor, sem mudar o firmware |
| HTTPS | A API ainda usa HTTP; planejar a troca antes da produção |
| Leitura do NFC do lacre | Prevista para a conferência física na auditoria |

## 11. Referências

- [Tipos-de-Erro.md](Tipos-de-Erro.md): todos os códigos de alerta e o que cada um significa.
- [Desenvolvimento.md](Desenvolvimento.md), Parte 1: como a API funciona por dentro.
- [Contrato-Entrega-Supabase.md](Contrato-Entrega-Supabase.md): o que a API envia ao banco principal.

## 12. Histórico do documento

| Versão | Data | Mudança |
| --- | --- | --- |
| 1.0 | 07/10/2026 | Primeira versão |
| 2.0 | 10/10/2026 | Posição e bateria obrigatórias; `gps_ok`; `satelites`, `hdop` e `device_state`; exemplo no estilo do firmware `fluxid-firmware`; banco principal passa a ser o Supabase |
