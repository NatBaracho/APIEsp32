# Relatório de Teste — Teste em massa (500 lacres)

**Data:** 10/10/2026, 14:00
**Executado por:** IA (Claude Code, modelo Claude Opus 5.5), a pedido de Natã da Silva Baracho
**Branch:** `feat/oxide-enxuta` (PR #20), enviada ao GitHub depois da aprovação
**Base:** descrição do sistema principal (FluxID) enviada por Natã, `Contrato-Entrega-Supabase.md` e `Guia-Firmware-Lacre-IoT.md` 2.0
**Situação:** ✅ **aprovado por Natã da Silva Baracho em 10/10/2026** (seção 9)

---

## 1. Resumo

| Indicador | Valor |
| --- | --- |
| Verificações do teste em massa | **24 de 24** |
| Lacres simulados | 500 (um por cilindro), 40 enviando ao mesmo tempo |
| Pedidos dos lacres à API | 15.010, todos com a resposta esperada |
| Mensagens gravadas na Oxide | 14.327 |
| Mensagens que chegaram ao banco principal (recebedor de teste) | 14.327: nada perdido, nada duplicado |
| Erros `500` da API | 0 |
| Quedas provocadas no meio do teste | Banco principal (8 s), Worker (3 s) e API (5 s) |
| Suíte da API (`npm test`) depois do teste | 91 de 91 |
| `oxide.db` do projeto | **Intacto**: SHA-256 `0b6b2b2d…5c87f52` igual antes e depois |
| Banco principal (Supabase) de verdade | **Não acessado** |

**O que o teste mostrou:**

1. **Os dados estão corretos.** Nenhuma mensagem se perdeu ou duplicou, mesmo com as três quedas.
2. **A API ficou lenta sob esta carga.** Ela atendeu cerca de 40 pedidos por segundo, e 1 em cada 100 respostas levou mais de 5 segundos. Há uma mudança simples no banco que, num teste de comparação, deixou a API cerca de 6 vezes mais rápida (seção 6). Ela foi aplicada depois da sua aprovação (seção 9).

**Limite deste teste:** o Supabase de verdade não participou. O sistema principal foi simulado pelo recebedor de teste, como nos testes anteriores.

## 2. O que foi simulado

O cenário segue a descrição do sistema principal que você enviou (cilindros, clientes, unidades, geocercas, veículos e motoristas):

| Item | Quantidade |
| --- | --- |
| Organizações | 3 |
| Clientes | 18 |
| Unidades de cliente, cada uma com geocerca de 150 m | 36 |
| Veículos | 24 |
| Motoristas | 24 |
| Cilindros (série, QR Code, etiqueta NFC e gás) | 500 |
| Lacres (um por cilindro) | 500 |
| Dispositivos desativados | 10 |
| Dispositivos que o banco principal não conhece | 10 |

Cada lacre faz uma viagem do depósito da organização até a unidade de um cliente:

- Evento de partida, com o veículo e o motorista.
- 24 leituras no trajeto, com posição, bateria, sinal, satélites e estado do lacre.
- Chegada à unidade e mais 2 leituras parado (posição repetida).
- Abertura do lacre na entrega e evento de entrega concluída.

Situações sorteadas entre os lacres:

| Situação | Lacres ou pedidos |
| --- | --- |
| Lacre rompido no trajeto | 31 lacres |
| Bateria caindo abaixo de 15% | 82 lacres |
| Trecho com sinal fraco (abaixo de -105 dBm) | 73 lacres |
| Trecho sem sinal de GPS (`gps_ok: false`, última posição) | parte dos lacres, com 43 alertas enviados pelo próprio lacre |
| Mesma mensagem enviada duas vezes | 87 pedidos |
| Mensagem sem bateria, sem posição ou sem tipo de evento | 201 pedidos |
| Chave que não existe | 18 pedidos |
| Chave de outro lacre | 25 pedidos |
| Comando de válvula criado no sistema principal | 92 lacres |

API e Worker rodaram em **processos separados**, como em produção. O cadastro dos lacres veio do banco principal (só o hash da chave).

## 3. Quedas provocadas

| Momento | O que foi feito | Resultado |
| --- | --- | --- |
| 100,8 s | Banco principal fora do ar por 8 s | A fila guardou tudo e nenhuma tentativa foi gasta |
| 190,6 s | Worker derrubado e religado depois de 3 s | O envio continuou de onde parou |
| 277,9 s | API derrubada e religada depois de 5 s | Os lacres ficaram sem conexão 430 vezes, tentaram de novo com o mesmo `message_id` e nada duplicou |

## 4. Resultados

### 4.1 Respostas da API

| Resposta | Significado | Previsto | Conferido |
| --- | --- | --- | --- |
| `202` | Leitura ou evento recebido | 13.537 | ✅ |
| `200` | Posição repetida: só a data e a hora atualizadas | 1.099 | ✅ |
| `201` | Alerta do lacre registrado | 43 | ✅ |
| `409` | Mensagem duplicada | 87 | ✅ |
| `400` | Mensagem incompleta | 201 | ✅ |
| `401` | Chave que não existe | 18 | ✅ |
| `403` | Chave de outro lacre | 25 | ✅ |

Os 15.010 pedidos receberam a resposta esperada. Os 10 dispositivos desativados receberam `403` e os 10 desconhecidos receberam `401`.

### 4.2 O que ficou na Oxide

| Tipo | Previsto | Gravado |
| --- | --- | --- |
| Leituras | 12.037 | 12.037 ✅ |
| Eventos | 1.500 | 1.500 ✅ |
| Alertas (43 do lacre + 655 automáticos) | 698 | 698 ✅ |
| Confirmações de comando | 92 | 92 ✅ |
| **Total** | **14.327** | **14.327** |

| Alerta automático | Previsto | Gravado |
| --- | --- | --- |
| `BATERIA_BAIXA` | 82 | 82 ✅ |
| `GSM_SINAL_FRACO` | 73 | 73 ✅ |
| `LACRE_VIOLADO` | 31 | 31 ✅ |
| `LACRE_ABERTO_SEM_AUTORIZACAO` | 469 | 469 ✅ |

- Fila no fim: 14.327 mensagens `SYNCED`; nenhuma pendente, com erro ou parada.
- Banco íntegro depois da carga e das quedas; arquivo com 8,2 MB.
- Nenhuma chave em texto na Oxide.

### 4.3 O que chegou ao banco principal (recebedor de teste)

| Conferência | Resultado |
| --- | --- |
| Mesma quantidade dos dois lados | 14.327 e 14.327 ✅ |
| Toda mensagem aceita de cada lacre chegou | 13.580 de 13.580 ✅ |
| Leitura da chegada reenviada com a data e a hora novas (posição repetida) | 500 de 500 lacres ✅ |
| Toda mensagem com posição, bateria e `gps_ok` | 0 sem ✅ |
| Comandos confirmados | 92 de 92 ✅ |
| Chegada à unidade do cliente identificada pela geocerca | 500 de 500 cilindros ✅ |
| Cilindros com lacre rompido identificados | 31 de 31 ✅ |

As duas últimas linhas mostram que, com o que a API entrega, o sistema principal consegue aplicar as regras dele (geocerca e violação).

| Organização | Cilindros | Mensagens |
| --- | --- | --- |
| Organização A | 167 | 4.795 |
| Organização B | 167 | 4.773 |
| Organização C | 166 | 4.759 |

## 5. Desempenho

| Medida | Valor |
| --- | --- |
| Duração do envio | 390,6 s (cerca de 6 minutos e meio) |
| Pedidos atendidos | 40 por segundo |
| Metade das respostas em até | 474 ms |
| 95% das respostas em até | 2.936 ms |
| 99% das respostas em até | 5.092 ms |
| Resposta mais lenta | 7.258 ms |

Com 40 lacres enviando sem pausa, a API atende um pedido por vez e cada gravação espera o disco. Os pedidos formam fila e a resposta demora.

Para comparar com o uso real: 40 pedidos por segundo equivalem a cerca de 2.400 lacres enviando uma leitura por minuto. Este número é uma conta minha a partir do teste, e não uma medida com lacres reais.

## 6. Comparação: modo de gravação do banco

Fiz uma experiência com 150 lacres, mudando só o modo de gravação do SQLite para WAL (o banco anota as mudanças num arquivo ao lado e não trava a leitura enquanto grava). **A mudança foi desfeita depois da medida; o código não ficou com ela.**

| Medida (150 lacres) | Como está hoje | Com WAL |
| --- | --- | --- |
| Verificações | 24 de 24 | 24 de 24 |
| Duração | 88,6 s | 15,1 s |
| Pedidos por segundo | 53 | 313 |
| Metade das respostas em até | 347 ms | 51 ms |
| 99% das respostas em até | 4.310 ms | 146 ms |
| Resposta mais lenta | 8.029 ms | 214 ms |

O que muda se for adotado:

- Aparecem dois arquivos ao lado do banco: `oxide.db-wal` e `oxide.db-shm`. Eles já estão no `.gitignore`.
- O backup (`npm run backup`) continua funcionando: ele usa a cópia própria do SQLite.
- **Atenção:** a pasta do projeto fica no OneDrive. Com WAL, copiar só o `oxide.db` à mão, com a API ligada, pode levar uma cópia incompleta. O certo passa a ser sempre `npm run backup`.

## 7. Como repetir

```
npm run simular:massa
```

Ajustes por variável de ambiente: `MASSA_LACRES` (500), `MASSA_PONTOS` (24), `MASSA_PARALELO` (40), `MASSA_PORTA` (3198) e `MASSA_SEMENTE`. O teste roda numa pasta temporária. Com os valores padrão levou de 6 a 7 minutos nesta rodada e menos de 1 minuto depois do modo WAL (seção 9).

Arquivo novo: `src/simulador/massa.ts`. Nenhuma regra da API foi alterada nesta rodada.

## 8. Questionário de validação (responda sim ou não)

1. O cenário simulado (seção 2) representa o que você queria testar?
2. Os resultados da seção 4 estão de acordo com o que você espera?
3. Posso adotar o modo WAL no banco, para a API ficar mais rápida (seção 6)?
4. Aprova as correções do relatório anterior (`Relatorio-de-Teste-2026-10-10-13h45.md`): migração, cópia de segurança e gravação ao mesmo tempo?
5. Posso atualizar os documentos e enviar tudo ao GitHub, no PR #20?

## 9. Validação e modo WAL adotado (10/10/2026)

Natã da Silva Baracho respondeu **sim** às cinco perguntas: **aprovado por Natã da Silva Baracho em 10/10/2026**.

Com a aprovação, o modo WAL foi adotado (`src/database/connection.ts`), mantendo a gravação garantida em disco a cada mensagem. Dois ajustes vieram junto:

- `npm run backup`: a cópia sai num arquivo só, sem os arquivos `-wal` e `-shm` ao lado.
- `npm run retencao -- --confirmar`: depois de compactar, o espaço é devolvido ao arquivo principal.

O teste em massa completo foi repetido com o modo WAL:

| Medida (500 lacres, 15.010 pedidos) | Antes | Com WAL |
| --- | --- | --- |
| Verificações | 24 de 24 | **24 de 24** |
| Duração do envio | 390,6 s | 27,0 s |
| Pedidos por segundo | 40 | 588 |
| Metade das respostas em até | 474 ms | 36 ms |
| 95% das respostas em até | 2.936 ms | 78 ms |
| 99% das respostas em até | 5.092 ms | 121 ms |
| Resposta mais lenta | 7.258 ms | 220 ms |
| Mensagens na Oxide e no banco principal de teste | 14.327 e 14.327 | 14.327 e 14.327 |
| Erros `500` | 0 | 0 |

Na repetição, as três quedas aconteceram mais perto uma da outra (o envio todo levou 27 segundos), e os lacres ficaram sem conexão 319 vezes; nada se perdeu e nada duplicou.

Demais testes depois da mudança: banco direto no SQLite 64 de 64; suíte 92 de 92 (um caso novo confere o modo WAL); simulador 23 de 23; `oxide.db` do projeto com o mesmo checksum.
