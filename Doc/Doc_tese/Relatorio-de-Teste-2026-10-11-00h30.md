# Relatório de Teste — Segurança, operação e os testes que faltavam

**Data:** 11/10/2026, 00:30
**Executado por:** IA (Claude Code, modelo Claude Opus 5.5), a pedido de Natã da Silva Baracho
**Branch:** `feat/seguranca-e-operacao`, local, a partir da `main` `8e176c3` (merge do PR #24). **Ainda não enviada ao GitHub**
**Base:** pedido de Natã em 10/10/2026: levar cada área do projeto à nota máxima e reavaliar se o banco local precisa de três tabelas
**Situação:** ⏳ aguardando a validação de Natã da Silva Baracho (seção 9)

---

## 1. Resumo

| Teste | Resultado |
| --- | --- |
| Compilação (`npx tsc --noEmit`) | Sem erros |
| Suíte da API (`npm test`) | **135 de 135** (25 casos novos) |
| Desligamento forçado (`npm run simular:desligamento`, novo) | **10 de 10** |
| Simulador (`npm run simular`) | 26 de 26 |
| Teste em massa (`npm run simular:massa`) | 32 de 32 |
| Tabela `commands` (`npm run simular:comandos`) | 24 de 24 |
| Queda do banco principal por 10 minutos (`npm run simular:queda`) | 13 de 13 |
| `oxide.db` do projeto | Não participa dos testes (pastas temporárias) |
| Banco principal (Supabase) de verdade | **Não acessado** |

**O que mudou de mais importante:**

1. As rotas da equipe deixaram de ser abertas: agora pedem uma chave de administrador.
2. A Oxide não guarda mais a chave de nenhum lacre em texto, só o hash.
3. A API passou a gravar cada mensagem no disco antes de responder ao lacre. Isso corrigiu uma afirmação errada minha de 10/10/2026 e deixou a API mais lenta sob carga pesada (seção 5).

## 2. As tabelas do banco local, reavaliadas

Ficam as três. É o mínimo para a API funcionar com o banco principal fora do ar.

| Tabela | Por que não dá para tirar | Por que não dá para juntar |
| --- | --- | --- |
| `devices` | Sem ela, a API teria de perguntar ao banco principal a cada mensagem se a chave vale, e pararia quando ele caísse | Uma linha por lacre, atualizada a cada mensagem; a fila tem uma linha por mensagem |
| `mensagens` | É a fila: o que garante que nada se perde | Já junta leitura, evento, alerta, confirmação e ativação numa tabela só |
| `commands` | Sem ela, o lacre não teria de onde buscar o comando com o banco principal fora do ar | O comando vem do sistema para o lacre, com outro ciclo; na fila, tudo vai do lacre para o sistema |

As métricas, os limites e os avisos do vigia ficam na memória e em arquivos, sem tabela nova.

## 3. Segurança

### 3.1 O que foi feito

| Item | Antes | Agora |
| --- | --- | --- |
| Rotas da equipe (`/devices`, `/iot/messages`, `/sync`) | Abertas: qualquer pessoa na rede cadastrava um dispositivo e enviava dados como lacre | Exigem a chave de administrador (`X-Admin-Key`). Sem chave configurada, ficam fechadas (`503`) |
| Chave do lacre no cadastro de bancada | Guardada em texto no banco | Só o hash. Banco antigo é convertido ao ligar, e o lacre continua entrando com a mesma chave |
| Tentativas de adivinhar a chave | Sem limite | 60 erros por minuto por endereço; depois, `429` até a janela acabar |
| Lacre enviando demais | Sem limite | 120 mensagens por minuto; depois, `429` com o tempo de espera |
| Tamanho do pedido | 100 KB (padrão do componente) | 32 KB (`413` acima disso) |
| HTTPS | Não havia | Direto na API, com o certificado no `.env`, ou por proxy |
| Cabeçalhos de proteção | Não havia | Em toda resposta; a API não informa qual programa é |

### 3.2 Casos da suíte (grupo 14)

| Caso | Resultado |
| --- | --- |
| Rotas da equipe sem a chave de administrador → `401`, e nada é gravado (8 rotas) | ✅ |
| Chave de administrador errada → `401`; certa → a rota responde | ✅ |
| A chave do lacre não abre as rotas da equipe, e a de administrador não envia como lacre | ✅ |
| Sem chave de administrador configurada, ou curta demais → `503`; as rotas do lacre continuam funcionando | ✅ |
| `ROTAS_DA_EQUIPE_ABERTAS=true` abre as rotas sem chave, e o `/health` avisa | ✅ |
| Cadastro de bancada guarda só o hash; o texto da chave não fica em lugar nenhum do banco | ✅ |
| Nenhum dispositivo do banco tem chave em texto | ✅ |
| Banco de versão anterior: a chave em texto vira hash e o lacre continua entrando com a mesma chave | ✅ |
| Limite por dispositivo: `429` com o tempo de espera; outro lacre não é afetado | ✅ |
| Limite de chave errada: endereço bloqueado (`429`), inclusive com a chave certa, até a janela acabar | ✅ |
| Cabeçalhos de proteção em toda resposta | ✅ |
| Corpo maior que 32 KB → `413`, sem gravar | ✅ |
| Nenhuma chave aparece nas respostas de `/health` e de `/metrics` | ✅ |
| Swagger: rotas da equipe declaram a chave de administrador; rotas do lacre, a chave do dispositivo e o `429` | ✅ |
| HTTPS: com o certificado no `.env`, a API atende em HTTPS e não em HTTP | ✅ |

## 4. Operação

### 4.1 O que foi feito

- **`GET /metrics`** (com a chave de administrador): pedidos, respostas por classe, recusados por limite, tempo de resposta, fila com a idade da mensagem mais antiga, comandos pendentes, tamanho do banco e memória. Também no formato de texto do Prometheus.
- **Vigia** (`npm run vigia`): confere a cada minuto e avisa, quando o problema aparece e quando se resolve. Avisa na tela, no arquivo `oxide-alertas.log` e num endereço configurado (`VIGIA_WEBHOOK_URL`).
- **Serviço** (`npm run servico`): liga a API, o Worker e o vigia, religa o que parar e faz o backup diário.
- **Worker sem pausa na volta:** quando há fila acumulada, a rodada seguinte começa em seguida.

### 4.2 Casos da suíte (grupo 15)

| Caso | Resultado |
| --- | --- |
| `GET /metrics`: pedidos, respostas, tempos, fila e banco; as rotas aparecem sem o código dos dispositivos | ✅ |
| `GET /metrics?formato=prometheus`: o mesmo em texto | ✅ |
| A idade da mensagem mais antiga à espera aparece nas métricas | ✅ |
| Vigia: com tudo normal, não avisa nada | ✅ |
| Vigia: fila grande, fila atrasada e mensagem parada viram aviso na tela, no arquivo e no endereço configurado | ✅ |
| Vigia: API fora do ar, banco principal fora do ar e Worker parado viram aviso | ✅ |
| Serviço: liga a API e o Worker, religa a API derrubada e para quando pedem | ✅ |

### 4.3 Velocidade da volta depois de uma queda

Queda de 10 minutos, 600 lacres, uma leitura a cada 10 segundos, com a gravação garantida. Lote padrão de 100.

| Medida | Worker de 10/10/2026 | Worker de 11/10/2026 |
| --- | --- | --- |
| Mensagens por segundo na volta | 96 | 718 |
| Tempo para esvaziar cerca de 36.000 mensagens | cerca de 6 minutos (conta) | 0,8 minuto (medido) |

Nos 10 minutos da queda: 35.966 leituras aceitas, nenhuma recusada, metade das respostas em até 9 ms e a mais lenta em 493 ms.

## 5. Gravação garantida: um erro meu corrigido

Em 10/10/2026, ao adotar o modo WAL, eu escrevi que tinha mantido "a gravação garantida em disco a cada mensagem". **Isso estava errado.** O componente de banco usa, por padrão, um modo mais rápido no WAL, em que um corte de energia pode levar as mensagens do último instante. O banco não corrompe, mas uma mensagem já confirmada ao lacre podia se perder.

Agora a gravação garantida é o padrão. O modo rápido continua disponível (`GRAVACAO_GARANTIDA=false` no `.env`).

Medido no teste em massa (500 lacres, 40 enviando ao mesmo tempo, sem pausa):

| Medida | Garantida (padrão agora) | Rápida (o que valia em 10/10) |
| --- | --- | --- |
| Verificações | 32 de 32 | 32 de 32 |
| Pedidos por segundo | 226 | 607 |
| Metade das respostas em até | 99 ms | 37 ms |
| 95% das respostas em até | 536 ms | 82 ms |
| Resposta mais lenta | 3.046 ms | 328 ms |

- **Os números de velocidade dos relatórios de 10/10/2026** (cerca de 600 pedidos por segundo no teste em massa; os tempos de resposta do teste de 1 hora) foram medidos no modo rápido.
- **Para o uso previsto, o modo garantido sobra:** 600 lacres enviando uma leitura por minuto são 10 pedidos por segundo.
- **O custo aparece só sob carga pesada:** com 40 lacres enviando sem pausa, 1 em cada 100 respostas passa de 1 segundo.

## 6. Os testes que faltavam

### 6.1 Desligamento forçado (`npm run simular:desligamento`)

30 lacres enviando sem parar. A API é derrubada à força 20 vezes e o Worker, 10. Depois de cada queda, o banco é conferido.

| Conferência | Resultado |
| --- | --- |
| A API religou depois de todas as quedas | 20 de 20 ✅ |
| O banco abriu íntegro depois de cada queda | 20 de 20 ✅ |
| Toda mensagem confirmada ao lacre está na Oxide | 9.042 confirmadas, 0 perdidas ✅ |
| Nenhuma mensagem duplicada | 9.042 linhas, 9.042 códigos ✅ |
| Fila esvaziada | Sim ✅ |
| Toda mensagem confirmada chegou ao banco principal de teste | 0 faltando ✅ |
| Mesma quantidade dos dois lados | 9.042 e 9.042 ✅ |
| Banco íntegro no fim, ainda em modo WAL | Sim ✅ |

Os lacres ficaram sem resposta 11.757 vezes e insistiram com a mesma mensagem.

**Limite deste teste:** os programas são encerrados à força, com o sistema operacional de pé. **Corte de energia de verdade não foi testado**; a gravação garantida existe para esse caso, mas só um teste com o equipamento prova.

### 6.2 Mesma mensagem no mesmo instante (grupo 16 da suíte)

| Caso | Resultado |
| --- | --- |
| 20 envios iguais ao mesmo tempo: 1 aceito, 19 com `409`, uma linha só | ✅ |
| 20 alertas iguais e 20 ativações iguais ao mesmo tempo: um de cada, e um identificador só | ✅ |
| Dois lacres diferentes com o mesmo `message_id` ao mesmo tempo: só um grava | ✅ |

## 7. Organização do código

- Pasta `src/Middleware/` renomeada para `src/middlewares/`, e `Errohandler.ts` para `errorHandler.ts`.
- `package.json`: nome `api-do-lacre`, versão `2.1.0` e descrição.
- Novos: `src/middlewares/adminMiddleware.ts`, `src/middlewares/limite.ts`, `src/metricas.ts`, `src/manutencao/vigia.ts`, `src/manutencao/servico.ts` e `src/simulador/desligamento.ts`.

**Não feito:** uniformizar os nomes em português e inglês dentro do código. Hoje o contrato com o lacre e as colunas do banco estão em inglês, e os nomes internos, em português. Trocar isso mexe em quase todos os arquivos, sem mudar o comportamento; preferi não arriscar nesta entrega.

## 8. Pontos de atenção

- **A chave de administrador precisa ser criada por você.** Sem `ADMIN_API_KEY` no `.env`, as rotas da equipe respondem `503`. A coleção do Thunder Client e o Swagger passam a pedir essa chave nas consultas.
- **Uma chave de administrador só.** Não há usuários nem perfis; quem tem a chave pode tudo nas rotas da equipe.
- **Limites na memória.** Zeram quando a API reinicia e valem para uma API só.
- **Lacres atrás do mesmo endereço dividem o limite de chaves erradas.** Um lacre com a chave errada, insistindo sem parar, pode bloquear os outros por até 1 minuto. O guia do firmware já manda não insistir em `401` e `403`.
- **O vigia só avisa em algum lugar útil se você configurar o endereço** (`VIGIA_WEBHOOK_URL`). Sem ele, o aviso fica na tela e no arquivo.
- **O histórico do Git continua com as chaves de teste antigas em texto.** O banco atual passa a ter só o hash, mas as versões antigas do `oxide.db` estão no repositório público.
- **Um engano meu durante os testes:** numa das rodadas do teste de queda eu apaguei, antes da hora, um arquivo da pasta do teste, e uma das 13 conferências falhou por isso. Repeti o teste sem mexer em nada: 13 de 13.
- **Não testado:** corte de energia de verdade, o Supabase e o lacre de verdade.

## 9. Questionário de validação (responda sim ou não)

1. Aprova a chave de administrador nas rotas da equipe, fechadas por padrão?
2. Aprova a chave do lacre guardada só em hash, inclusive a conversão do seu `oxide.db`?
3. Aprova os limites (120 mensagens por minuto por lacre; 60 chaves erradas por minuto por endereço)?
4. Aprova a gravação garantida como padrão, mesmo com a API mais lenta sob carga pesada (226 em vez de 607 pedidos por segundo)?
5. Aprova o Worker sem pausa quando há fila acumulada?
6. Aprova as métricas, o vigia e o serviço que religa sozinho?
7. Concorda em manter as três tabelas?
8. Posso criar a chave de administrador no seu `.env`? Ela fica só no arquivo; eu não a mostro na conversa.
9. Posso converter o `oxide.db` do projeto, atualizar a coleção do Thunder Client e enviar tudo ao GitHub, num PR novo?
