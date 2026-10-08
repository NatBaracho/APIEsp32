# Checklist de conclusão do projeto

Este documento registra o que já foi implementado e validado e o que falta para concluir o escopo planejado. Os itens de hardening estão separados das entregas do MVP.

Legenda: ✅ feito e validado; ⏳ feito, falta o passo indicado no item; [ ] a fazer.

## Arquitetura local

- ✅ Arquitetura IoT local definida.
- ✅ Fluxo ESP32 → API → SQLite documentado.
- ✅ API em Node.js, TypeScript e Express.
- ✅ Organização em routes, controllers, services, repositories e models.
- ✅ Especificação OpenAPI e interface Swagger disponíveis.
- ✅ Inicialização do SQLite com criação e normalização de schema.
- ✅ Modelo de dados local documentado.
- ✅ Worker de sincronização Oxide ⇄ FluxID (implementado em 07/10/2026; teste formal sem falhas; aprovado por Natã da Silva Baracho em 07/10/2026).
- ⏳ PostgreSQL central (FluxID) integrado: verificado no Docker; falta aplicar os scripts `001` a `006` no banco principal.
- ⏳ API do frontend sobre o FluxID (`/api/v1/app`, 23 funções) (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).

**Status:** API do lacre, Worker e API do frontend implementados; falta aplicar os scripts no FluxID principal e ligar o frontend.

## Segurança do MVP

- ✅ API Key associada a dispositivo.
- ✅ Middleware valida chave ausente (`401`), inválida (`401`) e dispositivo inativo (`403`).
- ✅ Telemetria, eventos, comandos e alertas validam se a chave pertence ao dispositivo informado (`403`).
- ✅ `GET /devices` não expõe `api_key`; rotas de dispositivos abertas por decisão do responsável.
- ✅ Sem criação automática de dispositivo (chave previsível `auto-<device_id>` eliminada).
- ✅ API Key exclusiva por dispositivo (`409` na duplicidade e índice único no banco).
- ✅ Autenticação aplicada aos fluxos de telemetria, comandos e alertas.

**Status:** segurança por API Key implementada para o MVP.

### Hardening futuro

Estes itens não estão implementados e não bloqueiam o MVP atual, salvo se forem definidos como requisitos:

- ✅ Hash de API Keys em repouso: a chave vem do FluxID só como hash e a Oxide confere o SHA-256 (implementado em 07/10/2026; teste formal sem falhas; aprovado por Natã da Silva Baracho em 07/10/2026).
- ⏳ Rotação de chave do dispositivo pela API do frontend (`rotate_device_key`; a chave aparece uma vez) (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).
- ⏳ Limite de tentativas de login (5 falhas em 15 min) e de sessões (3 por pessoa) (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã). Rate limiting das rotas do lacre: [ ] a fazer.
- ⏳ Auditoria de acesso e de alterações no FluxID (login, logout e toda escrita da API do frontend em `auditoria`) (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).
- [ ] Envio de e-mail (convite e recuperação de senha) e MFA.

## Dispositivos e estados

- ✅ Cadastro, consulta individual e listagem de dispositivos.
- ✅ API Key e versão de firmware associadas ao dispositivo.
- ✅ Ativação e desativação de dispositivo.
- ✅ Colunas opcionais `device_status_id`, `valve_status_id` e `seal_status_id`.
- ✅ Prevenção de cadastro duplicado (`409`).
- ✅ `active` restrito a `0`/`1` na API (`400`) e no banco (triggers em bancos antigos).
- ✅ Dispositivo precisa estar cadastrado (`404` em telemetria e eventos); cadastro na Oxide é provisório até o Worker trazer o cadastro oficial do FluxID.
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
- ✅ Evento de dispositivo não cadastrado retorna `404` (criação automática removida na entrega A).

**Status:** ingestão e validações implementadas. `event_type` é validado como obrigatório; não há catálogo fechado de tipos de evento.

## Comandos

- ✅ Repository e service para comandos.
- ✅ Consulta de comandos pendentes por dispositivo.
- ✅ Confirmação de comando por `POST /api/v1/iot/commands/confirm`.
- ✅ Estados de confirmação `EXECUTADO` e `ERRO`.
- ✅ Registro de `executed_at` e `error_message`.
- ✅ Validação de API Key e ownership do dispositivo.
- ✅ Prevenção de reconfirmação.
- ✅ Catálogo de comandos (`TRAVAR_VALVULA`, `DESTRAVAR_VALVULA`) aplicado no banco, com migração dos comandos antigos (entrega D).
- ✅ Catálogo de tipos de erro e ocorrências operacionais (`Doc/Tipos-de-Erro.md`).
- ⏳ Comando automático: lacre aberto ou rompido com o cilindro em trânsito → `TRAVAR_VALVULA`, sem duplicar o pendente (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).
- ⏳ Comando de válvula pelo frontend com login, `ENVIAR_COMANDOS`, justificativa e auditoria (D8) (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).
- ✅ `alert_type` da Oxide com os códigos em português do catálogo, aceitando os nomes antigos na transição (06/10/2026).
- ⏳ Fluxo de saída de rota: rota planejada (margem de 50 m), desvios programados e justificados, alerta automático, justificativa do motorista e encerramento pelo gestor (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).

**Status:** fluxo manual de comandos implementado e testado, com catálogo de tipos.

## Alertas

- ✅ Schema e persistência SQLite.
- ✅ Endpoint autenticado de criação `POST /api/v1/iot/alerts`.
- ✅ Tipos com os 28 códigos em português do catálogo, protegidos por `CHECK`; nomes antigos em inglês convertidos (transição).
- ✅ Severidade (`BAIXA`, `MEDIA`, `ALTA`, `CRITICA`) e status (`ABERTO`, `EM_ANALISE`, `ENCERRADO`) com os valores do FluxID; severidade padrão sugerida no catálogo.
- ✅ Prevenção de `alert_id` duplicado (`409`).
- ✅ Validação da API Key e do vínculo da chave com o dispositivo.
- ✅ Teste HTTP de `SEAL_BROKEN`: resposta `201` e persistência confirmada no SQLite.
- ✅ Migração automática da tabela `alerts` antiga (`status_id`/`severity_id` e tipos em inglês), preservando os alertas.
- ✅ Listagem (`GET /api/v1/iot/alerts`) e rota para analisar e encerrar (`PATCH /api/v1/iot/alerts/{alert_id}/status`), com quem encerrou e o motivo.
- ⏳ Justificativa do motorista e tratamento pelo gestor pela API do frontend (D5: o alerta tratado no FluxID não é sobrescrito) (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).
- ⏳ Alertas automáticos: `BATERIA_BAIXA`, `GSM_SINAL_FRACO`, `LACRE_ABERTO_EM_TRANSITO`, `COMANDO_FALHOU`, `SEM_COMUNICACAO`, `GPS_SEM_SINAL`, `COMANDO_SEM_RESPOSTA`, `SAIDA_ROTA` e `SAIDA_GEOCERCA`, com limites no `.env` e sem repetição (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).

**Status:** criação, listagem, análise e encerramento de alertas concluídos e validados, com tipos, severidade e status alinhados ao FluxID.

## Banco de dados local

### Tabelas

- ✅ `devices`
- ✅ `status`
- ✅ `telemetry_queue`
- ✅ `events`
- ✅ `commands`
- ✅ `alerts`
- ✅ `seals`, `cylinders`, `seal_assignments` e `cylinder_assignments`
- ✅ `sync_logs` (uma linha por rodada do Worker). `sync_items` não foi criada: o estado de cada item fica na própria fila (decisão aprovado por Natã da Silva Baracho em 07/10/2026).

### Relacionamentos e integridade

- ✅ `device_id` e `api_key` únicos em dispositivos.
- ✅ `message_id` único para eventos e telemetrias.
- ✅ `alert_id` e `command_id` únicos.
- ✅ `devices` → `telemetry_queue` por `device_id`.
- ✅ `devices` → `events` por `device_id`.
- ✅ `devices` → `commands` por `device_id`.
- ✅ `devices` → `alerts` por `device_id`.
- ✅ `alerts.severity` e `alerts.status` com `CHECK` nos valores do FluxID.
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
- ✅ Estrutura do FluxID verificada em PostgreSQL temporário e no Docker (container `fluxid-analise`, 07/10/2026).
- ✅ Swagger organizado em grupos, com teste que barra rota sem grupo (07/10/2026).
- ⏳ Compilação, suíte (108/108), `npm run test:app` (45/45) e `npm run simular` (65/65) reexecutados (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).

**Status:** funcionalidades atuais do MVP validadas; a suíte deve ser repetida a cada nova etapa.

## Próximas entregas, na ordem acordada

### 1. Associação Dispositivo → Lacre → Cilindro

- ✅ Regras de associação, troca (`replace`) e desassociação definidas (RN04, RN05, RN21).
- ✅ Schema SQLite de lacres, cilindros e vínculos, com integridade referencial e índices de vínculo ativo único.
- ✅ Repositories, services, controllers e rotas (`/seals`, `/cylinders`, `/assignments`).
- ✅ Entidades inexistentes (`404`), duplicidade e conflitos (`409`) validados; rotas abertas por decisão (ownership não se aplica).
- ✅ Telemetria preenche `lacre_id`/`cilindro_id` pelo vínculo ativo; `error_type` registra dispositivo sem lacre, lacre sem cilindro e lacre aberto em trânsito.
- ✅ OpenAPI e documentação atualizados (no Swagger, grupos Lacres, Cilindros e Vínculos desde 07/10/2026).
- ✅ Cópia provisória atualizada pelo cadastro do FluxID (Worker; o FluxID prevalece e nada é apagado) (implementado em 07/10/2026; teste formal sem falhas; aprovado por Natã da Silva Baracho em 07/10/2026).

### 2. Histórico de associações

- ✅ Histórico com início, fim e motivo, sem sobrescrever vínculos anteriores.
- ✅ Consulta por dispositivo, lacre e cilindro, com filtro de ativos, do mais recente ao mais antigo.
- ✅ Testes de associações sucessivas, troca, encerramento e ordenação.
- ✅ Contrato e exemplos documentados (Desenvolvimento 1.3 e Swagger).
- [ ] Teste de reassociação do mesmo par (HIS-04).

### 3. Geofence

- ⏳ Formato definido: geocerca = raio do endereço do cliente (`locais_entrega.raio_geocerca_metros`); rota = linha de pontos com margem (padrão 50 m) (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).
- ⏳ Geocerca e rota no FluxID (`rotas_entrega`, `desvios_rota`; custódia aberta ao concluir a entrega) (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).
- ⏳ Avaliação da última posição a cada rodada do Worker, com alerta `SAIDA_GEOCERCA` ou `SAIDA_ROTA` sem repetição (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).
- ⏳ Testes de dentro e fora, desvio que suspende a regra e distâncias (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).
- ⏳ Documentação (`Contrato-API-Frontend.md` 7.7 e 8; `Integracao-Oxide-FluxID.md` 3.5) (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).

### 4. Comandos automáticos

- ⏳ Regra: lacre aberto ou rompido com o cilindro em trânsito → `TRAVAR_VALVULA` (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).
- ⏳ Sem duplicar o pendente do mesmo tipo (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).
- ⏳ Sem resposta em 10 min → `COMANDO_SEM_RESPOSTA`; confirmação com `ERRO` → `COMANDO_FALHOU` (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).
- ⏳ Testes de disparo, não disparo e confirmação (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).
- ⏳ Documentado em `Integracao-Oxide-FluxID.md` 3.4 e 3.5 (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).

### 5. Worker SQLite → PostgreSQL

- ✅ Análise do dump FluxID e plano de integração com tabelas de conversão (`Doc/Integracao-Oxide-FluxID.md`, entrega E).
- ✅ Scripts de ajuste de estrutura e de correção da massa de testes do FluxID (`sql/fluxid/`), validados em servidor temporário.
- [ ] Aplicar os scripts `001` a `006` no FluxID principal e versionar o novo dump (Natã).
- ✅ Decisões P1 a P8 do plano de integração fechadas (06/10/2026).
- ✅ Script `sql/fluxid/003`: alerta com cilindro e lacre obrigatórios (vínculo da data do alerta), validado em servidor temporário (07/10/2026).
- ✅ Gatilho no FluxID que confere se o par lacre + cilindro do alerta tinha vínculo naquela data (script `004`, implementado em 07/10/2026; teste formal sem falhas; aprovado por Natã da Silva Baracho em 07/10/2026).
- ✅ Script `sql/fluxid/004`: data gravada na chegada (P1), lacre e cilindro na telemetria, quarentena da telemetria sem GPS (P2), tabela de eventos do dispositivo (P4), tipos de alerta do catálogo em `alertas.tipo` (P5) e colunas da Oxide nos alertas (implementado em 07/10/2026; teste formal sem falhas; aprovado por Natã da Silva Baracho em 07/10/2026).
- ✅ Script `sql/fluxid/005`: estruturas do frontend (tipos e identificadores de cilindro, laudo e retificação do teste hidrostático, histórico imutável do cilindro integrado com a Oxide) (implementado em 07/10/2026; teste formal sem falhas; aprovado por Natã da Silva Baracho em 07/10/2026).
- ⏳ Decisões com o frontend implementadas na recomendação (D1 a D9: estoque em coluna própria, login pela API, papéis por organização...) no script `006` (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã). Falta a revisão de aalissonalmeidaq. A classificação dos tipos dos cilindros antigos continua a decidir (eles aparecem com `type.legacy`).
- ✅ Regras do Worker: evento sem lacre espera o vínculo (P3), código do alerta = `alert_id` da Oxide (P7) e lacre só marcado como `SUSPEITA_VIOLACAO`, com confirmação do gestor (P8) (implementado em 07/10/2026; teste formal sem falhas; aprovado por Natã da Silva Baracho em 07/10/2026).
- ✅ Oxide guarda `api_key_hash` e compara o SHA-256 da `X-API-Key` (implementado em 07/10/2026; teste formal sem falhas; aprovado por Natã da Silva Baracho em 07/10/2026).
- ✅ Configuração segura de conexão: `FLUXID_DATABASE_URL` no `.env` (fora do git), modelo em `.env.example` sem senha.
- ✅ Leitura de pendências e envio ao PostgreSQL (implementado em 07/10/2026; teste formal sem falhas; aprovado por Natã da Silva Baracho em 07/10/2026).
- ✅ Estados de sincronização na própria fila (`next_attempt_at`; `sync_*` nos alertas) e `sync_logs`.
- ✅ Transações, idempotência, retry (envio inicial + 5 tentativas: 1 min, 5 min, 15 min, 1 h e 6 h; depois o gestor resolve, P6) e recuperação sem perda de dados (implementado em 07/10/2026; teste formal sem falhas; aprovado por Natã da Silva Baracho em 07/10/2026).
- ✅ Inicialização (devolve à fila o que ficou pela metade), encerramento ao fim da rodada (Ctrl+C) e `sync_logs`.
- ✅ Teste formal de sucesso, repetição, indisponibilidade do PostgreSQL e recuperação: Roteiro v1.10 (seção 5.10) executado pela IA em 07/10/2026, sem falhas; aprovado por Natã da Silva Baracho em 07/10/2026.
- ✅ Configuração, execução e recuperação de falhas documentadas (`Integracao-Oxide-FluxID.md` v2.0, seção 6; `Desenvolvimento.md` 1.8).
- ✅ FluxID de análise no Docker (container `fluxid-analise`).
- ✅ Simulador do lacre (`npm run simular`): percurso completo do lacre e do operador, com fila, GPS sem sinal e todos os alertas; 58/58, aprovado por Natã da Silva Baracho em 07/10/2026.
- ✅ Série do cilindro não única na Oxide (achado A3; identificação pelo lacre e pelo código), aprovado por Natã da Silva Baracho em 07/10/2026.

## Fase de operação e conclusão

- ⏳ Retenção: só o que já foi sincronizado e chegou há mais de 30 dias (`npm run retencao`, simulação por padrão) (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).
- ⏳ Backup consistente da Oxide (`npm run backup`, com `integrity_check`, mantém 14) (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã). Restauração: parar a API e o Worker e copiar o arquivo do backup sobre o `oxide.db`.
- ⏳ Observabilidade básica: `GET /health` (Oxide, FluxID, Worker e filas) (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã). Métricas detalhadas: [ ] a fazer.
- ⏳ Dados do dashboard com mapa pela API do frontend (`query-map`, `query-overview`): lacres e cilindros, lacre sem GPS na última posição conhecida e cor do alerta de maior severidade (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã). A tela é do frontend: [ ] a fazer (aalissonalmeidaq).
- ⏳ Compilação, suíte e testes de integração com PostgreSQL (FluxID de análise no Docker) (feito e testado pela IA em 07/10/2026; aguardando a validação de Natã).
- ✅ `Desenvolvimento.md` com o papel de cada parte (API, Oxide, Worker e FluxID) e o histórico de PRs por funcionalidade (Parte 3), atualizado a cada PR.
- [ ] Revisar documentação final e confirmar que todos os fluxos implantados estão descritos.

## Status real

| Área | Status |
| --- | --- |
| Arquitetura e API local | Implementada e validada para o MVP atual |
| Segurança por API Key | Implementada para o MVP |
| Dispositivos, estados, telemetria e eventos | Implementados e validados |
| Comandos manuais | Implementados e validados |
| Alertas | Criação, listagem, análise e encerramento implementados e validados; tipos do catálogo em português, severidade e status alinhados ao FluxID |
| Associação dispositivo/lacre/cilindro | Implementada e validada (cópia provisória do FluxID) |
| Histórico de associações | Implementado e validado |
| Geofence e rota | Implementadas e testadas pela IA; aguardando validação |
| Comandos e alertas automáticos | Implementados e testados pela IA; aguardando validação |
| Decisões de integração (P1 a P8) | Fechadas |
| Worker e sincronização PostgreSQL | Implementados, testados (sem falhas) e aprovado por Natã da Silva Baracho em 07/10/2026 |
| Estruturas do frontend no FluxID | Script `005` aprovado por Natã da Silva Baracho em 07/10/2026 como proposta; F1 a F4 a decidir com o frontend |
| API do frontend sobre o FluxID | Implementada (`Contrato-API-Frontend.md` v1.0, script `006`) e testada pela IA; aguardando validação e a ligação com o frontend |
| Dashboard com mapa | Dados prontos na API (`query-map`, `query-overview`); a tela é do frontend |
| Saúde, backup e retenção | Implementados e testados pela IA; aguardando validação |
| Hardening adicional de segurança | Pendente, fora do MVP atual |

**Conclusão:** o backend está completo para o MVP: API do lacre, Worker, API do frontend, regras automáticas, geocerca, rota e manutenção. O que falta:
- a validação de Natã (relatório `Relatorio-de-Teste-2026-10-07-23h45.md`);
- aplicar `001` a `006` no FluxID principal;
- ligar o frontend à `/api/v1/app`;
- envio de e-mail e MFA;
- o hardening restante.
Atualização de 06/10/2026 (decisões P1 a P8 e dashboard com mapa) conferida por questionário (3/3 sim) e **aprovada por Natã da Silva Baracho**.

Atualização de 07/10/2026 (integração Oxide ⇄ FluxID, scripts `004` e `005`, contrato do frontend) conferida por questionário (15/15 sim) e **aprovada por Natã da Silva Baracho**.
