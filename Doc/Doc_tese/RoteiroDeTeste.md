# Roteiro de Teste para IA — API Oxide (FluxID / Oxide IoT)

**Versão:** 1.0
**Uso:** instruções executáveis para uma IA (ou pessoa) testar a API Oxide e produzir um relatório padronizado.
**Base:** `Plano-de-Teste.md` (IDs dos casos entre colchetes, ex.: `[TEL-03]`).

---

## 1. Papel e regras de conduta

Você é um executor de testes. Siga este roteiro na ordem, sem pular etapas.

1. **Não altere código-fonte** do projeto. Este roteiro só executa e reporta.
2. **Não toque na base real.** Faça backup do `oxide.db` antes e restaure ao final (seção 3).
3. **Use apenas dados de teste** com prefixo `DSP-TEST`, `MSG-RT-`, `EVT-RT-`, `ALT-RT-`, `CMD-RT-`.
4. **Não invente resultados.** Se um comando falhar ou não puder ser executado, registre `NÃO EXECUTADO` com o motivo.
5. **Registre o resultado obtido real** (status HTTP e corpo), não o esperado.
6. **Se o resultado divergir do esperado, não corrija:** marque `FALHOU` e continue. Só pare nas condições da seção 9.
7. **Nunca registre segredos reais** (senhas do PostgreSQL, chaves de produção) no relatório.
8. Sem acesso a um recurso (servidor, banco, PostgreSQL), diga isso no relatório em vez de simular.

---

## 2. Contexto do sistema

- API REST em Node.js + TypeScript + Express, prefixo `/api/v1`, porta padrão `3000`.
- Banco SQLite `oxide.db` no diretório de trabalho do processo (`process.cwd()`), com `PRAGMA foreign_keys = ON`.
- Autenticação: header `X-API-Key` (chave por dispositivo).
- Dispositivo semente: `DSP-000001`, chave `auto-DSP-000001`.
- Idempotência por `message_id` (telemetria e eventos), `alert_id`, `command_id`, `device_id`.
- Não existe endpoint HTTP para criar comandos; comandos de teste são inseridos direto no SQLite.
- Tipos de alerta aceitos: `SEAL_BROKEN`, `GEOFENCE_EXIT`, `LOW_BATTERY`, `DEVICE_ERROR`, `COMMAND_FAILURE`, `COMMUNICATION_LOST`.
- `seal_status` aceita: `LOCKED`, `UNLOCKED`, `BROKEN`.
- Estados de comando na confirmação: `EXECUTADO`, `ERRO` (comando novo nasce `PENDENTE`).

---

## 3. Preparação do ambiente

Execute na raiz do projeto.

```bash
# 3.1 Backup do banco real
cp oxide.db oxide.db.bak-roteiro

# 3.2 Dependências e compilação
npm install
npx tsc --noEmit

# 3.3 Subir a API em uma instância nova (encerrar processo antigo na porta 3000 antes)
npm start &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```

**Esperado:** compilação sem erros; `GET /` retorna `200`.

Defina variáveis para os comandos seguintes:

```bash
BASE=http://localhost:3000
API=$BASE/api/v1
KEY=key-rt-12345
DEV=DSP-TEST-RT
OTHER_KEY=auto-DSP-000001
```

Função auxiliar para registrar status e corpo:

```bash
req() { curl -s -w "\nHTTP:%{http_code}\n" "$@"; }
```

Se qualquer item desta seção falhar, aplique a regra de parada da seção 9.

---

## 4. Execução da suíte automatizada

```bash
npm test
```

Registre: total, aprovados, reprovados. **Esperado:** 40 casos, 40 aprovados, saída com código `0`.
Se houver reprovação, copie o nome de cada teste que falhou para o relatório.

> A suíte limpa registros `DSP-TEST%` no início e no fim. Os casos manuais abaixo usam `DSP-TEST-RT`, que **também** será limpo na seção 8.

---

## 5. Casos manuais (curl)

Formato de cada caso: **ID — ação — esperado**. Execute, compare e preencha no relatório.

### 5.1 Preparar o dispositivo de teste

```bash
req -X POST $API/devices -H "Content-Type: application/json" \
  -d '{"device_id":"'$DEV'","api_key":"'$KEY'","firmware_version":"1.0.0"}'
```

**Esperado:** `201`. (Pré-condição dos casos seguintes.)

### 5.2 Dispositivos

| ID | Comando | Esperado |
| --- | --- | --- |
| DEV-08 | `req -X POST $API/devices -H "Content-Type: application/json" -d '{"device_id":"DSP-TEST-RT2","api_key":"k2"}'` e depois `req $API/devices/DSP-TEST-RT2` | `201`; no GET, `firmware_version` nulo e `active` = `1` |
| DEV-09 | Contar dispositivos antes e depois de dois `GET $API/devices` | Contagem inalterada |
| SEG-01 | `req $API/devices/$DEV` (sem header) e verificar se o corpo contém o campo `api_key` | **Registrar:** se contém `api_key`, marcar como **achado de segurança (risco conhecido R4)**, não como erro do roteiro |

### 5.3 Autenticação

| ID | Comando | Esperado |
| --- | --- | --- |
| AUT-07 | `req $API/iot/commands/DSP-NAO-EXISTE -H "X-API-Key: $KEY"` | `404` ou `403` (registrar qual; o esperado do plano é `404`) |
| AUT-08 | `POST /iot/telemetries` com `X-API-Key: $OTHER_KEY` e `device_id` = `$DEV` (ver payload em 5.4) | Hoje aceita (`202`). Registrar como achado se `202` |
| AUT-09 | `POST /iot/events` com `X-API-Key: $OTHER_KEY` e `device_id` = `$DEV` | Hoje aceita (`202`). Registrar como achado se `202` |
| AUT-10 | `req $API/iot/telemetries -H "x-api-key: $KEY"` | `200` |

### 5.4 Telemetria

```bash
H='-H Content-Type:application/json'
```

| ID | Comando | Esperado |
| --- | --- | --- |
| TEL-02 | `req -X POST $API/iot/telemetries $H -H "X-API-Key: $KEY" -d '{"message_id":"MSG-RT-001","device_id":"'$DEV'","latitude":-8.05,"longitude":-34.88,"speed_kmh":10,"battery_percent":90,"gsm_signal":-60}'` | `202` |
| TEL-03 | Repetir o comando de TEL-02 | `409`, `"Mensagem duplicada"` |
| TEL-04 | Mesmo lat/long, `message_id` `MSG-RT-002` | `202`; linha **não** criada (conferir na seção 6) |
| TEL-05 | Lat `-8.10`, long `-34.90`, `message_id` `MSG-RT-003` | `202`; nova linha |
| TEL-06 | Dois POSTs sem lat/long com `message_id` `MSG-RT-004` e `MSG-RT-005` | `202` e `202`; duas linhas com coordenadas nulas |
| TEL-07 | Corpo `{ invalid json` | `400`, `"Requisição inválida"` |
| TEL-08 | `message_id` `MSG-RT-006`, `last_seen_at` `2026-10-04T15:30:00.000Z`, lat/long novos | `202`; valor gravado igual ao enviado |
| TEL-11 | Só `latitude` (sem longitude), `message_id` `MSG-RT-007` | `202`; nova linha |
| TEL-12 | `latitude` e `longitude` como strings, `message_id` `MSG-RT-008` | `202`; registrar se criou linha |
| TEL-13 | `latitude` `999`, `longitude` `999`, `message_id` `MSG-RT-009` | **Registrar comportamento real** (hoje não há validação de faixa; se `202`, marcar como achado) |
| TEL-15 | `device_id` `DSP-NAO-EXISTE`, `message_id` `MSG-RT-010` | **Registrar status real.** Esperado pelo plano: erro tratado, sem vazar detalhes. Marcar achado se `500` ou se o corpo expõe mensagem do SQLite |
| TEL-16 | `req $API/iot/telemetries -H "X-API-Key: $KEY"` | `200`; `id` em ordem decrescente |
| TEL-17 | POST sem corpo (`-d ''`) | `400` |
| TEL-19 | Disparar duas requisições simultâneas com o mesmo `message_id` `MSG-RT-011` (`&` e `wait`) | Uma `202`, outra `409`; uma única linha |

### 5.5 Eventos

| ID | Comando | Esperado |
| --- | --- | --- |
| EVT-05a | POST `/iot/events` com `{"message_id":"EVT-RT-001","device_id":"DSP-TEST-RT","event_type":"seal_changed","seal_status":"UNLOCKED"}` | `202` |
| EVT-05b | Igual, `message_id` `EVT-RT-002`, `seal_status` `BROKEN` | `202` |
| EVT-06 | `message_id` `EVT-RT-003`, `seal_status` `ACTIVE` | `400`; nenhuma linha |
| EVT-10 | `message_id` `EVT-RT-004`, com `"status":"SYNCED"` no corpo | `202`; na seção 6 `events.status` deve ser `PENDING` |
| EVT-12 | `message_id` `EVT-RT-005`, sem `seal_status` | `202`; `seal_status` nulo |
| EVT-08 | Repetir `EVT-RT-001` | `409` |

### 5.6 Comandos

Inserir comandos de teste direto no banco (não há endpoint de criação):

```bash
sqlite3 oxide.db "INSERT INTO commands (command_id, device_id, command_type, status, created_at) VALUES
('CMD-RT-001','DSP-TEST-RT','LOCK_VALVE','PENDENTE',datetime('now')),
('CMD-RT-002','DSP-TEST-RT','UNLOCK_VALVE','PENDENTE',datetime('now'));"
```

| ID | Comando | Esperado |
| --- | --- | --- |
| CMD-12 | `req $API/iot/commands/$DEV -H "X-API-Key: $KEY"` | `200`; `CMD-RT-001` antes de `CMD-RT-002` |
| CMD-09 | POST `/iot/commands/confirm` com `{"command_id":"CMD-RT-001","device_id":"DSP-TEST-RT","status":"ERRO","error_message":"falha simulada"}` | `200`; na seção 6, `error_message` gravado e `executed_at` preenchido |
| CMD-10 | Confirmar `CMD-RT-002` com `"error_message": 123` | `400` |
| CMD-11 | Confirmar `CMD-RT-002` informando outro `device_id` e a chave `$OTHER_KEY` | `403` ou `404` (registrar qual) |
| CMD-07 | Reconfirmar `CMD-RT-001` | `409`, `"Comando já confirmado"` |
| CMD-13 | `req -X POST $API/iot/commands $H -H "X-API-Key: $KEY" -d '{}'` | `404` |

### 5.7 Alertas

Descobrir os IDs do catálogo, sem assumir valores fixos:

```bash
sqlite3 oxide.db "SELECT id, code FROM status;"
```

Use qualquer `id` existente como `SID` (status) e `VID` (severidade).

| ID | Comando | Esperado |
| --- | --- | --- |
| ALT-07 | Um POST `/iot/alerts` para cada tipo (`SEAL_BROKEN`, `GEOFENCE_EXIT`, `LOW_BATTERY`, `DEVICE_ERROR`, `COMMAND_FAILURE`, `COMMUNICATION_LOST`), com `alert_id` `ALT-RT-001` a `ALT-RT-006`, `title` e IDs válidos | `201` nos seis |
| ALT-08 | `severity_id` `9999` | `400` |
| ALT-09a | `status_id` `"1"` (string) | `400` |
| ALT-09b | `status_id` `0` e `-1` | `400` |
| ALT-10 | Sem `title` | `400` |
| ALT-11 | Sem `description` (`ALT-RT-007`) | `201` |
| ALT-06 | Repetir `ALT-RT-001` | `409`, `"Alerta duplicado"` |
| ALT-12 | Registrar os `code` presentes em `status` | **Achado:** se não existir nenhum código de severidade (ex.: `BAIXA`, `ALTA`), registrar "taxonomia de severidade pendente" |

### 5.8 Segurança

| ID | Ação | Esperado |
| --- | --- | --- |
| SEG-04 | `req $API/iot/telemetries -H "X-API-Key: auto-DSP-TEST-AUTOCREATE"` depois de um evento ter criado esse dispositivo automaticamente (use `EVT-RT-AUTO` com `device_id` `DSP-TEST-AUTOCREATE`) | Registrar se a chave previsível `auto-<device_id>` funciona (achado de risco se `200`) |
| SEG-05 | Enviar `device_id` `"x' OR '1'='1"` em telemetria; `title` `"'); DROP TABLE alerts;--"` em alerta | Sem alteração de dados; tabelas intactas (conferir `sqlite_master`) |
| SEG-06 | POST com corpo de ~10 MB | `413` ou erro tratado; servidor continua respondendo `GET /` com `200` |
| SEG-07 | Provocar erro interno (ex.: TEL-15) e inspecionar o corpo | Sem stack trace nem texto de erro do SQLite |
| SEG-08 | `req "$API/iot/telemetries?api_key=$KEY"` (sem header) | `401` |

---

## 6. Verificações no banco (SQLite)

Execute após as seções 4 e 5.

```bash
# Tabelas
sqlite3 oxide.db "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```
**Esperado [BD-01, BD-02]:** `alerts`, `commands`, `devices`, `events`, `status`, `telemetry_queue` (e `sqlite_sequence`); **sem** `sync_logs` e `sync_items`.

```bash
# Foreign keys
sqlite3 oxide.db "PRAGMA foreign_key_list(alerts); PRAGMA foreign_key_list(commands);"
```
**Esperado [BD-05, BD-06]:** `alerts` com 3 FKs (dispositivo, `status_id`, `severity_id`); `commands` com `ON UPDATE CASCADE` e `ON DELETE RESTRICT`.

```bash
# TEL-04/05/06: telemetrias do dispositivo de teste
sqlite3 -header oxide.db "SELECT message_id, latitude, longitude, last_seen_at, status, attempt_count FROM telemetry_queue WHERE device_id='DSP-TEST-RT' ORDER BY id;"
```
**Esperado:** `MSG-RT-002` ausente; `MSG-RT-001` com `last_seen_at` atualizado; `MSG-RT-004` e `MSG-RT-005` com coordenadas nulas; `status = PENDING`, `attempt_count = 0`.

```bash
# EVT: eventos
sqlite3 -header oxide.db "SELECT message_id, message_type, seal_status, status, attempt_count FROM events WHERE device_id LIKE 'DSP-TEST%' ORDER BY id;"
```
**Esperado [EVT-09, EVT-10, EVT-11]:** `event_type` do payload gravado em `message_type`; `status = PENDING` em todos (inclusive `EVT-RT-004`); `attempt_count = 0`; `EVT-RT-003` ausente.

```bash
# CMD: comandos
sqlite3 -header oxide.db "SELECT command_id, status, executed_at, error_message FROM commands WHERE device_id LIKE 'DSP-TEST%';"
```
**Esperado:** `CMD-RT-001` com `ERRO`, `executed_at` preenchido e `error_message = falha simulada`; `CMD-RT-002` ainda `PENDENTE`.

```bash
# BD-03: duplicatas
sqlite3 oxide.db "SELECT 'devices', COUNT(*) FROM (SELECT device_id FROM devices GROUP BY device_id HAVING COUNT(*)>1)
UNION ALL SELECT 'telemetry', COUNT(*) FROM (SELECT message_id FROM telemetry_queue GROUP BY message_id HAVING COUNT(*)>1)
UNION ALL SELECT 'events', COUNT(*) FROM (SELECT message_id FROM events GROUP BY message_id HAVING COUNT(*)>1);"
```
**Esperado:** zero em todas as linhas.

```bash
# BD-04: FK com dispositivo inexistente (rodar com foreign_keys ligado)
sqlite3 oxide.db "PRAGMA foreign_keys=ON; INSERT INTO events (message_id, device_id, message_type) VALUES ('EVT-RT-FK','DSP-NAO-EXISTE','x');"
```
**Esperado:** erro `FOREIGN KEY constraint failed`.

```bash
# BD-08: CHECK de active
sqlite3 oxide.db "INSERT INTO devices (device_id, api_key, active) VALUES ('DSP-TEST-CHK','k',2);"
```
**Esperado:** erro `CHECK constraint failed`. (Se o banco foi criado por migração antiga, pode não haver o `CHECK`; registrar o resultado real.)

```bash
# BD-12/13: catálogo e colunas de status em devices
sqlite3 oxide.db "SELECT id, code FROM status;"
sqlite3 oxide.db "PRAGMA table_info(devices);"
```
**Esperado:** 5 códigos (`ACTIVE`, `INACTIVE`, `LOCKED`, `UNLOCKED`, `BROKEN`) sem duplicatas (mais códigos de severidade, se já definidos); colunas `device_status_id`, `valve_status_id`, `seal_status_id` presentes.

### 6.1 Inicialização idempotente [BD-11]

1. Parar a API.
2. Contar linhas: `sqlite3 oxide.db "SELECT COUNT(*) FROM status;"`.
3. Subir a API duas vezes seguidas (`npm start`, aguardar, parar).
4. Contar novamente.

**Esperado:** contagem igual; sem erro na inicialização.

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
# Parar a API
kill %1 2>/dev/null || pkill -f "npm start"

# Remover resíduos (se não for restaurar o backup)
sqlite3 oxide.db "
DELETE FROM alerts WHERE device_id LIKE 'DSP-TEST%';
DELETE FROM commands WHERE device_id LIKE 'DSP-TEST%';
DELETE FROM telemetry_queue WHERE device_id LIKE 'DSP-TEST%';
DELETE FROM events WHERE device_id LIKE 'DSP-TEST%';
DELETE FROM devices WHERE device_id LIKE 'DSP-TEST%';"

# Conferir [BD-15]
sqlite3 oxide.db "SELECT COUNT(*) FROM devices WHERE device_id LIKE 'DSP-TEST%';"

# Restaurar o banco original (recomendado)
cp oxide.db.bak-roteiro oxide.db
```

**Esperado:** contagem `0`. Informar no relatório se a restauração foi feita.

---

## 9. Condições de parada

Interrompa a execução e reporte imediatamente se:

- `npx tsc --noEmit` falhar;
- a API não iniciar ou `GET /` não retornar `200`;
- o arquivo `oxide.db` não existir ou não puder ser lido;
- for detectada corrupção do banco (`PRAGMA integrity_check` diferente de `ok`).

Para os demais casos, registre `FALHOU` e continue.

---

## 10. Classificação de resultado

| Resultado | Significado |
| --- | --- |
| **PASSOU** | Obtido igual ao esperado |
| **FALHOU** | Obtido diferente do esperado e o esperado já era regra implementada |
| **ACHADO** | Comportamento divergente do plano, mas já listado como risco ou decisão pendente (R4, R5, R6, TEL-13, SEG-04) |
| **NÃO EXECUTADO** | Impossível executar; informar motivo |

Severidade dos defeitos: **Crítica** (perda de dados, exposição de segredo), **Alta** (regra de negócio quebrada), **Média** (mensagem ou status incorreto), **Baixa** (cosmético ou documentação).

---

## 11. Formato do relatório (entregar em Markdown)

Gere o arquivo `Relatorio-de-Teste-AAAA-MM-DD.md` com a estrutura abaixo.

```markdown
# Relatório de Teste — API Oxide

**Data/hora:** 
**Executor:** (IA/modelo ou pessoa)
**Commit/versão:** (se disponível)
**Ambiente:** (SO, Node, porta, caminho do banco)

## 1. Resumo
| Indicador | Valor |
| --- | --- |
| Compilação | PASSOU/FALHOU |
| Suíte automatizada | X/40 |
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
Você é um executor de testes. Leia o arquivo Roteiro-de-Teste-IA.md e execute-o
integralmente, na ordem, na raiz do projeto da API Oxide. Siga as regras da seção 1:
faça backup do oxide.db, use apenas dados de teste, não altere código-fonte, não
invente resultados e registre o que foi realmente obtido. Ao final, restaure o banco
e gere o relatório no formato da seção 11 em Relatorio-de-Teste-AAAA-MM-DD.md.
Se uma etapa for impossível de executar, marque NÃO EXECUTADO com o motivo.
```