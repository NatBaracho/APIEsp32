# API ESP32

API REST em Node.js, TypeScript, Express e SQLite para receber dados de dispositivos ESP32.

O banco principal do projeto é o PostgreSQL FluxID. A Oxide (`oxide.db`) funciona como armazenamento local e buffer persistente; a API ainda grava somente no SQLite, pois o Worker de sincronização não está implementado. O arquivo `FluxID.sql` acompanha um dump PostgreSQL em formato custom (`PGDMP`), não um script SQL texto; use as ferramentas `pg_restore` para inspecioná-lo ou restaurá-lo.

## Executar localmente

```bash
npm install
npm start
```

O servidor inicia na porta `3000`.

O npm 11 avisa que os scripts de instalação do `better-sqlite3` ainda não estão autorizados (`allowScripts`); hoje é só um aviso e o módulo instala normalmente. Se uma versão futura do npm bloquear o script e a API não conseguir abrir o banco, rode `npm install-scripts approve better-sqlite3` e depois `npm install`.

## Testes

```bash
npx tsc --noEmit
npm test
```

O `npm test` sobe a própria instância da API; pare o `npm start` antes de executá-lo para que a suíte não teste um processo antigo. A suíte grava no `oxide.db` do diretório atual e remove os registros `DSP-TEST%` ao final; faça backup do banco antes. Resultado atual: 50/50. O registro de cada entrega (validação da IA e do responsável) fica em `Doc/Doc_tese/Relatorio-de-Teste-*.md`.

## Documentação interativa

Com o servidor ativo, acesse o Swagger UI em:

```text
http://localhost:3000/api-docs
```

Use **Try it out** para executar as requisições. Para telemetrias e eventos, clique em **Authorize** e informe uma chave cadastrada no header `X-API-Key`.

## Endpoints principais

| Método | Endpoint | Uso |
| --- | --- | --- |
| `GET` | `/api/v1/devices` | Listar dispositivos |
| `GET` | `/api/v1/devices/:deviceId` | Buscar dispositivo |
| `POST` | `/api/v1/devices` | Cadastrar dispositivo |
| `GET` | `/api/v1/iot/telemetries` | Listar telemetrias recentes primeiro |
| `POST` | `/api/v1/iot/telemetries` | Enfileirar telemetria |
| `POST` | `/api/v1/iot/events` | Registrar evento |
| `GET` | `/api/v1/iot/commands/:deviceId` | Buscar comandos pendentes do dispositivo |
| `POST` | `/api/v1/iot/commands/confirm` | Confirmar execução ou erro de comando |
| `POST` | `/api/v1/iot/alerts` | Registrar alerta do dispositivo |

Os POSTs de telemetria, eventos e alertas exigem `X-API-Key` do próprio `device_id` enviado (`403` se for de outro). O dispositivo precisa estar cadastrado em `POST /api/v1/devices` (provisório até o cadastro vir do FluxID); não há criação automática (`404`). As rotas de dispositivos são abertas, mas não mostram a `api_key`. Os campos `device_id` e `message_id` identificam os registros; `message_id` deve ser único por mensagem. Dispositivo repetido retorna `409 Dispositivo duplicado` e API Key já usada por outro dispositivo retorna `409 API Key já está em uso`; mensagem repetida retorna `409 Mensagem duplicada` e não cria outro registro. `status` e `attempt_count` da fila são sempre definidos pelo servidor; o `attempt_count` enviado pelo ESP32 (tentativas de envio) é gravado em `device_attempt_count`.

Telemetrias também podem informar `last_seen_at` em ISO 8601; o campo é opcional e fica `NULL` quando omitido.
A telemetria informa o estado do lacre em `seal_status` (`LOCKED`, `UNLOCKED` ou `BROKEN`). Quando latitude, longitude e `seal_status` forem iguais aos da última telemetria do dispositivo, a API responde `200 Posição já registrada; data e hora atualizadas`, atualiza apenas `last_seen_at` e guarda o `message_id` em `last_repeat_message_id`, sem inserir outra linha; um reenvio desse `message_id` retorna `409`. Se o estado do lacre mudar no mesmo lugar, uma nova linha é gravada.
Campos numéricos da telemetria (`latitude`, `longitude`, `speed_kmh`, `battery_percent`, `gsm_signal`) precisam ser números, senão a API retorna `400`. Latitude e longitude vêm juntas, com latitude entre -90 e 90 e longitude entre -180 e 180 (`400` fora disso). Telemetria para um `device_id` não cadastrado retorna `404`.

`ACTIVE`/`INACTIVE` representam o estado do dispositivo (`devices.active` igual a `1`/`0`). Em eventos, `seal_status` aceita `LOCKED`, `UNLOCKED` ou `BROKEN`; `events.status` continua reservado ao processamento da fila.

A tabela `status` cataloga esses códigos com nomes e descrições. Ela é separada porque `events.status` já significa estado de sincronização (`PENDING`, `PROCESSING`, `SYNCED` ou `ERROR`), não estado do dispositivo ou do lacre.

Comandos são consultados por dispositivo e só podem ser acessados pela API Key daquele dispositivo. A confirmação aceita `EXECUTADO` ou `ERRO`; comandos confirmados deixam de aparecer na lista de pendentes.

A tabela `devices` também possui `device_status_id`, `valve_status_id` e `seal_status_id`, colunas opcionais para guardar os IDs de estado associados. Dispositivos já cadastrados mantêm `NULL` nesses campos até serem atualizados.

A tabela `alerts` armazena alertas associados a dispositivos. `POST /api/v1/iot/alerts` exige a API Key do dispositivo e aceita `SEAL_BROKEN`, `GEOFENCE_EXIT`, `LOW_BATTERY`, `DEVICE_ERROR`, `COMMAND_FAILURE` ou `COMMUNICATION_LOST`. `severity` é opcional e aceita `BAIXA`, `MEDIA`, `ALTA` ou `CRITICA` (os mesmos valores do FluxID); sem ela, a API usa o padrão do tipo (`SEAL_BROKEN` → `CRITICA`; `GEOFENCE_EXIT` e `COMMAND_FAILURE` → `ALTA`; `DEVICE_ERROR` e `COMMUNICATION_LOST` → `MEDIA`; `LOW_BATTERY` → `BAIXA`). Todo alerta nasce com `status` `ABERTO`. Os campos antigos `status_id` e `severity_id` são ignorados.

## Documentos

- [Checklist de conclusão do projeto](Doc/Checklist-Projeto.md)
- [Regras de negócio da API e bancos FluxID/Oxide](Doc/Regras-de-Negocio-e-Banco-Oxide.md)
- [Desenvolvimento: como a API funciona (guia para o ESP32) e histórico de testes](Doc/Desenvolvimento.md)
- [Integração e payloads do ESP32](Doc/ESP32-envio-de-dados.md)
- [Especificação do banco SQLite Oxide](Doc/Oxidedb.md)
- [Banco PostgreSQL FluxID](Doc/Banco_FluxID.md)
- [Plano de Teste](Doc/Doc_tese/PlanoDeTeste.md)
- [Roteiro de Teste para IA](Doc/Doc_tese/RoteiroDeTeste.md)
