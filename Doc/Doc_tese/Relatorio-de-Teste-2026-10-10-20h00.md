# Relatório de Teste — Ativação do lacre e vínculo com o cilindro e o cliente

**Data:** 10/10/2026, 20:00
**Executado por:** IA (Claude Code, modelo Claude Opus 5.5), a pedido de Natã da Silva Baracho
**Branch:** `fix/teste-banco-e-massa` (PR #21), enviada ao GitHub depois da aprovação
**Base:** descrição de Natã em 10/10/2026 e duas respostas dele: o identificador é **um fixo por lacre**; o vínculo termina **quando o sistema mandar ou quando o lacre avisar que desativou**
**Situação:** ✅ **aprovado por Natã da Silva Baracho em 10/10/2026** (seção 9)

---

## 1. Resumo

| Indicador | Valor |
| --- | --- |
| Compilação (`npx tsc --noEmit`) | Sem erros |
| Suíte da API (`npm test`) | **110 de 110** (18 casos novos) |
| Simulador (`npm run simular`) | **26 de 26** (3 verificações novas) |
| Teste em massa (`npm run simular:massa`) | **32 de 32**, em três execuções seguidas (8 verificações novas) |
| Teste direto no banco | **64 de 64** |
| `oxide.db` do projeto | **Intacto**: SHA-256 `f0db3993…4308f9960` igual antes e depois |
| Banco principal (Supabase) de verdade | **Não acessado** |

O fluxo que você descreveu está implementado: o lacre avisa que está ativo, a API gera o identificador e avisa o sistema, o sistema vincula o cilindro e o cliente por esse identificador, e o vínculo fica salvo na Oxide.

O teste em massa achou um defeito antigo, sem relação com a ativação, que foi corrigido (seção 5).

**Limite:** o lado do sistema (receber a lista de lacres ativados e devolver o vínculo) foi feito pelo recebedor de teste. O sistema de verdade ainda não faz isso, e o firmware do lacre ainda não manda o aviso de ativação.

## 2. O fluxo implementado

1. **O lacre avisa que está ativo.** Ele envia `POST /api/v1/iot/activations` com `status: "ATIVO"`, a posição e a bateria.
2. **A API gera o identificador do lacre**, no formato `LCR-` e 8 caracteres (exemplo: `LCR-JKFL6VBR`). Ele é gerado só na primeira ativação e nunca muda. A API devolve o identificador na resposta ao lacre.
3. **A API avisa o sistema.** O aviso entra na fila como mensagem do tipo `ATIVACAO` e o Worker o entrega. Com esses avisos, o sistema sabe quais lacres estão ativos.
4. **O sistema vincula o cilindro e o cliente**, usando o identificador.
5. **O vínculo é salvo na Oxide.** O Worker traz a ordem de vinculação e grava na tabela `devices`.
6. **Cada mensagem do lacre sai com o identificador, o cilindro e o cliente.**

### 2.1 Como o vínculo termina

| Quem encerra | O que acontece |
| --- | --- |
| O sistema | Manda o vínculo vazio. A Oxide apaga o cilindro e o cliente; o lacre continua ativo |
| O lacre | Avisa `status: "INATIVO"`. O aviso sai ainda com o cilindro e o cliente; em seguida a Oxide encerra o vínculo |

Um vínculo encerrado pelo lacre **não volta**, mesmo que o sistema ainda o mande por algum tempo. Para usar de novo, o lacre é ativado outra vez (o identificador é o mesmo) e o sistema manda um vínculo novo.

### 2.2 O que a API recusa ou ignora

| Situação | O que a API faz |
| --- | --- |
| Vínculo com um identificador que a API não gerou | Ignora e registra um aviso na rodada do Worker |
| Vínculo para lacre que não está ativo | Ignora e registra um aviso |
| Aviso de ativação sem posição ou sem bateria, ou com `status` diferente de `ATIVO` e `INATIVO` | Recusa (`400`) |
| Aviso de ativação repetido (mesmo `message_id`) | Responde `409` |

### 2.3 Lacre enviando sem cilindro

| Situação | O que a API faz |
| --- | --- |
| Lacre ativo, ainda sem cilindro, dentro do prazo de 10 minutos | Aceita a mensagem, sem alerta: é o tempo de alguém vincular no sistema |
| Lacre ativo, sem cilindro, depois do prazo | Aceita a mensagem e abre o alerta `LACRE_SEM_CILINDRO`, uma vez |
| Lacre que nunca avisou a ativação (firmware atual) | Aceita a mensagem como antes, sem alerta e sem identificador |

O prazo muda no `.env` (`REGRA_MINUTOS_SEM_VINCULO`).

## 3. O que mudou no banco

A Oxide continua com 3 tabelas. Colunas novas em `devices`:

| Coluna | O que guarda |
| --- | --- |
| `seal_code` | Identificador do lacre, gerado pela API; não se repete entre lacres |
| `activation_status` | `ATIVO` ou `INATIVO` |
| `activated_at` e `deactivated_at` | Datas do último aviso |
| `binding_id` | Identificador da ordem de vinculação |
| `cylinder_code` | Código do cilindro |
| `customer_code` e `customer_name` | Cliente |
| `bound_at` | Data da vinculação |
| `ended_binding` | Vínculo que o lacre encerrou, para ele não voltar |
| `binding_alert` | Alerta de vínculo já aberto, para não repetir |

A tabela `mensagens` passou a aceitar o tipo `ATIVACAO`.

Ao ligar, a API percebe o banco de versão anterior, faz uma cópia de segurança (`oxide.db.bak-antes-da-atualizacao-<data>`) e refaz as tabelas com os mesmos dados.

## 4. Resultados

### 4.1 Suíte: grupo 13 (novo) e um caso da correção

| Caso | Resultado |
| --- | --- |
| Lacre avisa que está ativo: a API gera o identificador e manda o aviso ao sistema | ✅ |
| Ativar de novo mantém o identificador; repetida → `409`; `status` inválido e sem bateria → `400`; chave de outro → `403` | ✅ |
| Cada lacre recebe um identificador diferente | ✅ |
| Sistema vincula o cilindro e o cliente pelo identificador; a Oxide guarda | ✅ |
| `GET /devices/{id}` mostra a ativação e o vínculo, sem a chave | ✅ |
| Leitura do lacre vinculado sai com o identificador, o cilindro e o cliente, e chega assim ao sistema | ✅ |
| Evento, alerta do lacre e alerta automático também saem com o cilindro | ✅ |
| Vínculo com identificador que a API não gerou é ignorado, com aviso | ✅ |
| Vínculo para lacre que não está ativo é ignorado, com aviso | ✅ |
| Lacre ativo sem cilindro: mensagem aceita; alerta só depois do prazo, uma vez | ✅ |
| Lacre que nunca avisou a ativação: mensagem aceita, sem alerta e sem identificador | ✅ |
| Troca de cilindro: mensagem nova com o cilindro novo; a gravada fica com o antigo | ✅ |
| Confirmação de comando sai com o cilindro | ✅ |
| Sistema desfaz o vínculo: lacre continua ativo e as mensagens saem sem cilindro | ✅ |
| Lacre avisa que desativou: o aviso sai com o vínculo, e o vínculo acaba na hora | ✅ |
| Vínculo encerrado pelo lacre não volta; um vínculo novo vale depois de ativar de novo | ✅ |
| Dado do vínculo com tipo errado é ignorado, sem derrubar o cadastro | ✅ |
| Posição repetida enquanto o Worker envia a leitura: ela volta para a fila (seção 5) | ✅ |

### 4.2 Teste em massa (500 lacres)

O teste ganhou uma etapa antes da viagem: todos os lacres avisam que estão ativos, o "sistema" vincula o cilindro e o cliente pelo identificador, e só então eles partem.

| Conferência | Resultado |
| --- | --- |
| Lacres ativados, cada um com um identificador só dele | 500 de 500 ✅ |
| Lista de lacres ativados recebida pelo sistema | 500 avisos ✅ |
| Ordem de vinculação gravada na Oxide | 474 de 474 (26 lacres ninguém vincula, de propósito) ✅ |
| Pedidos dos lacres na viagem com a resposta esperada | 14.974 de 14.974 ✅ |
| Mensagens na Oxide e no sistema principal de teste | 14.934 e 14.934 ✅ |
| **Mensagens com o identificador, o cilindro e o cliente certos** | **14.934 de 14.934** ✅ |
| Alerta `LACRE_SEM_CILINDRO` | 26 de 26 previstos ✅ |
| Demais alertas automáticos (bateria, sinal, rompido, aberto) | 662 de 662 previstos ✅ |
| Avisos de ativação e de desativação gravados | 582 de 582 (500 + 82) ✅ |
| Lacres que avisaram a desativação: vínculo encerrado e aviso entregue | 82 de 82 ✅ |
| Quem não desativou continua vinculado | 396 de 396 ✅ |
| Comandos confirmados | 86 de 86 ✅ |
| Erros `500` da API | 0 ✅ |
| Pedidos por segundo (três execuções) | 550 a 648 |

As quedas provocadas (banco principal, Worker e API) continuaram no teste. Neste teste o prazo do alerta foi posto em zero, para o alerta abrir na primeira mensagem da viagem.

## 5. Defeito achado e corrigido

**Posição repetida no instante em que o Worker envia a leitura.**

- **Como apareceu:** numa execução do teste em massa, 6 dos 500 lacres ficaram com a leitura da chegada sem a data nova no sistema principal. Nas execuções anteriores não tinha aparecido.
- **Causa:** quando o lacre fica parado, a API atualiza a data e a hora da leitura anterior. Se, nesse mesmo instante, o Worker já estava enviando a versão antiga daquela leitura, ele a marcava como enviada logo depois, e a data nova nunca saía.
- **Correção** (`MessageRepository.ts`): se a leitura está sendo enviada, ela volta para a fila junto com a data nova.
- **Conferência:** um caso novo na suíte reproduz a situação, e o teste em massa passou três vezes seguidas com 500 de 500.
- **Alcance:** o defeito existia desde a entrega da fila única. O dado perdido era só a data da última vez em que o lacre foi visto parado; a leitura em si chegava.

## 6. O que depende de outras pessoas

**Professor Alisson (sistema):**

- Tratar a mensagem do tipo `ATIVACAO` (campos `activation_status` e `seal_code`) para montar a lista de lacres ativos e, com `INATIVO`, encerrar o vínculo do lado dele.
- Devolver o vínculo na lista de dispositivos (`list_devices`), no campo `binding`:

```json
{
  "device_id": "DSP-000001",
  "api_key_hash": "…",
  "active": true,
  "binding": {
    "binding_id": "…",
    "seal_code": "LCR-JKFL6VBR",
    "cylinder_code": "CIL-000111",
    "customer_code": "CLI-0007",
    "customer_name": "Hospital de Teste",
    "bound_at": "2026-10-10T12:00:00Z"
  }
}
```

- `"binding": null` desfaz o vínculo. Se o campo não vier, nada muda.
- O `seal_code` tem de ser o que a API gerou.

**Simão (firmware):**

- Enviar o aviso de ativação ao ligar (`POST /api/v1/iot/activations`, `status: "ATIVO"`) e, se houver desligamento controlado, o de desativação.

## 7. Pontos de atenção

- **Atraso do vínculo:** a Oxide busca o vínculo a cada 5 minutos (`WORKER_CADASTRO_INTERVAL_SECONDS`). Entre alguém vincular no sistema e a API saber, podem passar até 5 minutos; nesse tempo as mensagens saem só com o identificador do lacre.
- **Lacre que desliga sem avisar** (bateria acabou, queda): continua como ativo e vinculado. O vínculo só termina quando o sistema mandar.
- **Lacre que perde a resposta da ativação:** basta avisar de novo; o identificador devolvido é o mesmo.
- **Nomes dos campos** (`seal_code`, `cylinder_code`, `customer_code`, `customer_name`): fui eu que defini. As tabelas do lacre no Supabase ainda não estão no repositório do frontend.
- **O `oxide.db` do projeto** ainda não tem as colunas novas. Ele será atualizado, com cópia de segurança, depois da sua aprovação.
- **Não testado:** o Supabase de verdade e o lacre de verdade.

## 8. Questionário de validação (responda sim ou não)

1. O fluxo da seção 2 é o que você descreveu?
2. O identificador no formato `LCR-` e 8 caracteres serve?
3. A API devolver o identificador ao lacre na resposta da ativação está certo?
4. O vínculo só vale para lacre **ativo** (vínculo para lacre inativo é ignorado). Está certo?
5. Lacre ativo sem cilindro: aceitar a mensagem e abrir o alerta depois de 10 minutos está certo? (não = recusar a mensagem)
6. Vínculo encerrado pelo lacre não volta; para usar de novo, o sistema manda um vínculo novo. Está certo?
7. Aprova a correção da seção 5?
8. Posso atualizar o `oxide.db` do projeto com as colunas novas e enviar ao GitHub?
9. Posso atualizar os documentos (contrato para o professor Alisson, guia do firmware para o Simão e os demais) e enviar tudo ao GitHub, no PR #21?

## 9. Validação (10/10/2026)

Natã da Silva Baracho respondeu **sim** às nove perguntas: **aprovado por Natã da Silva Baracho em 10/10/2026**.

Depois da aprovação:

- o `oxide.db` do projeto foi atualizado com as colunas novas, com a cópia de segurança automática, e enviado ao GitHub;
- os documentos foram atualizados: contrato de entrega (1.1), guia do firmware (2.1), regras (2.1), `Oxidedb.md` (2.2), `Como-o-Sistema-se-Comporta.md` (1.1), plano e roteiro de teste (2.2), `Desenvolvimento.md`, README, checklist e tipos de erro;
- foi criado o registro 22 em `DocumentacaoFinal/`.
