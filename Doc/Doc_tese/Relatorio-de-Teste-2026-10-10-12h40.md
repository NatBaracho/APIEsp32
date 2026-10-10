# Relatório de Teste — Oxide enxuta, fila única e envio ao Supabase

**Data:** 10/10/2026, 12:40 (testes das 12:32:51 às 12:33:12)
**Executado por:** IA (Claude Code, modelo Claude Opus 5.5), a pedido de Natã da Silva Baracho
**Branch:** `feat/oxide-enxuta`, a partir da `main` `547a1f2` (merge do PR #19). Commits locais; **ainda não enviada ao GitHub**
**Base:** `PlanoDeTeste.md` v2.0 (seção 0) e `RoteiroDeTeste.md` v2.0
**Situação:** ✅ **aprovado por Natã da Silva Baracho em 10/10/2026**, com dois ajustes já feitos e duas confirmações pendentes (seção 10)

---

## 1. Resumo

| Indicador | Valor |
| --- | --- |
| Compilação (`npx tsc --noEmit`) | Sem erros |
| Suíte nova (`npm test`) | **71 de 71** |
| Simulador novo (`npm run simular`) | **23 de 23** |
| Migração numa cópia do `oxide.db` real | Conforme (seção 4.3) |
| `oxide.db` do projeto | **Intacto**: SHA-256 `0b6b2b2d…5c87f52` igual antes e depois |
| Banco principal (Supabase) | **Não acessado** |
| Falhas | 0 |
| Não executado | Envio ao Supabase de verdade e lacre real (seção 6) |

**Atenção ao ponto principal:** o envio ao Supabase **ainda não foi testado de verdade**. A função de recebimento e as tabelas do lacre não estão no repositório do frontend. Os testes usaram um recebedor de teste, que faz o papel do Supabase seguindo o contrato que escrevi.

## 2. As decisões que orientaram esta entrega

| # | Decisão | De quem |
| --- | --- | --- |
| 1 | O banco principal é o Supabase do projeto `fluxid_integra2026`; as tabelas do lacre são criadas lá. O FluxID em PostgreSQL fica só como teste | Natã e professor Alisson |
| 2 | A API não atende o frontend: recebe os dados do lacre, interpreta e envia ao banco principal | Natã |
| 3 | Envio pela API REST do Supabase, com a chave `service_role`, por uma função de recebimento | Resposta 2 (b) e 2 (a) |
| 4 | Fila mínima no servidor | Resposta 3 (a) |
| 5 | Rotas do lacre mantidas | Resposta 4 (a) |
| 6 | Bateria, latitude e longitude obrigatórias em todas as mensagens; sem sinal de GPS, última posição com `gps_ok: false` | Resposta 5 |
| 7 | Regras automáticas: só as que saem da própria mensagem | Resposta 3 (segunda rodada) |
| 8 | Comandos e cadastro de dispositivos vêm do banco principal | Respostas 7 e 8 |
| 9 | Bateria obrigatória já, mesmo antes de o lacre ter a leitura | Resposta 4 (segunda rodada) |
| 10 | Branch `feat/sistema-completo` arquivada, sem merge | Resposta 9 |

## 3. O que mudou

### 3.1 Oxide: de 11 para 3 tabelas

| Tabela | Para quê |
| --- | --- |
| `devices` | Quem pode enviar (chave ou hash) e o último estado recebido |
| `mensagens` | Fila única: leitura, evento, alerta e confirmação de comando |
| `commands` | Comandos da válvula vindos do banco principal |

Saíram `telemetry_queue`, `events`, `alerts`, `seals`, `cylinders`, `seal_assignments`, `cylinder_assignments`, `status` e `sync_logs`.

**Migração automática.** Quando a API nova encontra um banco do modelo antigo, ela:
1. faz uma cópia de segurança do arquivo inteiro, ao lado do original;
2. guarda as mensagens antigas na fila nova como `ARQUIVADA` (ficam guardadas, mas não são enviadas ao Supabase, porque eram dados de teste);
3. remove as tabelas que saíram.

### 3.2 API

- **Posição e bateria obrigatórias** em leitura, evento e alerta. Sem elas: `400`.
- **`gps_ok`**: `false` quando o lacre manda a última posição conhecida.
- Campos do firmware aceitos: `satelites`, `hdop` e `device_state`.
- **Alertas automáticos**, abertos uma vez a cada mudança:
  - `BATERIA_BAIXA` (abaixo de 15%);
  - `GSM_SINAL_FRACO` (abaixo de -105 dBm);
  - `LACRE_VIOLADO` (lacre `BROKEN`);
  - `LACRE_ABERTO_SEM_AUTORIZACAO` (lacre `UNLOCKED`).
- Rotas novas: `GET /api/v1/iot/messages` (últimas mensagens) e `GET /health`.
- **Removido:** rotas de lacres, cilindros e vínculos; listagem, análise e encerramento de alertas; a página da proposta da API do frontend.

### 3.3 Worker

- Envia a fila em lotes de até 100, por HTTP, e recebe um resultado por mensagem: gravada, repetida ou recusada.
- Traz do banco principal os dispositivos (com o hash da chave) e os comandos pendentes.
- Mantém a regra das tentativas: envio inicial e mais 5. Banco principal fora do ar não gasta tentativa.

### 3.4 Manutenção e dependências

- `npm run backup` e `npm run retencao` (só apaga com `--confirmar`, e só o que já foi enviado há mais de 30 dias).
- Saiu a dependência `pg`: a API não fala mais com PostgreSQL diretamente.

### 3.5 Tamanho do código

| | Antes | Agora |
| --- | --- | --- |
| Tabelas da Oxide | 11 | 3 |
| Linhas em `src/` e `tests/` | cerca de 8.500 | cerca de 3.400 |

## 4. Resultados

### 4.1 Suíte (`npm test`) — 71/71

| Grupo | Casos |
| --- | --- |
| 1. Geral, documentação e banco | 5 |
| 2. Dispositivos | 5 |
| 3. Autenticação | 5 |
| 4. Telemetria | 14 |
| 5. Eventos | 4 |
| 6. Alertas enviados pelo lacre | 5 |
| 7. Alertas automáticos | 8 |
| 8. Worker: envio ao banco principal | 12 |
| 9. Cadastro e comandos do banco principal | 8 |
| 10. Saúde | 2 |
| 11. Migração e manutenção | 3 |

A suíte roda numa pasta temporária, com banco novo. Ela **deixou de precisar do `oxide.db` do projeto**: antes, era preciso fazer backup e restaurar.

### 4.2 Simulador (`npm run simular`) — 23/23

Percurso de um lacre:
- cadastro vindo do banco principal (só o hash da chave);
- leitura aceita, e recusa sem bateria e sem posição;
- trajeto, posição repetida (`200`) e mensagem duplicada (`409`);
- GPS sem sinal com `gps_ok: false`;
- bateria baixa (um alerta só), lacre rompido e alerta enviado pelo lacre;
- banco principal fora do ar (nada perdido, nenhuma tentativa gasta) e envio na volta;
- reenvio de tudo sem duplicar;
- comando da válvula: trazido, buscado pelo lacre, confirmado e avisado ao banco principal.

### 4.3 Migração numa cópia do seu `oxide.db`

| | Antes | Depois |
| --- | --- | --- |
| Tabelas | 11 | `commands`, `devices`, `mensagens` |
| Dispositivos | 3 | 3 (mantidos) |
| Leituras e eventos antigos | 10 e 8 | 18 mensagens `ARQUIVADA` |
| Cópia de segurança | — | `oxide.db.bak-antes-da-fila-unica-<data>`, criada antes de qualquer mudança |
| Integridade | — | `ok`, nenhuma chave estrangeira quebrada |

O seu `oxide.db` original não foi tocado: a migração rodou numa cópia.

## 5. Pontos de atenção e escolhas minhas

Para não parar o trabalho, tomei algumas decisões que você não chegou a responder. Todas podem ser trocadas.

| # | Escolha | Por quê |
| --- | --- | --- |
| E1 | Escrevi o contrato de entrega (`Contrato-Entrega-Supabase.md`) com três operações: `push_messages`, `list_devices` e `list_commands` | Você disse que as tabelas do lacre já existem no Supabase, mas elas não estão no repositório e eu não tenho os nomes. Defini o formato pelo lado da API; se as tabelas pedirem outro, eu ajusto |
| E2 | Lacre `UNLOCKED` abre `LACRE_ABERTO_SEM_AUTORIZACAO` | A API não sabe mais se o cilindro está em trânsito nem se havia autorização. O alerta avisa, e o sistema principal confere |
| E3 | As mensagens antigas ficam como `ARQUIVADA` e **não** vão para o Supabase | Eram dados de teste enviados ao FluxID |
| E4 | Mantive a regra da posição repetida (responde `200` e atualiza a leitura anterior) | Era uma decisão sua de 06/10. Agora a leitura atualizada é reenviada ao banco principal |
| E5 | O resultado da última rodada do Worker fica num arquivo (`oxide-worker.json`), e não numa tabela | Para manter as três tabelas |
| E6 | O alerta automático de comando que falhou e a regra de travar a válvula sozinha **saíram** | Os comandos agora são do sistema principal; a API só entrega a confirmação |
| E7 | O campo de sinal continua `gsm_signal`, e vale também para o WiFi | O firmware atual usa WiFi; mudar o nome mexeria no contrato sem ganho |

**Consequência da decisão 9:** enquanto o lacre não tiver a leitura da bateria, **toda mensagem dele será recusada** com `400`. Isso está escrito no guia do firmware.

## 6. O que não foi executado

| Caso | Motivo |
| --- | --- |
| Envio ao Supabase de verdade (`V2-INT-01`) | A função de recebimento e as tabelas do lacre não estão no repositório do frontend. Preciso do endereço da função; a chave você coloca no `.env` |
| Lacre real enviando (`V2-INT-02`) | O envio HTTP está desligado no firmware, esperando o contrato, e a leitura da bateria ainda não entrou |
| Migração no seu `oxide.db` de verdade | Fiz só numa cópia. A de verdade acontece quando você subir a API nova (com a cópia de segurança automática) |

## 7. Documentos

| Documento | Situação |
| --- | --- |
| **`Contrato-Entrega-Supabase.md`** | **Novo.** Para o professor Alisson: o que a API envia e o que espera de volta |
| `Guia-Firmware-Lacre-IoT.md` | 1.0 → **2.0**. Para o Simão: o contrato do lacre, com o exemplo no estilo do firmware dele |
| `Oxidedb.md` | 1.8 → **2.0**. As três tabelas e a migração |
| `Regras-de-Negocio-e-Banco-Oxide.md` | **2.0**, reescrito |
| `Tipos-de-Erro.md` | 1.2 → **2.0**. Quem detecta cada código: a API ou o sistema principal |
| `Desenvolvimento.md` | Parte 1 reescrita; histórico 7.25 e 7.26; suíte; Parte 3 |
| `README.md` | Reescrito |
| `Checklist-Projeto.md` | Nova seção com a situação atual; o resto fica como histórico |
| `PlanoDeTeste.md` | 1.12 → **2.0**. Nova seção 0 com os casos atuais |
| `RoteiroDeTeste.md` | 1.10 → **2.0**, reescrito |
| `Banco_FluxID.md`, `Integracao-Oxide-FluxID.md`, `Contrato-API-Frontend.md`, `ESP32-envio-de-dados.md` | Aviso no topo: referência histórica |
| Este relatório | Novo |

## 8. Questionário de validação (responda sim ou não)

| # | Pergunta |
| --- | --- |
| 1 | A Oxide com três tabelas (`devices`, `mensagens` e `commands`) está como você queria? |
| 2 | Aprova a migração automática: cópia de segurança, mensagens antigas arquivadas e tabelas antigas removidas? |
| 3 | Aprova que as mensagens antigas (de teste) **não** sejam enviadas ao Supabase (E3)? |
| 4 | Aprova posição e bateria obrigatórias em leitura, evento e alerta, com recusa `400` sem elas, mesmo antes de o lacre ter a leitura da bateria? |
| 5 | Aprova o `gps_ok: false` com a última posição conhecida? |
| 6 | Aprova os quatro alertas automáticos e os limites (bateria 15% e sinal -105 dBm)? |
| 7 | Aprova que lacre aberto vire `LACRE_ABERTO_SEM_AUTORIZACAO`, deixando o sistema principal conferir a autorização (E2)? |
| 8 | Aprova tirar da API o travamento automático da válvula e o alerta de comando que falhou (E6)? |
| 9 | Aprova a retirada das rotas de lacres, cilindros, vínculos e de análise de alertas? |
| 10 | O contrato de entrega ao Supabase pode ser enviado ao professor Alisson como está (E1)? |
| 11 | O guia do firmware 2.0 pode ser enviado ao Simão como está? |
| 12 | Rodou `npm test` e deu 71/71? |
| 13 | Rodou `npm run simular` e deu 23/23? |
| 14 | Os documentos estão claros? |
| 15 | Posso enviar a branch `feat/oxide-enxuta` ao GitHub e abrir o PR? |

Com tudo "sim", registro **"aprovado por Natã da Silva Baracho"** nos documentos e abro o PR. Se alguma resposta for "não", eu corrijo antes, sem enviar nada.

## 9. Depois da aprovação

1. Você envia o contrato ao professor Alisson e o guia ao Simão.
2. O professor Alisson cria a função de recebimento e passa o endereço.
3. Você coloca `SUPABASE_IOT_URL` e `SUPABASE_SERVICE_KEY` no `.env` do servidor (a chave nunca por mensagem).
4. Rodamos o passo 6 do roteiro: o primeiro envio de verdade ao Supabase.

## 10. Validação (10/10/2026)

Respostas de Natã da Silva Baracho ao questionário da seção 8:

| # | Resposta | O que foi feito |
| --- | --- | --- |
| 1 | Não deixar as tabelas de antes | Mantidas só as três tabelas novas |
| 2 | Sim | — |
| 3 | **As mensagens antigas devem ser enviadas.** Só não se envia de novo o que for duplicado; nesse caso, só a data e a hora são atualizadas | **Ajuste feito** (abaixo) |
| 4, 5, 6 | Sim | — |
| 7 | **Sem resposta** | Pendente: o lacre aberto continua abrindo `LACRE_ABERTO_SEM_AUTORIZACAO` até a confirmação |
| 8, 9 | Sim | — |
| 10 | **Sem resposta** | Pendente: o contrato ainda não foi enviado ao professor Alisson |
| 11, 12, 13, 14, 15 | Sim | Branch enviada e PR aberto |

### Ajustes feitos depois da validação

1. **Mensagens antigas (resposta 3).** As seções 3.1, 4.3 e a escolha E3 descrevem o comportamento testado antes da validação, em que todas as mensagens antigas ficavam arquivadas. Agora:
   - a leitura antiga que tem posição e bateria é convertida para o formato atual e **entra na fila para o banco principal**, marcada com `legacy: true`;
   - a que não tem posição ou bateria fica arquivada, porque o banco principal exige as duas (resposta 4).

   Na cópia do `oxide.db` real: **1 leitura na fila** e **17 mensagens arquivadas** (9 leituras sem bateria ou sem posição e 8 eventos).
2. **Posição repetida (resposta 3).** Agora só a data e a hora (`last_seen_at`) são atualizadas. Antes, a bateria e o sinal também eram.

### Testes depois dos ajustes

| Teste | Resultado |
| --- | --- |
| Compilação | Sem erros |
| Suíte (`npm test`) | 71 de 71 |
| Simulador (`npm run simular`) | 23 de 23 |
| Migração numa cópia do `oxide.db` real | 1 leitura na fila, 17 arquivadas, banco íntegro |
| `oxide.db` do projeto | Intacto (SHA-256 igual) |

### Pendências

- **Pergunta 7:** confirmar o código do alerta de lacre aberto.
- **Pergunta 10:** confirmar o envio do contrato ao professor Alisson.
- Envio ao Supabase de verdade: continua sem teste, até existir a função de recebimento.
