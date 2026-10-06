# Relatório de Teste — API Oxide (entrega D: catálogo de comandos e tipos de erro)

**Data/hora:** 06/10/2026, publicado às 20:35; execução do Roteiro das 20:13:01 às 20:13:26
**Executor:** IA (Claude Code, modelo Claude Opus 5.5), com validação humana de Natã da Silva Baracho
**Commit/versão:** branch `feat/catalogo-comandos`, a partir da `main` `3971f21` (merge do PR #6)
**Ambiente:** Windows 11 Pro, Node.js v24.21.0, npm 11.19.0, Git Bash 5.3, porta 3000, banco **`oxide.db` real** (com backup e restauração)
**Base:** `PlanoDeTeste.md` v1.6 e `RoteiroDeTeste.md` v1.6
**Relatório anterior:** [20h00 (entrega E)](Relatorio-de-Teste-2026-10-06-20h00.md)

## 1. Resumo

| Indicador | Valor |
| --- | --- |
| Compilação (`npx tsc --noEmit`) | PASSOU |
| Suíte automatizada | 57/57 (dois casos novos) |
| Migração da tabela `commands` antiga | PASSOU (testada com 4 comandos antigos) |
| Respostas HTTP dos casos manuais | Todas iguais ao esperado |
| Verificações do banco (seção 6, incluindo o novo BD-18) | Todas conforme |
| FALHOU | 0 |
| ACHADO | 0 |
| Banco restaurado | Sim, idêntico ao original (SHA-256 `3454c8d4…` antes e depois) |
| Validação humana | **Aprovada por Natã da Silva Baracho** |

## 2. Escopo da entrega

| # | Decisão |
| --- | --- |
| 1 | Catálogo de comandos: `TRAVAR_VALVULA` e `DESTRAVAR_VALVULA` |
| 2 | Regra no banco: comando `PENDENTE` só com tipo do catálogo; histórico pode guardar tipos antigos |
| 3 | Status do comando só `PENDENTE`, `EXECUTADO` ou `ERRO` |
| 4 | Migração: `LOCK_VALVE` → `TRAVAR_VALVULA`; `UNLOCK_VALVE` → `DESTRAVAR_VALVULA`; pendente desconhecido → `ERRO` "tipo de comando descontinuado" |
| 5 | Sem rota de criação de comandos (evita destravar válvula por rota aberta) |
| 6 | Comandos só na Oxide; tabela no FluxID decidida na fase do Worker |
| 7 | Novo catálogo `Doc/Tipos-de-Erro.md` (v1.0, 27 códigos), a pedido do responsável |

Regras de operação definidas pelo responsável e registradas no catálogo:
- **No destino:** o lacre não sai de um raio de 10 m do destino final.
- **Em rota:** o cilindro não sai da rota sem desvio justificado antes ou programado. Se sair, o alerta vai para o motorista e o gestor, o motorista justifica e **só o gestor libera**.
- **Em trânsito:** o lacre fica sempre fechado; qualquer abertura é irregular (novo código `LACRE_ABERTO_EM_TRANSITO`).
- O `alert_type` da Oxide passará a usar os códigos em português, numa entrega própria com transição.

## 3. Validação pela IA

### 3.1 Compilação, suíte e migração

- `npx tsc --noEmit`: sem erros.
- `npm test`: 57/57 numa cópia do banco do GitHub e no banco real (Roteiro).
- Testes novos: o banco rejeita comando pendente com tipo fora do catálogo (`LIGAR_SIRENE`); aceita histórico com tipo antigo; rejeita status `FALHOU`.
- Migração, numa cópia do banco com quatro comandos antigos:

| Comando antigo | Depois da migração |
| --- | --- |
| `LOCK_VALVE` pendente | `TRAVAR_VALVULA`, continua pendente |
| `UNLOCK_VALVE` executado | `DESTRAVAR_VALVULA`, histórico preservado |
| `REINICIAR` pendente | `ERRO` "tipo de comando descontinuado", tipo original mantido |
| `ABRIR_TAMPA` com erro | Preservado, inclusive "motor travado" |
| Novo pendente `REINICIAR` | Rejeitado pelo banco |

### 3.2 Roteiro v1.6 no banco real

| ID | Esperado | Obtido | Resultado |
| --- | --- | --- | --- |
| CMD-12 | `200`, `CMD-RT-001` (`TRAVAR_VALVULA`) antes de `CMD-RT-002` (`DESTRAVAR_VALVULA`) | Conforme | PASSOU |
| CMD-09 / CMD-10 / CMD-11 / CMD-07 / CMD-13 | `200` / `400` / `404` / `409` / `404` | Conforme | PASSOU |
| BD-18 | Pendente `LIGAR_SIRENE` rejeitado | `CHECK constraint failed` | PASSOU |

Demais casos (dispositivos, autenticação, telemetria, eventos, alertas, segurança e banco): mesmos resultados do [relatório das 19h28](Relatorio-de-Teste-2026-10-06-19h28.md), sem regressão. Limpeza com 0 registros `DSP-TEST%`; inicialização repetida sem erro.

## 4. Defeitos e achados

Nenhum. Pendências funcionais registradas no Checklist: comandos automáticos, `alert_type` em português e fluxo de saída de rota (rota planejada, justificativa e liberação pelo gestor).

## 5. Casos não executados

| ID | Motivo |
| --- | --- |
| ASC-*, HIS-*, GEO-*, AUT-C*, SYN-*, FLX-* (exceto FLX-18 a FLX-22) | Funcionalidades ainda não implementadas |
| SEG-09 a SEG-11 | Hardening futuro |
| ESP-03, ESP-05, ESP-06, OPE-* | Dependem de hardware ou da fase de operação |

## 6. Validação humana (questionário)

Respondido por **Natã da Silva Baracho** em 06/10/2026.

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | Catálogo só com `TRAVAR_VALVULA` e `DESTRAVAR_VALVULA`? | Sim |
| 2 | Pendente só com tipo do catálogo; histórico com tipos antigos? | Sim |
| 3 | Status só `PENDENTE`, `EXECUTADO`, `ERRO` (rejeita `FALHOU`)? | Sim |
| 4 | Migração dos comandos antigos? | Sim |
| 5 | Sem rota de criação de comandos por enquanto? | Sim |
| 6 | Comandos só na Oxide; FluxID decidido no Worker? | Sim |
| 7 | Testes da IA suficientes? | Sim |
| 8 | Aprova Plano v1.6 e Roteiro v1.6? | Sim |
| 9 | Os códigos do catálogo de erros cobrem o necessário? | Sim |
| 10 | Códigos em português, maiúsculas e `_`? | Sim |
| 11 | Catálogo primeiro como referência, implementado aos poucos? | Sim |
| 12 | Limites a definir | Definidos: raio de 10 m do destino; sem saída de rota sem justificativa prévia ou programação (alerta ao motorista e ao gestor, justificativa do motorista, liberação só pelo gestor); lacre fechado em trânsito |
| 13 | `alert_type` da Oxide em português ou inglês? | Português |
| 14 | Aprova a entrega D para relatório, documentos e GitHub? | Sim |

## 7. Conclusão

**Aprovado.** Os comandos que o ESP32 executa passaram a ter uma lista fechada, protegida no próprio banco, sem perder o histórico e sem abrir uma rota que permitisse destravar válvulas. O projeto ganhou um catálogo único de tipos de erro, com as regras de destino, rota e trânsito definidas pelo responsável.

> **Validação aprovada por Natã da Silva Baracho em 06/10/2026.**

## 8. Recomendações

1. Ajustar o firmware para reconhecer exatamente `TRAVAR_VALVULA` e `DESTRAVAR_VALVULA`.
2. Seguir para a entrega B (associação dispositivo → lacre → cilindro), base para `LACRE_SEM_CILINDRO`, `CILINDRO_SEM_LACRE` e `LACRE_ABERTO_EM_TRANSITO`.
3. Planejar a entrega do `alert_type` em português, com transição para os nomes antigos.
4. Definir com o programador do ESP32 os limites ainda abertos do catálogo (GPS sem sinal, sem comunicação, bateria, GSM, margem do GPS na rota).
