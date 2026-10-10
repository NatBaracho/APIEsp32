# Catálogo de Tipos de Erro (`error_type`) — FluxID / Oxide

**Versão:** 2.0 — 10/10/2026 — banco principal no Supabase e alertas automáticos da API (aguardando a validação de Natã da Silva Baracho)
**Público:** equipe do projeto, programador do ESP32 e quem for implementar o Worker e as regras automáticas.

Este catálogo dá **um código único** para cada ocorrência operacional que precisa ser registrada, investigada ou tratada: problemas no lacre, no cilindro, no dispositivo, no GPS, na comunicação, na rota e nos comandos. Hoje esses tipos estão espalhados em três lugares, com nomes diferentes:

- `alert_type` na API Oxide: até 06/10/2026 em inglês (ex.: `SEAL_BROKEN`); **agora usa os códigos deste catálogo** (seção 7);
- `alertas.tipo` no FluxID (ex.: `VIOLACAO_LACRE`);
- `eventos_lacre.tipo` no FluxID (ex.: `VIOLACAO`, `ABERTURA_NAO_AUTORIZADA`).

**Desde 10/10/2026, quem detecta cada código mudou.** O banco principal é o Supabase, e a API do lacre deixou de guardar lacres, cilindros e vínculos. Por isso:

- **A API do lacre** recebe qualquer código deste catálogo enviado pelo lacre e abre sozinha só os quatro que saem da própria mensagem: `BATERIA_BAIXA`, `GSM_SINAL_FRACO`, `LACRE_VIOLADO` e `LACRE_ABERTO_SEM_AUTORIZACAO`. Cada um abre uma vez, na mudança (ao cruzar o limite ou quando o lacre muda de estado).
- **O sistema principal** (Supabase e frontend) fica com tudo o que depende de cadastro, de rota, de geocerca ou de tempo: lacre sem cilindro, lacre aberto em trânsito, saída de rota, saída da geocerca, sem comunicação e os demais.

Na coluna **Situação**, "API" quer dizer que a API do lacre já abre o alerta, e "Sistema principal" quer dizer que a regra é do lado do Supabase.

A coluna `error_type`, que a API gravava nas filas antigas, deixou de existir.

A coluna **Equivalente atual** mostra onde cada código já existe. A coluna **Situação** diz se a detecção já está implementada:

- **Implementado:** a API já recebe ou detecta;
- **Parcial:** o dado existe, mas a regra automática ainda não;
- **Previsto:** depende de funcionalidade futura;
- **API:** a API do lacre abre o alerta sozinha (10/10/2026);
- **Sistema principal:** a regra fica no Supabase e no frontend.

Limites ainda não decididos estão marcados como **a definir** e não devem ser inventados.

### Regras definidas pelo responsável (06/10/2026)

1. **No destino:** depois da entrega, o lacre não pode sair de um raio de **10 metros** do destino final (local de entrega).
2. **Em rota:** o cilindro não pode sair da rota, a não ser que o desvio tenha sido **justificado antes** ou esteja **programado**. Se sair, o fluxo é o da seção 6.
3. **Em trânsito:** o cilindro viaja com o lacre **fechado**. Qualquer abertura durante o trânsito é irregular, mesmo que exista autorização (a abertura regular só acontece no cliente, RN09).

---

## 1. Lacre

| Código | Significado | Quem detecta / como | Severidade sugerida | Equivalente atual | Situação |
| --- | --- | --- | --- | --- | --- |
| `LACRE_VIOLADO` | O lacre foi rompido fisicamente | ESP32 envia `seal_status: BROKEN` (leitura ou evento) | CRITICA | Nome antigo `SEAL_BROKEN` | **API**: abre quando o lacre passa a `BROKEN` |
| `LACRE_ABERTO_EM_TRANSITO` | O lacre foi aberto enquanto o cilindro está em trânsito, onde deve estar sempre fechado (regra 3) | Lacre `UNLOCKED` ou `BROKEN` com o cilindro em trânsito | CRITICA | — | **Sistema principal** (a API não sabe se o cilindro está em trânsito; ela manda `LACRE_ABERTO_SEM_AUTORIZACAO` ou `LACRE_VIOLADO`) |
| `LACRE_ABERTO_SEM_AUTORIZACAO` | O lacre foi aberto no cliente sem autorização registrada (RN09) | ESP32 envia `seal_status: UNLOCKED` | CRITICA | — | **API**: abre quando o lacre passa a `UNLOCKED`. A API não sabe se havia autorização; o sistema principal confere |
| `DISPOSITIVO_SEM_LACRE` | O dispositivo enviou dados sem estar vinculado a nenhum lacre | Dispositivo sem vínculo ativo com um lacre | MEDIA | — | **Sistema principal** |
| `LACRE_SEM_CILINDRO` | O lacre está em uso (envia dados) mas não tem vínculo ativo com nenhum cilindro | Lacre do dispositivo sem vínculo ativo com um cilindro | ALTA | — | **Sistema principal** |
| `LACRE_SEM_DISPOSITIVO` | O lacre está instalado num cilindro mas sem dispositivo ativo vinculado | FluxID: lacre `INSTALADO` sem `vinculos_dispositivo_lacre` ativo | MEDIA | — | Previsto (entrega B) |
| `LACRE_REVISAO_VENCIDA` | Passou a data da revisão quinquenal do lacre (RN16) | FluxID: `lacres.proxima_revisao` < hoje | MEDIA | FluxID `REVISAO_LACRE` | Parcial (falta a rotina diária) |
| `LACRE_REPROVADO_EM_USO` | Lacre reprovado ou inutilizado na inspeção continua instalado | FluxID: inspeção `REPROVADO`/`INUTILIZADO` e lacre `INSTALADO` | ALTA | — | Previsto |

## 2. Cilindro e cliente

| Código | Significado | Quem detecta / como | Severidade sugerida | Equivalente atual | Situação |
| --- | --- | --- | --- | --- | --- |
| `CILINDRO_SEM_CLIENTE` | O cilindro está marcado como `COM_CLIENTE`, mas não tem custódia ativa num local de entrega | FluxID: status `COM_CLIENTE` sem `custodias` ativa | ALTA | — | Previsto |
| `CILINDRO_SEM_LACRE` | Cilindro com cliente ou em trânsito sem lacre ativo (RN04) | FluxID: status `COM_CLIENTE`/`EM_TRANSITO` sem vínculo ativo de lacre | ALTA | — | Previsto (entrega B) |
| `TESTE_HIDROSTATICO_VENCIDO` | Passou a data do próximo teste hidrostático (RN15) | FluxID: `testes_hidrostaticos.proximo_teste` < hoje | ALTA | FluxID `TESTE_HIDROSTATICO` | Parcial (falta a rotina diária) |
| `CILINDRO_REPROVADO_EM_USO` | Cilindro reprovado no teste hidrostático está disponível, em trânsito ou com cliente | FluxID: último teste `REPROVADO` e status de circulação | CRITICA | — | Previsto |

## 3. GPS e posição

| Código | Significado | Quem detecta / como | Severidade sugerida | Equivalente atual | Situação |
| --- | --- | --- | --- | --- | --- |
| `GPS_INATIVO` | O módulo GPS não responde (falha de hardware ou desligado) | ESP32 identifica e envia evento/alerta | ALTA | Oxide `GPS_INATIVO` (antes, o genérico `DEVICE_ERROR`) | Previsto (firmware precisa enviar) |
| `GPS_SEM_SINAL` | O GPS funciona, mas está sem posição (sem satélites) há mais tempo que o limite | Leituras com `gps_ok: false` (última posição conhecida) por mais de **[a definir]** minutos | MEDIA | — | **Sistema principal** (a API entrega o `gps_ok` em toda mensagem) |
| `POSICAO_INVALIDA` | O dispositivo enviou coordenada impossível ou incompleta | API Oxide responde `400` (entrega C) | BAIXA | — | Implementado (rejeição) |
| `SAIDA_GEOCERCA` | Depois da entrega, o lacre saiu do raio de **10 metros** do destino final (regra 1, RN10) | Distância da posição até a geocerca do cliente (raio padrão de 10 m) | ALTA | Nome antigo `GEOFENCE_EXIT` | **Sistema principal** (as geocercas estão no Supabase) |
| `SAIDA_ROTA` | Durante a entrega, o cilindro saiu da rota sem desvio **justificado antes** ou **programado** (regra 2) | Comparação da posição com a rota da viagem; não gera alerta durante um desvio justificado ou programado. Margem para a imprecisão do GPS: **[a definir]** metros | ALTA | — | **Sistema principal** (viagens e rotas ficam no Supabase) |
| `MOVIMENTACAO_SUSPEITA` | Movimento incompatível com o estado: ex.: velocidade > 0 com o cilindro `COM_CLIENTE` ou `DISPONIVEL` no depósito | Regra sobre `speed_kmh` e status do cilindro (RN11) | ALTA | FluxID `MOVIMENTACAO_SUSPEITA` | Previsto |
| `PARADA_PROLONGADA` | Em trânsito, o cilindro ficou parado fora de local conhecido por mais que o limite | Entrega `EM_ANDAMENTO` com posição repetida por mais de **[a definir]** minutos | MEDIA | — | Previsto |

## 4. Dispositivo, energia e comunicação

| Código | Significado | Quem detecta / como | Severidade sugerida | Equivalente atual | Situação |
| --- | --- | --- | --- | --- | --- |
| `BATERIA_BAIXA` | A bateria está abaixo do limite de alerta | Regra sobre `battery_percent` < **15%** (`REGRA_BATERIA_MINIMA`) | BAIXA | Nome antigo `LOW_BATTERY` | **API**: abre quando a bateria cai abaixo do limite |
| `SEM_COMUNICACAO` | O dispositivo parou de enviar dados por mais que o limite | Nenhuma mensagem do lacre há mais de **[a definir]** minutos | ALTA | Nome antigo `COMMUNICATION_LOST` | **Sistema principal** (a API guarda o último contato em `devices.last_contact_at` e entrega a hora de chegada de cada mensagem) |
| `GSM_SINAL_FRACO` | O sinal do modem GSM está abaixo do limite, com risco de perder comunicação | Regra sobre `gsm_signal` < **-105 dBm** (`REGRA_SINAL_MINIMO_DBM`) | BAIXA | — | **API**: abre quando o sinal cai abaixo do limite |
| `DISPOSITIVO_FALHA` | Falha de hardware do ESP32 ou de sensor não coberta por outro código | ESP32 envia alerta | MEDIA | Oxide `DISPOSITIVO_FALHA` (nome antigo `DEVICE_ERROR`) | Implementado (recebimento) |
| `DISPOSITIVO_NAO_CADASTRADO` | Um dispositivo tentou enviar dados sem estar cadastrado | API Oxide responde `404` (entrega A) | MEDIA | — | Implementado (rejeição) |
| `CHAVE_INVALIDA` | Tentativa de envio com chave ausente, inválida ou de outro dispositivo | API Oxide responde `401`/`403` | ALTA | — | Implementado (rejeição) |

## 5. Comandos

| Código | Significado | Quem detecta / como | Severidade sugerida | Equivalente atual | Situação |
| --- | --- | --- | --- | --- | --- |
| `COMANDO_FALHOU` | O ESP32 tentou executar o comando e confirmou `ERRO` | Confirmação com `status: ERRO` | ALTA | Nome antigo `COMMAND_FAILURE` | **Sistema principal** (a API entrega a confirmação com o erro, como mensagem `CONFIRMACAO_COMANDO`) |
| `COMANDO_SEM_RESPOSTA` | Um comando ficou `PENDENTE` além do limite sem confirmação | Comando pendente há mais de **[a definir]** minutos | MEDIA | — | **Sistema principal** (os comandos são criados lá) |
| `COMANDO_DESCONTINUADO` | Comando antigo com tipo fora do catálogo, marcado na migração da entrega D | Migração: `error_message` "tipo de comando descontinuado" | BAIXA | — | Implementado (migração) |

---

## 6. Fluxo da saída de rota (`SAIDA_ROTA`)

Definido por Natã da Silva Baracho em 06/10/2026:

```text
Cilindro sai da rota sem desvio justificado antes ou programado
   ↓
Alerta SAIDA_ROTA criado com status ABERTO
   ↓  aviso ao MOTORISTA e ao GESTOR
Motorista registra a justificativa (por que saiu da rota)
   ↓  alerta passa para EM_ANALISE
Gestor analisa a justificativa
   ↓  só o GESTOR pode liberar
Alerta ENCERRADO (com quem encerrou e quando)
```

| Regra | Detalhe |
| --- | --- |
| Quem é avisado | O motorista responsável pela entrega e o gestor |
| Quem justifica | O motorista, informando o motivo da saída |
| Quem libera (encerra) | **Somente o gestor** |
| Estados usados | `ABERTO` → `EM_ANALISE` (justificado) → `ENCERRADO` (liberado), os mesmos valores do FluxID |
| Registro | A justificativa, quem justificou, quem encerrou e quando ficam guardados (RN20, auditoria) |

**Desde 10/10/2026, este fluxo é do sistema principal** (Supabase e frontend): a API do lacre não guarda rotas nem trata alertas, e a rota `PATCH /api/v1/iot/alerts/{alert_id}/status` foi removida. O que ainda precisa existir, do lado do sistema principal:

- rota planejada da entrega e registro de desvios programados ou justificados antes;
- campos para a justificativa e para quem encerrou o alerta (o FluxID já tem `alertas.encerrado_por` e `encerrado_em`);
- telas para o motorista justificar e para o gestor analisar e encerrar;
- forma de avisar o motorista e o gestor (aplicativo, SMS, e-mail: **a definir**);
- correspondência de papéis com os perfis do FluxID: hoje existem `OPERADOR` e `SUPERVISOR`, mas não "motorista" e "gestor". Sugestão: motorista → `OPERADOR`; gestor → `SUPERVISOR` ou `ORG_ADMIN`, que têm a permissão `ENCERRAR_ALERTAS`. Falta uma permissão para **justificar** alerta (**a definir**).

## 7. Como o catálogo se liga ao que já existe

Desde 06/10/2026, a API aceita **todos** os códigos deste catálogo em `alert_type` e recusa os demais (`400`). Na transição, os nomes antigos da primeira coluna continuam aceitos e são gravados como o código do catálogo.

| Nome antigo na Oxide (convertido) | Código do catálogo (gravado) | FluxID `alertas.tipo` (dump atual) |
| --- | --- | --- |
| `SEAL_BROKEN` | `LACRE_VIOLADO` | `VIOLACAO_LACRE` |
| `GEOFENCE_EXIT` | `SAIDA_GEOCERCA` | `SAIDA_GEOCERCA` |
| `LOW_BATTERY` | `BATERIA_BAIXA` | `BATERIA_BAIXA` |
| `COMMUNICATION_LOST` | `SEM_COMUNICACAO` | `SEM_COMUNICACAO` |
| `DEVICE_ERROR` | `DISPOSITIVO_FALHA` (para falha do GPS, o firmware deve mandar `GPS_INATIVO`) | — (decisão P5: o FluxID passa a aceitar os códigos do catálogo) |
| `COMMAND_FAILURE` | `COMANDO_FALHOU` | — (decisão P5) |
| — | `LACRE_ABERTO_SEM_AUTORIZACAO` | `ABERTURA_NAO_AUTORIZADA` |
| — | `MOVIMENTACAO_SUSPEITA` | `MOVIMENTACAO_SUSPEITA` |
| — | `TESTE_HIDROSTATICO_VENCIDO` | `TESTE_HIDROSTATICO` |
| — | `LACRE_REVISAO_VENCIDA` | `REVISAO_LACRE` |

## 8. Decisões

Aprovadas por Natã da Silva Baracho em 06/10/2026:

1. **Idioma e padrão dos códigos:** português, em maiúsculas com `_`, como no FluxID.
2. **Uso do catálogo:** primeiro como documentação de referência; os códigos e regras são implementados aos poucos, em cada entrega (B, geofence, Worker, comandos automáticos).
3. **Limites:** definidos o raio de 10 m no destino, a rota sem saída sem justificativa/programação e o lacre fechado em trânsito. **Adotados na API em 10/10/2026, para validação:** bateria 15% e sinal -105 dBm (mudam no `.env`). **Ainda a definir, no sistema principal:** minutos sem sinal de GPS, sem comunicação e sem resposta de comando; margem técnica do GPS na rota; minutos de parada prolongada.
4. **`alert_type` da Oxide em português:** ✅ implementado em 06/10/2026. A API Oxide usa os códigos deste catálogo (ex.: `LACRE_VIOLADO` no lugar de `SEAL_BROKEN`), com severidade padrão igual à sugerida aqui. Na transição, os nomes antigos em inglês continuam aceitos e são convertidos, para não quebrar o firmware, até nova decisão.
5. **Códigos que faltam:** a equipe e o programador do ESP32 podem propor novos códigos (ex.: tampa do lacre forçada, temperatura alta), que entram numa nova versão deste documento.
