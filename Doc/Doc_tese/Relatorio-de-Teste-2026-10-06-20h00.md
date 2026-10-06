# Relatório de Teste — Banco FluxID (entrega E: análise, ajustes e plano de integração)

**Data/hora:** 06/10/2026, publicado às 20:00
**Executor:** IA (Claude Code, modelo Claude Opus 5.5), com validação humana de Natã da Silva Baracho
**Commit/versão:** branch `feat/fluxid-ajustes`, a partir da `main` `ec9c485` (merge do PR #3)
**Ambiente:** Windows 11 Pro; servidor **PostgreSQL 18.6 temporário** (binários locais, porta 55432, pasta temporária, sem senha e sem acesso ao servidor principal), apagado ao final
**Base:** dump `FluxID.sql` de 23/09/2026, `Banco_FluxID.md` v3.0, `PlanoDeTeste.md` v1.5
**Relatório anterior:** [19h28 (entrega C)](Relatorio-de-Teste-2026-10-06-19h28.md)

## 1. Resumo

| Indicador | Valor |
| --- | --- |
| Restauração do dump | PASSOU (26 tabelas, sem erros) |
| Script 001 (estrutura) | PASSOU, executado duas vezes |
| Script 002 (massa de testes) | PASSOU, executado duas vezes |
| Coerência final da massa | PASSOU |
| Regras novas da estrutura | PASSOU (4 de 4) |
| FALHOU | 0 |
| Servidor temporário removido | Sim; banco principal não foi acessado |
| Validação humana | **Aprovada por Natã da Silva Baracho** |

## 2. Escopo da entrega

Análise do dump e do documento, seguida das quatro ações escolhidas pelo responsável:

| Ação | Entregável |
| --- | --- |
| Ajustes de estrutura | `sql/fluxid/001_ajustes_estrutura.sql` |
| Correção da massa de testes | `sql/fluxid/002_correcao_massa_de_testes.sql` |
| Atualizar o documento do banco | `Doc/Banco_FluxID.md` v3.1 |
| Plano de integração | `Doc/Integracao-Oxide-FluxID.md` (novo) |

Decisões tomadas antes da implementação:
- validar os scripts num PostgreSQL isolado: primeiro Docker; depois, com a virtualização desativada, servidor temporário com os binários locais;
- chave de API do dispositivo guardada como hash no FluxID;
- empresas reais renomeadas para Alfa e Beta Gases;
- cilindros reprovados: 2 em `MANUTENCAO` e 3 com cliente com teste `APROVADO`;
- lacres violados em `SUSPEITA_VIOLACAO`;
- ativos livres movidos para a Beta;
- matriz de perfis e permissões;
- todos os 6 ajustes de estrutura;
- scripts aplicados pelo responsável no banco principal, com novo dump numa próxima entrega.

## 3. Achados da análise (antes dos scripts)

| Área | Achado |
| --- | --- |
| Estrutura | Regras RN01 a RN05, RN14, RN17 e RN21 respeitadas; 5 índices únicos parciais presentes; IDs sem valor padrão; índice redundante em `dispositivos`; sem índice composto de telemetria |
| Documento | Contagens de 9 tabelas ausentes; índices dados como "a confirmar"; valores aceitos incompletos |
| Massa | 5 cilindros reprovados circulando; 10 lacres violados ainda `INSTALADO`; todos os ativos numa organização; RBAC vazio; empresas reais com domínios reais num repositório público |
| Integração | `device_id` = `dispositivos.codigo` (mapeamento direto); FluxID sem chave de API, sem `message_id` em eventos e sem tabela de comandos; Oxide sem data de recebimento em `telemetry_queue` e `events` |

## 4. Validação pela IA

### 4.1 Execução dos scripts

| Passo | 1ª execução | 2ª execução |
| --- | --- | --- |
| 001: defaults, índices, colunas, `CHECK` | OK | OK, só avisos "já existe" |
| 002: empresas | 1 e 1 | 0 e 0 |
| 002: usuários | 1 e 1 | 0 e 0 |
| 002: testes com cliente → `APROVADO` | 3 | 0 |
| 002: cilindros → `MANUTENCAO` | 2 | 0 |
| 002: lacres → `SUSPEITA_VIOLACAO` | 10 | 0 |
| 002: cilindros, lacres, dispositivos → Beta | 20, 20, 20 | 0, 0, 0 |
| 002: perfil × permissão / usuário × perfil | 34 / 3 | 0 / 0 |

### 4.2 Coerência final

| Verificação | Resultado |
| --- | --- |
| Cilindro reprovado em `DISPONIVEL`, `COM_CLIENTE` ou `EM_TRANSITO` | 0 |
| Lacres com violação | 10 em `SUSPEITA_VIOLACAO` |
| Distribuição | Alfa 30 / Beta 20 em cilindros, lacres e dispositivos |
| Mistura de organizações (vínculos, entregas, alertas, custódias) | 0 em todos os casos |
| Permissões por perfil | FLUXID_MASTER 10, ORG_ADMIN 9, SUPERVISOR 7, OPERADOR 5, AUDITOR 2, VISUALIZADOR 1 |
| Usuários | USR-000001 FLUXID_MASTER; USR-000002 e USR-000003 ORG_ADMIN |
| Tabelas com `DEFAULT gen_random_uuid()` | 21 |
| Índices novos / removido | `idx_telemetria_dispositivo_data`, `uq_eventos_lacre_message_id`, `uq_dispositivos_api_key_hash` / `idx_dispositivos_hardware` ausente |

### 4.3 Regras novas (transação desfeita ao final)

| Teste | Resultado |
| --- | --- |
| Inserção sem `id` | UUID gerado |
| Hash SHA-256 de chave (64 caracteres); mesmo hash em outro dispositivo | Gravado; repetição rejeitada |
| Telemetria com latitude 91 / com -7.2 e -39.3 | Rejeitada / aceita |
| `eventos_lacre.message_id` repetido / evento sem `message_id` | Rejeitado / aceito |

## 5. Pendências

- Aplicar os scripts no banco principal (`Banco_FluxID.md`, seção 17.3) e conferir o novo dump.
- Decisões P1 a P8 do plano de integração, antes do Worker.
- Docker: habilitar a virtualização na BIOS para validações futuras com contêiner (opcional; o servidor temporário atende).

## 6. Validação humana (questionário)

Respondido por **Natã da Silva Baracho** em 06/10/2026.

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | Scripts numa pasta nova `sql/fluxid/`? | Sim |
| 2 | Aprova os 6 ajustes de estrutura do script 001? | Sim |
| 3 | Aprova o resultado da correção da massa (script 002)? | Sim |
| 4 | Validação no servidor temporário é suficiente? | Sim |
| 5 | Aprova o plano de integração, inclusive a chave por hash na Oxide quando o Worker existir? | Sim |
| 6 | Deixar as decisões P1 a P8 para antes do Worker? | Sim |
| 7 | Aprova o `Banco_FluxID.md` v3.1? | Sim |
| 8 | PR agora com scripts e documentos; aplicação no banco principal e novo dump depois? | Sim |
| 9 | Aprova a entrega E para relatório, documentos e GitHub? | Sim |

## 7. Conclusão

**Aprovado.** A estrutura do FluxID ganhou os ajustes necessários para a integração, a massa de testes ficou coerente com as regras de negócio e sem nomes de empresas reais, e o caminho Oxide → FluxID está documentado com as decisões que faltam. Os scripts foram comprovados em banco isolado e podem ser repetidos com segurança.

> **Validação aprovada por Natã da Silva Baracho em 06/10/2026.**

## 8. Recomendações

1. Aplicar os scripts no banco principal e enviar o novo `FluxID.sql` para conferência.
2. Seguir para a entrega D (catálogo de comandos), decidindo onde os comandos ficam (seção 3.4 do plano de integração).
3. Fechar P1 (data de recebimento na Oxide) cedo: afeta telemetria e eventos.
