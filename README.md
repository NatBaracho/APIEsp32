# API ESP32

API REST em Node.js, TypeScript, Express e SQLite para receber dados de dispositivos ESP32.

O banco principal do projeto é o PostgreSQL FluxID. A Oxide (`oxide.db`) funciona como armazenamento local e buffer persistente; a API ainda grava somente no SQLite, pois o Worker de sincronização não está implementado. O arquivo `FluxID.sql` acompanha um dump PostgreSQL em formato custom (`PGDMP`), não um script SQL texto; use as ferramentas `pg_restore` para inspecioná-lo ou restaurá-lo.

## Executar localmente

```bash
npm install
npm start
```

O servidor inicia na porta `3000`.

## Testes

```bash
npx tsc --noEmit
npm test
```

O `npm test` sobe a própria instância da API; pare o `npm start` antes de executá-lo para que a suíte não teste um processo antigo. A suíte grava no `oxide.db` do diretório atual e remove os registros `DSP-TEST%` ao final; faça backup do banco antes. Resultado atual: 46/46.

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

Os POSTs de telemetria, eventos e alertas exigem `X-API-Key`; no alerta, a chave deve pertencer ao `device_id` enviado. Os campos `device_id` e `message_id` identificam os registros; `message_id` deve ser único por mensagem. Dispositivo repetido retorna `409 Dispositivo duplicado` e API Key já usada por outro dispositivo retorna `409 API Key já está em uso`; mensagem repetida retorna `409 Mensagem duplicada` e não cria outro registro. `status` e `attempt_count` da fila são sempre definidos pelo servidor.

Telemetrias também podem informar `last_seen_at` em ISO 8601; o campo é opcional e fica `NULL` quando omitido.
Quando latitude e longitude forem iguais à última posição registrada para o dispositivo, a API responde `202` e atualiza apenas `last_seen_at`, sem inserir outra linha; o `message_id` fica registrado em `telemetry_position_repeats` e um reenvio dele retorna `409`.
Campos numéricos da telemetria (`latitude`, `longitude`, `speed_kmh`, `battery_percent`, `gsm_signal`) precisam ser números, senão a API retorna `400`. Telemetria para um `device_id` não cadastrado retorna `404`.

`ACTIVE`/`INACTIVE` representam o estado do dispositivo (`devices.active` igual a `1`/`0`). Em eventos, `seal_status` aceita `LOCKED`, `UNLOCKED` ou `BROKEN`; `events.status` continua reservado ao processamento da fila.

A tabela `status` cataloga esses códigos com nomes e descrições. Ela é separada porque `events.status` já significa estado de sincronização (`PENDING`, `PROCESSING`, `SYNCED` ou `ERROR`), não estado do dispositivo ou do lacre.

Comandos são consultados por dispositivo e só podem ser acessados pela API Key daquele dispositivo. A confirmação aceita `EXECUTADO` ou `ERRO`; comandos confirmados deixam de aparecer na lista de pendentes.

A tabela `devices` também possui `device_status_id`, `valve_status_id` e `seal_status_id`, colunas opcionais para guardar os IDs de estado associados. Dispositivos já cadastrados mantêm `NULL` nesses campos até serem atualizados.

A tabela `alerts` armazena alertas associados a dispositivos. `POST /api/v1/iot/alerts` exige a API Key do dispositivo e aceita `SEAL_BROKEN`, `GEOFENCE_EXIT`, `LOW_BATTERY`, `DEVICE_ERROR`, `COMMAND_FAILURE` ou `COMMUNICATION_LOST`. `severity_id` referencia `status.id`, mas os níveis de severidade ainda precisam ser definidos no catálogo.

## Documentos

- [Checklist de conclusão do projeto](Doc/Checklist-Projeto.md)
- [Regras de negócio da API e bancos FluxID/Oxide](Doc/Regras-de-Negocio-e-Banco-Oxide.md)
- [Desenvolvimento, testes e histórico de correções](Doc/Desenvolvimento.md)
- [Integração e payloads do ESP32](Doc/ESP32-envio-de-dados.md)
- [Especificação do banco SQLite Oxide](Doc/Oxidedb.md)
- [Banco PostgreSQL FluxID](Doc/Banco_FluxID.md)
- [Plano de Teste](Doc/Doc_tese/PlanoDeTeste.md)
- [Roteiro de Teste para IA](Doc/Doc_tese/RoteiroDeTeste.md)
