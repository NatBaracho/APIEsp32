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
- src/services/EventService.ts: valida e encaminha eventos para persistência.
- src/repositories/DeviceRepository.ts: operações do cadastro e controle de dispositivos.
- src/repositories/EventRepository.ts: persistência de eventos no SQLite.
- src/repositories/TelemetryQueueRepository.ts: conjunto de métodos para fila de telemetria.
- src/models/Device.ts: modelo do dispositivo.
- src/models/Event.ts: modelo do evento.
- src/models/Telemetry.ts: modelo de telemetria.

## 3. Funcionalidades implementadas

### 3.1 Servidor Express
- API configurada com Express.
- Middleware para leitura de JSON.
- Rota raiz (`/`) retornando mensagem de status da API.
- Servidor rodando na porta 3000.

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
  - `POST /api/v1/iot/events`
  - `GET /api/v1/devices/:deviceId`

### 3.4 Rota de telemetria
- Endpoint: `POST /api/v1/iot/telemetries`
- Responsável por receber dados enviados pelo dispositivo.
- Resposta confirmando processamento com status 202.

### 3.5 Rota de eventos
- Endpoint: `POST /api/v1/iot/events`
- Responsável por receber eventos do ESP32 ou da aplicação.
- Validação de duplicidade por `message_id`.
- Persistência do evento no banco.
- Criação automática de dispositivo caso ele ainda não exista.

### 3.5 Repositórios
- `DeviceRepository`: busca, criação, atualização, desativação e verificação de existência do dispositivo.
- `EventRepository`: grava eventos, consulta por message_id, lista pendentes e marca status.
- `TelemetryQueueRepository`: estrutura para fila de telemetria com métodos de criação, busca, processamento, sincronização e erro.

## 4. Observações técnicas importantes

- O projeto teve ajustes para corrigir imports, nomes de arquivos e inconsistências no schema do SQLite.
- O banco possui nomes reais de colunas diferentes de algumas convenções iniciais do código, sendo necessário alinhar as queries ao schema real.
- A conexão com SQLite e a API foram validadas com testes reais via `curl`, retornando status 202 para telemetria e eventos.
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

## 7. Erro identificado e correção aplicada

### Problema encontrado
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

## 8. Status atual

Status geral: em funcionamento e validado com testes reais de integração.

### Rotas validadas
- `GET /` -> funcionando
- `GET /api/v1/devices/DSP-000001` -> funcionando
- `POST /api/v1/iot/telemetries` -> funcionando
- `POST /api/v1/iot/events` -> funcionando
- `POST /api/v1/iot/events` com duplicidade -> bloqueado corretamente
- validação de payload obrigatório -> funcionando
- autenticação por API key -> funcionando

### Convenção de rota atual
A API está organizada com o prefixo padrão `/api/v1`, e a estrutura atual é:
- `/api/v1/iot/telemetries`
- `/api/v1/iot/events`
- `/api/v1/devices/:deviceId`

## 9. Próximos passos sugeridos
- criar endpoints de listagem, atualização e exclusão dos dispositivos;
- implementar autenticação por API key;
- criar sincronização da fila de telemetria para o backend externo;
- adicionar testes automatizados com Jest ou Vitest;
- reforçar validação de payloads e erros de negócio.

## 10. Conclusão
A API está estruturada em camadas, conectada ao SQLite, com o schema corrigido e validada em testes reais. Os fluxos principais de telemetria, eventos, autenticação e prevenção de duplicidade estão funcionando de forma consistente, e o projeto está pronto para seguir para a próxima etapa de evolução.
