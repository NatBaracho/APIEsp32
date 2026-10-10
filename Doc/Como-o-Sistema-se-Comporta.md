# Como o sistema se comporta

Explicação em linguagem simples do que a API do lacre faz em cada situação. Serve para quem precisa entender o comportamento sem ler o código.

Para os detalhes técnicos, veja [Desenvolvimento.md](Desenvolvimento.md) (rotas e campos), [Oxidedb.md](Oxidedb.md) (banco local), [Contrato-Entrega-Supabase.md](Contrato-Entrega-Supabase.md) (envio ao banco principal) e [Guia-Firmware-Lacre-IoT.md](Guia-Firmware-Lacre-IoT.md) (lacre).

**Versão:** 1.2, de 10/10/2026.

---

## 1. As partes e o papel de cada uma

| Parte | O que é | O que faz |
| --- | --- | --- |
| Lacre | O equipamento (ESP32) preso ao cilindro | Avisa que está ativo; envia leituras, eventos e alertas; busca e confirma comandos |
| API | O programa em `src/` | Recebe as mensagens do lacre, confere a chave, valida e guarda na fila |
| Oxide | O arquivo `oxide.db` | Fila local: guarda as mensagens até chegarem ao banco principal |
| Worker | Outro programa (`npm run worker`) | Leva a fila ao banco principal e traz de lá os dispositivos, os vínculos e os comandos |
| Banco principal | O Supabase do sistema FluxID | Guarda tudo de forma definitiva; tem o cadastro de lacres, cilindros, clientes e vínculos |

A API **não atende o frontend**. As telas falam só com o banco principal.

## 2. O caminho de uma mensagem

1. O lacre envia a mensagem à API, com a chave dele.
2. A API confere a chave e os campos obrigatórios.
3. A API grava a mensagem na Oxide, como "pronta para enviar", e responde ao lacre.
4. O Worker pega as mensagens prontas e entrega ao banco principal, em lotes.
5. O banco principal responde mensagem por mensagem. As gravadas são marcadas como enviadas na Oxide.

O lacre recebe a resposta no passo 3. Ele não espera o banco principal.

## 3. O que o lacre envia

| Tipo | Para que serve | Rota | Campo que diz o que é |
| --- | --- | --- | --- |
| Leitura (telemetria) | Posição, bateria, sinal e estado do lacre | `POST /api/v1/iot/telemetries` | — |
| Evento | Dizer que tipo de situação o lacre está apresentando (ligou, o lacre mudou de estado, entrega concluída) | `POST /api/v1/iot/events` | `event_type` |
| Alerta | Avisar de mau funcionamento ou problema | `POST /api/v1/iot/alerts` | `alert_type`, do catálogo em [Tipos-de-Erro.md](Tipos-de-Erro.md) |
| Ativação | Avisar que o lacre foi ativado ou desativado | `POST /api/v1/iot/activations` | `status`: `ATIVO` ou `INATIVO` |

Toda mensagem precisa ter `device_id`, `latitude`, `longitude` e `battery_percent`. Sem um deles, a API recusa (`400`).

## 4. Onde cada coisa fica guardada

A Oxide tem três tabelas:

| Tabela | O que guarda |
| --- | --- |
| `devices` | Quem pode enviar (o hash da chave), o último estado conhecido de cada lacre, a ativação (identificador do lacre) e o vínculo atual (cilindro e cliente) |
| `mensagens` | A fila única: leituras, eventos, alertas, confirmações de comando e avisos de ativação |
| `commands` | Os comandos de válvula que o lacre busca e confirma |

Na tabela `mensagens`, a coluna `tipo` separa o que é cada linha: `TELEMETRIA`, `EVENTO`, `ALERTA`, `CONFIRMACAO_COMANDO` ou `ATIVACAO`.

O modelo anterior tinha mais tabelas. Para onde foi cada uma:

| Tabela antiga | Onde está agora |
| --- | --- |
| `telemetry_queue`, `events` e `alerts` | Dentro de `mensagens`, separadas pela coluna `tipo` |
| `seals`, `cylinders`, `seal_assignments` e `cylinder_assignments` | O cadastro e o histórico ficam só no banco principal. A Oxide guarda, em `devices`, o vínculo que vale agora |
| `sync_logs` | A última rodada do Worker fica no arquivo `oxide-worker.json` |
| `status` | Não era mais usada |

## 5. Como o sistema sabe de qual cilindro e de qual cliente é a mensagem

O lacre não sabe em qual cilindro está: ele envia só o `device_id`. Quem liga o lacre ao cilindro e ao cliente é o sistema, e a API guarda essa ligação.

### 5.1 O caminho

1. **O lacre avisa que está ativo.** Ao ligar, ele envia `POST /api/v1/iot/activations` com `status: "ATIVO"`.
2. **A API gera o identificador do lacre.** É um código como `LCR-JKFL6VBR`, criado na primeira ativação. Ele nunca muda: ligar de novo devolve o mesmo.
3. **A API avisa o sistema.** O aviso vai pela fila, como mensagem do tipo `ATIVACAO`. Assim o sistema sabe quais lacres estão ativos.
4. **No sistema, alguém vincula o cilindro e o cliente**, usando o identificador do lacre.
5. **O vínculo é salvo na Oxide.** O Worker traz a ordem de vinculação e grava na tabela `devices`.
6. **Cada mensagem do lacre passa a sair com o identificador, o cilindro e o cliente.**

O Worker busca os vínculos a cada 5 minutos. Entre alguém vincular no sistema e a API saber, podem passar até 5 minutos; nesse tempo as mensagens saem só com o identificador do lacre.

### 5.2 Como o vínculo termina

| Quem encerra | O que acontece |
| --- | --- |
| O sistema | Manda o vínculo vazio. A Oxide apaga o cilindro e o cliente; o lacre continua ativo |
| O lacre | Avisa `status: "INATIVO"`. O aviso sai ainda com o cilindro e o cliente; em seguida o vínculo acaba |

Um vínculo encerrado pelo lacre não volta sozinho. Para usar de novo, o lacre é ativado outra vez (com o mesmo identificador) e o sistema manda um vínculo novo.

Se o lacre desligar sem avisar (bateria acabou, queda), ele continua como ativo e vinculado até o sistema desfazer.

### 5.3 Situações

| Situação | O que a API faz |
| --- | --- |
| Lacre ativo e vinculado | Toda mensagem sai com o identificador, o cilindro e o cliente |
| Lacre ativo, ainda sem cilindro, até 10 minutos depois da ativação | Aceita a mensagem, sem alerta: é o tempo de alguém vincular |
| Lacre ativo, sem cilindro, depois de 10 minutos | Aceita a mensagem e abre o alerta `LACRE_SEM_CILINDRO`, uma vez |
| Lacre que nunca avisou a ativação | Aceita a mensagem como antes, sem identificador |
| O sistema troca o cilindro | As mensagens novas saem com o cilindro novo; as já gravadas ficam com o antigo |
| O sistema manda vínculo para lacre que não está ativo | Ignora e registra um aviso |
| O sistema manda vínculo com um identificador que a API não gerou | Ignora e registra um aviso |

A API **nunca recusa** uma mensagem por falta de vínculo, para não perder a posição de um lacre em campo.

### 5.4 O que continua sendo do sistema principal

- O cadastro de lacres, cilindros e clientes, e o histórico dos vínculos.
- As regras que dependem do cadastro: rota, geocerca, tempo sem comunicar e autorização para abrir o lacre.
- Se o vínculo de uma mensagem e o cadastro do sistema divergirem, vale o do sistema.

**Situação em 10/10/2026:** o lado da API está pronto e testado com um recebedor de teste. O sistema de verdade ainda não trata a mensagem `ATIVACAO` nem devolve o vínculo, e o firmware ainda não envia o aviso de ativação.

## 6. O que a API responde ao lacre

| Resposta | Significado | O que o lacre faz |
| --- | --- | --- |
| `202` | Leitura, evento ou aviso de ativação recebido | Segue em frente |
| `201` | Alerta registrado | Segue em frente |
| `200` | Posição repetida: só a data e a hora foram atualizadas | Segue em frente |
| `409` | A API já tinha essa mensagem | Dá a mensagem por entregue; não reenvia |
| `400` | Mensagem incompleta ou com valor inválido | Não reenvia igual; é erro do firmware |
| `401` | Sem chave ou chave que não existe | Não reenvia; conferir a chave |
| `403` | Dispositivo desativado ou chave de outro dispositivo | Não reenvia |
| `500` ou sem resposta | Falha da API ou da rede | Tenta de novo, com o **mesmo** `message_id` |

## 7. Situações do dia a dia

### 7.1 O lacre envia a mesma mensagem duas vezes

Cada mensagem tem um `message_id` (no alerta, `alert_id`). Se a API já tem esse identificador, responde `409` e não grava de novo. Isso permite ao lacre tentar de novo sem medo de duplicar.

### 7.2 O lacre está parado (mesma posição)

Se a leitura traz a mesma posição e o mesmo estado da anterior, a API não cria outra linha: atualiza só a data e a hora da leitura anterior (`last_seen_at`) e responde `200`. Se a leitura anterior já tinha sido enviada, ela volta para a fila e o banco principal recebe a data nova.

### 7.3 O lacre perde o sinal de GPS

O lacre envia a última posição conhecida com `gps_ok: false`. A API aceita e guarda, e o banco principal sabe que aquela posição não é nova.

### 7.4 Alertas que a API abre sozinha

A API abre cinco alertas sozinha, **só na mudança**, para não repetir a cada leitura:

| Alerta | Quando abre |
| --- | --- |
| `BATERIA_BAIXA` | A bateria cai abaixo de 15% |
| `GSM_SINAL_FRACO` | O sinal cai abaixo de -105 dBm |
| `LACRE_VIOLADO` | O lacre informa que foi rompido |
| `LACRE_ABERTO_SEM_AUTORIZACAO` | O lacre informa que foi aberto; o sistema principal confere se havia autorização |
| `LACRE_SEM_CILINDRO` | O lacre está ativo e continua enviando sem cilindro vinculado, 10 minutos depois da ativação |

Os limites podem ser mudados no arquivo `.env` (`REGRA_BATERIA_MINIMA`, `REGRA_SINAL_MINIMO_DBM` e `REGRA_MINUTOS_SEM_VINCULO`).

### 7.5 Comandos de válvula

1. O comando (travar ou destravar a válvula) nasce no sistema principal.
2. O Worker traz o comando para a Oxide.
3. O lacre pergunta à API se há comando para ele (`GET /api/v1/iot/commands/{device_id}`).
4. O lacre executa e confirma (`POST /api/v1/iot/commands/confirm`), com `EXECUTADO` ou `ERRO`.
5. A confirmação entra na fila e o Worker a leva ao sistema principal.

Confirmar o mesmo comando duas vezes devolve `409`.

### 7.6 Cadastro e chave do lacre

O cadastro dos dispositivos vem do banco principal: o Worker traz a lista com o **hash** da chave de cada um. A chave em texto não fica guardada na Oxide. A API calcula o hash da chave que o lacre envia e compara.

Um dispositivo desativado no sistema principal passa a receber `403` depois da próxima atualização do cadastro (a cada 5 minutos, por padrão).

## 8. Quando alguma coisa cai

### 8.1 O banco principal (Supabase) cai

- **Lacre:** não percebe. Ele fala só com a API, que continua respondendo.
- **API:** continua recebendo, validando e gravando na Oxide. Os alertas automáticos continuam sendo abertos.
- **Worker:** tenta enviar, não consegue e tenta de novo na rodada seguinte (a cada 10 segundos, por padrão).
- **Tentativas:** banco principal fora do ar **não gasta** tentativa da mensagem. Ela pode esperar o tempo que for.
- **Monitoramento:** `GET /health` responde `503` com `DEGRADADO`; `GET /api/v1/sync/status` mostra a fila crescendo.

Quando ele volta, o Worker envia a fila em lotes, na ordem de chegada. Se uma mensagem já tinha sido gravada e a resposta se perdeu, o banco principal responde "repetida" e ela não duplica.

Enquanto ele está fora:

- comandos novos não chegam ao lacre (os que já estavam na Oxide continuam disponíveis);
- dispositivos novos, chaves trocadas e vínculos novos não chegam à Oxide (os que já estavam lá continuam valendo);
- o sistema principal não vê posições nem alertas até a volta;
- o arquivo da Oxide cresce. A limpeza só apaga o que já foi enviado.

### 8.2 O Worker cai

A API continua recebendo e a fila cresce. Quando o Worker volta, as mensagens que estavam "sendo enviadas" no momento da queda voltam para a fila, sem gastar tentativa, e o envio continua.

### 8.3 A API cai

O lacre fica sem resposta. Ele deve guardar a mensagem e tentar de novo com o **mesmo** `message_id`. Se a API já tinha gravado antes de cair, ela responde `409` na nova tentativa e nada duplica. O que já estava na Oxide continua lá.

### 8.4 O banco principal recusa uma mensagem

É diferente de estar fora do ar. Se o banco principal está no ar e **recusa** uma mensagem (um dado que ele não aceita), ela fica **parada** na fila. Tentar de novo não mudaria o resultado; alguém precisa olhar (`GET /api/v1/sync/problems`) e decidir.

### 8.5 O banco principal não responde sobre uma mensagem

Se a resposta do lote vem sem aquela mensagem, a API marca erro e tenta de novo mais tarde: depois de 1 minuto, 5 minutos, 15 minutos, 1 hora e 6 horas. Depois da última tentativa, a mensagem fica parada.

### 8.6 API e Worker gravando ao mesmo tempo

Os dois são programas diferentes e gravam no mesmo arquivo. O banco usa o modo WAL e cada gravação espera a sua vez (até 5 segundos). O lacre não recebe erro por causa disso.

## 9. Situações de uma mensagem na fila

| Situação | Significado |
| --- | --- |
| `PENDING` | Pronta para enviar |
| `PROCESSING` | Sendo enviada agora |
| `SYNCED` | Gravada no banco principal |
| `ERROR` com nova tentativa marcada | Falhou; vai tentar de novo |
| `ERROR` sem nova tentativa | Parada: precisa de alguém olhar |
| `ARQUIVADA` | Veio do modelo antigo sem posição ou sem bateria; fica guardada e não é enviada |

## 10. Cuidados com o banco

- **Cópia:** com a API ligada, copie o banco só com `npm run backup`. Ao lado do `oxide.db` ficam os arquivos `oxide.db-wal` e `oxide.db-shm`; copiar só o `oxide.db` à mão pode levar uma cópia incompleta.
- **Limpeza:** `npm run retencao -- --confirmar` apaga o que foi enviado há mais de 30 dias. O que ainda não foi enviado nunca é apagado.
- **Banco de versão anterior:** ao ligar, a API faz uma cópia de segurança (`oxide.db.bak-antes-da-fila-unica-<data>`) e converte o banco para o modelo atual.
- **Pasta sincronizada (OneDrive e parecidos):** para o banco em uso, prefira uma pasta que não seja sincronizada.

## 11. Por que os testes não mexem no banco do projeto

A suíte (`npm test`), o simulador (`npm run simular`) e o teste em massa (`npm run simular:massa`) criam uma pasta temporária, com uma `oxide.db` nova, e usam um recebedor de teste no lugar do Supabase. O `oxide.db` do projeto e o banco principal não são tocados.

Para ver as tabelas preenchidas por um teste, abra a `oxide.db` da pasta que o simulador mostra no fim.

## 12. O que ainda não é real

| Item | Situação em 10/10/2026 |
| --- | --- |
| Envio ao Supabase de verdade | Não testado: a função de recebimento e as tabelas do lacre não estão no repositório do frontend |
| Lista de lacres ativos e vínculo com o cilindro e o cliente | Pronto na API. Falta o sistema tratar a mensagem `ATIVACAO` e devolver o vínculo (seção 5) |
| Aviso de ativação enviado pelo lacre | A rota existe; falta o firmware enviar ao ligar |
| Lacre de verdade enviando | O envio está desligado no firmware, e a leitura da bateria ainda não entrou |
| Queda longa do banco principal (horas ou dias) | Não testada; o teste em massa usou uma queda de 8 segundos |
| Queda de energia no meio de uma gravação | Não testada |

## 13. Como entrar na API (porta e endereços)

**A porta é a 3000.** Com a API ligada (`npm start`), os endereços são:

| Para quê | Endereço |
| --- | --- |
| Ver se a API está no ar (responde "API ESP32 Online") | http://localhost:3000 |
| Documentação interativa (Swagger), para testar as rotas pelo navegador | http://localhost:3000/api-docs |
| Situação da API, da fila e do Worker | http://localhost:3000/health |
| Rotas do lacre | `http://localhost:3000/api/v1/iot/...` |

- **De outro aparelho** (o lacre ou outro computador na mesma rede): troque `localhost` pelo IP do computador onde a API está ligada, por exemplo `http://192.168.0.10:3000`. No Windows, o IP aparece com o comando `ipconfig`, na linha "Endereço IPv4".
- **Para mudar a porta:** defina `PORT` no arquivo `.env` (por exemplo `PORT=8080`) e ligue a API de novo.
- **`banco_principal: "NAO_CONFIGURADO"` no `/health`:** é o esperado enquanto `SUPABASE_IOT_URL` e `SUPABASE_SERVICE_KEY` não estiverem no `.env`. A API continua recebendo, e as mensagens ficam guardadas na fila até o banco principal ser configurado.
- **Rotas `/api/v1/app/...` não existem.** Elas são da proposta antiga [Contrato-API-Frontend.md](Contrato-API-Frontend.md), que não foi seguida: a API não atende o frontend.

## 14. Histórico do documento

| Versão | Data | Mudança |
| --- | --- | --- |
| 1.0 | 10/10/2026 | Primeira versão, a pedido de Natã da Silva Baracho |
| 1.1 | 10/10/2026 | Ativação do lacre, identificador gerado pela API e vínculo com o cilindro e o cliente (seção 5 reescrita). **Aprovado por Natã da Silva Baracho em 10/10/2026** |
| 1.2 | 10/10/2026 | Nova seção 13: a porta da API (3000) e os endereços para entrar |
