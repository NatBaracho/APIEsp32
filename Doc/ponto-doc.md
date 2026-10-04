# Ponto de documentação do projeto API ESP32

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

### 3.3 Rota de telemetria
- Endpoint: `POST /api/telemetries`
- Responsável por receber dados enviados pelo dispositivo.
- Resposta confirmando processamento com status 202.

### 3.4 Rota de eventos
- Endpoint: `POST /api/events`
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

## 5. Status atual

Status geral: em funcionamento e com testes básicos de integração realizados com sucesso.

### Rotas validadas
- `GET /` -> funcionando
- `POST /api/telemetries` -> funcionando
- `POST /api/events` -> funcionando

## 6. Próximos passos sugeridos
- criar endpoints de listagem, atualização e exclusão dos dispositivos;
- implementar autenticação por API key;
- criar sincronização da fila de telemetria para o backend externo;
- adicionar testes automatizados com Jest ou Vitest;
- reforçar validação de payloads e erros de negócio.

## 7. Conclusão
A API está estruturada em camadas, conectada ao SQLite e pronta para receber dados de dispositivos IoT. O fluxo principal de telemetria e eventos já foi validado com sucesso, e o projeto está em um estado funcional para continuar evoluindo.
