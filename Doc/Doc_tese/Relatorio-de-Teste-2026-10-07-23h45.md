# Relatório de Teste — Sistema completo: API do frontend, regras automáticas e manutenção

**Data:** 07/10/2026, 23:45
**Executado por:** IA (Claude), a pedido de Natã da Silva Baracho
**Pedido:** "preciso que tudo esteja 100% rodando e testado, faça isso tudo hoje e amanhã irei validar"
**Branch:** `feat/sistema-completo` (commits locais; ainda não enviados ao GitHub)
**Situação:** **aguardando a validação de Natã da Silva Baracho** (questionário na seção 9)

---

## 1. Resumo

O backend ficou completo para o MVP. Foram feitas quatro coisas:

1. **Banco FluxID — script `006`**: tudo o que a API do frontend e as regras de rota precisam.
2. **API do frontend** (`/api/v1/app`): 23 funções, com login próprio, sobre o FluxID.
3. **Regras automáticas de alerta**:
   - o servidor abre sozinho 9 tipos de alerta, entre eles **saída de rota** e **saída da geocerca**;
   - quando o lacre abre com o cilindro em trânsito, o servidor também manda **travar a válvula**.
4. **Manutenção**: `GET /health`, backup da Oxide, limpeza do que já foi sincronizado e definição de senha.

**Resultado dos testes (rodada final, 23:27 a 23:28):**

| Teste | Onde rodou | Resultado |
| --- | --- | --- |
| Compilação (`npx tsc --noEmit`) | Projeto | Sem erros |
| Suíte da API (`npm test`) | Cópia da `oxide.db` real | **108 de 108** |
| API do frontend (`npm run test:app`) | FluxID de análise no Docker | **45 de 45** |
| Simulador (`npm run simular`) | FluxID de análise no Docker | **65 de 65** |
| Backup e retenção | Cópia da `oxide.db` | Conforme (seção 4.4) |
| `/health`, CORS e login, com a API subindo como no `npm start` | Pasta temporária + FluxID de análise | Conforme (seção 4.5) |

**Segurança:**
- a sua `oxide.db` **não foi alterada**: SHA-256 igual antes e depois (`0b6b2b2d…5c87f52`);
- **o banco principal (`FluxID_db` do seu PostgreSQL) não foi acessado**: tudo rodou no FluxID de análise no Docker (`127.0.0.1:54329`);
- nenhuma senha foi registrada.

## 2. O que mudou, parte por parte

### 2.1 FluxID — `sql/fluxid/006_api_frontend_rotas.sql`

| Passo | O que cria ou muda |
| --- | --- |
| (a) | Pessoa em várias organizações: `usuario_organizacoes` e `usuario_organizacao_perfis` (copiados dos usuários e papéis atuais) |
| (b) | Login: `sessoes_usuario` (só o hash do token), `tentativas_login`, `recuperacoes_senha`, `convites` e `usuarios.foto_caminho` |
| (c) | 9 permissões novas (ver cilindros, inativar, identificadores, estoque, teste hidrostático, histórico, **enviar comandos**, **justificar alertas**, **planejar rotas**), distribuídas pelos papéis |
| (d) | `cilindros.situacao_estoque` (em estoque / fora) e `chaves_operacao` (entrada no estoque sem duplicar) |
| (e) | `rotas_entrega` (pontos da rota; margem padrão de **50 m**) e `desvios_rota` (programado ou justificado) |
| (f) | Em `alertas`: justificativa, quem justificou e quando, e `tratado_no_fluxid` |
| (g) | Gatilho: todo cilindro novo ganha `CILINDRO_CRIADO` no histórico, com a pessoa que criou |

Validação: banco novo (dump + `001` a `006`), depois o `006` de novo. Sem erros, e a segunda execução não mudou nada. Aplicado também no `FluxID_db` do Docker, onde rodaram os testes.

### 2.2 API do frontend — `POST /api/v1/app/<função>`

- **Formato:** o mesmo que o frontend já usa (nomes de função, `operation`, `organization_id` e respostas `{ code }`). O frontend troca três coisas:
  - o endereço;
  - a origem do token;
  - deixa de mandar o `apikey`.
- **Login:**
  - a senha é guardada com scrypt;
  - o token é aleatório e o FluxID guarda só o hash;
  - a sessão dura no máximo 8 h, e 30 min sem uso a encerram;
  - até 3 sessões por pessoa;
  - 5 falhas de login bloqueiam o e-mail por 15 min.
- **23 funções:**
  - as 21 do contrato;
  - mais `query-deliveries` e `manage-deliveries`, para clientes, endereços, entregas, rotas e desvios. Sem elas, o operador não teria como criar a rota.
- **Permissões:** os códigos do frontend (`cylinder.read`...) são calculados a partir das permissões do FluxID.
- **CORS:** o navegador só chama a API a partir das origens em `APP_ORIGENS` (`.env`).
- Documentação: `Doc/Contrato-API-Frontend.md` v1.0 e a página `/api-docs-fluxid`.

### 2.3 Regras automáticas

| Alerta | Quando | Onde roda |
| --- | --- | --- |
| `BATERIA_BAIXA` | bateria < 15% | ao receber a telemetria |
| `GSM_SINAL_FRACO` | sinal < -105 dBm | ao receber a telemetria |
| `LACRE_ABERTO_EM_TRANSITO` | lacre aberto ou rompido com o cilindro em trânsito; **cria `TRAVAR_VALVULA`** | ao receber telemetria ou evento |
| `COMANDO_FALHOU` | o lacre confirmou o comando com `ERRO` | ao receber a confirmação |
| `SEM_COMUNICACAO` | sem contato há mais de 30 min | Worker |
| `GPS_SEM_SINAL` | mandando telemetria sem posição há mais de 15 min | Worker |
| `COMANDO_SEM_RESPOSTA` | comando pendente há mais de 10 min | Worker |
| `SAIDA_ROTA` | entrega em andamento: a última posição está a mais de 50 m da rota, fora de um desvio | Worker |
| `SAIDA_GEOCERCA` | cilindro com o cliente: a última posição está fora do raio do endereço | Worker |

Regras comuns:
- só abre alerta se o dispositivo está num lacre que está num cilindro, porque o FluxID exige os dois;
- não repete enquanto houver um aberto do mesmo tipo, nem antes de 30 min depois do último;
- todos os limites mudam no `.env`, sem mudar o código.

### 2.4 Worker

- Roda as regras de tempo, rota e geocerca a cada rodada. Os alertas criados vão ao FluxID na mesma rodada.
- **Decisão D5:** depois que o gestor trata o alerta pelo frontend, o Worker não sobrescreve mais o FluxID e copia o novo estado para a Oxide.

### 2.5 Oxide

- Colunas novas:
  - em `devices`: `last_contact_at`, `last_telemetry_at` e `last_position_at`;
  - em `telemetry_queue` e `events`: `received_at` (hora de chegada).
- Elas são criadas sozinhas quando a API sobe. O `Oxidedb.md` foi para a v1.9.

### 2.6 Manutenção

| Comando ou rota | O que faz |
| --- | --- |
| `GET /health` | Situação da API, da Oxide (filas), do FluxID e do Worker; 200 ou 503; não mostra a conexão |
| `npm run backup` | Cópia consistente da `oxide.db` em `backups/` (funciona com a API ligada), conferida com `integrity_check`; mantém as 14 mais novas |
| `npm run retencao` | Mostra o que sairia da Oxide: só telemetria e eventos **já sincronizados** há mais de 30 dias e rodadas antigas do Worker. Só apaga com `-- --confirmar` |
| `npm run senha -- <email>` | Define a senha de login de uma pessoa do FluxID; a senha é digitada sem aparecer |
| `npm start` / `npm run dev` | Passam a ler o `.env` (antes, a API do frontend ficaria sem o FluxID) |

## 3. Achados durante o desenvolvimento (já corrigidos)

| # | Achado | Correção |
| --- | --- | --- |
| A4 | Nas criações, o código do registro (ex.: `CIL-000156`) ia no campo `code` e **apagava** o `code: "CREATED"` da resposta | Campos renomeados (`cylinder_code`, `seal_code`...) e a resposta passou a proteger o `code` |
| A5 | A limpeza usaria `last_seen_at`, que fica vazio na maioria das linhas: apagaria quase toda a telemetria sincronizada de uma vez | Coluna `received_at` (hora de chegada); linhas antigas, sem ela, **nunca** são apagadas |
| A6 | O lacre aberto em trânsito só disparava pela telemetria; o evento `seal_changed` não disparava | A regra vale também para o evento |
| A7 | `npm start` não lia o `.env` | `npm start` e `npm run dev` leem o `.env` |
| A8 | O raio padrão da geocerca na API ficou em 200 m, diferente da sua regra (10 m) e do banco (10 m) | Padrão da API em 10 m |
| A9 | Duas Oxides com Worker no mesmo FluxID abririam o mesmo alerta automático duas vezes | Registrado como regra de operação: **um Worker por FluxID** (`Integracao-Oxide-FluxID.md`, 3.5) |

## 4. Como foi testado

### 4.1 Suíte da API (`npm test`) — 108/108

- Rodou numa **cópia** da sua `oxide.db`, numa pasta temporária.
- 12 casos novos (grupo 11):
  - `BATERIA_BAIXA`, `GSM_SINAL_FRACO`, `LACRE_ABERTO_EM_TRANSITO` com `TRAVAR_VALVULA` e `COMANDO_FALHOU`;
  - sem repetição;
  - nada para dispositivo sem lacre e cilindro;
  - último contato e última posição;
  - `GPS_SEM_SINAL`, `SEM_COMUNICACAO` e `COMANDO_SEM_RESPOSTA` na rodada periódica;
  - distâncias da rota;
  - `/health`.
- Dois casos antigos foram atualizados, porque esperavam que `/api/v1/app` ainda não existisse.

### 4.2 API do frontend (`npm run test:app`) — 45/45

Cria uma organização própria no FluxID de análise (`ORG-T<rodada>`, com admin, operador e visualizador) e percorre:
- **login:** erros, 4ª sessão, bloqueio por tentativas, inatividade e recuperação de senha;
- **permissões;**
- **cilindros:** todas as operações e conflitos da etapa 006 do frontend;
- **lacre e dispositivo:** chave mostrada uma vez, só o hash no banco;
- **vínculos;**
- **Worker:** traz o cadastro feito pela API, e o lacre envia com a chave gerada;
- **comandos pelo frontend;**
- **alertas:** analisar, justificar, encerrar, e D5 espelhado na Oxide;
- **entrega com rota de 50 m:**
  - sobre a rota não alerta;
  - a 334 m da rota abre `SAIDA_ROTA`;
  - desvio justificado suspende a regra;
  - lacre aberto em trânsito abre o alerta e o travamento;
  - entrega concluída: a 60 m do cliente não alerta, e a 1,1 km abre `SAIDA_GEOCERCA`;
- **mapa e visão geral;**
- **convite** aceito sem login, **bloqueio** de pessoa, **papéis**, **auditoria**, **foto** e **logout**.

### 4.3 Simulador (`npm run simular`) — 65/65

Mesmo percurso de antes, com três mudanças:
- o operador **entra pela API do frontend** e faz por ela a rota, a saída e a entrega;
- `LACRE_ABERTO_EM_TRANSITO` (com `TRAVAR_VALVULA`), `SAIDA_ROTA` (a 1396 m da rota) e `SAIDA_GEOCERCA` (a 60 m de um raio de 10 m) foram **detectados pelo servidor**, sem o lacre enviar;
- o gestor encerrou o alerta e **confirmou a violação** (lacre `ROMPIDO`) pela API do frontend.

### 4.4 Backup e retenção (numa cópia)

- **Backup:** cópia criada e conferida. Com `BACKUP_MANTER=1`, a cópia anterior foi removida, como esperado.
- **Retenção sem `--confirmar`:** só listou.
- **Retenção com `--confirmar`:**
  - removeu a linha sincronizada antiga;
  - **manteve** as linhas sem `received_at` e as de posição vista recentemente.

### 4.5 Subida real da API

- A API subiu com o `.env`, numa pasta temporária.
- `/health`: 200, Oxide OK e FluxID OK.
- CORS: liberou `http://localhost:5173` e não respondeu à origem desconhecida.
- Login de um usuário da massa (`fluxid@teste.com`): `INVALID_CREDENTIALS`, **como esperado**. Os usuários da massa têm `HASH_PROVISORIO` e precisam de `npm run senha`.

## 5. Decisões assumidas para a validação

Você pediu tudo pronto hoje, então segui as recomendações já escritas. **Qualquer uma pode ser trocada amanhã.**

| # | Decisão | O que foi feito |
| --- | --- | --- |
| D1 | Estoque | Coluna própria `cilindros.situacao_estoque` |
| D2 | Permissões | 9 permissões novas no FluxID, traduzidas para os códigos do frontend |
| D3 | Login | A API faz o login (sem MFA por enquanto) |
| D4 | Pessoa em várias empresas | Sim (`usuario_organizacoes`) |
| D5 | Onde o alerta é tratado | No frontend; o FluxID manda |
| D6 | Indicadores | Movimentação = saídas e entregas por dia; desempenho = % com GPS em 24 h, % de alertas encerrados em até 24 h e % de testes hidrostáticos em dia |
| D7 | Foto | Pasta do servidor (`arquivos/`) |
| D8 | Comandos pelo frontend | Sim, com login, permissão, justificativa e auditoria |
| D9 | JSON em inglês | Sim |
| D10 | Clientes, entregas e rotas | Duas funções novas (`query-deliveries`, `manage-deliveries`), fora do contrato v0.1 |
| D11 | Limites dos alertas | Bateria 15%; GSM -105 dBm; sem comunicação 30 min; GPS 15 min; comando 10 min; margem da rota 50 m; repetição 30 min |
| D12 | Lacre aberto em trânsito | Além do alerta, **trava a válvula automaticamente** |
| D13 | Retenção | 30 dias, só o que já está no FluxID; nunca apaga sem `--confirmar` |
| D14 | Raio padrão da geocerca | 10 m (a sua regra); cada endereço pode ter outro |

## 6. O que **não** foi feito (e por quê)

- **Aplicar os scripts `001` a `006` no seu `FluxID_db` principal.** Não tenho acesso a ele, por segurança. É o seu passo (seção 8).
- **Ligar o frontend** (`fluxid_integra2026`) à `/api/v1/app`. O repositório é do aalissonalmeidaq; o contrato v1.0 diz exatamente o que muda.
- **Envio de e-mail** (convite e recuperação de senha) e **MFA**. Sem e-mail, o token só sai na resposta em modo de teste (`APP_EXPOR_TOKENS=1`).
- **Alertas de agenda:** revisão do lacre vencida, teste hidrostático vencido, parada prolongada e movimentação suspeita.
- **Hardware real** (ESP32).
- **Aviso ativo ao motorista e ao gestor** (SMS, e-mail ou notificação). Hoje o alerta aparece no frontend.

**Pontos para você saber:**
- a rota da Oxide `PATCH /iot/alerts/.../status` continua aberta, só para teste;
- `remove_role` apaga a linha do papel (com auditoria), como no frontend;
- os 155 cilindros da massa não têm tipo cadastrado: aparecem com um tipo provisório (`type.legacy: true`) até alguém escolher o tipo real.

## 7. Documentos atualizados

| Documento | Versão | O que mudou |
| --- | --- | --- |
| `Contrato-API-Frontend.md` | 0.1 → **1.0** | Reescrito como implementado: todas as funções, códigos, permissões e decisões |
| `Banco_FluxID.md` | 3.3 → **3.4** | Seção 17.8 (script `006`), ordem de aplicação e senha |
| `Integracao-Oxide-FluxID.md` | 2.0 → **2.1** | Seção 3.5 (alertas automáticos), D5, comandos, saúde e manutenção, um Worker por FluxID |
| `Oxidedb.md` | 1.8 → **1.9** | Colunas novas no script de criação |
| `Desenvolvimento.md` | — | 1.1 (quem faz o quê), como usar a API do frontend, saúde e manutenção, 1.9, 1.10, histórico 7.25, suíte, Parte 3 (PR #19) |
| `Checklist-Projeto.md` | — | Itens novos como ⏳ (feito, aguardando a sua validação) |
| `PlanoDeTeste.md` | 1.12 → **1.13** | GEO, AUT-C, REG, APP, FLX-27/28, OPE |
| `RoteiroDeTeste.md` | 1.10 → **1.11** | Seção 5.11 |
| `Tipos-de-Erro.md` | 1.2 → **1.3** | Situação "Automático", limites adotados, fluxo da saída de rota implementado |
| `Guia-Firmware-Lacre-IoT.md` | 1.0 → **1.1** | O que o servidor detecta sozinho; o lacre não precisa mandar bateria baixa, GSM fraco nem comando falhou |
| `Regras-de-Negocio-e-Banco-Oxide.md`, `ESP32-envio-de-dados.md`, `README.md` | — | Rotas novas, comandos, alertas automáticos e colunas |
| **Este relatório** | — | Novo |

Nenhum documento novo além deste relatório. O código novo fica em:
- `src/app/`;
- `src/regras/`;
- `src/manutencao/`;
- `src/saude.ts`;
- `tests/app.test.ts`.

## 8. Como validar amanhã (passo a passo)

1. **Abra o Docker Desktop** e confira se o container `fluxid-analise` está rodando.
2. **Rode os testes** (cada um leva menos de 1 minuto):
   ```powershell
   npm run test:app     # esperado: Total: 45   Passaram: 45   Falharam: 0
   npm run simular      # esperado: Resultado: 65 de 65 verificações conforme
   ```
   Para a suíte da API, faça antes o backup da `oxide.db`, como sempre (ou use `npm run backup`). Pare a sua API e rode `npm test`: esperado 108/108.
3. **Veja a API do frontend no navegador:**
   - suba a API (`npm run dev`);
   - abra `http://localhost:3000/api-docs-fluxid`;
   - veja `http://localhost:3000/health`.
4. **Teste um login de verdade, no FluxID de análise:**
   - rode `npm run senha -- fluxid@teste.com` e digite uma senha;
   - no Swagger (`/api-docs-fluxid`), chame `session-login` com esse e-mail e senha;
   - copie o `session.access_token` em **Authorize**;
   - chame `query-permissions` com `organization_id` = `8ffb1326-877c-4e73-90fe-9362954f2415` (FluxID).
5. **Responda o questionário** (seção 9).
6. **Depois da aprovação:**
   - eu atualizo os documentos ("aprovado por Natã da Silva Baracho"), envio a branch e abro o PR #19 com a descrição pronta;
   - você aplica `001` a `006` no seu `FluxID_db` principal, gera o novo dump e define as senhas (`npm run senha`);
   - vocês dois (você e aalissonalmeidaq) ligam o frontend à `/api/v1/app`.

## 9. Questionário de validação (responda sim ou não)

| # | Pergunta |
| --- | --- |
| 1 | O script `006` pode ser aprovado como está (pessoa em várias empresas, login, convites, permissões novas, estoque, rotas e desvios, justificativa do alerta)? |
| 2 | Aprova as decisões D1 a D9 na recomendação (seção 5)? |
| 3 | Aprova as duas funções novas de clientes, entregas e rotas (D10)? |
| 4 | Aprova o login feito pela API: sessão de 8 h, 30 min sem uso, 3 sessões, bloqueio após 5 falhas, sem MFA por enquanto? |
| 5 | Aprova os limites dos alertas automáticos (D11: bateria 15%, GSM -105 dBm, sem comunicação 30 min, GPS 15 min, comando 10 min, rota 50 m, repetição 30 min)? |
| 6 | Aprova travar a válvula automaticamente quando o lacre abre com o cilindro em trânsito (D12)? |
| 7 | Aprova que o alerta tratado pelo frontend não seja mais sobrescrito pela Oxide (D5)? |
| 8 | Aprova a retenção: 30 dias, só o que já está no FluxID, e nunca sem `--confirmar` (D13)? |
| 9 | Aprova o raio padrão de 10 m da geocerca (D14) e a regra de um Worker por FluxID (A9)? |
| 10 | Rodou `npm run test:app` e deu 45/45? |
| 11 | Rodou `npm run simular` e deu 65/65? |
| 12 | Conseguiu entrar pelo Swagger com a senha definida em `npm run senha` (passo 4)? |
| 13 | Os documentos atualizados (seção 7) estão claros? |
| 14 | Posso enviar a branch `feat/sistema-completo` ao GitHub e abrir o PR #19? |
| 15 | Aprova a entrega como um todo? |

Com tudo "sim", registro **"aprovado por Natã da Silva Baracho"** nos documentos e abro o PR. Se alguma resposta for "não", eu corrijo antes, sem enviar nada.
