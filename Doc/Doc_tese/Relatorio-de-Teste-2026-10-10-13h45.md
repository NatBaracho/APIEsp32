# Relatório de Teste — Banco Oxide completo

**Data:** 10/10/2026, 13:45 (primeira rodada às 13:30; rodada final às 13:39)
**Executado por:** IA (Claude Code, modelo Claude Opus 5.5), a pedido de Natã da Silva Baracho
**Branch:** `feat/oxide-enxuta` (PR #20), enviada ao GitHub depois da aprovação
**Base:** `Oxidedb.md` 2.0 e `PlanoDeTeste.md` 2.0
**Situação:** ✅ **aprovado por Natã da Silva Baracho em 10/10/2026** (seção 8)

---

## 1. Resumo

| Indicador | Primeira rodada | Rodada final |
| --- | --- | --- |
| Teste direto no banco (SQLite) | 62 de 64 | **64 de 64** |
| Suíte da API (`npm test`) | 71 de 71 | **91 de 91** (20 casos novos de banco) |
| Simulador (`npm run simular`) | 23 de 23 | **23 de 23** |
| Compilação (`npx tsc --noEmit`) | Sem erros | Sem erros |
| `oxide.db` do projeto | Intacto | **Intacto**: SHA-256 `0b6b2b2d…5c87f52` igual antes e depois |
| Banco principal (Supabase) | Não acessado | **Não acessado** |

O teste encontrou **dois defeitos**, e os dois foram corrigidos nesta rodada, com a autorização de Natã:

1. **Banco migrado diferente do banco novo:** a tabela `commands` antiga ficava sem a data de criação padrão.
2. **API e Worker gravando ao mesmo tempo:** a API respondia erro `500` ao lacre enquanto outro processo gravava no banco. Este é o mais importante, porque o Worker roda em outro processo e grava o tempo todo.

Depois das correções, todas as tabelas passam em todos os casos, no banco novo e no banco migrado.

## 2. Como o teste foi feito

- O teste fala direto com o SQLite, sem passar pelas rotas da API. Assim ele confere o que o **banco** recusa sozinho, mesmo que a API erre.
- O banco de teste é criado pela própria API (`src/database/connection.ts`), numa pasta temporária.
- A migração roda numa **cópia** do `oxide.db` do projeto, em outra pasta temporária.
- O `oxide.db` do projeto só é lido para fazer a cópia. O checksum foi conferido antes e depois.
- As pastas temporárias do teste de banco são apagadas no fim.
- A suíte da API e o simulador foram executados em seguida, para conferir o banco em uso. A suíte rodou três vezes seguidas depois das correções, com o mesmo resultado.

## 3. Resultados do teste direto no banco (rodada final)

| Grupo | Passaram | Total |
| --- | --- | --- |
| 1. Estrutura | 8 | 8 |
| 2. Tabela devices | 9 | 9 |
| 3. Tabela mensagens (fila) | 12 | 12 |
| 4. Tabela commands | 10 | 10 |
| 5. Volume e desempenho | 7 | 7 |
| 6. Migração do banco atual (em cópia) | 17 | 17 |
| 7. Banco do projeto | 1 | 1 |
| **Total** | **64** | **64** |

### 1. Estrutura

| Caso | O que foi conferido | Resultado | Observado |
| --- | --- | --- | --- |
| EST-01 | Só as três tabelas do modelo | ✅ Passou | commands,devices,mensagens |
| EST-02 | Colunas de devices | ✅ Passou | 15 colunas |
| EST-03 | Colunas de mensagens | ✅ Passou | 11 colunas |
| EST-04 | Colunas de commands | ✅ Passou | 8 colunas |
| EST-05 | Índices criados | ✅ Passou | idx_devices_api_key,idx_devices_api_key_hash,idx_mensagens_device,idx_mensagens_fila |
| EST-06 | Chaves estrangeiras de mensagens e commands apontam para devices | ✅ Passou | CASCADE na troca, RESTRICT na exclusão |
| EST-07 | Banco novo íntegro | ✅ Passou | integrity_check ok |
| EST-08 | Abrir de novo não cria nem apaga nada | ✅ Passou | estrutura e dados iguais, sem cópia de segurança |

### 2. Tabela devices

| Caso | O que foi conferido | Resultado | Observado |
| --- | --- | --- | --- |
| DEV-01 | Cadastro com os valores padrão | ✅ Passou | active=1, estado vazio |
| DEV-02 | device_id repetido é recusado | ✅ Passou | UNIQUE constraint failed: devices.device_id |
| DEV-03 | api_key repetida é recusada | ✅ Passou | UNIQUE constraint failed: devices.api_key |
| DEV-04 | device_id vazio (NULL) é recusado | ✅ Passou | NOT NULL constraint failed: devices.device_id |
| DEV-05 | api_key vazia (NULL) é recusada | ✅ Passou | NOT NULL constraint failed: devices.api_key |
| DEV-06 | active fora de 0 e 1 é recusado | ✅ Passou | CHECK constraint failed: active IN (0, 1) |
| DEV-07 | Hash da chave repetido é recusado | ✅ Passou | UNIQUE constraint failed: devices.api_key_hash |
| DEV-08 | Vários dispositivos sem hash são aceitos | ✅ Passou | índice único só vale para hash preenchido |
| DEV-09 | Último estado é gravado e lido | ✅ Passou | valores iguais aos gravados |

### 3. Tabela mensagens (fila)

| Caso | O que foi conferido | Resultado | Observado |
| --- | --- | --- | --- |
| MSG-01 | Mensagem nova entra como PENDING, com 0 tentativas e data de chegada | ✅ Passou | 2026-10-10 16:39:01 |
| MSG-02 | message_id repetido é recusado | ✅ Passou | UNIQUE constraint failed: mensagens.message_id |
| MSG-03 | Dispositivo que não existe é recusado | ✅ Passou | FOREIGN KEY constraint failed |
| MSG-04 | Tipo desconhecido é recusado | ✅ Passou | CHECK constraint failed: tipo IN ('TELEMETRIA', 'EVENTO', 'ALERTA', 'CONFIRMACAO_COMANDO') |
| MSG-05 | Situação desconhecida é recusada | ✅ Passou | CHECK constraint failed: status IN ('PENDING', 'PROCESSING', 'SYNCED', 'ERROR', 'ARQUIVADA') |
| MSG-06 | Os quatro tipos são aceitos | ✅ Passou | TELEMETRIA, EVENTO, ALERTA, CONFIRMACAO_COMANDO |
| MSG-07 | As cinco situações são aceitas | ✅ Passou | PENDING, PROCESSING, SYNCED, ERROR, ARQUIVADA |
| MSG-08 | Campos obrigatórios vazios (NULL) são recusados | ✅ Passou | message_id, device_id, tipo e payload_json |
| MSG-09 | Dispositivo com mensagens não pode ser apagado | ✅ Passou | FOREIGN KEY constraint failed |
| MSG-10 | Trocar o device_id leva as mensagens junto | ✅ Passou | DSP-TROCADO |
| MSG-11 | Mensagem (JSON) com acentos e números volta igual | ✅ Passou | texto e números iguais |
| MSG-12 | Operação desfeita (rollback) não deixa mensagem pela metade | ✅ Passou | 12 antes e depois |

### 4. Tabela commands

| Caso | O que foi conferido | Resultado | Observado |
| --- | --- | --- | --- |
| CMD-01 | Comando novo entra como PENDENTE, com data de criação | ✅ Passou | 2026-10-10 16:39:01 |
| CMD-02 | command_id repetido é recusado | ✅ Passou | UNIQUE constraint failed: commands.command_id |
| CMD-03 | Dispositivo que não existe é recusado | ✅ Passou | FOREIGN KEY constraint failed |
| CMD-04 | Situação desconhecida é recusada | ✅ Passou | CHECK constraint failed: status IN ('PENDENTE', 'EXECUTADO', 'ERRO') |
| CMD-05 | Comando pendente de tipo desconhecido é recusado | ✅ Passou | CHECK constraint failed: status <> 'PENDENTE' OR command_type IN ('TRAVAR_VALVULA', 'DESTRAVAR_VALVULA') |
| CMD-06 | Os dois tipos e as três situações são aceitos | ✅ Passou | TRAVAR/DESTRAVAR; PENDENTE, EXECUTADO, ERRO |
| CMD-07 | Confirmar o comando grava a situação, a data e o erro | ✅ Passou | status, executed_at e error_message |
| CMD-08 | Comando já executado não volta para pendente com tipo inválido | ✅ Passou | CHECK constraint failed: status <> 'PENDENTE' OR command_type IN ('TRAVAR_VALVULA', 'DESTRAVAR_VALVULA') |
| CMD-09 | Dispositivo com comandos não pode ser apagado | ✅ Passou | FOREIGN KEY constraint failed |
| CMD-10 | Campos obrigatórios vazios (NULL) são recusados | ✅ Passou | command_id, device_id e command_type |

### 5. Volume e desempenho

| Caso | O que foi conferido | Resultado | Observado |
| --- | --- | --- | --- |
| VOL-01 | Gravar 100000 mensagens | ✅ Passou | 1441 ms |
| VOL-02 | A busca da fila usa o índice idx_mensagens_fila | ✅ Passou | SEARCH mensagens USING COVERING INDEX idx_mensagens_fila (status=?) \| USE TEMP B-TREE FOR ORDER BY |
| VOL-03 | Buscar o próximo lote com a fila cheia | ✅ Passou | 1.10 ms por busca |
| VOL-04 | A busca por dispositivo usa o índice idx_mensagens_device | ✅ Passou | SEARCH mensagens USING COVERING INDEX idx_mensagens_device (device_id=?) |
| VOL-05 | A checagem de duplicidade (message_id) usa índice | ✅ Passou | SEARCH mensagens USING COVERING INDEX sqlite_autoindex_mensagens_1 (message_id=?) |
| VOL-06 | Banco íntegro depois da carga | ✅ Passou | ok; arquivo com 27.7 MB |
| VOL-07 | Limpeza das enviadas devolve o espaço | ✅ Passou | 90000 apagadas, 10000 pendentes mantidas; 27.7 MB -> 2.8 MB |

Com 100.000 mensagens na fila, o arquivo chegou a 27,7 MB. A gravação levou 1441 ms e a busca do próximo lote ficou em cerca de 1 ms.

### 6. Migração do banco atual (em cópia)

| Caso | O que foi conferido | Resultado | Observado |
| --- | --- | --- | --- |
| MIG-01 | A API abre o banco antigo sem erro | ✅ Passou | banco antigo com 11 tabelas |
| MIG-02 | Cópia de segurança criada, com todas as tabelas e linhas antigas | ✅ Passou | as 11 tabelas do banco antigo, mesmas quantidades, íntegra |
| MIG-03 | Ficaram só as três tabelas | ✅ Passou | commands,devices,mensagens |
| MIG-04 | Dispositivos preservados (id, chave e ativo) | ✅ Passou | 3 dispositivo(s) |
| MIG-05 | Leituras antigas completas na fila para envio | ✅ Passou | 1 de 10 leitura(s) |
| MIG-06 | Nenhuma mensagem antiga se perdeu | ✅ Passou | 18 mensagens: 1 na fila e 17 arquivadas |
| MIG-07 | Leitura convertida tem posição, bateria e a marca de antiga | ✅ Passou | 1 conferida(s) |
| MIG-08 | Todas as mensagens guardadas são JSON válido | ✅ Passou | 0 inválidas |
| MIG-09 | Comandos preservados | ✅ Passou | 0 comando(s) |
| MIG-10 | Banco migrado íntegro | ✅ Passou | integrity_check ok, sem chave estrangeira solta |
| MIG-11 | As regras valem no banco migrado | ✅ Passou | tipo, dispositivo e comando conferidos |
| MIG-12 | Abrir de novo não migra outra vez | ✅ Passou | mesma quantidade, uma só cópia de segurança |
| MIG-13 | O banco migrado tem a mesma estrutura de um banco novo | ✅ Passou | igual |
| MIG-14 | No banco migrado, active fora de 0 e 1 é recusado | ✅ Passou | CHECK constraint failed: active IN (0, 1) |
| MIG-15 | No banco migrado, comando sem data de criação recebe a data atual | ✅ Passou | data preenchida |
| MIG-16 | No banco migrado, o comando gravado do jeito que a API grava entra com a data | ✅ Passou | 2026-10-10 16:39:06 |
| MIG-17 | No banco migrado, trocar active para valor inválido é recusado | ✅ Passou | CHECK constraint failed: active IN (0, 1) |

Banco do projeto antes da migração (lido na cópia): 11 tabelas, 3 dispositivos, 10 leituras, 8 eventos, 0 alertas e 0 comandos. Das 10 leituras, 1 tem posição e bateria.

### 7. Banco do projeto

| Caso | O que foi conferido | Resultado | Observado |
| --- | --- | --- | --- |
| REAL-01 | O oxide.db do projeto não foi alterado | ✅ Passou | SHA-256 `0b6b2b2d…5c87f52` igual antes e depois |

## 4. Defeitos encontrados e corrigidos

### 4.1 Banco migrado diferente do banco novo (casos MIG-13 e MIG-15)

- **O que acontecia:** na migração, as tabelas `devices` e `commands` antigas eram mantidas como estavam. A `commands` antiga não tem valor padrão para `created_at`, então gravar um comando sem a data era recusado no banco migrado e aceito no banco novo.
- **Efeito na API:** nenhum até aqui, porque a API sempre grava a data. O risco era para código futuro.
- **Correção** (`src/database/connection.ts`): a tabela que já existe com definição diferente da atual é **refeita no formato atual**, com os mesmos dados. No banco do projeto isso vale para `devices` e `commands`.
- **Também corrigido:** a cópia de segurança agora é feita **antes de qualquer mudança**. Antes, ela saía com a tabela `mensagens` vazia e as colunas novas de `devices`; agora é igual ao arquivo antigo.
- **Conferência:** o banco migrado tem a mesma definição de um banco novo (MIG-13), os 3 dispositivos e as chaves foram preservados (MIG-04) e a segunda abertura não migra de novo (MIG-12).

### 4.2 Erro `500` quando API e Worker gravam ao mesmo tempo

- **Como apareceu:** no teste novo, dois processos gravam no banco enquanto a API recebe 150 eventos do lacre. Na primeira execução, a API respondeu `500 Erro ao receber evento` em vários deles.
- **Causa:** a API começava a operação lendo (para checar a duplicidade) e só depois pedia para gravar. Se outro processo já estava gravando, o SQLite recusava na hora, sem esperar.
- **Correção:** as operações que gravam passaram a pedir a vez de gravar logo no início (`immediate`). Assim a API **espera** o outro processo terminar, em vez de falhar. Arquivos: `MessageService.ts` (receber mensagem), `CommandService.ts` (confirmar comando), `MessageRepository.ts` (marcar o lote do Worker) e `retencao.ts`.
- **Depois da correção:** 450 de 450 mensagens gravadas, nenhum erro nos dois processos e nenhuma recusa da API, em três execuções seguidas.
- **Por que importa:** o Worker (`npm run worker`) é outro processo e grava no mesmo arquivo. Sem a correção, o lacre podia receber `500` sempre que enviasse uma mensagem no instante em que o Worker gravava.

## 5. Suíte da API: casos novos

A suíte passou de 71 para **91 casos**. Os 20 novos:

- **Grupo 11:** banco migrado com a mesma definição de um banco novo, e cópia de segurança igual ao arquivo antigo (1 caso).
- **Grupo 12 (novo) — Banco Oxide, direto no SQLite:** estrutura (2), `devices` (4), `mensagens` (6), `commands` (3), volume com 100.000 mensagens (3) e gravação ao mesmo tempo (1).

O grupo 12 apaga no fim tudo o que criou.

## 6. Pontos de atenção

- **Espera sob carga pesada:** no teste de gravação ao mesmo tempo, a resposta mais lenta da API ficou entre 2,1 e 3,4 segundos. O limite de espera do banco é 5 segundos; acima disso a API responderia `500`. O teste é mais pesado que o uso real (dois processos gravando sem parar), mas o número fica registrado.
- **A busca da fila ordena fora do índice** (`USE TEMP B-TREE FOR ORDER BY`, caso VOL-02). Com 10.000 pendentes levou cerca de 1 ms, então não é problema no volume esperado.
- **O conteúdo da mensagem não é conferido pelo banco.** A coluna `payload_json` aceita qualquer texto; quem valida posição, bateria e os demais campos é a API (coberto pela suíte).
- **A migração refaz `devices` e `commands`.** Se uma linha antiga não couber nas regras atuais, a API não sobe e nada é alterado; a cópia de segurança já terá sido feita. No banco do projeto todas as linhas couberam.
- **Não testado:** queda de energia no meio de uma gravação.
- **O `oxide.db` do projeto continua no modelo antigo.** Ele só muda quando a API nova for ligada na pasta do projeto.

## 7. Questionário de validação (responda sim ou não)

1. Aprova a correção da migração (tabelas `devices` e `commands` refeitas no formato atual)?
2. Aprova a cópia de segurança feita antes de qualquer mudança?
3. Aprova a correção da gravação ao mesmo tempo (a API espera o Worker em vez de responder `500`)?
4. Aprova os 20 casos novos na suíte (`npm test`, agora 91)?
5. Posso atualizar os documentos e enviar ao GitHub, no PR #20?

## 8. Validação (10/10/2026)

Natã da Silva Baracho respondeu **sim** às cinco perguntas: **aprovado por Natã da Silva Baracho em 10/10/2026**.

Depois desta rodada, o teste em massa (`Relatorio-de-Teste-2026-10-10-14h00.md`) levou à adoção do modo WAL. Com ele, a espera registrada na seção 6 (de 2,1 a 3,4 segundos no teste de gravação ao mesmo tempo) caiu para 42 ms, e a suíte passou a ter 92 casos (um a mais, que confere o modo WAL).
