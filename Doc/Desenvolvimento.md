# API ESP32 - Documentação de desenvolvimento e testes

## 1. Visão geral
O projeto consiste em uma API REST em Node.js + TypeScript, desenvolvida para receber dados de dispositivos ESP32 e armazená-los em SQLite. A API também foi estruturada para lidar com filas de eventos e telemetria, com organização por camadas (routes, controllers, services, repositories, models e database).

## 2. Estrutura atual do projeto

- src/server.ts: inicializa o servidor Express e registra as rotas da API.
- src/database/connection.ts: conexão com o banco SQLite via better-sqlite3.
- src/routes/telemetryRoutes.ts: rota para receber telemetria.
- src/routes/eventRoute.ts: rota para receber eventos.
- src/controllers/TelemetryController.ts: controller da telemetria.
- src/controllers/EventController.ts: controller dos eventos.
- src/controllers/DeviceController.ts: controller de consulta e cadastro de dispositivos.
- src/services/TelemetryService.ts: verifica duplicidade e encaminha telemetria à fila.
- src/services/EventService.ts: valida e encaminha eventos para persistência.
- src/services/DeviceService.ts: aplica regras de cadastro e identifica dispositivo duplicado.
- src/repositories/DeviceRepository.ts: operações do cadastro e controle de dispositivos.
- src/repositories/EventRepository.ts: persistência de eventos no SQLite.
- src/repositories/TelemetryQueueRepository.ts: conjunto de métodos para fila de telemetria.
- src/docs/openapi.ts: especificação OpenAPI servida pelo Swagger UI.
- src/models/Device.ts: modelo do dispositivo.
- src/models/Event.ts: modelo do evento.
- src/models/Telemetry.ts: modelo de telemetria.

## 3. Funcionalidades implementadas

### 3.1 Servidor Express
- API configurada com Express.
- Middleware para leitura de JSON.
- Middleware global para erros não tratados, registrado após as rotas e a rota raiz.
- Rota raiz (`/`) retornando mensagem de status da API.
- Servidor rodando na porta 3000.
- Interface Swagger UI disponível em `http://localhost:3000/api-docs` para explorar e testar os endpoints.

### 3.2 Conexão com SQLite
- Conexão configurada em `src/database/connection.ts`.
- Banco salvo localmente em `oxide.db`.
- Verificação inicial das tabelas do banco.
- Migração idempotente adiciona `device_status_id`, `valve_status_id` e `seal_status_id` à tabela `devices` sem recriá-la nem remover registros.
- Cria a tabela `alerts` idempotentemente, com FKs para dispositivos e status; o endpoint POST usa repository e service para registrar alertas.
- Cria a tabela `commands` idempotentemente para armazenar comandos destinados aos dispositivos; as rotas de consulta e confirmação usam `CommandRepository`, mas não há endpoint de criação.
- Adiciona `last_repeat_message_id`, `seal_status` e `device_attempt_count` a `telemetry_queue` e `device_attempt_count` a `events`; cria os triggers `trg_devices_active_insert`/`_update`, o índice `idx_telemetry_last_repeat_message_id` e o índice único `idx_devices_api_key` (este só quando não há chaves duplicadas).
- Uso de `better-sqlite3` para leitura e gravação.

### 3.3 Prefixo padronizado da API
- Prefixo base: `/api/v1`
- Aplicação de rotas usando o padrão: `${API_PREFIX}/...`
- Estrutura atual:
  - `POST /api/v1/iot/telemetries`
   - `GET /api/v1/iot/telemetries`
  - `POST /api/v1/iot/events`
   - `GET /api/v1/iot/commands/:deviceId`
   - `POST /api/v1/iot/commands/confirm`
   - `POST /api/v1/iot/alerts`
   - `GET /api/v1/devices`
  - `GET /api/v1/devices/:deviceId`
   - `POST /api/v1/devices`

### 3.4 Rota de telemetria
- Endpoint: `POST /api/v1/iot/telemetries`
- Responsável por receber dados enviados pelo dispositivo.
- O controller exige `message_id` e `device_id` antes de processar o payload; se algum estiver ausente, retorna `400 Bad Request` com `{"success":false,"message":"message_id e device_id são obrigatórios"}`.
- Campos numéricos (`latitude`, `longitude`, `speed_kmh`, `battery_percent`, `gsm_signal`) precisam ser números e `lacre_id`, `cilindro_id`, `payload_json` e `last_seen_at` precisam ser texto; tipo inválido retorna `400 Campo <nome> com tipo inválido`.
- Telemetria para `device_id` não cadastrado retorna `404 Dispositivo não encontrado`.
- Corpo ausente é tratado como objeto vazio para que a validação retorne `400`, em vez de provocar erro ao acessar propriedades.
- O service consulta a fila por `message_id` e por `last_repeat_message_id`; mensagem repetida retorna `409 Conflict` com `{"success":false,"message":"Mensagem duplicada"}` e não é inserida novamente.
- `seal_status` (estado do lacre) aceita `LOCKED`, `UNLOCKED` ou `BROKEN`; `attempt_count` do ESP32 precisa ser inteiro ≥ 0 e é gravado em `device_attempt_count`. Valores inválidos retornam `400`.
- Telemetria nova é persistida em `telemetry_queue` com `status = PENDING` e `attempt_count = 0` (colunas do Worker) e retorna `202 Accepted`.
- A fila contém `last_seen_at DATETIME`; o campo é opcional, aceito em formato ISO 8601 e salvo como `NULL` quando não informado.
- Se a última telemetria do dispositivo tiver as mesmas latitude, longitude e `seal_status`, o service atualiza somente `last_seen_at`, grava o `message_id` em `last_repeat_message_id`, não cria uma nova linha e a API responde `200` com `Posição já registrada; data e hora atualizadas`. Mudança de estado do lacre no mesmo lugar gera nova linha.
- `GET /api/v1/iot/telemetries` lista todas as telemetrias em ordem decrescente de `id` e exige `X-API-Key`.

### 3.5 Rota de eventos
- Endpoint: `POST /api/v1/iot/events`
- Responsável por receber eventos do ESP32 ou da aplicação.
- Validação dos campos obrigatórios `message_id`, `device_id` e `event_type`, retornando `400 Bad Request` quando ausentes.
- A resposta de validação é `{"success":false,"message":"message_id, device_id e event_type são obrigatórios"}`; o evento incompleto não é encaminhado ao service.
- Quando informado, `seal_status` aceita `LOCKED`, `UNLOCKED` ou `BROKEN` e é gravado em `events.seal_status`; os demais valores retornam `400`.
- `events.status` permanece reservado ao processamento da fila (`PENDING`, `PROCESSING`, `SYNCED`, `ERROR`) e é definido pelo servidor. `ACTIVE`/`INACTIVE` correspondem ao estado numérico `devices.active` (`1`/`0`).
- Validação de duplicidade por `message_id`.
- Evento repetido retorna `409 Conflict` com `{"success":false,"message":"Mensagem duplicada"}` e não é persistido novamente.
- Persistência do evento no banco, sempre com `attempt_count = 0`; o `attempt_count` do ESP32 vai para `device_attempt_count`.
- Criação automática de dispositivo caso ele ainda não exista.

### 3.6 Repositórios
- `DeviceRepository`: busca (inclusive por `api_key`, usada pelo middleware), criação, atualização, desativação e verificação de existência do dispositivo.
- `EventRepository`: grava eventos, consulta por message_id, lista pendentes e marca status.
- `TelemetryQueueRepository`: métodos de criação, busca por `message_id`, verificação de `message_id` também em `last_repeat_message_id` (`messageIdExists`), busca da última telemetria por `device_id` (`findLastByDeviceId`), atualização de `last_seen_at` e de `last_repeat_message_id` (`updateLastSeen`), processamento, sincronização e erro.
- `CommandRepository`: lista comandos pendentes por dispositivo e confirma execução/erro.
- `AlertRepository`: verifica `alert_id` e IDs do catálogo e persiste alertas.
- `device_id` e `api_key` identificam unicamente dispositivos; `message_id` identifica unicamente eventos e telemetrias. As tabelas possuem restrição `UNIQUE` (ou índice único) no SQLite como proteção adicional.
- Consultas `GET` são somente leitura e podem ser repetidas sem criar registros. O aviso `409` é aplicado aos `POST` que tentam cadastrar/enfileirar uma identidade já existente.

### 3.7 Catálogo de status e separação dos estados
- A tabela `status` guarda uma linha por código, com nome legível e descrição. Ela permite apresentar os mesmos códigos de forma consistente sem repetir textos descritivos nos eventos.
- A tabela é necessária porque `events.status` já tem outra responsabilidade: controlar o processamento da fila (`PENDING`, `PROCESSING`, `SYNCED`, `ERROR`). Reutilizá-la para estados do dispositivo ou do lacre confundiria o fluxo do Worker.
- `ACTIVE` e `INACTIVE` descrevem o dispositivo e correspondem a `devices.active = 1` e `devices.active = 0`.
- `LOCKED`, `UNLOCKED` e `BROKEN` descrevem o lacre e são enviados em `events.seal_status`.
- A tabela `status` é criada e semeada de forma idempotente por `src/database/connection.ts`. O controller valida os códigos aceitos para `seal_status`; `events.status` continua sendo definido pelo backend.
- `devices.device_status_id`, `devices.valve_status_id` e `devices.seal_status_id` armazenam IDs de estado opcionais; os registros anteriores à migração ficam com `NULL` até receberem valores.

### 3.8 Comandos para dispositivos
- `GET /api/v1/iot/commands/:deviceId` lista apenas comandos `PENDENTE`, por ordem de criação.
- `POST /api/v1/iot/commands/confirm` recebe `command_id`, `device_id`, `status` (`EXECUTADO` ou `ERRO`) e `error_message` opcional; a API preenche `executed_at`.
- As duas rotas exigem a API Key correspondente ao dispositivo e impedem confirmação repetida.

## 4. Observações técnicas importantes

- O projeto teve ajustes para corrigir imports, nomes de arquivos e inconsistências no schema do SQLite.
- O banco possui nomes reais de colunas diferentes de algumas convenções iniciais do código, sendo necessário alinhar as queries ao schema real.
- A conexão com SQLite e a API foram validadas com requisições HTTP reais, retornando os status esperados para telemetria e eventos.
- A rota de consulta de dispositivo foi validada com sucesso em `GET /api/v1/devices/DSP-000001`, retornando status `200 OK` com o registro do dispositivo.

## 5. Histórico de erros e correções

### 5.1 Middleware com caminho incorreto
- Problema: a rota de telemetria e a rota de eventos importavam `../middlewares/apiKeyMiddleware`, mas o diretório real do projeto era `src/Middleware/apiKeyMiddleware.ts`. Isso fazia o código apontar para um arquivo inexistente e quebrava a autenticação.
- Como foi consertado: o import foi ajustado para `../Middleware/apiKeyMiddleware` nos arquivos `src/routes/telemetryRoutes.ts` e `src/routes/eventRoute.ts`.
- Resultado: a autenticação por API key voltou a ser resolvida corretamente.

### 5.2 Falta de import do middleware na rota de eventos
- Problema: o arquivo `src/routes/eventRoute.ts` usava `apiKeyMiddleware` no `router.post(...)`, mas o `import` correspondente não estava presente. Isso gerava erro de referência e a rota não era registrada corretamente.
- Como foi consertado: foi adicionado o import `import { apiKeyMiddleware } from "../Middleware/apiKeyMiddleware";`.
- Resultado: a rota de eventos passou a validar a chave `X-API-Key` antes de processar o payload.

### 5.3 Inconsistência de nomes de colunas no SQLite
- Problema: o código utilizava nomes de colunas diferentes dos que existem no banco. Isso causava falhas em consultas por campos inexistentes e interrompia a persistência de dados.
- Como foi consertado: os repositórios e queries foram alinhados ao schema real do SQLite, incluindo nomes de colunas e valores padrão compatíveis com o banco.
- Resultado: gravações e consultas passaram a funcionar com o padrão real da base.

### 5.4 Erro de chave estrangeira ao receber evento com device inexistente
- Problema: ao criar eventos, a aplicação tentava gravar um registro referente a um `device_id` que ainda não existia no banco, gerando falha de integridade referencial.
- Como foi consertado: foi implementado o fluxo de verificação e criação automática do dispositivo antes de salvar o evento, com validação via `ensureDeviceExists` e criação em `DeviceRepository`.
- Resultado: a API passou a aceitar eventos mesmo quando o dispositivo ainda não havia sido cadastrado manualmente.

### 5.5 Problemática de tipagem em `req.params` no `DeviceController`
- Problema: o valor de `req.params.deviceId` poderia ser `undefined` e o código trabalhava com a variável como se fosse sempre string válida, o que gerava comportamento inconsistente em runtime.
- Como foi consertado: a leitura do parâmetro foi normalizada em uma variável local e validada com checagem de tipo antes da busca no repositório.
- Resultado: a rota `GET /api/v1/devices/:deviceId` passou a responder corretamente com status `200` quando o identificador era válido.

### 5.6 Prefixo de API inconsistente
- Problema: as rotas do sistema estavam sendo montadas com prefixos divergentes, gerando confusão na chamada dos endpoints e inconsistência de convenção.
- Como foi consertado: foi padronizado o uso de `API_PREFIX = "/api/v1"` e todas as rotas foram montadas seguindo o mesmo padrão em `src/server.ts`.
- Resultado: a API passou a seguir a convenção `/api/v1/...` de forma consistente.

## 6. Testes finais executados

### 6.1 Validação de compilação
- Comando executado: `npx tsc --noEmit`
- Resultado: sucesso, sem erros de TypeScript.

### 6.2 Validação do servidor
- Comando executado: `npm start`
- Resultado: servidor iniciado corretamente na porta 3000.

### 6.3 Casos de teste executados
1. `GET /`
   - Resultado esperado: `200 OK`
   - Resultado obtido: `200 OK` com resposta `API ESP32 Online`

2. `GET /api/v1/devices/DSP-000001`
   - Resultado esperado: retornou dispositivo cadastrado
   - Resultado obtido: `200 OK` com payload válido

3. `POST /api/v1/iot/telemetries` com payload válido
   - Resultado esperado: `202 Accepted`
   - Resultado obtido: `202` e `{"success":true,"message":"Telemetria recebida"}`

4. `POST /api/v1/iot/events` com payload válido
   - Resultado esperado: `202 Accepted`
   - Resultado obtido: `202` e `{"success":true,"message":"Evento recebido"}`

5. `POST /api/v1/iot/events` com `message_id` duplicado
   - Resultado esperado: mensagem de prevenção de duplicidade
   - Resultado obtido: `409 Conflict` e `{"success":false,"message":"Mensagem duplicada"}`

6. `POST /api/v1/iot/telemetries` sem `device_id`
   - Resultado esperado: `400 Bad Request`
   - Resultado obtido: `400` e `{"success":false,"message":"message_id e device_id são obrigatórios"}`

7. `POST /api/v1/iot/events` sem `X-API-Key`
   - Resultado esperado: `401 Unauthorized`
   - Resultado obtido: `401` e `{"success":false,"message":"API Key obrigatória"}`

8. `POST /api/v1/iot/events` com `X-API-Key` inválida
   - Resultado esperado: `401 Unauthorized`
   - Resultado obtido: `401` e `{"success":false,"message":"API Key inválida"}`

9. `GET /api-docs`
   - Resultado esperado: interface Swagger UI disponível.
   - Resultado obtido: `200 OK`, com resposta HTML da interface.

10. `GET /api-docs/swagger-ui-init.js`
    - Resultado esperado: especificação OpenAPI carregada com as rotas e a autenticação documentadas.
    - Resultado obtido: `200 OK`; conteúdo confirmou o título `API ESP32`, rotas de dispositivos e telemetria e o header `X-API-Key`.

11. `POST /api/v1/iot/events` sem `event_type`
   - Resultado esperado: `400 Bad Request` antes de chamar o service.
   - Resultado obtido: `400` e `{"success":false,"message":"message_id, device_id e event_type são obrigatórios"}`.

12. `POST /api/v1/iot/telemetries` sem `device_id`
   - Resultado esperado: `400 Bad Request`.
   - Resultado obtido: `400` e `{"success":false,"message":"message_id e device_id são obrigatórios"}`.

13. `GET /api/v1/devices` e `GET /api/v1/devices/DSP-000001`
   - Resultado esperado: `200 OK`; consultas não criam novos registros.
   - Resultado obtido: ambos retornaram `200 OK`.

14. `POST /api/v1/devices` com `device_id` já cadastrado
   - Resultado esperado: `409 Conflict` e nenhuma nova linha.
   - Resultado obtido: `409` e `{"success":false,"message":"Dispositivo duplicado"}`.

15. `POST /api/v1/iot/events` com `message_id` já cadastrado
   - Resultado esperado: `409 Conflict` e nenhuma nova linha.
   - Resultado obtido: `409` e `{"success":false,"message":"Mensagem duplicada"}`.

16. Duas chamadas de `POST /api/v1/iot/telemetries` com o mesmo `message_id`
   - Resultado esperado: primeira chamada `202`; repetição `409`; somente uma linha na fila.
   - Resultado obtido: `202` na primeira chamada, `409` na segunda e exatamente uma linha para `MSG-DUPTEST-20261004-001`.

17. Verificação de duplicatas nas tabelas `devices`, `events` e `telemetry_queue`
   - Resultado esperado: nenhuma identidade duplicada.
   - Resultado obtido: zero duplicatas nas três tabelas após os testes.

18. `POST /api/v1/iot/telemetries` com `last_seen_at`
   - Resultado esperado: `202 Accepted` e timestamp persistido na coluna `DATETIME`.
   - Resultado obtido: `202`; `PRAGMA table_info` confirmou `last_seen_at` como `DATETIME` e a consulta retornou `2026-10-04T15:30:00.000Z`.

19. Duas telemetrias consecutivas com as mesmas coordenadas e `message_id` diferentes
   - Resultado esperado: ambas retornam `202`, mas apenas uma linha é criada; a repetição atualiza `last_seen_at` da linha existente.
   - Resultado obtido: ambas retornaram `202`; somente `MSG-POSITION-20261004-A` ficou salvo para a posição `-8.001, -40.001`, com `last_seen_at` atualizado. A posição diferente `MSG-POSITION-20261004-C` foi inserida normalmente.

20. Duas telemetrias sem latitude/longitude e com `message_id` distintos
   - Resultado esperado: ambas são persistidas, pois coordenadas ausentes não representam uma posição repetida.
   - Resultado obtido: ambas retornaram `202` e as duas linhas foram confirmadas com coordenadas `NULL`.

21. `GET /api/v1/iot/telemetries` com chave válida e sem chave
   - Resultado esperado: lista ordenada por `id` decrescente com chave válida; `401 Unauthorized` sem `X-API-Key`.
   - Resultado obtido: `200 OK` com 10 registros (`id` 10 antes do 9); sem chave, `401` e `API Key obrigatória`.

22. `POST /api/v1/iot/telemetries` com JSON malformado
   - Resultado esperado: `400 Bad Request` com mensagem genérica de requisição inválida.
   - Resultado obtido: `400` e `{"success":false,"message":"Requisição inválida"}`.

23. `POST /api/v1/iot/events` com `seal_status: LOCKED`
   - Resultado esperado: `202 Accepted`, código em `events.seal_status` e `events.status` mantido como `PENDING`.
   - Resultado obtido: `202`; o registro de teste confirmou `seal_status = LOCKED` e `status = PENDING`.

24. `POST /api/v1/iot/events` com `seal_status: closed`
   - Resultado esperado: `400 Bad Request`, sem inserir evento, pois `closed` não pertence ao catálogo.
   - Resultado obtido: `400` e nenhuma linha para o `message_id` de teste.

25. Migração dos campos de status de `devices`
   - Resultado esperado: acrescentar `device_status_id`, `valve_status_id` e `seal_status_id`, preservando os registros existentes.
   - Resultado obtido: os campos foram adicionados sem recriar a tabela; valores permanecem `NULL` até serem definidos.

26. Schema da tabela `commands`
   - Resultado esperado: default `PENDENTE`, `command_id` único e FK de `device_id` para `devices.device_id` com `ON UPDATE CASCADE` e `ON DELETE RESTRICT`.
   - Resultado obtido: os três comportamentos foram confirmados em transação de teste revertida; nenhum comando de teste permaneceu no banco.

27. GET de comandos pendentes e confirmação
   - Resultado esperado: GET retorna somente PENDENTE; confirmação marca EXECUTADO/ERRO, grava `executed_at` e remove o comando da lista pendente.
   - Resultado obtido: GET retornou o comando PENDENTE; confirmações `EXECUTADO` e `ERRO` retornaram `200` e gravaram `executed_at`; `error_message` foi salvo no caso `ERRO`; a confirmação repetida retornou `409`; chave de outro dispositivo retornou `403`; status inválido retornou `400`. Os comandos temporários foram removidos após o teste.

28. Schema da tabela `alerts`
   - Resultado esperado: `alert_id` único, default `CURRENT_TIMESTAMP` e FKs para `devices.device_id` e `status.id`.
   - Resultado obtido: a tabela e suas três FKs foram confirmadas por `PRAGMA`; nenhum alerta foi inserido.

29. `POST /api/v1/iot/alerts`
   - Resultado esperado: `201` para alerta válido; `409` para `alert_id` repetido; `400` para tipo/IDs inválidos; `403` se a API Key não pertencer ao dispositivo.
   - Resultado obtido: os quatro status foram confirmados; o alerta temporário foi removido após o teste.

30. `POST /api/v1/iot/alerts` com `alert_type: SEAL_BROKEN`
   - Resultado esperado: `201 Created` e persistência do alerta de lacre rompido.
   - Resultado obtido: `201`; a resposta confirmou `alert_type = SEAL_BROKEN` e o registro foi consultado no SQLite. O teste usou uma cópia temporária do banco; a base original não foi alterada.

Observação: um corpo JSON literal `null` é rejeitado pelo parser JSON do Express antes de chegar ao controller, também com status `400`.

### 6.4 Processo de validação
- Validação assistida por IA: conferência da compilação TypeScript e execução de chamadas HTTP para verificar as respostas da API e a publicação da especificação Swagger.
- Validação humana: revisão e conferência manual dos resultados por Natã da Silva Baracho, responsável pela validação humana do projeto.
- Para os testes manuais no Swagger, acessar `http://localhost:3000/api-docs`. Nos endpoints protegidos, informar uma API Key válida em **Authorize**.

## 7. Erro identificado e correção aplicada

### 7.1 Erro de coluna no SQLite
Durante a validação do evento válido, a API devolveu `500 Internal Server Error` com o erro:
- `SqliteError: table events has no column named message_type`

Isso ocorreu porque o banco SQLite havia sido criado com colunas com grafia incorreta, como:
- `messge_tyoe`
- `seel_status`
- `firmware_versin `

### Como foi corrigido
Foi implementada uma migração de schema no arquivo `src/database/connection.ts` que verifica as colunas antigas e renomeia automaticamente para os nomes corretos:
- `messge_tyoe` -> `message_type`
- `seel_status` -> `seal_status`
- `firmware_versin ` -> `firmware_version`

Também foi ajustado o `INSERT` no repositório para usar os nomes padronizados do schema final.

### Resultado da correção
A API passou a aceitar eventos válidos corretamente e voltou a responder com `202 Accepted` em vez de `500`.

### 7.2 Resposta 404 inicial na documentação Swagger
- Problema: a primeira chamada a `GET /api-docs` retornou `404 Not Found`.
- Causa: o processo Node.js que atendia a porta 3000 havia sido iniciado antes da inclusão da rota Swagger e ainda executava a versão anterior do servidor.
- Como foi corrigido: a instância antiga da API foi reiniciada com `npm start`, carregando a rota `/api-docs` adicionada em `src/server.ts`.
- Resultado: `GET /api-docs` e `GET /api-docs/swagger-ui-init.js` passaram a retornar `200 OK`.

### 7.3 Duplicidade de dispositivo não era informada pelo controller
- Problema: `DeviceService` detectava o `device_id` existente e não inseria outro registro, mas não informava o controller; o endpoint podia responder sucesso indevidamente.
- Como foi corrigido: o service agora retorna `false` para dispositivo existente e o controller responde `409 Conflict` com `Dispositivo duplicado`.
- Resultado: o POST repetido foi rejeitado e o banco continuou sem duplicatas.

### 7.4 Telemetria não usava o service nem persistia na fila
- Problema: `TelemetryController` apenas registrava a mensagem no console e não chamava `TelemetryService`; por isso não consultava `message_id` nem gravava a telemetria.
- Como foi corrigido: o controller passou a usar o service, que verifica duplicidade, salva a primeira mensagem e retorna o resultado ao controller para responder `409` nas repetições.
- Problema adicional: o schema da fila tinha nomes legados e exigia como obrigatórios campos que a API define como opcionais.
- Como foi corrigido: a inicialização normaliza os nomes e migra a tabela preservando as linhas e IDs, tornando opcionais os campos de telemetria opcionais no contrato.
- Resultado: a primeira chamada retornou `202`, a repetida retornou `409`, e o SQLite manteve exatamente uma linha com aquele `message_id`.

### 7.5 Inclusão de `last_seen_at` na fila
- Necessidade: registrar opcionalmente a data/hora da última leitura associada à telemetria.
- Como foi implementado: a inicialização adiciona `last_seen_at DATETIME` somente quando a coluna ainda não existe; o repository e o modelo aceitam o valor opcional, e o Swagger documenta o formato ISO 8601.
- Resultado: o POST de teste retornou `202` e o valor enviado foi confirmado no SQLite. Quando omitido, o campo permanece `NULL`.

### 7.6 Repetição da última posição
- Regra: coordenadas presentes e iguais à última telemetria do mesmo dispositivo não geram nova linha, mesmo com `message_id` novo.
- Como foi implementado: `TelemetryService` busca a última linha por `device_id`; em caso de mesma latitude e longitude, chama `updateLastSeen` e retorna sucesso ao controller.
- Resultado: a requisição repetida respondeu `202`, atualizou o horário e não duplicou a telemetria; coordenadas diferentes ou ausentes continuam sendo inseridas.
- Correção posterior (06/10/2026): o `message_id` da posição repetida não era guardado, então um reenvio recebia `202` de novo. Ver 7.11.

### 7.7 Middleware global de erros
- Problema: `server.ts` importava `./Middleware/errorHandler`, mas o arquivo existente se chama `Errohandler.ts`, impedindo a compilação. Além disso, o handler convertia erros do parser JSON em `500`.
- Como foi corrigido: o import foi alinhado ao nome real, o middleware foi colocado após as rotas e passou a preservar status HTTP válidos, encaminhando erros quando os headers já foram enviados.
- Resultado: `npx tsc --noEmit` passou; JSON malformado retorna `400`, enquanto `/` e o GET autenticado de telemetrias continuam respondendo `200`.

### 7.8 Catálogo de status para dispositivos e eventos
- Necessidade: manter descrições legíveis para os códigos `ACTIVE`, `INACTIVE`, `LOCKED`, `UNLOCKED` e `BROKEN`.
- Por que uma tabela separada: `events.status` já representa o ciclo da fila. Um catálogo separado evita misturar esse fluxo com os estados de negócio e armazena código, nome e descrição em um único lugar.
- Como foi corrigido: `connection.ts` cria e semeia a tabela `status` idempotentemente; `ACTIVE`/`INACTIVE` mapeiam para `devices.active`, e os estados do lacre são aceitos em `events.seal_status`. O campo `events.status` continua controlando a sincronização.
- Resultado: o teste gravou `LOCKED` em `events.seal_status`, mantendo `events.status = PENDING`.

### 7.9 Tabela de comandos
- Necessidade: persistir comandos destinados aos dispositivos, com identificação única, estado de execução, datas e mensagem de erro.
- Como foi implementado: `connection.ts` cria `commands` se ainda não existir, com FK para `devices.device_id`; a migração não cria endpoint nem repository.
- Resultado: default `PENDENTE`, unicidade de `command_id` e integridade referencial foram testados; as inserções de validação foram revertidas.

### 7.10 Tabela de alertas
- Necessidade: registrar alertas de lacre, geofence, bateria, erro do dispositivo, falha de comando e perda de comunicação.
- Como foi implementado: `connection.ts` cria `alerts` se ainda não existir, com FK para dispositivo e duas FKs para `status`.
- Resultado: schema e constraints confirmados. Os tipos previstos são `SEAL_BROKEN`, `GEOFENCE_EXIT`, `LOW_BATTERY`, `DEVICE_ERROR`, `COMMAND_FAILURE` e `COMMUNICATION_LOST`.
- Pendência: o catálogo `status` atual não contém severidades, embora `severity_id` aponte para ele; os códigos de severidade precisam ser definidos antes de inserir alertas com validação de domínio.

### 7.11 Correções da revisão do plano de teste (06/10/2026)
A análise do código contra o Plano de Teste encontrou falhas reproduzidas em uma cópia do `oxide.db`:

| Problema | Correção | Resultado |
| --- | --- | --- |
| Reenvio do `message_id` de uma posição repetida respondia `202`, quebrando a idempotência (RN14). | Primeira versão com a tabela `telemetry_position_repeats`; substituída em 7.12 pela coluna `last_repeat_message_id`. | Reenvio retorna `409 Mensagem duplicada`. |
| O cliente definia `status` e `attempt_count` da telemetria (ex.: `SYNCED`), o que faria o Worker ignorar a linha. O mesmo valia para `attempt_count` de eventos. | Repositories gravam sempre `PENDING` e `0`; o campo `status` saiu do exemplo do Swagger. | Valores do cliente ignorados. |
| `POST /devices` aceitava `api_key` já usada por outro dispositivo. | `DeviceService` verifica a chave (`409 API Key já está em uso`) e a inicialização cria `idx_devices_api_key`. O middleware passou a buscar por `findByApiKey` em vez de listar todos os dispositivos. | Chave duplicada rejeitada. |
| `active` aceitava qualquer valor; o `oxide.db` real não tinha o `CHECK` do script. | Validação no controller (`400`) e triggers que reproduzem o `CHECK`. | `active` fora de `0`/`1` rejeitado na API e no banco. |
| Tipos inválidos (`latitude: true`, `payload_json` objeto) e `device_id` inexistente geravam `500`. | Validação de tipos no controller e verificação do dispositivo no service; violação `UNIQUE` convertida em `409`. | `400` para tipo inválido e `404` para dispositivo inexistente. |

Compilação aprovada e suíte com 46/46 (seis casos novos).

### 7.12 Ajustes definidos na validação (06/10/2026)
Na validação da 7.11, Natã da Silva Baracho recusou a tabela `telemetry_position_repeats` e explicou o papel do ESP32: ele fica no lacre do cilindro, informa se o lacre está fechado, aberto ou rompido e conta as próprias tentativas de envio. Ajustes aprovados:

| Decisão | Implementação |
| --- | --- |
| Guardar o `message_id` da posição repetida sem tabela nova | Coluna `telemetry_queue.last_repeat_message_id` com índice; guarda só a repetição mais recente de cada linha. |
| Avisar o ESP32 que a posição já existe | Resposta `200 Posição já registrada; data e hora atualizadas` (dado novo continua `202`). |
| Estado do lacre na telemetria | Campo `seal_status` (`LOCKED`, `UNLOCKED`, `BROKEN`), validado (`400`) e gravado em coluna própria. |
| Rompimento no mesmo lugar não pode se perder | Só é repetição quando posição **e** `seal_status` são iguais; mudança de estado gera nova linha. |
| Tentativas de envio do ESP32 | `attempt_count` do payload vai para `device_attempt_count` (telemetria e eventos), inteiro ≥ 0; `attempt_count` da fila continua sendo do Worker. |

Compilação aprovada, suíte com 50/50 (quatro casos novos) e Roteiro de Teste v1.2 executado de ponta a ponta. Validação registrada em [Relatorio-de-Teste-2026-10-06.md](Doc_tese/Relatorio-de-Teste-2026-10-06.md), **aprovada por Natã da Silva Baracho**.

## 8. Status atual

Status geral: em funcionamento e validado com testes reais de integração.

### Rotas validadas
- `GET /` -> funcionando
- `GET /api/v1/devices/DSP-000001` -> funcionando
- `GET /api/v1/devices` -> funcionando
- `POST /api/v1/devices` -> funcionando
- `POST /api/v1/iot/telemetries` -> funcionando
- `POST /api/v1/iot/events` -> funcionando
- `POST /api/v1/iot/alerts` com `SEAL_BROKEN` -> validado (`201 Created`)
- `POST /api/v1/devices` com duplicidade -> `409 Dispositivo duplicado`
- `POST /api/v1/devices` com `api_key` já usada -> `409 API Key já está em uso`
- `POST /api/v1/iot/telemetries` com posição e lacre iguais à última -> `200 Posição já registrada; data e hora atualizadas`
- `POST /api/v1/iot/telemetries` com duplicidade, inclusive de posição repetida -> `409 Mensagem duplicada`
- `POST /api/v1/iot/events` com duplicidade -> `409 Mensagem duplicada`
- validação de payload obrigatório -> funcionando
- autenticação por API key -> funcionando
- Swagger UI em `/api-docs` -> funcionando e especificação OpenAPI carregada
- Persistência de telemetria em `telemetry_queue` -> funcionando

### Etapas do projeto
- [x] Banco SQLite
- [x] API REST
- [x] Controllers
- [x] Services
- [x] Repositories
- [x] Rotas
- [x] API Key
- [x] Swagger
- [ ] Worker de sincronização
- [ ] `SyncLogRepository` em uso real
- [ ] `SyncItemRepository` em uso real
- [x] API/repository de comandos em uso real
- [x] Endpoint/repository básico de criação de alertas
- [ ] DTOs com validação automática
- [x] Testes automatizados

### Convenção de rota atual
A API está organizada com o prefixo padrão `/api/v1`, e a estrutura atual é:
- `/api/v1/iot/telemetries`
- `/api/v1/iot/events`
- `/api/v1/iot/commands/:deviceId`
- `/api/v1/iot/commands/confirm`
- `/api/v1/iot/alerts`
- `/api/v1/devices`
- `/api/v1/devices/:deviceId`

## 9. Suíte de testes automatizados (`npm test`)

Foi criada uma suíte completa de testes automatizados de ponta a ponta em `tests/api.test.ts` (executável com `npm test`), cobrindo 50 casos de teste:
1. **Geral & Documentação**: rota raiz `/`, interface `/api-docs/` e especificação `/api-docs/swagger-ui-init.js`.
2. **Dispositivos (`/api/v1/devices`)**: listagem, busca por ID, tratamento de 404, validação 400, criação com sucesso 201, conflito de duplicidade 409, `api_key` já usada (409) e `active` inválido (400).
3. **Autenticação (`X-API-Key`)**: 401 sem header, 401 com chave inválida, 403 para dispositivo inativo e 200 com chave válida.
4. **Telemetria (`/api/v1/iot/telemetries`)**: validação de campos obrigatórios (400), payload válido (202), duplicidade de `message_id` (409), regra de mesma posição GPS respondendo 200 e atualizando apenas `last_seen_at` sem duplicar linha, posição nova criando linha, reenvio de posição repetida (409), `attempt_count` do ESP32 gravado em `device_attempt_count`, tipo inválido (400), dispositivo inexistente (404), `seal_status` inválido (400), mudança do lacre na mesma posição criando linha, `attempt_count` negativo (400) e tratamento de JSON malformado (400).
5. **Eventos (`/api/v1/iot/events`)**: autenticação (401), validação de campos obrigatórios (400), validação do catálogo `seal_status` (400), evento válido (202), `attempt_count` do ESP32 gravado em `device_attempt_count`, auto-criação de dispositivo inexistente (202) e prevenção de duplicidade (409).
6. **Comandos (`/api/v1/iot/commands`)**: listagem de comandos pendentes, restrição de acesso por dispositivo (403), confirmação como EXECUTADO (200), bloqueio de reconfirmação (409) e exclusão da lista de pendentes.
7. **Alertas (`/api/v1/iot/alerts`)**: autenticação (401), checagem de chave por dispositivo (403), validação de `alert_type` (400), integridade de `status_id`/`severity_id` (400), criação de alerta (201) e duplicidade de `alert_id` (409).
8. **Teardown e Integridade**: limpeza automática dos registros temporários gerados durante os testes, garantindo banco limpo após a execução.

### Correção no cadastro de dispositivos
- **Problema**: `DeviceRepository.create` vinculava `device.active` diretamente na query SQL. Quando omitido pelo payload do cliente, o valor chegava como `undefined` e o better-sqlite3 atribuía `NULL`, violando a constraint `NOT NULL` do SQLite e gerando erro 500.
- **Correção**: Adicionados fallbacks seguros: `device.active ?? 1` e `device.firmware_version ?? null`.

## 10. Próximos passos sugeridos
- implementar o Worker de sincronização da fila;
- integrar `SyncLogRepository` ao fluxo real de sincronização;
- integrar `SyncItemRepository` ao fluxo real de sincronização;
- adicionar validação automática aos DTOs (ex.: class-validator ou Zod).

## 11. Conclusão
A API está estruturada em camadas, conectada ao SQLite, com o schema corrigido e validada em 50 testes automatizados de integração cobrindo fluxos felizes e exceções. O projeto está estável e pronto para a evolução dos workers de sincronização.
