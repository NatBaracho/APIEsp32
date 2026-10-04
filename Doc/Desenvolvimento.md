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
- Rota raiz (`/`) retornando mensagem de status da API.
- Servidor rodando na porta 3000.
- Interface Swagger UI disponível em `http://localhost:3000/api-docs` para explorar e testar os endpoints.

### 3.2 Conexão com SQLite
- Conexão configurada em `src/database/connection.ts`.
- Banco salvo localmente em `oxide.db`.
- Verificação inicial das tabelas do banco.
- Uso de `better-sqlite3` para leitura e gravação.

### 3.3 Prefixo padronizado da API
- Prefixo base: `/api/v1`
- Aplicação de rotas usando o padrão: `${API_PREFIX}/...`
- Estrutura atual:
  - `POST /api/v1/iot/telemetries`
   - `GET /api/v1/iot/telemetries`
  - `POST /api/v1/iot/events`
   - `GET /api/v1/devices`
  - `GET /api/v1/devices/:deviceId`
   - `POST /api/v1/devices`

### 3.4 Rota de telemetria
- Endpoint: `POST /api/v1/iot/telemetries`
- Responsável por receber dados enviados pelo dispositivo.
- O controller exige `message_id` e `device_id` antes de processar o payload; se algum estiver ausente, retorna `400 Bad Request` com `{"success":false,"message":"message_id e device_id são obrigatórios"}`.
- Corpo ausente é tratado como objeto vazio para que a validação retorne `400`, em vez de provocar erro ao acessar propriedades.
- O service consulta a fila por `message_id`; mensagem repetida retorna `409 Conflict` com `{"success":false,"message":"Mensagem duplicada"}` e não é inserida novamente.
- Telemetria nova é persistida em `telemetry_queue` e retorna `202 Accepted`.
- A fila contém `last_seen_at DATETIME`; o campo é opcional, aceito em formato ISO 8601 e salvo como `NULL` quando não informado.
- Se a última telemetria do dispositivo tiver as mesmas latitude e longitude, o service atualiza somente `last_seen_at` e não cria uma nova linha.
- `GET /api/v1/iot/telemetries` lista todas as telemetrias em ordem decrescente de `id` e exige `X-API-Key`.

### 3.5 Rota de eventos
- Endpoint: `POST /api/v1/iot/events`
- Responsável por receber eventos do ESP32 ou da aplicação.
- Validação dos campos obrigatórios `message_id`, `device_id` e `event_type`, retornando `400 Bad Request` quando ausentes.
- A resposta de validação é `{"success":false,"message":"message_id, device_id e event_type são obrigatórios"}`; o evento incompleto não é encaminhado ao service.
- Validação de duplicidade por `message_id`.
- Evento repetido retorna `409 Conflict` com `{"success":false,"message":"Mensagem duplicada"}` e não é persistido novamente.
- Persistência do evento no banco.
- Criação automática de dispositivo caso ele ainda não exista.

### 3.6 Repositórios
- `DeviceRepository`: busca, criação, atualização, desativação e verificação de existência do dispositivo.
- `EventRepository`: grava eventos, consulta por message_id, lista pendentes e marca status.
- `TelemetryQueueRepository`: métodos de criação, busca por `message_id`, busca da última telemetria por `device_id` (`findLastByDeviceId`), atualização de `last_seen_at` (`updateLastSeen`), processamento, sincronização e erro.
- `device_id` identifica unicamente dispositivos; `message_id` identifica unicamente eventos e telemetrias. As três tabelas possuem restrição `UNIQUE` no SQLite como proteção adicional.
- Consultas `GET` são somente leitura e podem ser repetidas sem criar registros. O aviso `409` é aplicado aos `POST` que tentam cadastrar/enfileirar uma identidade já existente.

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

## 8. Status atual

Status geral: em funcionamento e validado com testes reais de integração.

### Rotas validadas
- `GET /` -> funcionando
- `GET /api/v1/devices/DSP-000001` -> funcionando
- `GET /api/v1/devices` -> funcionando
- `POST /api/v1/devices` -> funcionando
- `POST /api/v1/iot/telemetries` -> funcionando
- `POST /api/v1/iot/events` -> funcionando
- `POST /api/v1/devices` com duplicidade -> `409 Dispositivo duplicado`
- `POST /api/v1/iot/telemetries` com duplicidade -> `409 Mensagem duplicada`
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
- [ ] DTOs com validação automática
- [ ] Testes automatizados

### Convenção de rota atual
A API está organizada com o prefixo padrão `/api/v1`, e a estrutura atual é:
- `/api/v1/iot/telemetries`
- `/api/v1/iot/events`
- `/api/v1/devices`
- `/api/v1/devices/:deviceId`

## 9. Próximos passos sugeridos
- implementar o Worker de sincronização da fila;
- integrar `SyncLogRepository` ao fluxo real de sincronização;
- integrar `SyncItemRepository` ao fluxo real de sincronização;
- adicionar validação automática aos DTOs;
- criar testes automatizados para os controllers e services.

## 10. Conclusão
A API está estruturada em camadas, conectada ao SQLite, com o schema corrigido e validada em testes reais. Os fluxos principais de telemetria, eventos, autenticação e prevenção de duplicidade estão funcionando de forma consistente, e o projeto está pronto para seguir para a próxima etapa de evolução.
