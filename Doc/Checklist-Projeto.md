# Checklist de conclusão do projeto

Este documento registra o que já foi implementado e validado e o que falta para concluir o escopo planejado. Os itens de hardening estão separados das entregas do MVP.

## Arquitetura local

- ✅ Arquitetura IoT local definida.
- ✅ Fluxo ESP32 → API → SQLite documentado.
- ✅ API em Node.js, TypeScript e Express.
- ✅ Organização em routes, controllers, services, repositories e models.
- ✅ Especificação OpenAPI e interface Swagger disponíveis.
- ✅ Inicialização do SQLite com criação e normalização de schema.
- ✅ Modelo de dados local documentado.
- [ ] Worker de sincronização em execução real.
- [ ] PostgreSQL central integrado.

**Status:** base local da API implementada; sincronização central permanece pendente.

## Segurança do MVP

- ✅ API Key associada a dispositivo.
- ✅ Middleware valida chave ausente (`401`), inválida (`401`) e dispositivo inativo (`403`).
- ✅ Rotas de comandos e alertas validam se a chave pertence ao dispositivo informado (`403`).
- [ ] Decidir e aplicar a mesma validação de ownership em telemetria e eventos (casos AUT-08 e AUT-09 do plano de teste).
- ✅ API Key exclusiva por dispositivo (`409` na duplicidade e índice único no banco).
- ✅ Autenticação aplicada aos fluxos de telemetria, comandos e alertas.

**Status:** segurança por API Key implementada para o MVP.

### Hardening futuro

Estes itens não estão implementados e não bloqueiam o MVP atual, salvo se forem definidos como requisitos:

- [ ] Hash de API Keys em repouso.
- [ ] Rotação e revogação de chaves.
- [ ] Rate limiting.
- [ ] Auditoria de acesso e de alterações.

## Dispositivos e estados

- ✅ Cadastro, consulta individual e listagem de dispositivos.
- ✅ API Key e versão de firmware associadas ao dispositivo.
- ✅ Ativação e desativação de dispositivo.
- ✅ Colunas opcionais `device_status_id`, `valve_status_id` e `seal_status_id`.
- ✅ Prevenção de cadastro duplicado (`409`).
- ✅ `active` restrito a `0`/`1` na API (`400`) e no banco (triggers em bancos antigos).
- ✅ Criação automática de dispositivo no fluxo de eventos quando ainda não existe.
- ✅ Catálogo `status` para estados de dispositivo e lacre.
- ✅ Validação de `seal_status` em eventos (`LOCKED`, `UNLOCKED` ou `BROKEN`).

**Status:** cadastro, estados e fluxo documentados e validados. As colunas opcionais de status permanecem `NULL` até serem preenchidas.

## Telemetria

- ✅ Endpoint de ingestão `POST /api/v1/iot/telemetries`.
- ✅ Endpoint autenticado de consulta `GET /api/v1/iot/telemetries`.
- ✅ Persistência na tabela `telemetry_queue`.
- ✅ Validação dos campos obrigatórios e de `message_id` duplicado (`409`).
- ✅ Repetição do mesmo `message_id` não cria novo registro.
- ✅ Atualização de `last_seen_at` quando a posição GPS se repete.
- ✅ Posição e lacre iguais à última telemetria respondem `200 Posição já registrada; data e hora atualizadas`.
- ✅ Reenvio do `message_id` de posição repetida retorna `409` (coluna `last_repeat_message_id`).
- ✅ Estado do lacre (`seal_status`) na telemetria; mudança de estado na mesma posição gera nova linha.
- ✅ `status` e `attempt_count` da fila definidos pelo servidor; tentativas de envio do ESP32 em `device_attempt_count`.
- ✅ Validação de tipos dos campos (`400`) e dispositivo inexistente (`404`).
- ✅ Telemetrias sem GPS aceitas e persistidas.
- ✅ Consulta ordenada por `id` decrescente (mais recentes primeiro).
- ✅ JSON malformado retorna `400`.

**Status:** fluxo de telemetria validado por testes de integração.

## Eventos

- ✅ Endpoint de ingestão `POST /api/v1/iot/events`.
- ✅ Persistência na tabela `events`.
- ✅ `message_id` obrigatório e protegido contra duplicidade (`409`).
- ✅ `event_type` obrigatório.
- ✅ Validação de `seal_status` quando informado.
- ✅ Estados de processamento definidos: `PENDING`, `PROCESSING`, `SYNCED` e `ERROR`.
- ✅ Criação automática de dispositivo inexistente no fluxo de eventos.

**Status:** ingestão e validações implementadas. `event_type` é validado como obrigatório; não há catálogo fechado de tipos de evento.

## Comandos

- ✅ Repository e service para comandos.
- ✅ Consulta de comandos pendentes por dispositivo.
- ✅ Confirmação de comando por `POST /api/v1/iot/commands/confirm`.
- ✅ Estados de confirmação `EXECUTADO` e `ERRO`.
- ✅ Registro de `executed_at` e `error_message`.
- ✅ Validação de API Key e ownership do dispositivo.
- ✅ Prevenção de reconfirmação.

**Status:** fluxo manual de comandos implementado e testado.

## Alertas

- ✅ Schema e persistência SQLite.
- ✅ Endpoint autenticado de criação `POST /api/v1/iot/alerts`.
- ✅ Validação dos tipos `SEAL_BROKEN`, `GEOFENCE_EXIT`, `LOW_BATTERY`, `DEVICE_ERROR`, `COMMAND_FAILURE` e `COMMUNICATION_LOST`.
- ✅ Validação de existência de `status_id` e `severity_id` no catálogo `status`.
- ✅ Prevenção de `alert_id` duplicado (`409`).
- ✅ Validação da API Key e do vínculo da chave com o dispositivo.
- ✅ Teste HTTP de `SEAL_BROKEN`: resposta `201` e persistência confirmada no SQLite.
- [ ] Definir códigos e significado de severidade no catálogo; a validação atual confirma existência do ID, não sua semântica como severidade.

**Status:** endpoint básico concluído e validado; taxonomia de severidade pendente.

## Banco de dados local

### Tabelas

- ✅ `devices`
- ✅ `status`
- ✅ `telemetry_queue`
- ✅ `events`
- ✅ `commands`
- ✅ `alerts`
- [ ] `sync_logs` e `sync_items` como tabelas operacionais no banco atual.

### Relacionamentos e integridade

- ✅ `device_id` e `api_key` únicos em dispositivos.
- ✅ `message_id` único para eventos e telemetrias.
- ✅ `alert_id` e `command_id` únicos.
- ✅ `devices` → `telemetry_queue` por `device_id`.
- ✅ `devices` → `events` por `device_id`.
- ✅ `devices` → `commands` por `device_id`.
- ✅ `devices` → `alerts` por `device_id`.
- ✅ `alerts.status_id` e `alerts.severity_id` referenciam `status.id`.
- ✅ Chaves estrangeiras principais entre dispositivos, eventos, telemetrias, comandos e alertas.
- ✅ Migrações e normalizações de schema preservam os dados existentes nos fluxos cobertos.

**Status:** schema SQLite local operacional; tabelas de sincronização ainda não estão ativas.

## Testes e validação

- ✅ Compilação TypeScript validada com `npx tsc --noEmit`.
- ✅ Servidor iniciado localmente.
- ✅ Swagger e especificação OpenAPI validados.
- ✅ Gestão de dispositivos testada.
- ✅ Telemetria testada, incluindo duplicidade, GPS ausente e JSON inválido.
- ✅ Eventos testados, incluindo autenticação e validação de lacre.
- ✅ Comandos testados, incluindo confirmação, ownership e reconfirmação.
- ✅ Alertas testados, incluindo autenticação, validação, duplicidade e criação de `SEAL_BROKEN`.
- ✅ Casos de sucesso e erro cobertos pela suíte de integração (`50/50` em 06/10/2026).
- ✅ Plano de Teste e Roteiro de Teste para IA documentados em `Doc/Doc_tese/`.
- ✅ Validação por entrega registrada em `Doc/Doc_tese/Relatorio-de-Teste-*.md` (IA + questionário do responsável); entrega de 06/10/2026 aprovada por Natã da Silva Baracho.
- ✅ Teste completo da API e do banco Oxide no `oxide.db` real, com backup e restauração (06/10/2026).
- ✅ Dependência não usada `sqlite3` removida.
- [ ] Atualizar o `nodemon` quando houver versão sem a vulnerabilidade do `braces` (3 alertas altos no `npm audit`, só em desenvolvimento).
- [ ] Verificar a estrutura do FluxID (PostgreSQL) numa rodada de teste antes de iniciar o Worker.
- [ ] Reexecutar compilação e suíte após concluir as próximas funcionalidades.

**Status:** funcionalidades atuais do MVP validadas; a suíte deve ser repetida a cada nova etapa.

## Próximas entregas, na ordem acordada

### 1. Associação Dispositivo → Lacre → Cilindro

- [ ] Definir regras de associação, troca e desassociação.
- [ ] Criar schema SQLite para lacres, cilindros e vínculos, com integridade referencial.
- [ ] Implementar models/DTOs, repositories, services, controllers e rotas.
- [ ] Validar ownership, entidades inexistentes, duplicidade e conflitos.
- [ ] Testar persistência e atualização dos vínculos.
- [ ] Atualizar OpenAPI e documentação.

### 2. Histórico de associações

- [ ] Definir dados e eventos que compõem o histórico.
- [ ] Persistir início e término sem sobrescrever associações anteriores.
- [ ] Implementar consulta por dispositivo, lacre e/ou cilindro.
- [ ] Testar associações sucessivas, desassociação e ordenação temporal.
- [ ] Documentar o contrato e exemplos.

### 3. Geofence

- [ ] Definir formato das áreas e regras de entrada, saída e limites geográficos.
- [ ] Persistir geofences e vínculos com dispositivos.
- [ ] Avaliar posições e detectar transições conforme as regras definidas.
- [ ] Gerar e persistir os eventos/alertas correspondentes, incluindo `GEOFENCE_EXIT`.
- [ ] Testar limites, transições, duplicidades e coordenadas inválidas.
- [ ] Documentar configuração e endpoints.

### 4. Comandos automáticos

- [ ] Definir regras, condições e ações que disparam comandos.
- [ ] Criar comandos automaticamente, evitando duplicidade indevida.
- [ ] Definir expiração, repetição, falha e confirmação.
- [ ] Testar disparo, não disparo, idempotência e confirmação.
- [ ] Documentar regras e estados.

### 5. Worker SQLite → PostgreSQL

- [ ] Definir schema PostgreSQL, mapeamento e configuração segura de conexão.
- [ ] Implementar leitura de pendências e envio ao PostgreSQL.
- [ ] Implementar estados/tabelas de sincronização (`sync_logs` e `sync_items`).
- [ ] Garantir transações, idempotência, retry e recuperação sem perda de dados.
- [ ] Implementar inicialização, encerramento e logs operacionais do Worker.
- [ ] Testar sucesso, repetição, indisponibilidade do PostgreSQL e recuperação.
- [ ] Documentar configuração, execução e recuperação de falhas.

## Fase de operação e conclusão

- [ ] Definir política de expurgo e retenção.
- [ ] Definir backup e procedimento de restauração.
- [ ] Implementar observabilidade e métricas necessárias para operação.
- [ ] Avaliar necessidade de dashboard operacional.
- [ ] Executar compilação, suíte de testes e testes de integração com PostgreSQL.
- [ ] Revisar documentação final e confirmar que todos os fluxos implantados estão descritos.

## Status real

| Área | Status |
| --- | --- |
| Arquitetura e API local | Implementada e validada para o MVP atual |
| Segurança por API Key | Implementada para o MVP |
| Dispositivos, estados, telemetria e eventos | Implementados e validados |
| Comandos manuais | Implementados e validados |
| Criação básica de alertas | Implementada e validada; severidade sem semântica definida |
| Associação dispositivo/lacre/cilindro | Pendente |
| Histórico de associações | Pendente |
| Geofence | Pendente |
| Comandos automáticos | Pendente |
| Worker e sincronização PostgreSQL | Pendente |
| Hardening adicional de segurança | Pendente, fora do MVP atual |

**Conclusão:** a API local atual está operacional para os fluxos implementados. O projeto completo ainda não está concluído; faltam as próximas entregas do roadmap e a camada de sincronização/operação.