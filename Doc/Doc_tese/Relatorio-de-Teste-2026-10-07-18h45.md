# Relatório de Teste — Simulação completa de um lacre

**Data/hora:** 07/10/2026, publicado às 18:45; simulação executada às 18:37 e 18:38 (rodadas `P4M3` e `PUDC`, que revelaram o achado A3) e, depois da correção, às 18:44 e 18:45 (rodadas `0S4A` e `0VXY`)
**Executor:** IA (Claude Code, modelo Claude Opus 5.5)
**Pedido de:** Natã da Silva Baracho: "Simule um lacre. Preciso ver que está ativo, cadastrar a um cilindro e um cliente, teste de localidade e salvar os dados (nos bancos), teste de duplicidade, quero ver os erros do lacre, violação, movimentação fora da geocerca, fora da rota, ou seja, todos os alertas. Depois faça o teste com operador do sistema: cadastrar cilindro, cadastrar cliente, lacre ao cliente, criar rota para o endereço do cliente, visualização dos erros, cadastro em massa e também em unidade." Também pediu o teste de fila e de GPS sem sinal.
**Branch:** `feat/simulador-lacre` (montada sobre o PR #16)
**Situação:** ⏳ **Aguardando a validação de Natã da Silva Baracho** (seção 8)

---

## 1. Resumo

| Pergunta | Resposta |
| --- | --- |
| O que foi feito? | Um **simulador** (`npm run simular`) que faz o percurso inteiro de um lacre e de um operador e confere cada passo nos **dois bancos** (Oxide e FluxID) |
| Resultado | Depois da correção do achado A3: **58 de 58 verificações conforme**, nas duas rodadas. Suíte 96/96 e Roteiro v1.10 completo sem falhas |
| Os bancos de verdade foram tocados? | **Não.** A Oxide da simulação é um `oxide.db` novo, numa pasta temporária (o do projeto ficou idêntico, checksum conferido). O FluxID é o de análise no Docker; o simulador **se recusa** a rodar em outro banco |
| Pode repetir? | Sim. Cada rodada usa códigos próprios (ex.: `LCR-SPUDC-00`), então as rodadas não colidem |
| O que ainda não existe e foi simulado à mão? | A **detecção automática** de geocerca e de rota (o lacre simulado envia os alertas `SAIDA_GEOCERCA` e `SAIDA_ROTA`) e o **operador pelo frontend** (as ações foram feitas direto no FluxID, como a API do frontend fará). Ficou combinado discutir os dois depois |

## 2. Como usar o simulador

1. Docker Desktop aberto, com o container `fluxid-analise` rodando (banco `FluxID_db` com os scripts `001` a `005`).
2. `.env` com `FLUXID_DATABASE_URL` apontando para `127.0.0.1:54329` (já está assim).
3. No terminal do projeto: `npm run simular`.

A API do projeto **não precisa estar parada**: a simulação sobe a própria API na porta 3199. No fim aparecem o resultado e o caminho do relatório da rodada (uma pasta em `%TEMP%\fluxid-simulacao-...`, com o `oxide.db` e o `relatorio-simulacao-<rodada>.md`).

O cadastro em massa lê `simulador/cadastro-em-massa.csv` (20 linhas, separador `;`). Pode editar: colunas `cilindro_serie`, `cilindro_tipo`, `capacidade_litros`, `lacre_uid_nfc`, `dispositivo_hardware` e `vincular` (`sim`/`nao`). O simulador acrescenta o código da rodada ao UID NFC e ao hardware, que são únicos no banco todo, para poder repetir.

## 3. O percurso simulado

| Etapa | O que acontece |
| --- | --- |
| 0 | Ambiente: API da simulação e conexão com o FluxID de análise |
| 1 | **Operador, cadastro unitário** (FluxID): empresa, operador, cliente com endereço (geocerca de 10 m), cilindro, lacre, dispositivo (a chave é gerada e o FluxID guarda só o hash), vínculos dispositivo ⇄ lacre ⇄ cilindro e a **rota** (entrega `PENDENTE` até o endereço do cliente, com o cilindro) |
| 2 | **Erros do operador**: série repetida, código de lacre repetido, segundo lacre no mesmo cilindro e alerta com lacre de outro cilindro: todos recusados pelo banco |
| 3 | **Cadastro em massa** (CSV): 20 conjuntos numa transação (19 vinculados, 1 de propósito sem vínculo); importar a mesma planilha de novo é recusado inteiro, sem duplicar nada |
| 4 | **Worker** traz o cadastro do FluxID para a Oxide (dispositivo com hash, vínculos) |
| 5 | **Lacre ativo**: dispositivo ativo e primeira posição no depósito |
| 6 | **Rota**: entrega em andamento (cilindro `EM_TRANSITO`), trajeto, posição repetida, `message_id` repetido, **GPS sem sinal**, **lacre aberto em trânsito** (a API detecta sozinha), posição **fora da rota** e os alertas |
| 7 | **Chegada ao cliente**: entrega concluída (cilindro `COM_CLIENTE`, custódia no endereço), posição **dentro** da geocerca (3 m) e **fora** dela (60 m), alerta `SAIDA_GEOCERCA` |
| 8 | **Violação** (lacre rompido), reinício do dispositivo, bateria baixa, sinal GSM fraco, falha de sensor, **chave errada** (`401`) e **chave de outro lacre** (`403`) |
| 9 | **Todos os 28 alertas** do catálogo, o nome antigo em inglês (convertido) e um código inválido (`400`) |
| 10 | **Fila**: situação antes do envio, **FluxID fora do ar** (nada perdido, nenhuma tentativa gasta), envio, dispositivo fora do FluxID (nova tentativa), evento sem lacre (espera, P3), alerta sem lacre (parado para o gestor), reenvio sem duplicar e "tentar de novo" pelo gestor |
| 11 | **Gestor** analisa e encerra a violação; o encerramento chega ao FluxID |
| 12 | **Visualização**: mapa (última posição e cor do alerta), alertas, eventos, quarentena, histórico do cilindro, erros da sincronização e rodadas do Worker |

## 4. Resultados

### 4.1 Verificações (rodada 0VXY, depois da correção)

| Etapa | Item | Esperado | Obtido | Resultado |
| --- | --- | --- | --- | --- |
| 0. Ambiente | API da simulação no ar | 200 | 200 | PASSOU |
| 0. Ambiente | Conexão com o FluxID de análise | conectado | PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) | PASSOU |
| 1. Operador: cadastro unitário (cliente, endereço, cilindro, lacre, dispositivo, rota) | Empresa, operador e cliente com endereço | cadastrados | ORG-S0VXY, USR-S0VXY, CLI-S0VXY (raio de 10 m) | PASSOU |
| 1. Operador: cadastro unitário (cliente, endereço, cilindro, lacre, dispositivo, rota) | Conjunto do lacre | cilindro + lacre + dispositivo vinculados | CIL-S0VXY-00 ⇄ LCR-S0VXY-00 ⇄ DSP-S0VXY-00 | PASSOU |
| 1. Operador: cadastro unitário (cliente, endereço, cilindro, lacre, dispositivo, rota) | Rota (entrega) até o endereço do cliente | PENDENTE com 1 cilindro | PENDENTE com 1 cilindro | PASSOU |
| 1. Operador: cadastro unitário (cliente, endereço, cilindro, lacre, dispositivo, rota) | Lacre no cilindro | INSTALADO | INSTALADO | PASSOU |
| 2. Operador: erros de cadastro (o banco recusa) | Cilindro com número de série repetido | recusado | duplicate key value violates unique constraint "uq_cilindro_serie" | PASSOU |
| 2. Operador: erros de cadastro (o banco recusa) | Lacre com código repetido | recusado | duplicate key value violates unique constraint "lacres_codigo_key" | PASSOU |
| 2. Operador: erros de cadastro (o banco recusa) | Segundo lacre ativo no mesmo cilindro (RN04) | recusado | duplicate key value violates unique constraint "uq_cilindro_vinculo_ativo" | PASSOU |
| 2. Operador: erros de cadastro (o banco recusa) | Alerta com lacre em cilindro que não é o dele (auditoria) | recusado pelo gatilho | Alerta ALT-S0VXY-PE: o lacre não estava vinculado a este cilindro em 2026-10-07 21:46:43.954569+00 | PASSOU |
| 3. Operador: cadastro em massa (CSV) | Planilha importada numa transação | 20 conjuntos (19 vinculados) | 20 conjuntos (19 vinculados) | PASSOU |
| 3. Operador: cadastro em massa (CSV) | Importar a mesma planilha de novo | recusada inteira; nada duplicado | duplicate key value violates unique constraint "uq_cilindro_serie"; 21 cilindros na empresa | PASSOU |
| 4. Worker: cadastro do FluxID chega à Oxide | Dispositivo na Oxide com hash da chave | ativo, com hash | active=1, hash=1 | PASSOU |
| 4. Worker: cadastro do FluxID chega à Oxide | Vínculos na Oxide | LCR-S0VXY-00 / CIL-S0VXY-00 | LCR-S0VXY-00 / CIL-S0VXY-00 | PASSOU |
| 4. Worker: cadastro do FluxID chega à Oxide | Cadastro trazido sem conflitos | 0 conflitos | 0 conflitos | PASSOU |
| 4. Worker: cadastro do FluxID chega à Oxide | Cilindros da empresa copiados para a Oxide | 21 | 21 | PASSOU |
| 5. Lacre ativo no depósito | Dispositivo ativo | active = 1 | active = 1 | PASSOU |
| 5. Lacre ativo no depósito | Primeira posição (lacre fechado) | 202 | 202 | PASSOU |
| 6. Rota: cilindro sai para o cliente (lacre sempre fechado) | Cilindro em trânsito na Oxide | EM_TRANSITO | EM_TRANSITO | PASSOU |
| 6. Rota: cilindro sai para o cliente (lacre sempre fechado) | Posição 1 do trajeto | 202 | 202 | PASSOU |
| 6. Rota: cilindro sai para o cliente (lacre sempre fechado) | Posição 2 do trajeto | 202 | 202 | PASSOU |
| 6. Rota: cilindro sai para o cliente (lacre sempre fechado) | Posição 3 do trajeto | 202 | 202 | PASSOU |
| 6. Rota: cilindro sai para o cliente (lacre sempre fechado) | Duplicidade: mesma posição (parado no trânsito) | 200, sem linha nova | 200 Posição já registrada; data e hora atualizadas | PASSOU |
| 6. Rota: cilindro sai para o cliente (lacre sempre fechado) | Duplicidade: mesmo message_id reenviado | 202 e depois 409 | 202 e 409 | PASSOU |
| 6. Rota: cilindro sai para o cliente (lacre sempre fechado) | GPS sem sinal (2 leituras sem posição) | 202 e 202 (vão para a quarentena) | 202 e 202 | PASSOU |
| 6. Rota: cilindro sai para o cliente (lacre sempre fechado) | Lacre aberto em trânsito (detectado pela API) | 202 e error_type LACRE_ABERTO_EM_TRANSITO | 202 e LACRE_ABERTO_EM_TRANSITO | PASSOU |
| 6. Rota: cilindro sai para o cliente (lacre sempre fechado) | Posição fora da rota | 202 | 202 (a 1560 m do trajeto) | PASSOU |
| 6. Rota: cilindro sai para o cliente (lacre sempre fechado) | Alerta GPS_SEM_SINAL | 201 | 201 (MEDIA) | PASSOU |
| 6. Rota: cilindro sai para o cliente (lacre sempre fechado) | Alerta LACRE_ABERTO_EM_TRANSITO | 201 | 201 (CRITICA) | PASSOU |
| 6. Rota: cilindro sai para o cliente (lacre sempre fechado) | Alerta SAIDA_ROTA | 201 | 201 (ALTA) | PASSOU |
| 7. Chegada ao cliente e geocerca de 10 m | Cilindro com o cliente na Oxide | COM_CLIENTE | COM_CLIENTE | PASSOU |
| 7. Chegada ao cliente e geocerca de 10 m | Posição dentro da geocerca | 202 e até 10 m | 202 a 3.3 m | PASSOU |
| 7. Chegada ao cliente e geocerca de 10 m | Posição fora da geocerca | 202 e mais de 10 m | 202 a 59.8 m | PASSOU |
| 7. Chegada ao cliente e geocerca de 10 m | Alerta SAIDA_GEOCERCA | 201 | 201 (ALTA) | PASSOU |
| 8. Violação e erros do dispositivo | Evento de violação (lacre rompido) | 202 | 202 | PASSOU |
| 8. Violação e erros do dispositivo | Alerta LACRE_VIOLADO | 201 CRITICA | 201 CRITICA | PASSOU |
| 8. Violação e erros do dispositivo | Evento do dispositivo (reinício) | 202 | 202 | PASSOU |
| 8. Violação e erros do dispositivo | Alerta BATERIA_BAIXA | 201 | 201 (BAIXA) | PASSOU |
| 8. Violação e erros do dispositivo | Alerta GSM_SINAL_FRACO | 201 | 201 (BAIXA) | PASSOU |
| 8. Violação e erros do dispositivo | Alerta DISPOSITIVO_FALHA | 201 | 201 (MEDIA) | PASSOU |
| 8. Violação e erros do dispositivo | Chave errada | 401 | 401 | PASSOU |
| 8. Violação e erros do dispositivo | Chave de outro lacre | 403 | 403 | PASSOU |
| 9. Todos os alertas do catálogo | Demais códigos do catálogo | 20 alertas com 201 | 20 aceitos | PASSOU |
| 9. Todos os alertas do catálogo | Nome antigo em inglês (transição) | 201 gravado como LACRE_VIOLADO | 201 LACRE_VIOLADO | PASSOU |
| 9. Todos os alertas do catálogo | Código fora do catálogo | 400 | 400 | PASSOU |
| 10. Fila: espera, FluxID fora do ar, erros e reenvio | Dispositivo só da Oxide (fora do FluxID) envia | 201 e 202 | 201 e 202 | PASSOU |
| 10. Fila: espera, FluxID fora do ar, erros e reenvio | Evento de dispositivo sem lacre | 202 e error_type DISPOSITIVO_SEM_LACRE | 202 e DISPOSITIVO_SEM_LACRE | PASSOU |
| 10. Fila: espera, FluxID fora do ar, erros e reenvio | Alerta de dispositivo sem lacre | 201 na Oxide | 201 | PASSOU |
| 10. Fila: espera, FluxID fora do ar, erros e reenvio | FluxID fora do ar | rodada FALHOU, nada perdido, nenhuma tentativa gasta | FALHOU; 3 telemetrias continuam PENDING com 0 tentativas | PASSOU |
| 10. Fila: espera, FluxID fora do ar, erros e reenvio | Telemetrias do lacre enviadas | todas SYNCED | 10 SYNCED | PASSOU |
| 10. Fila: espera, FluxID fora do ar, erros e reenvio | Telemetria de dispositivo fora do FluxID | ERROR com nova tentativa | ERROR: dispositivo não cadastrado no FluxID (próxima 2026-10-07 21:47:44) | PASSOU |
| 10. Fila: espera, FluxID fora do ar, erros e reenvio | Evento do lacre sem vínculo (P3) | esperando, sem gastar tentativa | PENDING, tentativas=0: aguardando o dispositivo ter um lacre vinculado no FluxID (P3) | PASSOU |
| 10. Fila: espera, FluxID fora do ar, erros e reenvio | Alerta sem lacre na data | parado para o gestor | ERROR: sem lacre vinculado ao dispositivo em 2026-10-07 21:46:44 (UTC); o alerta não pode ir ao FluxID sem lacre e cilindro | PASSOU |
| 10. Fila: espera, FluxID fora do ar, erros e reenvio | Reenvio de tudo de novo | nada duplicado no FluxID | 8 → 8 telemetrias | PASSOU |
| 10. Fila: espera, FluxID fora do ar, erros e reenvio | Gestor manda tentar de novo (POST /sync/retry) | 200 | 200 | PASSOU |
| 11. Gestor analisa e encerra o alerta de violação | Encerramento chega ao FluxID | 200, 200 e ENCERRADO | 200, 200 e ENCERRADO por Gestor da simulação | PASSOU |
| 12. O que ficou nos dois bancos (visualização dos erros) | Estado do lacre no FluxID (P8) | SUSPEITA_VIOLACAO (o gestor confirma ROMPIDO) | SUSPEITA_VIOLACAO | PASSOU |
| 12. O que ficou nos dois bancos (visualização dos erros) | Alertas do lacre no FluxID | 29 alertas com lacre e cilindro | 29 alertas | PASSOU |

#### Fila da Oxide antes do envio (GET /api/v1/sync/status)

```text
telemetry  pendentes=3 aguardando=0 nova_tentativa=0 parados=0 sincronizados=8
events     pendentes=3 aguardando=0 nova_tentativa=0 parados=0 sincronizados=1
alerts     pendentes=27 aguardando=0 nova_tentativa=0 parados=0 sincronizados=3
```

#### Mapa: onde está o cilindro do lacre (FluxID)

```text
CIL-S0VXY-00 / LCR-S0VXY-00: última posição -7.2086939, -39.3061666 (2026-10-07T21:46:44.867Z); cor do ponto = CRITICA; leituras sem GPS = 2
```

#### Alertas do lacre no FluxID (tipo, severidade, status)

```text
GPS_SEM_SINAL                  MEDIA    ABERTO
LACRE_ABERTO_EM_TRANSITO       CRITICA  ABERTO
SAIDA_ROTA                     ALTA     ABERTO
SAIDA_GEOCERCA                 ALTA     ABERTO
LACRE_VIOLADO                  CRITICA  ENCERRADO
BATERIA_BAIXA                  BAIXA    ABERTO
GSM_SINAL_FRACO                BAIXA    ABERTO
DISPOSITIVO_FALHA              MEDIA    ABERTO
LACRE_ABERTO_SEM_AUTORIZACAO   CRITICA  ABERTO
DISPOSITIVO_SEM_LACRE          MEDIA    ABERTO
LACRE_SEM_CILINDRO             ALTA     ABERTO
LACRE_SEM_DISPOSITIVO          MEDIA    ABERTO
LACRE_REVISAO_VENCIDA          MEDIA    ABERTO
LACRE_REPROVADO_EM_USO         ALTA     ABERTO
CILINDRO_SEM_CLIENTE           ALTA     ABERTO
CILINDRO_SEM_LACRE             ALTA     ABERTO
TESTE_HIDROSTATICO_VENCIDO     ALTA     ABERTO
CILINDRO_REPROVADO_EM_USO      CRITICA  ABERTO
GPS_INATIVO                    ALTA     ABERTO
POSICAO_INVALIDA               BAIXA    ABERTO
MOVIMENTACAO_SUSPEITA          ALTA     ABERTO
PARADA_PROLONGADA              MEDIA    ABERTO
SEM_COMUNICACAO                ALTA     ABERTO
DISPOSITIVO_NAO_CADASTRADO     MEDIA    ABERTO
CHAVE_INVALIDA                 ALTA     ABERTO
COMANDO_FALHOU                 ALTA     ABERTO
COMANDO_SEM_RESPOSTA           MEDIA    ABERTO
COMANDO_DESCONTINUADO          BAIXA    ABERTO
LACRE_VIOLADO                  CRITICA  ABERTO
```

#### Eventos no FluxID

```text
lacre        ABERTURA_NAO_AUTORIZADA   LACRE_ABERTO_EM_TRANSITO
lacre        VIOLACAO                  
dispositivo  startup                   
```

#### Quarentena: leituras sem GPS (FluxID)

```text
MSG-S0VXY-007 SEM_POSICAO
MSG-S0VXY-006 SEM_POSICAO
```

#### Histórico do cilindro CIL-S0VXY-00 (FluxID)

```text
 1 LACRE_VINCULADO        SISTEMA  
 2 ALERTA_REGISTRADO      OXIDE    
 3 ALERTA_REGISTRADO      OXIDE    
 4 ALERTA_REGISTRADO      OXIDE    
 5 ALERTA_REGISTRADO      OXIDE    
 6 ALERTA_REGISTRADO      OXIDE    
 7 ALERTA_REGISTRADO      OXIDE    
 8 ALERTA_REGISTRADO      OXIDE    
 9 ALERTA_REGISTRADO      OXIDE    
10 ALERTA_REGISTRADO      OXIDE    
11 ALERTA_REGISTRADO      OXIDE    
12 ALERTA_REGISTRADO      OXIDE    
13 ALERTA_REGISTRADO      OXIDE    
14 ALERTA_REGISTRADO      OXIDE    
15 ALERTA_REGISTRADO      OXIDE    
16 ALERTA_REGISTRADO      OXIDE    
17 ALERTA_REGISTRADO      OXIDE    
18 ALERTA_REGISTRADO      OXIDE    
19 ALERTA_REGISTRADO      OXIDE    
20 ALERTA_REGISTRADO      OXIDE    
21 ALERTA_REGISTRADO      OXIDE    
22 ALERTA_REGISTRADO      OXIDE    
23 ALERTA_REGISTRADO      OXIDE    
24 ALERTA_REGISTRADO      OXIDE    
25 ALERTA_REGISTRADO      OXIDE    
26 ALERTA_REGISTRADO      OXIDE    
27 ALERTA_REGISTRADO      OXIDE    
28 ALERTA_REGISTRADO      OXIDE    
29 ALERTA_REGISTRADO      OXIDE    
30 ALERTA_REGISTRADO      OXIDE    
31 ALERTA_ENCERRADO       OXIDE    Lacre substituído e cilindro conferido no cliente
```

#### Erros da sincronização vistos pelo gestor (GET /api/v1/sync/problems)

```text
telemetry MSG-S0VXY-046 NOVA_TENTATIVA: dispositivo não cadastrado no FluxID
events    EVT-S0VXY-047 AGUARDANDO: aguardando o dispositivo ter um lacre vinculado no FluxID (P3)
alerts    ALT-S0VXY-048 PARADO: sem lacre vinculado ao dispositivo em 2026-10-07 21:46:44 (UTC); o alerta não pode ir ao FluxID sem lacre e cilindro
```

#### Rodadas do Worker (sync_logs na Oxide)

```text
#1 OK
#2 OK
#3 OK
#4 FALHOU
#5 PARCIAL
#6 OK
#7 PARCIAL
```

#### Banco Oxide da simulação (oxide.db)

```text
telemetry_queue: 11 linhas
events: 4 linhas
alerts: 30 linhas
arquivo: C:\Users\natan\AppData\Local\Temp\fluxid-simulacao-0VXY-1AKlp3\oxide.db
```

## 5. Achados

| # | Achado | Gravidade | Proposta |
| --- | --- | --- | --- |
| A1 | O **histórico do cilindro** não registra `CILINDRO_CRIADO` para cilindros cadastrados agora: o `005` só montou o histórico dos cilindros que já existiam, e quem registra a criação dali em diante é a API do frontend (ainda inexistente). Na simulação, o histórico começa em `LACRE_VINCULADO` | Baixa | Na API do frontend, a operação `create` registra a criação (já previsto no contrato). Alternativa: um gatilho no FluxID que registra a criação de qualquer cilindro |
| A3 | **Série do cilindro única na Oxide inteira**, mas no FluxID só dentro da empresa. Na segunda rodada, a empresa nova usou as mesmas séries do CSV, e os 20 cilindros dela **não foram copiados** para a Oxide (78 conflitos). Na vida real, acontece com duas empresas com séries iguais | Média | **Corrigido** (aprovado por Natã: "a API deve identificar pelo identificador do lacre"): na Oxide a série deixa de ser única; o cilindro continua identificado pelo **código** e encontrado **pelo lacre**. A tabela `cylinders` é recriada preservando os dados. O simulador ganhou a verificação "cadastro trazido sem conflitos" |
| A2 | Com o simulador, o **FluxID de análise acumula dados** de cada rodada (empresas `ORG-S...`) | Informativo | Esperado (o histórico é imutável e nada é apagado). Para limpar, recriar o banco do container a partir do dump |

Depois da correção, nenhuma falha.

## 6. Correção do achado A3 e testes depois dela

| Verificação | Resultado |
| --- | --- |
| Migração da tabela `cylinders` (cópia do `oxide.db` no formato antigo, com cilindro e vínculo) | Cilindro e vínculo preservados; série sem `UNIQUE`; código continua único; `foreign_key_check` vazio e chaves estrangeiras religadas; segunda inicialização sem nova migração |
| Mesma série, outro código | Aceito |
| Código repetido | Recusado |
| Apagar cilindro com vínculo | Recusado (chave estrangeira ativa) |
| Simulação, duas rodadas seguidas (`0S4A` e `0VXY`) | **58/58** em cada uma; 0 conflitos; 21 cilindros copiados para a Oxide |
| Suíte `npm test` | **96/96** (o caso do cadastro provisório passou a esperar: série repetida `201`, código repetido `409`) |
| Roteiro de Teste v1.10 completo no `oxide.db` real (18:46 às 18:47) | 18 blocos; seções 5.1 a 5.9 com as mesmas 98 respostas HTTP; seção 5.10 (Worker) conforme; 6 recusas esperadas do banco; banco restaurado idêntico |

## 7. O que fica para depois (combinado)

- **Geocerca e rota automáticas**: hoje nada detecta sozinho a saída dos 10 m ou da rota; não existe tabela de rota (só entregas e endereços).
- **Operador pelo frontend**: depende da API do frontend.

## 8. Validação humana (questionário)

A responder por **Natã da Silva Baracho**.

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | A simulação mostrou o que você pediu (lacre ativo, cadastro, localização nos dois bancos, duplicidade, erros e todos os alertas)? | |
| 2 | O operador simulado direto no FluxID (cadastro unitário, cliente, rota como entrega, erros e cadastro em massa) atende por enquanto, até a API do frontend? | |
| 3 | Os testes de fila (FluxID fora do ar, espera do vínculo, dispositivo fora do FluxID, reenvio e "tentar de novo") e de GPS sem sinal estão de acordo? | |
| 4 | O simulador (`npm run simular`) e o CSV de exemplo podem ficar no projeto? | |
| 5 | Achado A1: registrar a criação do cilindro na API do frontend (e não por gatilho agora)? | |
| 6 | A correção do achado A3 (série não única na Oxide; cilindro identificado pelo código e pelo lacre) e os testes depois dela estão de acordo? | |
| 7 | Pode registrar a aprovação, atualizar os documentos e enviar ao GitHub? | |
