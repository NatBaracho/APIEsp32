# Catálogo de Tipos de Erro (`error_type`) — FluxID / Oxide

**Versão:** 1.3 — 07/10/2026 — alertas automáticos e limites (aguardando a validação de Natã da Silva Baracho)
**Público:** equipe do projeto, programador do ESP32 e quem for implementar o Worker e as regras automáticas.

Este catálogo dá **um código único** para cada ocorrência operacional que precisa ser registrada, investigada ou tratada: problemas no lacre, no cilindro, no dispositivo, no GPS, na comunicação, na rota e nos comandos. Hoje esses tipos estão espalhados em três lugares, com nomes diferentes:

- `alert_type` na API Oxide: até 06/10/2026 em inglês (ex.: `SEAL_BROKEN`); **agora usa os códigos deste catálogo** (seção 7);
- `alertas.tipo` no FluxID (ex.: `VIOLACAO_LACRE`);
- `eventos_lacre.tipo` no FluxID (ex.: `VIOLACAO`, `ABERTURA_NAO_AUTORIZADA`).

Desde a entrega B, a API Oxide grava na coluna `error_type` de `telemetry_queue` e `events` o código detectado no recebimento (`LACRE_ABERTO_EM_TRANSITO`, `DISPOSITIVO_SEM_LACRE` ou `LACRE_SEM_CILINDRO`, nessa ordem de prioridade).

**Desde 07/10/2026, o servidor abre alertas sozinho** (código `AUT-...`). São 9 códigos, marcados como "Automático" na coluna Situação. Regras comuns:
- só para dispositivo que está num lacre com cilindro;
- sem repetir enquanto houver um aberto do mesmo tipo, nem antes de 30 minutos depois do último;
- limites no `.env` (`REGRA_...`).

Detalhes em [Integracao-Oxide-FluxID.md](Integracao-Oxide-FluxID.md), seção 3.5.

A coluna **Equivalente atual** mostra onde cada código já existe. A coluna **Situação** diz se a detecção já está implementada:

- **Implementado:** a API já recebe ou detecta;
- **Automático:** o servidor abre o alerta sozinho (07/10/2026);
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
| `LACRE_VIOLADO` | O lacre foi rompido fisicamente | ESP32 envia `seal_status: BROKEN` | CRITICA | Oxide `LACRE_VIOLADO` (nome antigo `SEAL_BROKEN`); FluxID `VIOLACAO_LACRE` e evento `VIOLACAO` | Implementado (recebimento) |
| `LACRE_ABERTO_EM_TRANSITO` | O lacre foi aberto enquanto o cilindro está em trânsito, onde deve estar sempre fechado (regra 3) | ESP32 envia `seal_status: UNLOCKED` ou `BROKEN` (telemetria ou evento) com o cilindro `EM_TRANSITO` | CRITICA | Evento do FluxID `ABERTURA_NAO_AUTORIZADA` ou `VIOLACAO`; alerta `LACRE_ABERTO_EM_TRANSITO` | **Automático** (recebimento): alerta e comando `TRAVAR_VALVULA` |
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
| `GPS_INATIVO` | O módulo GPS não responde (falha de hardware ou desligado) | ESP32 identifica e envia evento/alerta | ALTA | Oxide `GPS_INATIVO` (antes, o genérico `DEVICE_ERROR`) | Previsto (firmware precisa enviar) |
| `GPS_SEM_SINAL` | O GPS funciona, mas está sem posição (sem satélites) há mais tempo que o limite | Oxide: o dispositivo continua mandando telemetria, mas sem posição há mais de **15 minutos** (`REGRA_GPS_SEM_SINAL_MINUTOS`) | MEDIA | — | **Automático** (Worker) |
| `POSICAO_INVALIDA` | O dispositivo enviou coordenada impossível ou incompleta | API Oxide responde `400` (entrega C) | BAIXA | — | Implementado (rejeição) |
| `SAIDA_GEOCERCA` | Depois da entrega, o lacre saiu do raio de **10 metros** do destino final (regra 1, RN10) | Com a custódia aberta (entrega concluída): distância da última posição até o endereço > `raio_geocerca_metros` (padrão 10) | ALTA | Oxide `SAIDA_GEOCERCA` (nome antigo `GEOFENCE_EXIT`); FluxID `SAIDA_GEOCERCA` | **Automático** (Worker) |
| `SAIDA_ROTA` | Durante a entrega, o cilindro saiu da rota sem desvio **justificado antes** ou **programado** (regra 2) | Distância da última posição até a linha da rota da entrega `EM_ANDAMENTO` > margem (`rotas_entrega.margem_metros`, padrão **50 m**); não gera alerta durante um desvio `PROGRAMADO` ou `JUSTIFICADO` (`desvios_rota`) | ALTA | FluxID `SAIDA_ROTA` | **Automático** (Worker) |
| `MOVIMENTACAO_SUSPEITA` | Movimento incompatível com o estado: ex.: velocidade > 0 com o cilindro `COM_CLIENTE` ou `DISPONIVEL` no depósito | Regra sobre `speed_kmh` e status do cilindro (RN11) | ALTA | FluxID `MOVIMENTACAO_SUSPEITA` | Previsto |
| `PARADA_PROLONGADA` | Em trânsito, o cilindro ficou parado fora de local conhecido por mais que o limite | Entrega `EM_ANDAMENTO` com posição repetida por mais de **[a definir]** minutos | MEDIA | — | Previsto |

## 4. Dispositivo, energia e comunicação

| Código | Significado | Quem detecta / como | Severidade sugerida | Equivalente atual | Situação |
| --- | --- | --- | --- | --- | --- |
| `BATERIA_BAIXA` | A bateria está abaixo do limite de alerta | ESP32 envia alerta, ou regra sobre `battery_percent` < **15%** (`REGRA_BATERIA_MINIMA`) | BAIXA | Oxide `BATERIA_BAIXA` (nome antigo `LOW_BATTERY`); FluxID `BATERIA_BAIXA` | Implementado (recebimento) e **Automático** |
| `SEM_COMUNICACAO` | O dispositivo parou de enviar dados por mais que o limite | Servidor: nenhum contato (telemetria, evento ou busca de comando) há mais de **30 minutos** (`REGRA_SEM_COMUNICACAO_MINUTOS`; `devices.last_contact_at`) | ALTA | Oxide `SEM_COMUNICACAO` (nome antigo `COMMUNICATION_LOST`); FluxID `SEM_COMUNICACAO` | **Automático** (Worker) |
| `GSM_SINAL_FRACO` | O sinal do modem GSM está abaixo do limite, com risco de perder comunicação | Regra sobre `gsm_signal` < **-105 dBm** (`REGRA_GSM_MINIMO_DBM`) | BAIXA | — | **Automático** (recebimento) |
| `DISPOSITIVO_FALHA` | Falha de hardware do ESP32 ou de sensor não coberta por outro código | ESP32 envia alerta | MEDIA | Oxide `DISPOSITIVO_FALHA` (nome antigo `DEVICE_ERROR`) | Implementado (recebimento) |
| `DISPOSITIVO_NAO_CADASTRADO` | Um dispositivo tentou enviar dados sem estar cadastrado | API Oxide responde `404` (entrega A) | MEDIA | — | Implementado (rejeição) |
| `CHAVE_INVALIDA` | Tentativa de envio com chave ausente, inválida ou de outro dispositivo | API Oxide responde `401`/`403` | ALTA | — | Implementado (rejeição) |

## 5. Comandos

| Código | Significado | Quem detecta / como | Severidade sugerida | Equivalente atual | Situação |
| --- | --- | --- | --- | --- | --- |
| `COMANDO_FALHOU` | O ESP32 tentou executar o comando e confirmou `ERRO` | Confirmação com `status: ERRO` | ALTA | Oxide `COMANDO_FALHOU` (nome antigo `COMMAND_FAILURE`) | **Automático** (confirmação) |
| `COMANDO_SEM_RESPOSTA` | Um comando ficou `PENDENTE` além do limite sem confirmação | Servidor: `created_at` há mais de **10 minutos** (`REGRA_COMANDO_SEM_RESPOSTA_MINUTOS`) e status `PENDENTE` | MEDIA | — | **Automático** (Worker) |
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

Como ficou implementado (07/10/2026, aguardando validação):

- **Rota planejada e desvios:** `rotas_entrega` e `desvios_rota` (script `006`), pela API do frontend (`manage-deliveries set_route` e `add_deviation`).
- **Alerta automático:** o Worker abre `SAIDA_ROTA` quando a última posição sai da margem (padrão 50 m), fora de um desvio.
- **Justificativa do motorista:** `manage-alerts justify` (permissão nova `JUSTIFICAR_ALERTAS`, papel `OPERADOR`). Fica em `alertas.justificativa`, `justificado_por` e `justificado_em`.
- **Análise e liberação pelo gestor:** `manage-alerts analyze` e `close` (permissão `ENCERRAR_ALERTAS`: `SUPERVISOR` e `ORG_ADMIN`). Grava `encerrado_por` (a pessoa logada) e o motivo.
- **Papéis:** motorista → `OPERADOR`; gestor → `SUPERVISOR` ou `ORG_ADMIN`.
- **Ainda a definir:**
  - a forma de **avisar** o motorista e o gestor (aplicativo, SMS, e-mail). Hoje o alerta aparece no frontend (`query-alerts`, `query-map`);
  - se a justificativa deve passar o alerta para `EM_ANALISE` sozinha. Hoje ela só registra, e o gestor muda o estado.

## 7. Como o catálogo se liga ao que já existe

Desde 06/10/2026, a Oxide aceita **todos** os códigos deste catálogo em `alert_type` (a API e o banco recusam outros). Na transição, os nomes antigos da primeira coluna continuam aceitos e são gravados como o código do catálogo.

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
3. **Limites:** definidos o raio de 10 m no destino, a rota sem saída sem justificativa/programação e o lacre fechado em trânsito.

   **Adotados em 07/10/2026, para validação** (todos mudam no `.env`):
   - GPS sem sinal: 15 min;
   - sem comunicação: 30 min;
   - comando sem resposta: 10 min;
   - bateria: 15%;
   - GSM: -105 dBm;
   - margem da rota: 50 m;
   - repetição do mesmo alerta: 30 min.

   **Ainda a definir:** minutos de parada prolongada.
4. **`alert_type` da Oxide em português:** ✅ implementado em 06/10/2026. A API Oxide usa os códigos deste catálogo (ex.: `LACRE_VIOLADO` no lugar de `SEAL_BROKEN`), com severidade padrão igual à sugerida aqui. Na transição, os nomes antigos em inglês continuam aceitos e são convertidos, para não quebrar o firmware, até nova decisão.
5. **Códigos que faltam:** a equipe e o programador do ESP32 podem propor novos códigos (ex.: tampa do lacre forçada, temperatura alta), que entram numa nova versão deste documento.
