# Relatório de Teste — Swagger em grupos e FluxID no Docker

**Data/hora:** 07/10/2026, publicado às 00:45
**Executor:** IA (Claude Code, modelo Claude Opus 5.5), com validação humana de Natã da Silva Baracho
**Commit/versão:** branch `feat/swagger-grupos`, montada sobre a branch do PR #13 (`feat/fluxid-alerta-cilindro-obrigatorio`)
**Ambiente:** Windows 11 Pro, Node.js v24.21.0, Git Bash; Docker Desktop 29.8.2 (WSL 2), container `fluxid-analise` com `postgis/postgis:18-3.6` ligado só a `127.0.0.1:54329`. A senha do container foi gerada na hora e não está registrada aqui
**Base:** `PlanoDeTeste.md` v1.10 (GER-06) e `RoteiroDeTeste.md` v1.9
**Relatório anterior:** [00h15 (FluxID: alerta com cilindro e lacre)](Relatorio-de-Teste-2026-10-07-00h15.md)

## 1. Resumo

| Indicador | Valor |
| --- | --- |
| Compilação (`npx tsc --noEmit`) | PASSOU |
| Suíte automatizada (cópia do banco) | 87/87 (1 caso novo), em duas rodadas |
| Teste negativo da regra de grupos | PASSOU (acusou as duas rotas alteradas de propósito) |
| Swagger publicado | 8 grupos, nenhum "default" |
| FluxID no Docker | Dump restaurado; `001`, `002` e `003` aplicados sem erro; `003` sem alteração na segunda vez |
| FALHOU | 0 |
| Validação humana | **Aprovada por Natã da Silva Baracho** |

## 2. Escopo

| # | Decisão |
| --- | --- |
| 1 | Swagger com 8 grupos, cada um com uma frase de explicação: Dispositivos, Telemetria, Eventos, Comandos, Alertas, Lacres, Cilindros e Vínculos. "Associação" dividida em três |
| 2 | Teste na suíte que barra rota sem grupo ou com grupo não declarado (GER-06) |
| 3 | FluxID de análise no Docker, mantido para consulta no pgAdmin e no Docker Desktop |
| 4 | Dump movido para `sql/fluxid/FluxID.sql`, com os documentos atualizados |

## 3. Validação pela IA

### 3.1 Swagger

| Verificação | Resultado |
| --- | --- |
| Distribuição das 25 operações | Dispositivos 3, Telemetria 2, Eventos 1, Comandos 2, Alertas 3, Lacres 4, Cilindros 4, Vínculos 6; nenhuma sem grupo |
| GER-06 na suíte | Passou ("8 grupos") nas duas rodadas |
| Teste negativo (cópia do spec em memória) | Retirada a etiqueta de `POST /iot/events` e trocada a de `GET /seals` por "Associação": a regra apontou as duas |
| `/api-docs/swagger-ui-init.js` numa API de teste (porta 3999, banco de cópia, encerrada depois) | Contém os 8 grupos; nenhuma ocorrência de "default" |
| Comportamento das rotas | Inalterado: os 86 casos anteriores continuaram passando |

### 3.2 FluxID no Docker

| Passo | Resultado |
| --- | --- |
| Docker Desktop | Cliente e servidor 29.8.2; WSL 2 com `docker-desktop`. A virtualização, antes desativada, passou a funcionar |
| Imagem | `postgis/postgis:18-3.6`: o dump usa as extensões `postgis` e `pgcrypto` |
| Banco `FluxID_original` | Dump restaurado sem erros, sem alteração (10 alertas sem cilindro) |
| Banco `FluxID_db` | Dump restaurado (26 tabelas); `001` sem erros; `002` com as correções previstas (organizações Alfa e Beta, 10 lacres em `SUSPEITA_VIOLACAO`, perfis e permissões); `003` com `UPDATE 10`; na segunda vez, `UPDATE 0` |
| Conferência | `ALT-000001 \| LCR-000001 \| CIL-000001` … `ALT-000010 \| LCR-000010 \| CIL-000010`; nenhum alerta sem cilindro; restrição criada |

### 3.3 Dump movido

`sql/fluxid/FluxID.sql` tem o mesmo SHA-256 do arquivo que estava na raiz (`31d837e5…`). As referências ao caminho foram atualizadas no README, no `Banco_FluxID.md`, no plano de integração, nas Regras de Negócio e no Plano e Roteiro de Teste. Os relatórios antigos não foram alterados, porque registram o caminho da época.

## 4. Ocorrências

| Ocorrência | Tratamento |
| --- | --- |
| No Git Bash, `docker exec` com caminhos `/tmp/...` foi convertido para caminho do Windows | Executado com `MSYS_NO_PATHCONV=1` |
| A imagem PostGIS cria extensões no banco inicial | Bancos novos criados a partir de `template0` |
| Ao reorganizar a branch, o git não conseguiu restaurar a pasta de trabalho porque a API do responsável estava aberta usando o `oxide.db` | Nada foi perdido. O `oxide.db` ficou idêntico (mesmo checksum) e as alterações locais ficaram guardadas num stash de segurança; a branch foi refeita com `cherry-pick`, sem tocar no banco |

## 5. Validação humana (questionário)

Respondido por **Natã da Silva Baracho** em 07/10/2026.

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | Os 8 grupos do Swagger ficaram como queria? | Sim |
| 2 | Pode manter o teste novo, que barra rota sem grupo? | Sim |
| 3 | Pode registrar a aprovação, atualizar os documentos (novo caminho do `FluxID.sql` e teste no Docker) e enviar ao GitHub? | Sim |

Antes disso, também aprovou usar o Docker Desktop com o banco FluxID e dividir "Associação" em Lacres, Cilindros e Vínculos.

## 6. Conclusão

**Aprovado.** O Swagger ficou organizado por assunto, e a suíte impede que uma rota nova volte a cair em "default". O FluxID de análise agora roda no Docker, com o banco original e o banco com os scripts lado a lado, para conferência antes da aplicação no banco principal.

> **Validação aprovada por Natã da Silva Baracho em 07/10/2026.**

## 7. Recomendações

1. Mesclar o PR #13 antes deste.
2. Aplicar `001`, `002` e `003` no `FluxID_db` principal pelo pgAdmin, com backup antes, e enviar o novo `sql/fluxid/FluxID.sql` para conferência.
3. Quando não precisar mais do container: `docker rm -f fluxid-analise` e `docker volume rm fluxid-analise-dados`.
