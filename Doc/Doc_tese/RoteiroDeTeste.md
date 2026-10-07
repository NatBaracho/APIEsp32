# Roteiro de Teste para IA — API Oxide (FluxID / Oxide IoT)

**Versão:** 1.7
**Data:** 06/10/2026
**Uso:** instruções executáveis para uma IA (ou pessoa) testar a API Oxide e produzir um relatório padronizado.
**Base:** `Doc/Doc_tese/PlanoDeTeste.md` (IDs dos casos entre colchetes, ex.: `[TEL-03]`).

---

## 1. Papel e regras de conduta

Você é um executor de testes. Siga este roteiro na ordem, sem pular etapas.

1. **Não altere código-fonte** do projeto. Este roteiro só executa e reporta.
2. **Não toque na base real.** Faça backup do `oxide.db` antes e restaure ao final (seção 8).
3. **Use apenas dados de teste** com prefixo `DSP-TEST`, `MSG-RT-`, `EVT-RT-`, `ALT-RT-`, `CMD-RT-`.
4. **Não invente resultados.** Se um comando falhar ou não puder ser executado, registre `NÃO EXECUTADO` com o motivo.
5. **Registre o resultado obtido real** (status HTTP e corpo), não o esperado.
6. **Se o resultado divergir do esperado, não corrija:** marque `FALHOU` e continue. Só pare nas condições da seção 9.
7. **Nunca registre segredos reais** (senhas do PostgreSQL, chaves de produção) no relatório.
8. Sem acesso a um recurso (servidor, banco, PostgreSQL), diga isso no relatório em vez de simular.

---

## 2. Contexto do sistema

- API REST em Node.js + TypeScript + Express, prefixo `/api/v1`, porta padrão `3000`.
- Banco SQLite `oxide.db` no diretório de trabalho do processo (`process.cwd()`), com chaves estrangeiras ativas.
- Autenticação: header `X-API-Key` (chave exclusiva por dispositivo). Telemetria, eventos, comandos e alertas só aceitam a chave do próprio `device_id` (`403` se for de outro).
- Dispositivo precisa estar cadastrado (`POST /devices`, provisório até o Worker trazer o cadastro do FluxID); não há criação automática pelo evento (`404`).
- `GET /devices` e `GET /devices/:id` são abertos, mas não mostram a `api_key`. A listagem `GET /iot/telemetries` continua geral (decisão SEG-03).
- Dispositivo semente: `DSP-000001`, chave `auto-DSP-000001`.
- Idempotência por `message_id` (telemetria e eventos), `alert_id`, `command_id`, `device_id` e `api_key`.
- Telemetria com posição **e** estado do lacre (`seal_status`) iguais aos da anterior não cria linha: a API responde `200 "Posição já registrada; data e hora atualizadas"`, atualiza `last_seen_at` e guarda o `message_id` em `last_repeat_message_id`.
- Na telemetria, `seal_status` aceita `LOCKED`, `UNLOCKED` ou `BROKEN`.
- Campos numéricos da telemetria precisam ser números; tipo inválido retorna `400` e dispositivo inexistente retorna `404`.
- O `attempt_count` enviado pelo ESP32 (tentativas de envio, inteiro ≥ 0) é gravado em `device_attempt_count`. As colunas `status` e `attempt_count` da fila pertencem ao Worker e o servidor sempre grava `PENDING` e `0`.
- Não existe endpoint HTTP para criar comandos; comandos de teste são inseridos direto no SQLite.
- Tipos de alerta aceitos: `SEAL_BROKEN`, `GEOFENCE_EXIT`, `LOW_BATTERY`, `DEVICE_ERROR`, `COMMAND_FAILURE`, `COMMUNICATION_LOST`.
- Alerta: `severity` opcional (`BAIXA`, `MEDIA`, `ALTA`, `CRITICA`, padrão pelo tipo) e `status` sempre `ABERTO` na criação, nos valores do FluxID. Campos antigos `status_id`/`severity_id` são ignorados.
- Telemetria: latitude e longitude vêm juntas, com latitude entre -90 e 90 e longitude entre -180 e 180 (`400` fora disso).
- `seal_status` aceita: `LOCKED`, `UNLOCKED`, `BROKEN`.
- Estados de comando na confirmação: `EXECUTADO`, `ERRO` (comando novo nasce `PENDENTE`).
- Tipos de comando: `TRAVAR_VALVULA` e `DESTRAVAR_VALVULA`. O banco rejeita comando `PENDENTE` com outro tipo; o histórico (`EXECUTADO`/`ERRO`) pode guardar tipos antigos.

---

## 3. Preparação do ambiente

**Requisitos:** Node.js, npm, `curl` e um shell bash (no Windows, use o Git Bash). **Não é preciso** o `sqlite3` de linha de comando: as consultas usam o `better-sqlite3` já instalado no projeto.

Execute tudo na raiz do projeto. Evite acentos nos valores enviados pelo `curl`: no Git Bash do Windows eles podem chegar corrompidos à API.

```bash
# 3.1 Backup do banco real
cp oxide.db oxide.db.bak-roteiro

# 3.2 Dependências e compilação
npm install
npx tsc --noEmit
```

**Esperado:** compilação sem erros.

### 3.3 Arquivo de ambiente

Muitos executores (inclusive IAs) rodam cada comando em um shell novo, perdendo variáveis e funções. Por isso as definições ficam em um arquivo, carregado com `source ./roteiro-env.sh` no início de **cada** bloco de comandos.

```bash
cat > roteiro-env.sh <<'ENV'
BASE=http://localhost:3000
API=$BASE/api/v1
KEY=key-rt-12345
DEV=DSP-TEST-RT
OTHER_KEY=auto-DSP-000001

# GET: get <caminho> [chave]
get() { curl -s -w "\nHTTP:%{http_code}\n" "$API$1" ${2:+-H "X-API-Key: $2"}; }

# POST JSON: post <caminho> <chave ou ''> <corpo>
post() {
  curl -s -w "\nHTTP:%{http_code}\n" -X POST "$API$1" \
    -H "Content-Type: application/json" ${2:+-H "X-API-Key: $2"} -d "$3"
}

# Uma instrução SQL; consultas imprimem uma linha JSON por registro
sql() {
  node -e 'const D=require("better-sqlite3");const db=new D("oxide.db");const st=db.prepare(process.argv[1]);if(st.reader){for(const r of st.all())console.log(JSON.stringify(r))}else{console.log(JSON.stringify(st.run()))}' "$1"
}

# Várias instruções SQL separadas por ponto e vírgula
sqlexec() {
  node -e 'const D=require("better-sqlite3");const db=new D("oxide.db");db.exec(process.argv[1]);console.log("ok")' "$1"
}

# A API roda direto pelo ts-node (sem o npm) para que o kill encerre o processo certo
api_start() {
  node node_modules/ts-node/dist/bin.js src/server.ts > api.log 2>&1 &
  echo $! > api.pid
  for i in $(seq 1 30); do
    curl -s -o /dev/null "$BASE/" && { echo "API no ar"; return 0; }
    sleep 1
  done
  echo "API não respondeu"; return 1
}

api_stop() {
  [ -f api.pid ] && kill "$(cat api.pid)" 2>/dev/null
  rm -f api.pid
  sleep 1
}
ENV
```

Se `api_stop` não liberar a porta 3000 no Windows, encerre o processo pelo PowerShell:
`Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`.

Se qualquer item desta seção falhar, aplique a regra de parada da seção 9.

---

## 4. Execução da suíte automatizada

O `npm test` sobe a **própria** instância da API. A porta 3000 precisa estar livre; se houver uma API rodando, ela seria testada no lugar do código atual.

```bash
source ./roteiro-env.sh
curl -s -o /dev/null -w "porta 3000: %{http_code}\n" "$BASE/"   # esperado: 000 (nada rodando)
npm test
```

Registre: total, aprovados, reprovados. **Esperado:** 71 casos, 71 aprovados, saída com código `0`.
Se houver reprovação, copie o nome de cada teste que falhou para o relatório.

> A suíte limpa registros `DSP-TEST%` no início e no fim. Os casos manuais abaixo usam `DSP-TEST-RT`, que **também** será limpo na seção 8.

---

## 5. Casos manuais

Cada comando é precedido de um comentário `# [ID] esperado: ...`. Execute, compare a linha `HTTP:` e o corpo com o esperado e preencha o relatório. Os `message_id` e coordenadas foram escolhidos para que um caso não interfira no outro; não os altere.

### 5.1 Subir a API e preparar o dispositivo de teste

```bash
source ./roteiro-env.sh
api_start                                   # esperado: "API no ar"

# Pré-condição dos casos seguintes — esperado: 201
post /devices '' '{"device_id":"DSP-TEST-RT","api_key":"key-rt-12345","firmware_version":"1.0.0"}'
```

### 5.2 Dispositivos

```bash
source ./roteiro-env.sh

# [DEV-08] esperado: 201; no GET, firmware_version null e active 1
post /devices '' '{"device_id":"DSP-TEST-RT2","api_key":"key-rt-2"}'
get /devices/DSP-TEST-RT2

# [DEV-09] esperado: as duas contagens iguais
sql "SELECT COUNT(*) AS total FROM devices"
get /devices > /dev/null; get /devices > /dev/null
sql "SELECT COUNT(*) AS total FROM devices"

# [DEV-10] esperado: 409 "API Key já está em uso"
post /devices '' '{"device_id":"DSP-TEST-RT3","api_key":"key-rt-12345"}'

# [DEV-11] esperado: 400 "active deve ser 0 ou 1"
post /devices '' '{"device_id":"DSP-TEST-RT4","api_key":"key-rt-4","active":7}'

# [DEV-12] esperado: 400 "firmware_version deve ser texto"
post /devices '' '{"device_id":"DSP-TEST-RT5","api_key":"key-rt-5","firmware_version":123}'

# [SEG-01] sem header. Esperado: 200 e o corpo NÃO contém "api_key"
get /devices/DSP-TEST-RT
```

### 5.3 Autenticação

```bash
source ./roteiro-env.sh

# [AUT-07] esperado: 404 "Dispositivo não encontrado"
get /iot/commands/DSP-NAO-EXISTE "$KEY"

# [AUT-08] chave de outro dispositivo. Esperado: 403 "API Key não pertence ao dispositivo"; nenhuma linha
post /iot/telemetries "$OTHER_KEY" '{"message_id":"MSG-RT-A08","device_id":"DSP-TEST-RT","latitude":-8.30,"longitude":-34.70}'

# [AUT-09] chave de outro dispositivo. Esperado: 403 "API Key não pertence ao dispositivo"; nenhuma linha
post /iot/events "$OTHER_KEY" '{"message_id":"EVT-RT-A09","device_id":"DSP-TEST-RT","event_type":"auth_check"}'

# [AUT-10] header em minúsculas. Esperado: 200
curl -s -o /dev/null -w "HTTP:%{http_code}\n" "$API/iot/telemetries" -H "x-api-key: $KEY"
```

### 5.4 Telemetria

```bash
source ./roteiro-env.sh

# [TEL-02] esperado: 202 "Telemetria recebida"
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-001","device_id":"DSP-TEST-RT","latitude":-8.05,"longitude":-34.88,"speed_kmh":10,"battery_percent":90,"gsm_signal":-60}'

# [TEL-03] mesmo comando. Esperado: 409 "Mensagem duplicada"
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-001","device_id":"DSP-TEST-RT","latitude":-8.05,"longitude":-34.88,"speed_kmh":10,"battery_percent":90,"gsm_signal":-60}'

# [TEL-04] mesma posição, message_id novo. Esperado: 200 "Posição já registrada; data e hora atualizadas" e nenhuma linha nova (seção 6)
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-002","device_id":"DSP-TEST-RT","latitude":-8.05,"longitude":-34.88}'

# [TEL-20] reenvio da posição repetida. Esperado: 409 "Mensagem duplicada"
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-002","device_id":"DSP-TEST-RT","latitude":-8.05,"longitude":-34.88}'

# [TEL-05] posição diferente. Esperado: 202 e nova linha
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-003","device_id":"DSP-TEST-RT","latitude":-8.10,"longitude":-34.90}'

# [TEL-06] duas telemetrias sem coordenadas. Esperado: 202 e 202
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-004","device_id":"DSP-TEST-RT"}'
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-005","device_id":"DSP-TEST-RT"}'

# [TEL-08] last_seen_at em ISO 8601. Esperado: 202; valor gravado igual ao enviado
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-006","device_id":"DSP-TEST-RT","latitude":-8.15,"longitude":-34.91,"last_seen_at":"2026-10-04T15:30:00.000Z"}'

# [TEL-11] só latitude. Esperado: 400 "latitude e longitude devem ser enviadas juntas"; nenhuma linha
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-007","device_id":"DSP-TEST-RT","latitude":-8.16}'

# [TEL-12] coordenadas como texto. Esperado: 400 "Campo latitude com tipo inválido"
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-008","device_id":"DSP-TEST-RT","latitude":"-8.17","longitude":"-34.92"}'

# [TEL-13] fora de faixa. Esperado: 400 "latitude deve estar entre -90 e 90 e longitude entre -180 e 180"; nenhuma linha
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-009","device_id":"DSP-TEST-RT","latitude":999,"longitude":999}'

# [TEL-15] dispositivo inexistente. Esperado: 404 "Dispositivo não encontrado"
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-010","device_id":"DSP-NAO-EXISTE"}'

# [TEL-21] status e attempt_count do ESP32. Esperado: 202; na seção 6, status PENDING, attempt_count 0 e device_attempt_count 99
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-012","device_id":"DSP-TEST-RT","latitude":-8.50,"longitude":-34.50,"status":"SYNCED","attempt_count":99}'

# [TEL-22] tipos inválidos. Esperado: 400 nos dois
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-013","device_id":"DSP-TEST-RT","latitude":true,"longitude":-34.50}'
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-014","device_id":"DSP-TEST-RT","payload_json":{"a":1}}'

# [TEL-23] seal_status inválido. Esperado: 400 "seal_status deve ser LOCKED, UNLOCKED ou BROKEN"
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-015","device_id":"DSP-TEST-RT","latitude":-8.60,"longitude":-34.40,"seal_status":"OPEN"}'

# [TEL-24] mesma posição com o lacre mudando. Esperado: 202, 202 (lacre mudou: nova linha) e 200 (repetição)
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-016","device_id":"DSP-TEST-RT","latitude":-8.70,"longitude":-34.30,"seal_status":"LOCKED"}'
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-017","device_id":"DSP-TEST-RT","latitude":-8.70,"longitude":-34.30,"seal_status":"BROKEN"}'
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-018","device_id":"DSP-TEST-RT","latitude":-8.70,"longitude":-34.30,"seal_status":"BROKEN"}'

# [TEL-25] attempt_count negativo. Esperado: 400 "attempt_count deve ser um inteiro maior ou igual a 0"
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-019","device_id":"DSP-TEST-RT","attempt_count":-1}'

# [TEL-07] JSON malformado. Esperado: 400 "Requisição inválida"
post /iot/telemetries "$KEY" '{ invalid json'

# [TEL-17] corpo vazio. Esperado: 400
post /iot/telemetries "$KEY" ''

# [TEL-16] esperado: 200; ids em ordem decrescente
get /iot/telemetries "$KEY" | head -c 400; echo

# [TEL-19] duas requisições simultâneas. Esperado: uma 202 e uma 409; uma linha (seção 6)
BODY='{"message_id":"MSG-RT-011","device_id":"DSP-TEST-RT","latitude":-8.40,"longitude":-34.60}'
post /iot/telemetries "$KEY" "$BODY" > tel19-a.txt & P1=$!
post /iot/telemetries "$KEY" "$BODY" > tel19-b.txt & P2=$!
wait $P1 $P2            # não use "wait" sem argumentos: esperaria a API
grep HTTP tel19-a.txt tel19-b.txt; rm -f tel19-a.txt tel19-b.txt
```

### 5.5 Eventos

```bash
source ./roteiro-env.sh

# [EVT-05] esperado: 202 nos dois
post /iot/events "$KEY" '{"message_id":"EVT-RT-001","device_id":"DSP-TEST-RT","event_type":"seal_changed","seal_status":"UNLOCKED"}'
post /iot/events "$KEY" '{"message_id":"EVT-RT-002","device_id":"DSP-TEST-RT","event_type":"seal_changed","seal_status":"BROKEN"}'

# [EVT-06] esperado: 400; nenhuma linha
post /iot/events "$KEY" '{"message_id":"EVT-RT-003","device_id":"DSP-TEST-RT","event_type":"seal_changed","seal_status":"ACTIVE"}'

# [EVT-10] status enviado pelo cliente. Esperado: 202; na seção 6, status PENDING
post /iot/events "$KEY" '{"message_id":"EVT-RT-004","device_id":"DSP-TEST-RT","event_type":"seal_changed","status":"SYNCED"}'

# [EVT-12] sem seal_status. Esperado: 202; seal_status nulo
post /iot/events "$KEY" '{"message_id":"EVT-RT-005","device_id":"DSP-TEST-RT","event_type":"startup"}'

# [EVT-11] attempt_count do ESP32. Esperado: 202; na seção 6, attempt_count 0 e device_attempt_count 7
post /iot/events "$KEY" '{"message_id":"EVT-RT-006","device_id":"DSP-TEST-RT","event_type":"startup","attempt_count":7}'

# [EVT-13] attempt_count negativo. Esperado: 400; nenhuma linha
post /iot/events "$KEY" '{"message_id":"EVT-RT-007","device_id":"DSP-TEST-RT","event_type":"startup","attempt_count":-1}'

# [EVT-08] repetir EVT-RT-001. Esperado: 409
post /iot/events "$KEY" '{"message_id":"EVT-RT-001","device_id":"DSP-TEST-RT","event_type":"seal_changed","seal_status":"UNLOCKED"}'
```

### 5.6 Comandos

```bash
source ./roteiro-env.sh

# Inserir comandos de teste direto no banco (não há endpoint de criação). Esperado: ok
sqlexec "INSERT INTO commands (command_id, device_id, command_type, status, created_at) VALUES
('CMD-RT-001','DSP-TEST-RT','TRAVAR_VALVULA','PENDENTE',datetime('now')),
('CMD-RT-002','DSP-TEST-RT','DESTRAVAR_VALVULA','PENDENTE',datetime('now'));"

# [CMD-12] esperado: 200; CMD-RT-001 antes de CMD-RT-002
get /iot/commands/DSP-TEST-RT "$KEY"

# [CMD-09] esperado: 200; na seção 6, error_message gravado e executed_at preenchido
post /iot/commands/confirm "$KEY" '{"command_id":"CMD-RT-001","device_id":"DSP-TEST-RT","status":"ERRO","error_message":"falha simulada"}'

# [CMD-10] esperado: 400 "error_message deve ser texto"
post /iot/commands/confirm "$KEY" '{"command_id":"CMD-RT-002","device_id":"DSP-TEST-RT","status":"ERRO","error_message":123}'

# [CMD-11] comando de outro dispositivo. Esperado: 404
post /iot/commands/confirm "$OTHER_KEY" '{"command_id":"CMD-RT-002","device_id":"DSP-000001","status":"EXECUTADO"}'

# [CMD-07] reconfirmar CMD-RT-001. Esperado: 409 "Comando já confirmado"
post /iot/commands/confirm "$KEY" '{"command_id":"CMD-RT-001","device_id":"DSP-TEST-RT","status":"EXECUTADO"}'

# [CMD-13] não existe criação de comando. Esperado: 404
post /iot/commands "$KEY" '{}'
```

### 5.7 Alertas

```bash
source ./roteiro-env.sh

# [ALT-07] um alerta por tipo, sem severity. Esperado: 201 nos seis (severidade padrão do tipo)
i=1
for T in SEAL_BROKEN GEOFENCE_EXIT LOW_BATTERY DEVICE_ERROR COMMAND_FAILURE COMMUNICATION_LOST; do
  post /iot/alerts "$KEY" "{\"alert_id\":\"ALT-RT-00$i\",\"device_id\":\"DSP-TEST-RT\",\"alert_type\":\"$T\",\"title\":\"Teste $T\"}"
  i=$((i+1))
done

# [ALT-08] severity fora da lista. Esperado: 400 "severity deve ser BAIXA, MEDIA, ALTA ou CRITICA"
post /iot/alerts "$KEY" '{"alert_id":"ALT-RT-008","device_id":"DSP-TEST-RT","alert_type":"LOW_BATTERY","severity":"URGENTE","title":"x"}'

# [ALT-09] severity informada + campos antigos (status_id, severity_id, status). Esperado: 201;
# severity ALTA, status ABERTO e sem status_id/severity_id na resposta
post /iot/alerts "$KEY" '{"alert_id":"ALT-RT-009","device_id":"DSP-TEST-RT","alert_type":"LOW_BATTERY","severity":"ALTA","status":"ENCERRADO","status_id":9999,"severity_id":9999,"title":"Bateria baixa"}'

# [ALT-10] sem title. Esperado: 400
post /iot/alerts "$KEY" '{"alert_id":"ALT-RT-010","device_id":"DSP-TEST-RT","alert_type":"LOW_BATTERY"}'

# [ALT-11] sem description. Esperado: 201
post /iot/alerts "$KEY" '{"alert_id":"ALT-RT-007","device_id":"DSP-TEST-RT","alert_type":"LOW_BATTERY","title":"Sem descricao"}'

# [ALT-06] repetir ALT-RT-001. Esperado: 409 "Alerta duplicado"
post /iot/alerts "$KEY" '{"alert_id":"ALT-RT-001","device_id":"DSP-TEST-RT","alert_type":"SEAL_BROKEN","title":"Teste SEAL_BROKEN"}'

# [ALT-12] severidade e status gravados
sql "SELECT alert_id, alert_type, severity, status FROM alerts WHERE device_id = 'DSP-TEST-RT' ORDER BY alert_id"
```

**Esperado [ALT-12]:** `ALT-RT-001` `SEAL_BROKEN` → `CRITICA`; `002` `GEOFENCE_EXIT` → `ALTA`; `003` `LOW_BATTERY` → `BAIXA`; `004` `DEVICE_ERROR` → `MEDIA`; `005` `COMMAND_FAILURE` → `ALTA`; `006` `COMMUNICATION_LOST` → `MEDIA`; `007` → `BAIXA`; `009` → `ALTA`. Todos com `status = ABERTO`. `ALT-RT-008` e `ALT-RT-010` ausentes.

### 5.8 Segurança

```bash
source ./roteiro-env.sh

# [SEG-04] evento para dispositivo não cadastrado. Esperado: 404 (sem criação) e depois 401 com a chave auto-<device_id>
post /iot/events "$KEY" '{"message_id":"EVT-RT-AUTO","device_id":"DSP-TEST-AUTOCREATE","event_type":"startup"}'
curl -s -o /dev/null -w "HTTP:%{http_code}\n" "$API/iot/telemetries" -H "X-API-Key: auto-DSP-TEST-AUTOCREATE"

# [SEG-05] injeção SQL. Esperado: 404 na telemetria e 201 no alerta (texto gravado literalmente)
post /iot/telemetries "$KEY" "{\"message_id\":\"MSG-RT-SQL\",\"device_id\":\"x' OR '1'='1\"}"
post /iot/alerts "$KEY" "{\"alert_id\":\"ALT-RT-SQL\",\"device_id\":\"DSP-TEST-RT\",\"alert_type\":\"DEVICE_ERROR\",\"title\":\"'); DROP TABLE alerts;--\"}"
sql "SELECT COUNT(*) AS alerts_intacta FROM alerts"

# [SEG-06] corpo de ~10 MB. Esperado: 413 e a API continua respondendo 200
node -e 'process.stdout.write(JSON.stringify({x:"a".repeat(10*1024*1024)}))' > big.json
curl -s -w "\nHTTP:%{http_code}\n" -X POST "$API/iot/telemetries" -H "Content-Type: application/json" -H "X-API-Key: $KEY" --data-binary @big.json
curl -s -o /dev/null -w "HTTP:%{http_code}\n" "$BASE/"
rm -f big.json

# [SEG-08] chave por query string. Esperado: 401
get "/iot/telemetries?api_key=$KEY"
```

**[SEG-07]** Revise os corpos de **todas** as respostas `4xx`/`5xx` anteriores: nenhum pode conter `SQLITE`, `SqliteError` ou linhas de stack trace (`at ...`). Os detalhes devem aparecer apenas em `api.log`.

---

### 5.9 Associação dispositivo → lacre → cilindro

```bash
source ./roteiro-env.sh

# Cadastro. Esperado: 201, 201, 201
post /seals '' '{"seal_code":"LCR-RT-1","nfc_uid":"NFC-RT-1"}'
post /seals '' '{"seal_code":"LCR-RT-2","nfc_uid":"NFC-RT-2"}'
post /cylinders '' '{"cylinder_code":"CIL-RT-1","serial_number":"SER-RT-1"}'

# [ASC-01] vínculos dispositivo → lacre → cilindro. Esperado: 201 e 201; lacre INSTALADO
post /assignments/device-seal '' '{"device_id":"DSP-TEST-RT","seal_code":"LCR-RT-1"}'
post /assignments/seal-cylinder '' '{"seal_code":"LCR-RT-1","cylinder_code":"CIL-RT-1"}'
get /seals/LCR-RT-1

# [ASC-02] cilindro já tem lacre ativo. Esperado: 409
post /assignments/seal-cylinder '' '{"seal_code":"LCR-RT-2","cylinder_code":"CIL-RT-1"}'

# [ASC-04] lacre já tem dispositivo ativo. Esperado: 409
post /assignments/device-seal '' '{"device_id":"DSP-000001","seal_code":"LCR-RT-1"}'

# [ASC-05] lacre inexistente. Esperado: 404
post /assignments/seal-cylinder '' '{"seal_code":"LCR-RT-9","cylinder_code":"CIL-RT-1"}'

# [ASC-09] telemetria recebe lacre e cilindro do vínculo. Esperado: 202; lacre_id LCR-RT-1,
# cilindro_id CIL-RT-1 e error_type nulo (o lacre_id enviado é ignorado)
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-ASC1","device_id":"DSP-TEST-RT","latitude":-8.95,"longitude":-35.05,"lacre_id":"LCR-FALSO"}'
sql "SELECT message_id, lacre_id, cilindro_id, error_type FROM telemetry_queue WHERE message_id = 'MSG-RT-ASC1'"

# [ASC-10] lacre aberto em trânsito. Esperado: 200 e 202; error_type LACRE_ABERTO_EM_TRANSITO
post /cylinders/CIL-RT-1/status '' '{"status":"EM_TRANSITO"}'
post /iot/events "$KEY" '{"message_id":"EVT-RT-ASC1","device_id":"DSP-TEST-RT","event_type":"seal_changed","seal_status":"UNLOCKED"}'
sql "SELECT message_id, error_type FROM events WHERE message_id = 'EVT-RT-ASC1'"

# [ASC-06] troca do lacre do cilindro. Esperado: 201; LCR-RT-1 REMOVIDO e LCR-RT-2 INSTALADO
post /assignments/seal-cylinder '' '{"seal_code":"LCR-RT-2","cylinder_code":"CIL-RT-1","replace":true}'
sql "SELECT seal_code, status FROM seals WHERE seal_code LIKE 'LCR-RT-%' ORDER BY seal_code"

# [ASC-11] lacre sem cilindro. Esperado: 202; error_type LACRE_SEM_CILINDRO
post /iot/telemetries "$KEY" '{"message_id":"MSG-RT-ASC2","device_id":"DSP-TEST-RT","latitude":-8.96,"longitude":-35.06}'
sql "SELECT message_id, lacre_id, cilindro_id, error_type FROM telemetry_queue WHERE message_id = 'MSG-RT-ASC2'"

# [ASC-07] encerrar vínculo. Esperado: 200 e depois 409 (já encerrado); LCR-RT-2 REMOVIDO
ID=$(sql "SELECT id FROM cylinder_assignments WHERE seal_code = 'LCR-RT-2' AND ended_at IS NULL" | sed 's/[^0-9]//g')
post "/assignments/seal-cylinder/$ID/end" '' '{"reason":"Teste do roteiro"}'
post "/assignments/seal-cylinder/$ID/end" '' '{}'

# [HIS-02, HIS-03] histórico do cilindro. Esperado: 200; LCR-RT-2 e depois LCR-RT-1, ambos encerrados
get "/assignments/seal-cylinder?cylinder_code=CIL-RT-1"
```

---

## 6. Verificações no banco (SQLite)

Execute após as seções 4 e 5, com a API ainda no ar.

```bash
source ./roteiro-env.sh

# [BD-01, BD-02] Esperado: alerts, commands, devices, events, sqlite_sequence, status,
# telemetry_queue; SEM sync_logs e sync_items
sql "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"

# [BD-05, BD-06] Esperado: alerts com 1 FK (devices; severidade e status são texto com CHECK);
# commands com on_update CASCADE e on_delete RESTRICT
sql "SELECT \"table\", \"from\", on_update, on_delete FROM pragma_foreign_key_list('alerts')"
sql "SELECT \"table\", \"from\", on_update, on_delete FROM pragma_foreign_key_list('commands')"

# [TEL-04/05/06/08/11/19/20/21/24] telemetrias do dispositivo de teste
sql "SELECT message_id, latitude, longitude, seal_status, last_seen_at, last_repeat_message_id, status, attempt_count, device_attempt_count FROM telemetry_queue WHERE device_id='DSP-TEST-RT' ORDER BY id"
```

**Esperado nas telemetrias:**
- Presentes: `MSG-RT-001`, `003`, `004`, `005`, `006`, `011` (uma única vez), `012`, `016`, `017`, `ASC1` e `ASC2` (seção 5.9).
- As telemetrias da seção 5.4, enviadas antes do vínculo, ficam com `error_type = DISPOSITIVO_SEM_LACRE`.
- Ausentes: `MSG-RT-A08` [AUT-08], `MSG-RT-002`, `007` [TEL-11], `008`, `009` [TEL-13], `010`, `013`, `014`, `015`, `018` e `019`.
- `MSG-RT-001` com `last_seen_at` preenchido pelo servidor, no formato `AAAA-MM-DD HH:MM:SS` [TEL-10].
- `MSG-RT-006` com `last_seen_at = 2026-10-04T15:30:00.000Z`.
- `MSG-RT-004` e `MSG-RT-005` com coordenadas nulas.
- Todas, inclusive `MSG-RT-012`, com `status = PENDING` e `attempt_count = 0`; `MSG-RT-012` com `device_attempt_count = 99`.
- `MSG-RT-001` com `last_repeat_message_id = MSG-RT-002` [TEL-04, TEL-20].
- `MSG-RT-016` com `seal_status = LOCKED`; `MSG-RT-017` com `seal_status = BROKEN` e `last_repeat_message_id = MSG-RT-018` [TEL-24].

```bash
source ./roteiro-env.sh

# [EVT-09, EVT-10, EVT-11]
sql "SELECT message_id, message_type, seal_status, status, attempt_count, device_attempt_count FROM events WHERE device_id LIKE 'DSP-TEST%' ORDER BY id"
```

**Esperado:** `event_type` gravado em `message_type`; `status = PENDING` e `attempt_count = 0` em todos (inclusive `EVT-RT-004` e `EVT-RT-006`); `EVT-RT-006` com `device_attempt_count = 7`; `EVT-RT-003`, `EVT-RT-007`, `EVT-RT-A09` [AUT-09] e `EVT-RT-AUTO` [SEG-04] ausentes.

```bash
source ./roteiro-env.sh

# [CMD-09] Esperado: CMD-RT-001 com ERRO, executed_at preenchido e error_message "falha simulada";
# CMD-RT-002 ainda PENDENTE
sql "SELECT command_id, status, executed_at, error_message FROM commands WHERE device_id LIKE 'DSP-TEST%'"

# [BD-03] duplicatas. Esperado: 0 em todas as linhas
sql "SELECT 'devices' AS tabela, COUNT(*) AS duplicatas FROM (SELECT device_id FROM devices GROUP BY device_id HAVING COUNT(*)>1)
UNION ALL SELECT 'api_key', COUNT(*) FROM (SELECT api_key FROM devices GROUP BY api_key HAVING COUNT(*)>1)
UNION ALL SELECT 'telemetry', COUNT(*) FROM (SELECT message_id FROM telemetry_queue GROUP BY message_id HAVING COUNT(*)>1)
UNION ALL SELECT 'events', COUNT(*) FROM (SELECT message_id FROM events GROUP BY message_id HAVING COUNT(*)>1)"

# [BD-04] FK com dispositivo inexistente. Esperado: erro "FOREIGN KEY constraint failed"
sqlexec "INSERT INTO events (message_id, device_id, message_type) VALUES ('EVT-RT-FK','DSP-TEST-NAO-EXISTE','x');"

# [BD-08] regra de active. Esperado: erro "CHECK constraint failed"
sqlexec "INSERT INTO devices (device_id, api_key, active) VALUES ('DSP-TEST-CHK','key-rt-chk',2);"

# [BD-18] catálogo de comandos. Esperado: erro "CHECK constraint failed" (pendente com tipo fora da lista)
sqlexec "INSERT INTO commands (command_id, device_id, command_type, status, created_at) VALUES ('CMD-RT-TIPO','DSP-TEST-RT','LIGAR_SIRENE','PENDENTE',datetime('now'));"

# [BD-16] índice único de api_key. Esperado: idx_devices_api_key com unique 1;
# o INSERT falha com "UNIQUE constraint failed: devices.api_key"
sql "SELECT name, \"unique\" FROM pragma_index_list('devices')"
sqlexec "INSERT INTO devices (device_id, api_key) VALUES ('DSP-TEST-UK','key-rt-12345');"

# [BD-12, BD-13] Esperado: ACTIVE, INACTIVE, LOCKED, UNLOCKED, BROKEN sem duplicatas
# (mais códigos de severidade, se já definidos); colunas device_status_id, valve_status_id, seal_status_id
sql "SELECT id, code FROM status"
sql "SELECT name FROM pragma_table_info('devices')"

# [BD-17] colunas novas e índice. Esperado: last_repeat_message_id, seal_status e device_attempt_count
# em telemetry_queue; device_attempt_count em events; índice idx_telemetry_last_repeat_message_id
sql "SELECT name FROM pragma_table_info('telemetry_queue') WHERE name IN ('last_repeat_message_id','seal_status','device_attempt_count')"
sql "SELECT name FROM pragma_table_info('events') WHERE name = 'device_attempt_count'"
sql "SELECT name FROM pragma_index_list('telemetry_queue')"
```

### 6.1 Inicialização idempotente [BD-11]

```bash
source ./roteiro-env.sh
api_stop
sql "SELECT COUNT(*) AS status FROM status"
api_start && api_stop
api_start && api_stop
sql "SELECT COUNT(*) AS status FROM status"
grep -iE "erro|error" api.log || echo "sem erros no log"
```

**Esperado:** contagens iguais; "API no ar" nas duas subidas; sem erro no log.

---

## 7. Casos que não podem ser executados agora

Marque como `NÃO EXECUTADO – funcionalidade pendente` no relatório (sem tentar simular):

- Associação dispositivo/lacre/cilindro e histórico (`ASC-*`, `HIS-*`).
- Geofence (`GEO-*`) e comandos automáticos (`AUT-C*`).
- Worker SQLite → PostgreSQL (`SYN-*`) e API FluxID NestJS (`FLX-*`).
- Rate limiting, hash/rotação de chaves e auditoria (`SEG-09` a `SEG-11`).
- Testes com hardware (`ESP-03`, `ESP-05`, `ESP-06`) e operação (`OPE-*`).

Se o dump `FluxID.sql` e o `pg_restore` estiverem disponíveis em banco local de análise, a IA pode **apenas verificar a estrutura** (tabelas `dispositivos`, `telemetrias`, `eventos_lacre`, `alertas`, `CHECK` de tipo/severidade/status) para apoiar `SYN-09` a `SYN-11`. Não escrever no banco principal e não registrar credenciais.

---

## 8. Limpeza e restauração

```bash
source ./roteiro-env.sh
api_stop

# Remover resíduos (útil mesmo antes de restaurar, para conferir BD-15)
sqlexec "
DELETE FROM cylinder_assignments WHERE seal_code LIKE 'LCR-RT-%' OR cylinder_code LIKE 'CIL-RT-%';
DELETE FROM seal_assignments WHERE device_id LIKE 'DSP-TEST%' OR seal_code LIKE 'LCR-RT-%';
DELETE FROM seals WHERE seal_code LIKE 'LCR-RT-%';
DELETE FROM cylinders WHERE cylinder_code LIKE 'CIL-RT-%';
DELETE FROM alerts WHERE device_id LIKE 'DSP-TEST%';
DELETE FROM commands WHERE device_id LIKE 'DSP-TEST%';
DELETE FROM telemetry_queue WHERE device_id LIKE 'DSP-TEST%';
DELETE FROM events WHERE device_id LIKE 'DSP-TEST%';
DELETE FROM devices WHERE device_id LIKE 'DSP-TEST%';"

# [BD-15] Esperado: 0
sql "SELECT COUNT(*) AS restantes FROM devices WHERE device_id LIKE 'DSP-TEST%'"

# Restaurar o banco original e remover arquivos temporários
cp oxide.db.bak-roteiro oxide.db
rm -f oxide.db.bak-roteiro roteiro-env.sh api.log api.pid
```

Informe no relatório se a restauração foi feita. Se precisar de `api.log` como evidência, copie-o antes da última linha.

---

## 9. Condições de parada

Interrompa a execução e reporte imediatamente se:

- `npx tsc --noEmit` falhar;
- a API não iniciar (`api_start` imprime "API não respondeu") ou `GET /` não retornar `200`;
- o arquivo `oxide.db` não existir ou não puder ser lido;
- for detectada corrupção do banco (`sql "PRAGMA integrity_check"` diferente de `ok`).

Para os demais casos, registre `FALHOU` e continue.

---

## 10. Classificação de resultado

| Resultado | Significado |
| --- | --- |
| **PASSOU** | Obtido igual ao esperado |
| **FALHOU** | Obtido diferente do esperado e o esperado já era regra implementada |
| **ACHADO** | Comportamento divergente do plano, mas já listado como risco ou decisão pendente (nenhum previsto nesta versão) |
| **NÃO EXECUTADO** | Impossível executar; informar motivo |

Severidade dos defeitos: **Crítica** (perda de dados, exposição de segredo), **Alta** (regra de negócio quebrada), **Média** (mensagem ou status incorreto), **Baixa** (cosmético ou documentação).

---

## 11. Formato do relatório (entregar em Markdown)

Gere o arquivo `Relatorio-de-Teste-AAAA-MM-DD-HHhMM.md` em `Doc/Doc_tese/` (ex.: `Relatorio-de-Teste-2026-10-06-15h49.md`), com a hora da publicação para distinguir relatórios do mesmo dia, e a estrutura abaixo.

```markdown
# Relatório de Teste — API Oxide

**Data/hora:** 
**Executor:** (IA/modelo ou pessoa)
**Commit/versão:** (saída de `git rev-parse --short HEAD`, se disponível)
**Ambiente:** (SO, versão do Node, shell, porta, caminho do banco)

## 1. Resumo
| Indicador | Valor |
| --- | --- |
| Compilação | PASSOU/FALHOU |
| Suíte automatizada | X/71 |
| Casos manuais executados | N |
| PASSOU | N |
| FALHOU | N |
| ACHADO | N |
| NÃO EXECUTADO | N |
| Banco restaurado | Sim/Não |

## 2. Resultados por caso
| ID | Descrição | Esperado | Obtido (status + trecho do corpo) | Resultado |
| --- | --- | --- | --- | --- |

## 3. Defeitos e achados
| # | ID do caso | Severidade | Descrição | Passos para reproduzir | Evidência |
| --- | --- | --- | --- | --- | --- |

## 4. Casos não executados
| ID | Motivo |
| --- | --- |

## 5. Conclusão
(Aprovado / Aprovado com ressalvas / Reprovado, com justificativa em até 5 linhas)

## 6. Recomendações
(Máximo de 5 itens, em ordem de prioridade)
```

---

## 12. Prompt sugerido para entregar a outra IA

```text
Você é um executor de testes. Leia o arquivo Doc/Doc_tese/RoteiroDeTeste.md e execute-o
integralmente, na ordem, na raiz do projeto da API Oxide, usando um shell bash (Git Bash
no Windows). Siga as regras da seção 1: faça backup do oxide.db, use apenas dados de
teste, não altere código-fonte, não invente resultados e registre o que foi realmente
obtido. Comece cada bloco de comandos com "source ./roteiro-env.sh". Ao final, restaure
o banco e gere o relatório no formato da seção 11 em
Doc/Doc_tese/Relatorio-de-Teste-AAAA-MM-DD-HHhMM.md. Se uma etapa for impossível de executar,
marque NÃO EXECUTADO com o motivo.
```

---

## 13. Histórico do documento

| Versão | Data | Descrição |
| --- | --- | --- |
| 1.0 | 05/10/2026 | Criação do roteiro |
| 1.1 | 06/10/2026 | Nomes de arquivo corrigidos; consultas via `better-sqlite3` (sem depender do `sqlite3`); arquivo `roteiro-env.sh` para shells sem estado; API parada durante o `npm test`; IDs e coordenadas exclusivos por caso; casos DEV-10 a DEV-12, TEL-20 a TEL-22, EVT-11, BD-16 e BD-17; expectativas alinhadas às correções da API |
| 1.2 | 06/10/2026 | Ajustes definidos por Natã da Silva Baracho: `last_repeat_message_id` no lugar de `telemetry_position_repeats`, resposta `200` para posição repetida, `seal_status` na telemetria e `device_attempt_count`; casos TEL-23 a TEL-25 e EVT-13; BD-17 passa a verificar as colunas novas |
| 1.3 | 06/10/2026 | Nome do relatório passa a incluir a hora da publicação (`AAAA-MM-DD-HHhMM`), a pedido de Natã da Silva Baracho |
| 1.4 | 06/10/2026 | Entrega A (segurança): AUT-08, AUT-09 e SEG-04 passam a esperar `403`/`404` e SEG-01 a ausência de `api_key`; suíte com 52 casos |
| 1.5 | 06/10/2026 | Entrega C: alertas com `severity`/`status` em texto (valores do FluxID) e severidade padrão por tipo; ALT-08, ALT-09 e ALT-12 reescritos; TEL-11 e TEL-13 passam a esperar `400`; BD-06 com 1 FK; suíte com 55 casos |
| 1.6 | 06/10/2026 | Entrega D: comandos de teste com `TRAVAR_VALVULA`/`DESTRAVAR_VALVULA`; novo BD-18 (catálogo no banco); suíte com 57 casos |
| 1.7 | 06/10/2026 | Entrega B: nova seção 5.9 (associação, troca, encerramento, histórico e `error_type`); limpeza inclui lacres, cilindros e vínculos de teste; suíte com 71 casos |
