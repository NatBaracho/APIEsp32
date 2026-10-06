# Relatório de Teste — API Oxide (execução completa no banco real)

**Data/hora:** 06/10/2026, 15:20:19 a 15:20:46 (execução do Roteiro), seguida da rodada curta após a remoção do `sqlite3`
**Executor:** IA (Claude Code, modelo Claude Opus 5.5), com validação humana de Natã da Silva Baracho
**Commit/versão:** branch `fix/revisao-plano-de-teste` (`9a7187c`), mais a remoção da dependência `sqlite3` desta entrega
**Ambiente:** Windows 11 Pro, Node.js v24.21.0, npm 11.19.0, Git Bash 5.3, porta 3000, banco **`oxide.db` real** do projeto (com backup e restauração)
**Base:** `RoteiroDeTeste.md` v1.2 (todas as seções executáveis) e `PlanoDeTeste.md` v1.2
**Relatório anterior:** [Relatorio-de-Teste-2026-10-06.md](Relatorio-de-Teste-2026-10-06.md)

## 1. Resumo

| Indicador | Valor |
| --- | --- |
| Compilação (`npx tsc --noEmit`) | PASSOU |
| Suíte automatizada | 50/50 (no Roteiro e de novo após a remoção do `sqlite3`) |
| Respostas HTTP dos casos manuais (seções 5.1 a 5.8) | 77, todas iguais ao esperado |
| Verificações do banco (seção 6 e BD-11) | Todas conforme |
| FALHOU | 0 |
| ACHADO | 6 (os mesmos cinco itens do relatório anterior; AUT-08 e AUT-09 contam juntos) |
| NÃO EXECUTADO | FluxID/PostgreSQL (escolha do responsável) e funcionalidades pendentes (seção 7 do Roteiro) |
| Banco restaurado | Sim, idêntico ao original (checksum SHA-256 igual) |
| Validação humana | **Aprovada por Natã da Silva Baracho** |

## 2. Forma de execução

Definida pelo responsável antes do teste:

| Decisão | Escolha |
| --- | --- |
| Banco SQLite | `oxide.db` real, com backup antes e restauração depois |
| FluxID (PostgreSQL) | Fora desta rodada |
| Versão do código | Branch do PR `fix/revisao-plano-de-teste` |

Todos os blocos `bash` do Roteiro foram executados em sequência na raiz do projeto, inclusive o `npm install`.

**Prova de integridade do banco:** o SHA-256 do `oxide.db` foi `3454c8d4b06d06717660eb0a71a1df6f5d66887c9e19bbcedb1a43a1e5efffb1` antes do teste, depois da restauração do Roteiro e depois da rodada curta. Ao final, `git status` não mostrou alterações e nenhum arquivo temporário (`roteiro-env.sh`, `api.log`, `api.pid`, backup) ficou na pasta.

## 3. Validação pela IA

### 3.1 Preparação e suíte

| Etapa | Resultado |
| --- | --- |
| Backup `oxide.db.bak-roteiro` | Criado |
| `npm install` | Dependências já instaladas; nenhuma alteração |
| `npx tsc --noEmit` | Sem erros |
| Porta 3000 livre antes do `npm test` | Confirmado (`000`) |
| `npm test` | 50 casos, 50 aprovados |

### 3.2 Casos da API (Roteiro, seção 5)

Os códigos HTTP obtidos, na ordem do Roteiro, foram iguais ao esperado em todos os casos:

| Grupo | Casos | Obtido |
| --- | --- | --- |
| 5.1 Preparação | Cadastro de `DSP-TEST-RT` | `201` |
| 5.2 Dispositivos | DEV-08, DEV-09, DEV-10, DEV-11, DEV-12, SEG-01 | `201`/`200`, contagens 5 e 5, `409`, `400`, `400`, `200` com `api_key` (ACHADO) |
| 5.3 Autenticação | AUT-07, AUT-08, AUT-09, AUT-10 | `404`, `202` (ACHADO), `202` (ACHADO), `200` |
| 5.4 Telemetria | TEL-02, 03, 04, 20, 05, 06, 08, 11, 12, 13, 15, 21, 22, 23, 24, 25, 07, 17, 16, 19 | `202`, `409`, `200`, `409`, `202`, `202`/`202`, `202`, `202`, `400`, `202` (ACHADO), `404`, `202`, `400`/`400`, `400`, `202`/`202`/`200`, `400`, `400`, `400`, `200` decrescente, `202`/`409` |
| 5.5 Eventos | EVT-05, 06, 10, 12, 11, 13, 08 | `202`/`202`, `400`, `202`, `202`, `202`, `400`, `409` |
| 5.6 Comandos | CMD-12, 09, 10, 11, 07, 13 | `200` na ordem certa, `200`, `400`, `404`, `409`, `404` |
| 5.7 Alertas | ALT-07, 08, 09, 10, 11, 06, 12 | `201` ×6, `400`, `400` ×3, `400`, `201`, `409`; sem códigos de severidade (ACHADO) |
| 5.8 Segurança | SEG-04, SEG-05, SEG-06, SEG-07, SEG-08 | `202` e `200` com chave deduzida (ACHADO); `404` e `201` com tabelas intactas; `413` e `GET /` `200`; sem detalhes internos; `401` |

### 3.3 Banco de dados (Roteiro, seção 6)

| ID | Verificação | Obtido | Resultado |
| --- | --- | --- | --- |
| BD-01/02 | Tabelas | `alerts`, `commands`, `devices`, `events`, `sqlite_sequence`, `status`, `telemetry_queue`; sem `sync_*` | PASSOU |
| BD-05/06 | FKs | `alerts` com 3 FKs; `commands` com `CASCADE`/`RESTRICT` | PASSOU |
| TEL-04/20/24 | Repetições | `MSG-RT-001` → `last_repeat_message_id = MSG-RT-002`; `MSG-RT-017` (`BROKEN`) → `MSG-RT-018` | PASSOU |
| TEL-21, EVT-11 | Tentativas do ESP32 | `device_attempt_count` 99 e 7; colunas do Worker `PENDING`/`0` | PASSOU |
| EVT-09/10 | Eventos | `event_type` em `message_type`; todos `PENDING`; `EVT-RT-003` e `EVT-RT-007` ausentes | PASSOU |
| CMD-09 | Comandos | `CMD-RT-001` `ERRO` com `falha simulada`; `CMD-RT-002` `PENDENTE` | PASSOU |
| BD-03 | Duplicatas | 0 em `devices`, `api_key`, `telemetry` e `events` | PASSOU |
| BD-04 | FK inexistente | `FOREIGN KEY constraint failed` | PASSOU |
| BD-08 | `active = 2` | `CHECK constraint failed: active IN (0,1)` | PASSOU |
| BD-16 | Índice único de `api_key` | `idx_devices_api_key`; `UNIQUE constraint failed: devices.api_key` | PASSOU |
| BD-12/13 | Catálogo e colunas | 5 códigos; colunas de status presentes | PASSOU |
| BD-17 | Colunas e índice novos | Criados pela migração **no banco real** | PASSOU |
| BD-11 | Inicialização repetida | 5 status antes e depois; sem erro no log | PASSOU |
| BD-15 | Limpeza | 0 registros `DSP-TEST%` | PASSOU |

## 4. Verificações adicionais (fora do Roteiro)

| Verificação | Resultado | Decisão do responsável |
| --- | --- | --- |
| `npm audit` | 3 vulnerabilidades altas em `braces` → `chokidar` → `nodemon`. O `nodemon` só é usado no `npm run dev` e não roda com `npm start`. O conserto automático rebaixaria o `nodemon` para uma versão de 2017. | Não aplicar `npm audit fix --force` (questão 4) |
| Dependência `sqlite3` | Instalada, mas não usada pelo código (a API usa `better-sqlite3`) | Remover (questão 5) |
| Instalação do zero (`npm ci` em pasta limpa) | O npm 11.19 avisa que os scripts de instalação do `better-sqlite3` ainda não estão em `allowScripts`, mas o módulo foi instalado e carregou normalmente | Apenas registrar: versões futuras do npm podem exigir `npm install-scripts approve better-sqlite3` |

### 4.1 Rodada curta após a remoção do `sqlite3`

`npm uninstall sqlite3` alterou só o `package.json` e o `package-lock.json`. Em seguida, com backup e restauração do banco real:

| Etapa | Resultado |
| --- | --- |
| `npx tsc --noEmit` | Sem erros |
| `npm test` | 50/50 |
| `npm start` + `GET /` | `200 API ESP32 Online` |
| Banco após restauração | Checksum idêntico ao original |

## 5. Defeitos e achados

Nenhum defeito. Os achados continuam os mesmos do relatório anterior e foram mantidos como pendências (questão 3):

| # | ID do caso | Severidade | Descrição |
| --- | --- | --- | --- |
| 1 | SEG-01 | Alta | `GET /devices` expõe `api_key` sem autenticação |
| 2 | AUT-08, AUT-09 | Alta | Telemetria e eventos aceitam chave de outro dispositivo |
| 3 | SEG-04 | Alta | Chave previsível `auto-<device_id>` em dispositivos criados por evento |
| 4 | ALT-12 | Média | Catálogo sem níveis de severidade |
| 5 | TEL-13 | Média | Coordenadas fora da faixa válida aceitas |

## 6. Casos não executados

| ID | Motivo |
| --- | --- |
| Estrutura do FluxID (apoio a SYN-09 a SYN-11) | Fora desta rodada por decisão do responsável |
| ASC-*, HIS-*, GEO-*, AUT-C*, SYN-*, FLX-* | Funcionalidades ainda não implementadas |
| SEG-09 a SEG-11 | Hardening futuro |
| ESP-03, ESP-05, ESP-06, OPE-* | Dependem de hardware ou da fase de operação |

## 7. Validação humana (questionário)

Respondido por **Natã da Silva Baracho** em 06/10/2026.

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | Concorda com a execução no `oxide.db` real, com backup e restauração comprovada pelo checksum? | Sim |
| 2 | Os resultados são suficientes como validação completa da API e do banco Oxide? | Sim |
| 3 | Manter os 5 achados como pendências conhecidas, sem corrigir nesta entrega? | Sim |
| 4 | Não aplicar `npm audit fix --force`? | Sim |
| 5 | Remover a dependência `sqlite3`, que não é usada (com nova rodada curta de testes)? | Sim |
| 6 | Registrar o FluxID como NÃO EXECUTADO nesta rodada? | Sim |
| 7 | Aprova esta execução de teste para registro no relatório? | Sim |

## 8. Conclusão

**Aprovado com ressalvas.** A API e o banco Oxide foram testados por completo no banco real e todas as regras implementadas se comportaram como esperado. A migração das colunas novas funcionou no arquivo real e o banco foi devolvido intacto. As ressalvas são os achados já conhecidos da seção 5 e as vulnerabilidades do `nodemon` de desenvolvimento.

> **Validação aprovada por Natã da Silva Baracho em 06/10/2026.**

## 9. Recomendações

1. Ajustar o firmware do ESP32 para `seal_status`, `attempt_count` e as respostas `200`/`202`/`400`/`404`/`409`.
2. Tratar SEG-01, AUT-08/09 e SEG-04 antes de expor a API fora de ambiente controlado.
3. Atualizar o `nodemon` assim que sair uma versão sem o `braces` vulnerável.
4. Incluir a verificação estrutural do FluxID na próxima rodada, antes de iniciar o Worker.
5. Definir a taxonomia de severidade e a faixa válida de coordenadas (ALT-12, TEL-13).
