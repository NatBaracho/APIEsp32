# Guia do firmware do lacre IoT (ESP32)

**Versão:** 1.0 — 07/10/2026
**Para:** quem programa o lacre IoT (ESP32 em C++)
**Base:** API Oxide com o Worker e o simulador (PRs #15 a #17)

Este guia diz **o que o lacre envia, quando envia, o que recebe de volta e o que fazer com cada resposta**. É tudo o que o firmware precisa saber; o resto (banco, Worker, FluxID) fica do lado do servidor. Para testar cada rota no navegador, use o Swagger: `http://<IP_DA_API>:3000/api-docs`.

---

## 1. Visão em uma página

```text
Lacre (ESP32: GPS + modem GSM + sensor do lacre)
   │  HTTP + JSON, com a chave do dispositivo no cabeçalho X-API-Key
   ▼
API Oxide ──► fila local ──► FluxID (banco principal, mapa, alertas, auditoria)
   ▲
   └── comandos (travar/destravar a válvula) que o lacre busca e confirma
```

| O lacre faz | O servidor faz (o lacre **não** precisa) |
| --- | --- |
| Lê GPS, bateria, sinal e o estado do lacre | Sabe a que **lacre** e **cilindro** o dispositivo pertence (pelo cadastro) |
| Envia **telemetria**, **eventos** e **alertas** | Detecta **lacre aberto em trânsito**, dispositivo sem lacre e lacre sem cilindro |
| Busca e **confirma comandos** | Vai detectar saída da **geocerca** e da **rota** (próxima etapa do projeto) |
| Guarda o que não conseguiu enviar e reenvia | Grava a data oficial, sincroniza com o FluxID e não duplica nada |

## 2. Antes do primeiro envio

1. **Cadastro do dispositivo.** O cadastro oficial é feito no FluxID por quem administra o sistema. Ele gera a **chave** do dispositivo e a entrega **uma única vez**; o banco guarda só o hash, então uma chave perdida não pode ser recuperada, só trocada.
2. **No firmware**, configure:

   | Item | Exemplo |
   | --- | --- |
   | Endereço da API | `http://<IP_DA_API>:3000/api/v1` |
   | `device_id` | `DSP-000001` (o código cadastrado) |
   | Chave | a recebida no cadastro (guardar em área protegida, ex.: NVS) |

3. **Para testar na bancada, sem o FluxID**, a equipe pode cadastrar um dispositivo provisório:

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
| Números | `latitude`, `longitude`, `speed_kmh`, `battery_percent`, `gsm_signal` vão como **número** JSON, nunca como texto |
| `message_id` | **Único por mensagem** (ex.: `MSG-DSP000001-000123`). Guarde a sequência em NVS, para não repetir depois de reiniciar |
| Reenvio | Reenvie a **mesma** mensagem com o **mesmo** `message_id` e `attempt_count + 1`. Mensagem nova = `message_id` novo |
| Texto | Evite acentos nos valores (ex.: `startup`, `sensor_failure`) |

## 4. As mensagens

### 4.1 Telemetria (leitura periódica) — `POST /iot/telemetries`

```json
{
  "message_id": "MSG-DSP000001-000123",
  "device_id": "DSP-000001",
  "latitude": -7.2091939,
  "longitude": -39.3063666,
  "speed_kmh": 21.98,
  "battery_percent": 57.33,
  "gsm_signal": -64,
  "seal_status": "LOCKED",
  "attempt_count": 1,
  "last_seen_at": "2026-10-07T10:15:00Z"
}
```

| Campo | Obrigatório | Regra |
| --- | --- | --- |
| `message_id`, `device_id` | Sim | Texto |
| `latitude`, `longitude` | Não, mas **juntas** | Latitude de -90 a 90, longitude de -180 a 180. **Sem posição do GPS, não envie nenhuma das duas** (a leitura é guardada à parte e não some do mapa) |
| `speed_kmh`, `battery_percent`, `gsm_signal` | Não | Números |
| `seal_status` | Recomendado | `LOCKED` (fechado), `UNLOCKED` (aberto) ou `BROKEN` (rompido) |
| `attempt_count` | Recomendado | Inteiro ≥ 0: em qual tentativa de envio esta mensagem está |
| `last_seen_at` | Opcional | Hora da leitura (ISO 8601, UTC), quando o relógio do lacre for confiável (GPS ou rede) |

Respostas: `202` gravada; `200` "Posição já registrada" (mesma posição e mesmo estado do lacre da última leitura: só a hora é atualizada); `409` mensagem já recebida.

### 4.2 Evento (algo aconteceu) — `POST /iot/events`

```json
{ "message_id": "EVT-DSP000001-000045", "device_id": "DSP-000001", "event_type": "seal_changed", "seal_status": "BROKEN", "attempt_count": 1 }
```

| Campo | Obrigatório | Regra |
| --- | --- | --- |
| `message_id`, `device_id` | Sim | Texto |
| `event_type` | **Sim** | Texto. Use: `seal_changed` (mudou o estado do lacre), `startup` (ligou/reiniciou), `hardware_failure`, `sensor_failure` |
| `seal_status` | Quando o evento for do lacre | `LOCKED`, `UNLOCKED` ou `BROKEN` |
| `attempt_count` | Recomendado | Como na telemetria |

Respostas: `202` gravado; `409` mensagem já recebida.

### 4.3 Alerta (o lacre identificou um problema) — `POST /iot/alerts`

```json
{ "alert_id": "ALT-DSP000001-000007", "device_id": "DSP-000001", "alert_type": "LACRE_VIOLADO", "title": "Lacre rompido" }
```

| Campo | Obrigatório | Regra |
| --- | --- | --- |
| `alert_id` | Sim | Único, como o `message_id` |
| `device_id`, `title` | Sim | Texto |
| `alert_type` | Sim | Um código da tabela da seção 5 |
| `severity` | Não | `BAIXA`, `MEDIA`, `ALTA` ou `CRITICA`. Sem ela, vale a do catálogo |
| `description` | Não | Texto livre (ex.: leitura do sensor) |

Respostas: `201` criado; `409` "Alerta duplicado" (mesmo `alert_id`: tratar como sucesso).

### 4.4 Comandos (travar e destravar a válvula)

1. **Buscar** os pendentes: `GET /iot/commands/DSP-000001` (com `X-API-Key`). Resposta `200` com uma lista, na ordem de criação:

   ```json
   [ { "command_id": "CMD-000001", "device_id": "DSP-000001", "command_type": "TRAVAR_VALVULA", "status": "PENDENTE" } ]
   ```

   `command_type` é sempre `TRAVAR_VALVULA` ou `DESTRAVAR_VALVULA`.

2. **Executar** e **confirmar**: `POST /iot/commands/confirm`

   ```json
   { "command_id": "CMD-000001", "device_id": "DSP-000001", "status": "EXECUTADO" }
   ```

   Se falhar: `"status": "ERRO"` e `"error_message": "motor não respondeu"`. Respostas: `200` confirmado; `409` "Comando já confirmado" (tratar como sucesso); `404` comando não encontrado para este dispositivo.

## 5. Quando enviar o quê

| Situação no lacre | O que enviar |
| --- | --- |
| Funcionamento normal | **Telemetria** periódica com `seal_status` |
| Ligou ou reiniciou | **Evento** `startup` |
| O lacre mudou de estado (fechou, abriu, rompeu) | **Evento** `seal_changed` com o novo `seal_status` **e** uma telemetria logo em seguida |
| Lacre rompido | Além do evento: **alerta** `LACRE_VIOLADO` |
| GPS funcionando, mas sem posição (sem satélites) | **Telemetria sem latitude e longitude** |
| Módulo GPS não responde | **Alerta** `GPS_INATIVO` |
| Bateria abaixo do limite | **Alerta** `BATERIA_BAIXA` |
| Sinal GSM abaixo do limite | **Alerta** `GSM_SINAL_FRACO` |
| Falha de hardware ou de sensor | **Evento** `hardware_failure`/`sensor_failure` e **alerta** `DISPOSITIVO_FALHA` |
| Comando falhou | Confirmar com `ERRO`. O alerta `COMANDO_FALHOU` automático ainda não existe no servidor; até ele existir, envie também o **alerta** `COMANDO_FALHOU` |

**Não envie:**
- `lacre_id` e `cilindro_id`: vêm do cadastro;
- `LACRE_ABERTO_EM_TRANSITO`, `DISPOSITIVO_SEM_LACRE` e `LACRE_SEM_CILINDRO`: o servidor já detecta ao receber os dados;
- `SAIDA_GEOCERCA`, `SAIDA_ROTA`, `SEM_COMUNICACAO` e `COMANDO_SEM_RESPOSTA`: serão detectados pelo servidor nas próximas entregas (geocerca e rota, alertas automáticos). A lista completa de códigos está em [Tipos-de-Erro.md](Tipos-de-Erro.md).

> Os nomes antigos em inglês (`SEAL_BROKEN`, `LOW_BATTERY`, `DEVICE_ERROR`...) ainda são aceitos e convertidos, mas o firmware novo deve usar os códigos em português.

## 6. O que fazer com cada resposta

| Resposta | Significado | O que o firmware faz |
| --- | --- | --- |
| `200`, `201`, `202` | Recebido | Apagar da fila local e seguir |
| `409` | Já recebido antes (mensagem, alerta ou comando) | **Tratar como sucesso**; apagar da fila; não reenviar |
| `400` | Corpo inválido (campo faltando, tipo errado, valor fora da lista) | **Não reenviar**; registrar no log do lacre. É erro do firmware |
| `401` | Chave ausente ou errada | Conferir a chave configurada; não insistir |
| `403` | Chave de outro dispositivo, ou dispositivo desativado | Conferir `device_id` e chave; não insistir |
| `404` | Dispositivo não cadastrado | Avisar a equipe; não insistir |
| `413` | Corpo grande demais | Não reenviar; reduzir o conteúdo |
| `500` ou sem resposta | Problema no servidor ou na rede | **Reenviar** a mesma mensagem, com o mesmo `message_id` e `attempt_count + 1` |

## 7. Sem rede: fila local e reenvio

- Guarde no próprio lacre (memória flash) as mensagens que não foram confirmadas e envie **as mais antigas primeiro**.
- Espere um pouco mais a cada falha seguida (ex.: 10 s, 30 s, 1 min, 5 min) para não gastar bateria nem dados.
- Uma mensagem só sai da fila com `200`, `201`, `202` ou `409`. Com `400`, `401`, `403`, `404` ou `413`, registre o erro e descarte (reenviar não resolve).
- **Data dos dados atrasados:** no FluxID, a data oficial é a da **chegada** (decisão do projeto). Para não perder a hora real da leitura, envie `last_seen_at` quando o relógio for confiável.

## 8. Exemplo em C++ (ESP32)

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>

const char* API_BASE  = "http://192.168.0.10:3000/api/v1";
const char* DEVICE_ID = "DSP-000001";
const char* API_KEY   = "chave-recebida-no-cadastro";

Preferences prefs;

// message_id único que não se repete depois de reiniciar (sequência em NVS)
String novoId(const char* prefixo) {
  uint32_t seq = prefs.getUInt("seq", 0) + 1;
  prefs.putUInt("seq", seq);
  char id[48];
  snprintf(id, sizeof(id), "%s-%s-%06lu", prefixo, DEVICE_ID, (unsigned long)seq);
  return String(id);
}

// Envia e devolve true quando a mensagem pode sair da fila local
bool enviar(const char* rota, const String& json) {
  HTTPClient http;
  http.begin(String(API_BASE) + rota);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  int codigo = http.POST(json);
  String corpo = http.getString();
  http.end();

  if (codigo == 200 || codigo == 201 || codigo == 202 || codigo == 409) return true;   // recebido
  if (codigo == 400 || codigo == 401 || codigo == 403 || codigo == 404 || codigo == 413) {
    Serial.printf("Erro %d (nao reenviar): %s\n", codigo, corpo.c_str());
    return true;                                    // descartar: reenviar não resolve
  }
  return false;                                     // 500 ou sem resposta: reenviar depois
}

String telemetria(const String& id, uint8_t tentativa, bool temGps, double lat, double lon,
                  float vel, float bat, int gsm, const char* estadoLacre) {
  StaticJsonDocument<384> doc;
  doc["message_id"] = id;
  doc["device_id"] = DEVICE_ID;
  if (temGps) {                                     // sem posição: não envia nenhuma das duas
    doc["latitude"] = lat;
    doc["longitude"] = lon;
  }
  doc["speed_kmh"] = vel;
  doc["battery_percent"] = bat;
  doc["gsm_signal"] = gsm;
  doc["seal_status"] = estadoLacre;                 // LOCKED, UNLOCKED ou BROKEN
  doc["attempt_count"] = tentativa;
  String json;
  serializeJson(doc, json);
  return json;
}

void verificarComandos() {
  HTTPClient http;
  http.begin(String(API_BASE) + "/iot/commands/" + DEVICE_ID);
  http.addHeader("X-API-Key", API_KEY);
  if (http.GET() == 200) {
    StaticJsonDocument<1024> lista;
    deserializeJson(lista, http.getString());
    for (JsonObject cmd : lista.as<JsonArray>()) {
      const char* tipo = cmd["command_type"];
      bool ok = strcmp(tipo, "TRAVAR_VALVULA") == 0 ? travarValvula() : destravarValvula();
      StaticJsonDocument<256> conf;
      conf["command_id"] = cmd["command_id"];
      conf["device_id"] = DEVICE_ID;
      conf["status"] = ok ? "EXECUTADO" : "ERRO";
      if (!ok) conf["error_message"] = "valvula nao respondeu";
      String json;
      serializeJson(conf, json);
      enviar("/iot/commands/confirm", json);
    }
  }
  http.end();
}
```

`travarValvula()` e `destravarValvula()` são do hardware de vocês. Num firmware de produção, `enviar` é chamado pela fila local da seção 7, que guarda o `message_id` e o `attempt_count` de cada mensagem.

## 9. Como testar

| Teste | Como |
| --- | --- |
| Cada rota, à mão | Swagger (`/api-docs`), botão **Authorize** com a chave |
| Pelo terminal | `curl -X POST http://<IP>:3000/api/v1/iot/telemetries -H "Content-Type: application/json" -H "X-API-Key: <chave>" -d "{...}"` |
| Ver o que chegou | `GET /api/v1/iot/telemetries` (com uma chave válida) e `GET /api/v1/iot/alerts?device_id=DSP-000001` |
| Percurso completo de referência | A equipe do backend roda `npm run simular`, que faz exatamente o que o lacre deve fazer e mostra o que chega nos bancos |

**Lista de conferência do firmware:**

- [ ] Telemetria com posição → `202`; repetida na mesma posição → `200`.
- [ ] Mesma mensagem reenviada → `409`, e o firmware trata como sucesso.
- [ ] Sem GPS → telemetria sem latitude e longitude → `202`.
- [ ] Mudança do lacre → evento `seal_changed` + telemetria.
- [ ] Lacre rompido → evento `BROKEN` + alerta `LACRE_VIOLADO` → `201`.
- [ ] Reinício → evento `startup`.
- [ ] Chave errada → `401`, e o firmware não fica insistindo.
- [ ] Sem rede → mensagens guardadas e enviadas depois, na ordem, sem `message_id` novo.
- [ ] Comando `TRAVAR_VALVULA` executado e confirmado; reconfirmar → `409` tratado como sucesso.
- [ ] Depois de reiniciar, o `message_id` continua sem repetir.

## 10. Ainda a definir (combinar com o backend)

| Item | Situação |
| --- | --- |
| Intervalo da telemetria e da busca de comandos | A definir (ex.: telemetria a cada 1 min em trânsito e 15 min parado; comandos a cada 30 s) |
| Limites de bateria baixa e de sinal GSM fraco | A definir no catálogo de erros |
| Tempo sem posição para o alerta `GPS_SEM_SINAL` | A definir |
| HTTPS | A API ainda usa HTTP; planejar a troca antes da produção |
| Leitura do NFC do lacre | Prevista para a conferência física na auditoria |

## 11. Referências

- [ESP32-envio-de-dados.md](ESP32-envio-de-dados.md): exemplos detalhados de cada payload e resposta.
- [Desenvolvimento.md](Desenvolvimento.md), seções 1.2 a 1.8: o contrato completo de cada rota e onde cada campo fica no banco.
- [Tipos-de-Erro.md](Tipos-de-Erro.md): todos os códigos de alerta e o que cada um significa.
