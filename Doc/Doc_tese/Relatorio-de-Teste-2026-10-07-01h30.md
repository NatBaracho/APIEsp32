# Relatório — Integração Oxide ⇄ FluxID (lacre e os dois bancos)

**Data/hora:** 07/10/2026, publicado às 01:30
**Executor:** IA (Claude Code, modelo Claude Opus 5.5)
**Pedido de:** Natã da Silva Baracho, em 07/10/2026: "deixe tudo pronto sobre o lacre e a integração da API com os dois bancos [...] usando o banco de dados FluxID como banco principal. Se for necessário replicar o banco que ele [o frontend] está fazendo, faça, mas que fique integrado com a Oxide. [...] no final gere um relatório para eu validar depois [...] deixe para fazer o teste amanhã antes da integração API e front."
**Branch:** `feat/integracao-oxide-fluxid`, a partir da `main` `387a18e` (merge do PR #14). **Nada foi enviado ao GitHub:** o envio acontece depois da sua validação.
**Situação:** ⏳ **Aguardando o teste formal e a validação de Natã da Silva Baracho (08/10/2026).**

---

## 1. Resumo em uma página

| Pergunta | Resposta |
| --- | --- |
| O que ficou pronto? | O **Worker**: o programa que leva os dados do lacre (telemetria, eventos e alertas) da Oxide para o FluxID e traz o cadastro oficial do FluxID (dispositivos, lacres, cilindros, vínculos e o hash das chaves) de volta para a Oxide |
| E no banco FluxID? | Dois scripts novos. O `004` aplica as decisões P1 a P8 e o gatilho do par lacre + cilindro. O `005` cria o que o frontend usa e o FluxID não tinha (tipos e identificadores de cilindro, laudo do teste hidrostático, histórico do cilindro), já ligado à Oxide |
| E na API? | Confere a chave do dispositivo pelo **hash** vindo do FluxID; devolve o alerta ao Worker quando o gestor o analisa ou encerra; ganhou três rotas para acompanhar a sincronização (`/api/v1/sync/*`) |
| Funcionou? | Na verificação técnica da IA, sim: compilação sem erro, suíte com **94/94**, os cinco scripts aplicados em banco novo no Docker, e o Worker rodou contra o FluxID do Docker, com uma cópia do `oxide.db`. Todos os casos difíceis se comportaram como combinado (seção 5) |
| O que **não** foi feito hoje? | O **teste formal** (roteiro e questionário), que você pediu para amanhã; aplicar os scripts no seu `FluxID_db` principal; enviar ao GitHub; a API do frontend (amanhã) |
| O que você precisa decidir? | As escolhas da seção 4 (7 da implementação e 4 do frontend). Todas têm uma recomendação e podem ser revistas |

## 2. Como ficou o sistema

```text
Frontend (React) ─── (amanhã: API do frontend) ───┐
                                                   ▼
ESP32 (lacre) ──► API Oxide ──► oxide.db ──► Worker ──► FluxID (PostgreSQL, banco principal)
                     ▲              ▲                      │
                     └──────────────┴──── cadastro oficial ┘
                                         (dispositivos, lacres, cilindros, vínculos, hash da chave)
```

- O **ESP32 não muda nada**: continua enviando para a API Oxide com a mesma chave.
- A **Oxide** continua sendo a fila local. Se o FluxID cair, nada se perde.
- O **Worker** roda ao lado da API (`npm run worker`): a cada 10 segundos envia a fila, e a cada 5 minutos traz o cadastro.
- O **FluxID** recebe tudo e é o banco que o frontend vai ler.

## 3. O que foi feito, parte por parte

### 3.1 FluxID — script `sql/fluxid/004_integracao_oxide.sql`

| Mudança | Por quê |
| --- | --- |
| `data_coleta` (telemetria) e `ocorrido_em` (evento do lacre) preenchidas pelo banco na chegada | Decisão P1: a data é a da chegada ao FluxID |
| `telemetrias` ganhou `lacre_id` e `cilindro_id` | Para o **mapa** saber onde está cada lacre e cada cilindro |
| Tabela `telemetrias_quarentena` | Decisão P2: telemetria sem GPS fica guardada à parte e não entra no mapa |
| Tabela `eventos_dispositivo`; `eventos_lacre` com o dispositivo, o código de erro e o conteúdo original | Decisão P4: eventos sem estado do lacre (ex.: reinício) |
| Tipos de alerta = os 28 códigos do catálogo; os 10 alertas da massa passaram de `VIOLACAO_LACRE` para `LACRE_VIOLADO` | Decisão P5: mesmos códigos na Oxide e no FluxID |
| `alertas` ganhou o dispositivo de origem, quem encerrou (texto) e o motivo | Decisão P7: o alerta nasce na Oxide |
| **Gatilho** que recusa alerta cujo par lacre + cilindro não tinha vínculo naquela data | Aprovado por você como entrega futura (FLX-26); feito agora, porque é parte do lacre |

### 3.2 FluxID — script `sql/fluxid/005_estruturas_do_frontend.sql` (replicação do banco do frontend)

O frontend do aalissonalmeidaq foi feito sobre um **banco de teste no Supabase**, em inglês. Como o banco definitivo é o seu `FluxID_db`, comparei os dois. Repliquei no FluxID, em português e no padrão dele, o que as telas de cilindros do frontend usam e que **não deixa dúvida**:

| No frontend | No FluxID | Ligação com a Oxide |
| --- | --- | --- |
| Tipos de cilindro | `tipos_cilindro` (gás, capacidade, medicinal ou industrial) | — |
| Fabricante, pressão, motivo da inativação | Colunas novas em `cilindros` | — |
| Identificadores (QR, Data Matrix, NFC, número do casco) | `identificadores_cilindro` (nunca apagados; desativar exige justificativa) | — |
| Laudo e retificação do teste hidrostático | Colunas novas; teste registrado não pode ser alterado | — |
| Histórico do cilindro | `historico_cilindro` (imutável, numerado por cilindro) | **Sim:** instalar e remover o lacre, alerta vindo do lacre e encerramento do alerta entram sozinhos no histórico, com origem `OXIDE` |

**O que eu não inventei:**
- Os 50 cilindros da massa **não receberam tipo**, porque a massa diz só "OXIGENIO" e não informa se é medicinal ou industrial.
- O histórico inicial foi montado só com fatos que já estavam no banco: criação do cilindro, vínculos e alertas.

### 3.3 Worker (`src/worker/`)

| Faz | Regra |
| --- | --- |
| Envia telemetria | Com posição → `telemetrias`; sem posição → quarentena |
| Envia eventos | Com estado do lacre → `eventos_lacre` (`FECHAMENTO`, `ABERTURA_NAO_AUTORIZADA`, `VIOLACAO`); sem estado → `eventos_dispositivo` |
| Espera o vínculo (P3) | Evento do lacre de um dispositivo sem lacre fica esperando, **sem gastar tentativa** |
| Marca suspeita (P8) | Violação ou abertura não autorizada nova passa o lacre de `INSTALADO` a `SUSPEITA_VIOLACAO`; nada além disso |
| Envia alertas | Com o lacre e o cilindro **da hora do alarme**. Se o gestor analisa ou encerra na Oxide, o mesmo alerta é atualizado no FluxID |
| Tenta de novo (P6) | Envio inicial + 5 tentativas (1 min, 5 min, 15 min, 1 h, 6 h); depois para e aparece para o gestor |
| Traz o cadastro | Dispositivos (com o hash da chave), lacres, cilindros e vínculos; o FluxID prevalece; nada é apagado |
| Registra | Cada rodada em `sync_logs` (`OK`, `PARCIAL` ou `FALHOU`) |

Detalhes completos: [Integracao-Oxide-FluxID.md](../Integracao-Oxide-FluxID.md) v2.0.

### 3.4 API Oxide

- **Chave por hash:** dispositivo vindo do FluxID autentica só com a chave que gera o hash guardado. A chave em texto deixa de valer para ele. Os dispositivos do cadastro provisório continuam como estavam.
- **Alerta volta para a fila** quando o gestor muda o status, para o FluxID receber a mudança.
- **Rotas novas** (abertas e provisórias, grupo "Sincronização" no Swagger):
  - `GET /api/v1/sync/status`: situação das filas;
  - `GET /api/v1/sync/problems`: itens com problema;
  - `POST /api/v1/sync/retry`: devolver um item à fila depois de corrigir a causa.
- `GET /devices` não mostra a chave nem o hash.

### 3.5 Banco local (`oxide.db`)

Colunas novas, criadas sozinhas quando a API ou o Worker sobem:
- `next_attempt_at` na telemetria e nos eventos;
- `sync_*` nos alertas;
- `api_key_hash` nos dispositivos;
- `fluxid_id` nos vínculos.

Também foi criada a tabela `sync_logs`. Nada existente foi alterado nem apagado.

### 3.6 Configuração

- `.env.example` (versionado, sem senha): modelo da configuração do Worker.
- `.env` (fora do git) criado na sua máquina apontando para o **FluxID de análise no Docker** (`127.0.0.1:54329/FluxID_db`), para o teste de amanhã. **Antes de apontar para o banco principal, troque a URL no `.env`.**
- Dependência nova: `pg` (driver do PostgreSQL) e `@types/pg`.

## 4. Escolhas que você precisa validar

### 4.1 Da implementação do Worker

| # | Escolha feita | Alternativa | Por que escolhi |
| --- | --- | --- | --- |
| I1 | "5 tentativas (1 min, 5 min, 15 min, 1 h, 6 h)" lido como **envio inicial + 5 novas tentativas** (6 envios) | 5 envios no total (a espera de 6 h nunca seria usada) | Usa as 5 esperas que você aprovou |
| I2 | FluxID fora do ar **não gasta tentativa** (as linhas ficam `PENDING`) | Gastar tentativa também | Nada chegou a ser enviado; evita parar dados por queda de rede |
| I3 | Alerta sem lacre/cilindro na data, e código já usado no FluxID, **param na hora** para o gestor | Seguir as 5 tentativas | Tentar de novo não muda o passado |
| I4 | `sync_items` **não** foi criada; `sync_logs` sim | Criar as duas | O estado de cada item já fica na própria fila |
| I5 | Quem encerrou o alerta vai como **texto** (`encerrado_por_nome`) | Ligar ao usuário do FluxID | A Oxide não conhece os usuários do FluxID; a API do frontend poderá preencher `encerrado_por` |
| I6 | Lacre do evento = o vínculo **ativo na chegada** ao FluxID | Vínculo da hora da leitura | A Oxide não guarda a data do evento (P1) |
| I7 | Rotas `/api/v1/sync/*` abertas e provisórias | Exigir chave | Mesmo padrão de `/devices` até existir controle por perfil |

### 4.2 Da replicação do frontend (decidir com o aalissonalmeidaq)

| # | Assunto | O que fiz | Precisa de decisão |
| --- | --- | --- | --- |
| F1 | **Estoque**: `in_stock`/`out_of_stock` do frontend × `cilindros.status` do FluxID (`DISPONIVEL`, `COM_CLIENTE`...) | Nada: os dois conceitos se sobrepõem | Usar o status do FluxID ou criar uma situação de estoque separada? |
| F2 | **Tipo dos cilindros já cadastrados** | Tabela de tipos criada, sem tipo nos 50 cilindros | Os de teste são medicinais ou industriais? |
| F3 | **Login, sessões, convites, recuperação de senha** (no frontend, são do Supabase) | Nada | Depende de como será o login da API do frontend (amanhã) |
| F4 | **Papéis por organização** (`memberships` no frontend × `usuario_perfis` no FluxID) | Nada | Mesmo motivo |

## 5. Verificação técnica feita pela IA

Não é o teste formal, que você pediu para amanhã. É a conferência mínima de que o que gerei funciona.

### 5.1 Ambiente

- FluxID de análise no Docker (`fluxid-analise`, PostgreSQL 18 com PostGIS), em bancos temporários criados a partir do dump e já apagados.
- Uma **cópia** do `oxide.db`. O banco real ficou **intacto**: o checksum foi conferido antes e depois.

### 5.2 Resultados

| Verificação | Resultado |
| --- | --- |
| Compilação (`npx tsc --noEmit`) | Sem erros |
| Suíte `npm test` numa cópia do banco | **94/94** (87 anteriores + 7 novos), em duas rodadas; depois da página da proposta, **96/96** (seção 11) |
| Banco criado só pelo script do `Oxidedb.md` v1.7 (BD-14) | **94/94** |
| Scripts `001` → `005` num banco novo | Sem erros; `004` e `005` rodados de novo não mudaram nada |
| 1ª rodada do Worker | Cadastro trazido (50 dispositivos, 50 lacres, 50 cilindros, 60 vínculos, sem conflitos); 10 telemetrias e 8 eventos antigos da cópia enviados (7 telemetrias com posição, 3 na quarentena) |
| Telemetria nova com lacre | Chegou com `LCR-000001` e `CIL-000001` |
| Evento `BROKEN` de `DSP-000011` | Virou `VIOLACAO`; o lacre `LCR-000011` passou de `INSTALADO` a `SUSPEITA_VIOLACAO` (P8) |
| Evento de dispositivo sem lacre (`DSP-000031`) | Ficou esperando, com 0 tentativas e nova verificação em 5 min (P3) |
| Alerta `ALT-OX-1` (`DSP-000001`) | Chegou com `LCR-000001` e `CIL-000001`, o par da hora |
| Alerta com código repetido (`ALT-000001`, já existe na massa) | Parou na Oxide: "o código ALT-000001 já é usado no FluxID por outro alerta" |
| Alerta de dispositivo sem lacre (`ALT-OX-2`) | Parou na Oxide: "sem lacre vinculado ao dispositivo em … o alerta não pode ir ao FluxID sem lacre e cilindro" |
| Exceção de cadastro (`DISPOSITIVO_SEM_LACRE`) | Chegou sem lacre e sem cilindro, como permitido |
| Encerramento na Oxide | O alerta no FluxID ficou `ENCERRADO`, com data, "Gestor teste" e o motivo |
| Histórico do cilindro (`005`) | O alerta vindo da Oxide e o encerramento entraram sozinhos, com origem `OXIDE` e a justificativa |
| Alterar o histórico | Recusado: "Registro imutável" |
| Alerta com par errado (`LCR-000001` + `CIL-000002`) | Recusado pelo gatilho |
| Hash da chave | Chave certa aceita; chave em texto antiga recusada; o login pela chave antiga não acha o dispositivo |
| FluxID fora do ar | Rodada `FALHOU` em `sync_logs`; a linha continuou `PENDING` com 0 tentativas |

### 5.3 Ajustes que fiz durante a verificação

| O que | Por quê |
| --- | --- |
| Porta do servidor de teste: 54329 (já aprovada antes) | — |
| Histórico inicial do cilindro: a criação vem sempre primeiro | Na massa, os vínculos começam em 25/07/2026, **antes** da data de criação dos cilindros (23/09/2026, dia em que o dump foi gerado). É uma incoerência da massa, registrada no `Banco_FluxID.md` |
| No Worker, falhas de conexão interrompem a rodada sem gastar tentativa | Garantir a escolha I2 |

## 6. Pontos de atenção

1. **O seu `FluxID_db` principal ainda está sem os scripts.** Ele precisa de `001` → `002` → `003` → `004` → `005` (seção 17.3 do `Banco_FluxID.md`), com backup antes. Só depois o Worker pode apontar para ele.
2. **Primeira rodada no `oxide.db` real:** o Worker vai trazer os 50 dispositivos, lacres e cilindros do FluxID e as linhas antigas da fila, inclusive as de teste das entregas anteriores. As linhas de dispositivos que não existem no FluxID vão parar com "dispositivo não cadastrado no FluxID". Isso é esperado e pode ser acompanhado em `GET /api/v1/sync/problems`.
3. **Telemetrias antigas sem lacre:** as que foram gravadas antes da associação (entrega B) chegam ao FluxID sem lacre e sem cilindro.
4. **Dispositivos do FluxID sem hash** (hoje são todos os 50 da massa) chegam à Oxide **sem chave utilizável**: não conseguem enviar dados até alguém gerar a chave e gravar o hash no FluxID.
5. **Ordem dos PRs:** este trabalho vai num PR novo, depois da sua validação.

## 7. Como fazer o teste formal amanhã

1. Conferir que o Docker está com o container `fluxid-analise` rodando. O banco `FluxID_db` dele já tem `001` a `005` aplicados.
2. Rodar o **Roteiro de Teste v1.10** completo. A seção nova 5.10 testa o Worker contra o FluxID do Docker (SYN-01 a SYN-23), usando o `.env` já criado.
3. Responder o questionário da seção 8.
4. Com a aprovação, eu registro, atualizo os documentos e envio ao GitHub. Depois disso, você aplica os scripts no banco principal.

## 8. Questionário para amanhã (sim ou não)

1. O Worker pode enviar telemetria, eventos e alertas e trazer o cadastro como descrito na seção 3.3?
2. Escolha I1: "5 tentativas" = envio inicial + 5 novas tentativas?
3. Escolha I2: FluxID fora do ar não gasta tentativa?
4. Escolha I3: alerta sem lacre/cilindro na data, ou com código repetido, para na hora para o gestor?
5. Escolha I4: só `sync_logs`, sem `sync_items`?
6. Escolha I5: quem encerrou o alerta vai como texto até a API do frontend?
7. Escolha I6: o lacre do evento é o do vínculo ativo na chegada?
8. Escolha I7: rotas `/api/v1/sync/*` abertas e provisórias?
9. A chave por hash pode valer como descrito (seção 3.4)?
10. O script `004` (seção 3.1) está aprovado?
11. O script `005` (seção 3.2) está aprovado como proposta, com F1 a F4 para decidir com o aalissonalmeidaq?
12. O teste formal (roteiro v1.10) passou como esperado?
13. Posso registrar a aprovação, atualizar os documentos e enviar ao GitHub?

## 9. Arquivos

| Tipo | Arquivos |
| --- | --- |
| Novos | `Doc/Contrato-API-Frontend.md` (proposta do contrato da API para o frontend, pedida por você depois deste relatório; ver seção 10), `sql/fluxid/004_integracao_oxide.sql`, `sql/fluxid/005_estruturas_do_frontend.sql`, `src/worker/` (`config.ts`, `retry.ts`, `fluxid.ts`, `pushTelemetry.ts`, `pushEvents.ts`, `pushAlerts.ts`, `cadastroSync.ts`, `runner.ts`, `index.ts`), `src/repositories/SyncRepository.ts`, `src/controllers/SyncController.ts`, `src/routes/syncRoutes.ts`, `src/utils/apiKeyHash.ts`, `.env.example`, este relatório |
| Alterados (código) | `src/database/connection.ts`, `src/Middleware/apiKeyMiddleware.ts`, `src/repositories/DeviceRepository.ts`, `AlertRepository.ts`, `syncLogRepository.ts`, `src/services/DeviceService.ts`, `src/models/Device.ts`, `Alert.ts`, `src/server.ts`, `src/docs/openapi.ts`, `tests/api.test.ts`, `package.json`, `package-lock.json` |
| Atualizados (documentos) | `Integracao-Oxide-FluxID.md` v2.0, `Banco_FluxID.md` v3.3, `Desenvolvimento.md` (1.1, 1.3, 1.8 a 1.10, 7.23, 9, Parte 3), `Oxidedb.md` v1.7, `Regras-de-Negocio-e-Banco-Oxide.md`, `Checklist-Projeto.md`, `ESP32-envio-de-dados.md`, `README.md`, `PlanoDeTeste.md` v1.11, `RoteiroDeTeste.md` v1.10 |
| Fora do git | `.env` (FluxID de análise no Docker) e o `oxide.db` real, que não foi tocado |

## 10. Documento novo: contrato da API para o frontend

Pedido por você depois deste relatório ("aproveite, faça hoje se necessário"). O arquivo [Contrato-API-Frontend.md](../Contrato-API-Frontend.md) (v0.1) é uma **proposta** para você e o aalissonalmeidaq aprovarem antes da API do frontend:

- A API **imita o jeito como o frontend já chama o servidor**: mesmos nomes de função, corpo e códigos. O frontend muda o endereço base e o login.
- Lista cada chamada (login, permissões, cilindros, lacres, mapa, alertas, visão geral, comandos) e a tabela do FluxID que a atende.
- Traz 9 decisões (D1 a D9) com recomendação; elas incluem as F1 a F4 da seção 4.2.
- Nada foi implementado: é só o contrato.

Pergunta extra para o questionário de amanhã: **14.** O contrato v0.1 pode ser levado ao aalissonalmeidaq como proposta?

## 11. Página da proposta no navegador (`/api-docs-fluxid`)

Também a seu pedido, o contrato ganhou uma página no formato do Swagger, separada da API atual e marcada como **proposta**: `http://localhost:3000/api-docs-fluxid`. Ela mostra as 21 funções em 4 grupos (Login e sessão, Acesso, Cilindros, Lacre e mapa), com entrada, saída, exemplos e a tabela do FluxID de cada uma. **Nenhuma dessas rotas funciona ainda** (`/api/v1/app/...` responde `404`).

- As duas páginas (`/api-docs` e `/api-docs-fluxid`) passaram a gerar os arquivos separadamente (`serveFiles`), para uma não sobrescrever a outra.
- A suíte ganhou 2 casos (GER-07 e GER-08) e passou de 94 para **96/96**, em duas rodadas, numa cópia do banco. O teste novo achou um erro meu na própria proposta (a indicação "sem token" do login no lugar errado), corrigido antes desta versão.

Pergunta extra: **15.** A página `/api-docs-fluxid` pode ficar no projeto até a API do frontend ser implementada?
