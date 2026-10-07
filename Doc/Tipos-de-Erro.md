# Catálogo de Tipos de Erro (`error_type`) — FluxID / Oxide

**Versão:** 1.1 — 06/10/2026 — entrega B: `DISPOSITIVO_SEM_LACRE` e registro em `error_type`
**Público:** equipe do projeto, programador do ESP32 e quem for implementar o Worker e as regras automáticas.

Este catálogo dá **um código único** para cada ocorrência operacional que precisa ser registrada, investigada ou tratada: problemas no lacre, no cilindro, no dispositivo, no GPS, na comunicação, na rota e nos comandos. Hoje esses tipos estão espalhados em três lugares, com nomes diferentes:

- `alert_type` na API Oxide (em inglês, ex.: `SEAL_BROKEN`);
- `alertas.tipo` no FluxID (ex.: `VIOLACAO_LACRE`);
- `eventos_lacre.tipo` no FluxID (ex.: `VIOLACAO`, `ABERTURA_NAO_AUTORIZADA`).

Desde a entrega B, a API Oxide grava na coluna `error_type` de `telemetry_queue` e `events` o código detectado no recebimento (`LACRE_ABERTO_EM_TRANSITO`, `DISPOSITIVO_SEM_LACRE` ou `LACRE_SEM_CILINDRO`, nessa ordem de prioridade), sem gerar alerta. A geração automática de alertas virá na entrega de regras automáticas.

A coluna **Equivalente atual** mostra onde cada código já existe. A coluna **Situação** diz se a detecção já está implementada:

- **Implementado:** a API já recebe ou detecta;
- **Parcial:** o dado existe, mas a regra automática ainda não;
- **Previsto:** depende de funcionalidade futura (geofence, Worker, rotas).

Limites ainda não decididos estão marcados como **a definir** e não devem ser inventados.

### Regras definidas pelo responsável (06/10/2026)

1. **No destino:** depois da entrega, o lacre não pode sair de um raio de **10 metros** do destino final (local de entrega).
2. **Em rota:** o cilindro não pode sair da rota, a não ser que o desvio tenha sido **justificado antes** ou esteja **programado**. Se sair, o fluxo é o da seção 6.
3. **Em trânsito:** o cilindro viaja com o lacre **fechado**. Qualquer abertura durante o trânsito é irregular, mesmo que exista autorização (a abertura regular só acontece no cliente, RN09).

---

## 1. Lacre

| Código | Significado | Quem detecta / como | Severidade sugerida | Equivalente atual | Situação |
| --- | --- | --- | --- | --- | --- |
| `LACRE_VIOLADO` | O lacre foi rompido fisicamente | ESP32 envia `seal_status: BROKEN` | CRITICA | Oxide `SEAL_BROKEN`; FluxID `VIOLACAO_LACRE` e evento `VIOLACAO` | Implementado (recebimento) |
| `LACRE_ABERTO_EM_TRANSITO` | O lacre foi aberto enquanto o cilindro está em trânsito, onde deve estar sempre fechado (regra 3) | ESP32 envia `seal_status: UNLOCKED` ou `BROKEN` com o cilindro `EM_TRANSITO` ou a entrega `EM_ANDAMENTO` | CRITICA | — (no FluxID, entra como `ABERTURA_NAO_AUTORIZADA`) | Implementado (registrado em `error_type`, sem alerta) |
| `LACRE_ABERTO_SEM_AUTORIZACAO` | O lacre foi aberto no cliente sem autorização registrada (RN09) | ESP32 envia `seal_status: UNLOCKED` e não há autorização para aquele lacre | CRITICA | FluxID alerta e evento `ABERTURA_NAO_AUTORIZADA` | Parcial (falta o registro de autorização) |
| `DISPOSITIVO_SEM_LACRE` | O dispositivo enviou dados sem estar vinculado a nenhum lacre | API Oxide: dispositivo sem vínculo ativo em `seal_assignments` | MEDIA | — | Implementado (registrado em `error_type`, sem alerta) |
| `LACRE_SEM_CILINDRO` | O lacre está em uso (envia dados) mas não tem vínculo ativo com nenhum cilindro | API Oxide: lacre do dispositivo sem vínculo ativo em `cylinder_assignments` | ALTA | — | Implementado (registrado em `error_type`, sem alerta) |
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
| `GPS_INATIVO` | O módulo GPS não responde (falha de hardware ou desligado) | ESP32 identifica e envia evento/alerta | ALTA | Oxide `DEVICE_ERROR` (genérico) | Previsto (firmware precisa enviar) |
| `GPS_SEM_SINAL` | O GPS funciona, mas está sem posição (sem satélites) há mais tempo que o limite | Oxide: telemetrias seguidas sem latitude/longitude por mais de **[a definir]** minutos | MEDIA | — | Parcial (telemetria sem posição já é aceita) |
| `POSICAO_INVALIDA` | O dispositivo enviou coordenada impossível ou incompleta | API Oxide responde `400` (entrega C) | BAIXA | — | Implementado (rejeição) |
| `SAIDA_GEOCERCA` | Depois da entrega, o lacre saiu do raio de **10 metros** do destino final (regra 1, RN10) | Geofence: distância da posição até `locais_entrega` > 10 m (`raio_geocerca_metros`, padrão 10) | ALTA | Oxide `GEOFENCE_EXIT`; FluxID `SAIDA_GEOCERCA` | Previsto (geofence) |
| `SAIDA_ROTA` | Durante a entrega, o cilindro saiu da rota sem desvio **justificado antes** ou **programado** (regra 2) | Comparação da posição com a rota da entrega `EM_ANDAMENTO`; não gera alerta se houver desvio justificado/programado para aquele trecho. Precisa de: rota planejada e registro de desvios no banco (não existem), e uma margem técnica para a imprecisão do GPS (**[a definir]** metros) | ALTA | — | Previsto (rotas ainda não existem no banco) |
| `MOVIMENTACAO_SUSPEITA` | Movimento incompatível com o estado: ex.: velocidade > 0 com o cilindro `COM_CLIENTE` ou `DISPONIVEL` no depósito | Regra sobre `speed_kmh` e status do cilindro (RN11) | ALTA | FluxID `MOVIMENTACAO_SUSPEITA` | Previsto |
| `PARADA_PROLONGADA` | Em trânsito, o cilindro ficou parado fora de local conhecido por mais que o limite | Entrega `EM_ANDAMENTO` com posição repetida por mais de **[a definir]** minutos | MEDIA | — | Previsto |

## 4. Dispositivo, energia e comunicação

| Código | Significado | Quem detecta / como | Severidade sugerida | Equivalente atual | Situação |
| --- | --- | --- | --- | --- | --- |
| `BATERIA_BAIXA` | A bateria está abaixo do limite de alerta | ESP32 envia alerta, ou regra sobre `battery_percent` < **[a definir]** % | BAIXA | Oxide `LOW_BATTERY`; FluxID `BATERIA_BAIXA` | Implementado (recebimento) |
| `SEM_COMUNICACAO` | O dispositivo parou de enviar dados por mais que o limite | Servidor: último `last_seen_at`/telemetria há mais de **[a definir]** minutos | ALTA | Oxide `COMMUNICATION_LOST`; FluxID `SEM_COMUNICACAO` | Parcial (falta a rotina de monitoramento) |
| `GSM_SINAL_FRACO` | O sinal do modem GSM está abaixo do limite, com risco de perder comunicação | Regra sobre `gsm_signal` < **[a definir]** dBm | BAIXA | — | Previsto |
| `DISPOSITIVO_FALHA` | Falha de hardware do ESP32 ou de sensor não coberta por outro código | ESP32 envia alerta | MEDIA | Oxide `DEVICE_ERROR` | Implementado (recebimento) |
| `DISPOSITIVO_NAO_CADASTRADO` | Um dispositivo tentou enviar dados sem estar cadastrado | API Oxide responde `404` (entrega A) | MEDIA | — | Implementado (rejeição) |
| `CHAVE_INVALIDA` | Tentativa de envio com chave ausente, inválida ou de outro dispositivo | API Oxide responde `401`/`403` | ALTA | — | Implementado (rejeição) |

## 5. Comandos

| Código | Significado | Quem detecta / como | Severidade sugerida | Equivalente atual | Situação |
| --- | --- | --- | --- | --- | --- |
| `COMANDO_FALHOU` | O ESP32 tentou executar o comando e confirmou `ERRO` | Confirmação com `status: ERRO` | ALTA | Oxide `COMMAND_FAILURE` | Implementado (confirmação) |
| `COMANDO_SEM_RESPOSTA` | Um comando ficou `PENDENTE` além do limite sem confirmação | Servidor: `created_at` há mais de **[a definir]** minutos e status `PENDENTE` | MEDIA | — | Previsto |
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

O que ainda precisa existir para este fluxo funcionar:

- rota planejada da entrega e registro de desvios programados ou justificados antes;
- campos para a justificativa e para quem encerrou o alerta (o FluxID já tem `alertas.encerrado_por` e `encerrado_em`);
- rotas da API para justificar e para encerrar alertas;
- forma de avisar o motorista e o gestor (aplicativo, SMS, e-mail: **a definir**);
- correspondência de papéis com os perfis do FluxID: hoje existem `OPERADOR` e `SUPERVISOR`, mas não "motorista" e "gestor". Sugestão: motorista → `OPERADOR`; gestor → `SUPERVISOR` ou `ORG_ADMIN`, que têm a permissão `ENCERRAR_ALERTAS`. Falta uma permissão para **justificar** alerta (**a definir**).

## 7. Como o catálogo se liga ao que já existe

| Oxide `alert_type` (hoje) | Código do catálogo | FluxID `alertas.tipo` |
| --- | --- | --- |
| `SEAL_BROKEN` | `LACRE_VIOLADO` | `VIOLACAO_LACRE` |
| `GEOFENCE_EXIT` | `SAIDA_GEOCERCA` | `SAIDA_GEOCERCA` |
| `LOW_BATTERY` | `BATERIA_BAIXA` | `BATERIA_BAIXA` |
| `COMMUNICATION_LOST` | `SEM_COMUNICACAO` | `SEM_COMUNICACAO` |
| `DEVICE_ERROR` | `DISPOSITIVO_FALHA` (ou `GPS_INATIVO`, quando for o GPS) | — (decisão P5 do plano de integração) |
| `COMMAND_FAILURE` | `COMANDO_FALHOU` | — (decisão P5) |
| — | `LACRE_ABERTO_SEM_AUTORIZACAO` | `ABERTURA_NAO_AUTORIZADA` |
| — | `MOVIMENTACAO_SUSPEITA` | `MOVIMENTACAO_SUSPEITA` |
| — | `TESTE_HIDROSTATICO_VENCIDO` | `TESTE_HIDROSTATICO` |
| — | `LACRE_REVISAO_VENCIDA` | `REVISAO_LACRE` |

## 8. Decisões

Aprovadas por Natã da Silva Baracho em 06/10/2026:

1. **Idioma e padrão dos códigos:** português, em maiúsculas com `_`, como no FluxID.
2. **Uso do catálogo:** primeiro como documentação de referência; os códigos e regras são implementados aos poucos, em cada entrega (B, geofence, Worker, comandos automáticos).
3. **Limites:** definidos o raio de 10 m no destino, a rota sem saída sem justificativa/programação e o lacre fechado em trânsito. **Ainda a definir:** minutos sem sinal de GPS, sem comunicação e sem resposta de comando; percentual de bateria; dBm de GSM; margem técnica do GPS na rota; minutos de parada prolongada.
4. **`alert_type` da Oxide em português:** a API Oxide passará a usar os códigos deste catálogo (ex.: `LACRE_VIOLADO` no lugar de `SEAL_BROKEN`). A implementação é uma entrega própria, com período de transição em que os nomes antigos em inglês continuam aceitos e são convertidos, para não quebrar o firmware.
5. **Códigos que faltam:** a equipe e o programador do ESP32 podem propor novos códigos (ex.: tampa do lacre forçada, temperatura alta), que entram numa nova versão deste documento.
