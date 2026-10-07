# Relatório de Teste — FluxID (alerta com cilindro e lacre obrigatórios)

**Data/hora:** 07/10/2026, publicado às 00:15; testes executados entre 00:02 e 00:04
**Executor:** IA (Claude Code, modelo Claude Opus 5.5), com validação humana de Natã da Silva Baracho
**Commit/versão:** branch `feat/fluxid-alerta-cilindro-obrigatorio`, a partir da `main` `2146345` (merge do PR #12)
**Ambiente:** Windows 11 Pro, PostgreSQL 18.6 **temporário** (binários locais, só `localhost`, porta 54329, autenticação local), criado numa pasta de rascunho e **apagado ao final**. O servidor PostgreSQL do responsável (porta 5432) e a senha dele não foram usados.
**Base:** dump `FluxID.sql` de 23/09/2026 com `sql/fluxid/001` e `002` aplicados; `PlanoDeTeste.md` v1.9 (FLX-23 a FLX-25)
**Relatório anterior:** [23h40 (alertas em português)](Relatorio-de-Teste-2026-10-06-23h40.md)

## 1. Resumo

| Indicador | Valor |
| --- | --- |
| Restauração do dump e scripts `001` e `002` | Sem erros |
| `003`, primeira execução | 10 alertas preenchidos com o cilindro do vínculo da data |
| `003`, segunda execução | Nenhuma alteração |
| Demais tabelas | Dados idênticos antes e depois |
| Regras do `CHECK` (FLX-24) | 6 de 6 conforme |
| Parada segura (FLX-25) | Conforme: parou, listou o código e não alterou nada |
| FALHOU | 0 |
| Banco principal (`FluxID_db`) | Não acessado. A aplicação é feita pelo responsável |
| Validação humana | **Aprovada por Natã da Silva Baracho** |

## 2. Escopo

Decisão de Natã da Silva Baracho: todo alerta do FluxID pertence a um lacre que está num cilindro. O par lacre + cilindro do momento do alarme fica gravado no alerta, para que a auditoria possa conferir se o lacre está no cilindro que o cliente comprou.

| # | Decisão |
| --- | --- |
| 1 | `cilindro_id` e `lacre_id` obrigatórios em `alertas`. Exceções, só para códigos de cadastro: sem cilindro, `LACRE_SEM_CILINDRO`, `DISPOSITIVO_SEM_LACRE`, `DISPOSITIVO_NAO_CADASTRADO` e `CHAVE_INVALIDA`; sem lacre, só os três últimos |
| 2 | Mudança **só no FluxID**: a Oxide não ganha colunas de lacre nem de cilindro |
| 3 | O Worker busca o lacre e o cilindro do vínculo válido na data do alerta; sem vínculo, o alerta fica em erro na Oxide para o gestor |
| 4 | Alertas da massa preenchidos pelo vínculo da data; se não houver, o script para sem alterar nada |
| 5 | Entrega como script novo `003`; o das decisões P1 a P8 passa a ser o `004` |
| 6 | Conferência física (leitura do NFC na auditoria) fica para depois |

## 3. Validação pela IA

### 3.1 Situação encontrada

Os 10 alertas da massa (`ALT-000001` a `ALT-000010`, `VIOLACAO_LACRE`, `ABERTO`) tinham `lacre_id`, mas **nenhum tinha `cilindro_id`**. Cada lacre (`LCR-000001` a `LCR-000010`) tinha um único vínculo com cilindro, ativo desde 25/07/2026, portanto válido na data dos alertas (23/09/2026). Organização do alerta igual à do lacre em todos.

### 3.2 Resultados

| ID | Caso | Esperado | Obtido | Resultado |
| --- | --- | --- | --- | --- |
| FLX-23 | 1ª execução do `003` | Os 10 alertas preenchidos pelo vínculo válido em `aberto_em` | `UPDATE 10`; `LCR-000001` → `CIL-000001` … `LCR-000010` → `CIL-000010`; vínculo na data confirmado nos 10 | PASSOU |
| FLX-23 | 2ª execução | Nenhuma alteração | `UPDATE 0`; `COMMIT` | PASSOU |
| FLX-23 | Demais tabelas | Sem mudança | Dumps de dados (sem `alertas`) idênticos; só os tokens `\restrict` do `pg_dump` 18 diferem, porque são aleatórios a cada execução | PASSOU |
| FLX-24 | `VIOLACAO_LACRE` sem cilindro | Rejeitado | `violates check constraint "alertas_cilindro_lacre_obrigatorio_check"` | PASSOU |
| FLX-24 | `VIOLACAO_LACRE` sem lacre | Rejeitado | Mesmo erro | PASSOU |
| FLX-24 | Alerta com lacre e cilindro | Aceito | `INSERT 0 1` (desfeito) | PASSOU |
| FLX-24 | `LACRE_SEM_CILINDRO` com lacre, sem cilindro | Aceito | `INSERT 0 1` | PASSOU |
| FLX-24 | `DISPOSITIVO_SEM_LACRE` sem lacre e sem cilindro | Aceito | `INSERT 0 1` | PASSOU |
| FLX-24 | `LACRE_SEM_CILINDRO` sem lacre | Rejeitado | Erro de `CHECK` | PASSOU |
| FLX-25 | Alerta com data anterior ao vínculo (cópia separada do banco) | O script para, lista o código e nada muda | "Alertas sem lacre/cilindro no momento do alarme, analisar antes de aplicar: ALT-000001"; depois disso, 10 alertas ainda sem cilindro e restrição não criada | PASSOU |

Total de alertas no fim dos testes: 10, sem nenhum resíduo dos testes.

Observação sobre os testes das exceções: o `CHECK` atual de `alertas.tipo` ainda não aceita os códigos do catálogo; isso vem no script `004` (decisão P5). Para testar as exceções, esse `CHECK` foi retirado só dentro de uma transação, desfeita em seguida.

## 4. Ocorrências durante os testes

| Ocorrência | Tratamento |
| --- | --- |
| O servidor temporário não abriu a porta 55432 ("Permission denied") | O Windows tinha reservado a faixa 55365 a 55464. Usada a porta 54329, fora das faixas reservadas. Aprovado no questionário (pergunta 4) |

## 5. Casos não executados

| ID | Motivo |
| --- | --- |
| FLX-26 | Gatilho do par lacre + cilindro: aprovado para entrega futura |
| Aplicação no `FluxID_db` | Feita pelo responsável, no pgAdmin (seção 17.3 do `Banco_FluxID.md`) |

## 6. Validação humana (questionário)

Respondido por **Natã da Silva Baracho** em 07/10/2026.

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | Os alertas do FluxID passam a ter cilindro e lacre obrigatórios, com exceção só para os códigos de cadastro? | Sim |
| 2 | Os 10 alertas de teste podem ser preenchidos com o cilindro do vínculo na data do alerta? | Sim |
| 3 | Se algum alerta não tiver vínculo na data, o script deve parar e listar os códigos, sem alterar nada? | Sim |
| 4 | Aceita a troca da porta do servidor temporário para 54329? | Sim |
| 5 | Quer o gatilho que confere o par lacre + cilindro numa entrega futura? | Sim |
| 6 | Pode registrar a aprovação, atualizar os documentos e enviar ao GitHub? | Sim |

## 7. Conclusão

**Aprovado.** Com o `003` aplicado, nenhum alerta operacional do FluxID existe sem o lacre e o cilindro do momento do alarme. A auditoria passa a ter o par para conferir com o cilindro físico do cliente. A massa de testes foi corrigida sem inventar dados, e o script se recusa a rodar se houver alerta sem vínculo comprovado.

> **Validação aprovada por Natã da Silva Baracho em 07/10/2026.**

## 8. Recomendações

1. Aplicar `001`, `002` e `003`, nessa ordem, no `FluxID_db`, com backup antes, e enviar o novo `FluxID.sql` para conferência.
2. Numa entrega futura, criar o gatilho do par lacre + cilindro (FLX-26) e a conferência física com leitura do NFC (`inspecoes_lacre`).
