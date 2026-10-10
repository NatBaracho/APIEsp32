# API do lacre (ESP32)

API REST em Node.js, TypeScript, Express e SQLite que recebe os dados dos lacres (ESP32) e os entrega ao banco principal do sistema FluxID (Supabase).

```text
Lacre (ESP32) ──► API (valida) ──► Oxide (fila local) ──► Worker ──► Supabase (banco principal)
                                                             ▲                │
                                                             └── dispositivos, vínculos e comandos ──┘
```

| Parte | O que é | O que faz |
| --- | --- | --- |
| Lacre | O equipamento (ESP32) preso ao cilindro | Avisa que está ativo; envia leituras, eventos e alertas; busca e confirma comandos |
| API | O programa em `src/` | Confere a chave do dispositivo, valida a mensagem e guarda na fila. Não grava a mesma mensagem duas vezes |
| Oxide | O arquivo `oxide.db` (SQLite) | Fila local, com três tabelas. Se o banco principal cair, nada se perde |
| Worker | Outro programa (`npm run worker`) | Envia a fila ao Supabase e traz de lá os dispositivos, os vínculos e os comandos da válvula |
| Supabase | O banco principal, no projeto do frontend (`fluxid_integra2026`) | Guarda tudo de forma definitiva. Lacre, cilindro, cliente, rota e geocerca ficam lá |

A API **não atende o frontend**: as telas falam direto com o Supabase.

Para entender o comportamento em linguagem simples, comece por [Como o sistema se comporta](Doc/Como-o-Sistema-se-Comporta.md).

## Situação atual (10/10/2026)

| Item | Situação |
| --- | --- |
| API, fila (Oxide) e Worker | Prontos e testados: suíte 110/110, simulador 26/26 e teste em massa 32/32 |
| Envio ao Supabase de verdade | **Ainda não testado.** A função de recebimento não existe no repositório do frontend; os testes usam um recebedor de teste |
| Ativação do lacre e vínculo com o cilindro e o cliente | Pronto na API. Falta o sistema tratar a mensagem de ativação e devolver o vínculo |
| Lacre de verdade | O envio está desligado no firmware; faltam o aviso de ativação e a leitura da bateria |

## Como ligar

É preciso ter o Node.js instalado (o projeto usa a versão 24).

```bash
npm install
npm start        # ou npm run dev (reinicia ao salvar)
```

A API sobe na **porta 3000** e cria as tabelas sozinha.

| Para quê | Endereço |
| --- | --- |
| Ver se a API está no ar (responde "API ESP32 Online") | http://localhost:3000 |
| Documentação interativa (Swagger), para testar as rotas pelo navegador | http://localhost:3000/api-docs |
| Situação da API, da fila e do Worker | http://localhost:3000/health |
| Rotas do lacre | `http://localhost:3000/api/v1/iot/...` |

- **De outro aparelho** (o lacre ou outro computador na mesma rede): troque `localhost` pelo IP do computador onde a API está ligada, por exemplo `http://192.168.0.10:3000`. No Windows, o IP aparece com o comando `ipconfig`, na linha "Endereço IPv4".
- **Para mudar a porta:** defina `PORT` no arquivo `.env` (por exemplo `PORT=8080`) e ligue a API de novo.
- **No Swagger:** use **Try it out** para executar. Nas rotas do lacre, clique em **Authorize** e informe a chave do dispositivo (`X-API-Key`).
- **`banco_principal: "NAO_CONFIGURADO"` no `/health`:** é o esperado enquanto o endereço e a chave do Supabase não estiverem no `.env`. A API continua recebendo, e as mensagens ficam guardadas na fila.
- **Rotas `/api/v1/app/...` não existem.** Elas são da proposta antiga [Contrato-API-Frontend.md](Doc/Contrato-API-Frontend.md), que não foi seguida.

**Banco de versão anterior.** Se a `oxide.db` for de uma versão anterior, a API faz uma cópia de segurança ao lado do arquivo antes de mudar qualquer coisa e converte o banco sozinha:

- do modelo antigo (filas separadas): cópia `oxide.db.bak-antes-da-fila-unica-<data>`; as leituras antigas com posição e bateria seguem para o banco principal e as outras ficam arquivadas;
- do modelo atual, mas sem as colunas mais novas: cópia `oxide.db.bak-antes-da-atualizacao-<data>`.

Detalhes em [Oxidedb.md](Doc/Oxidedb.md).

**Aviso do npm.** O npm 11 avisa que os scripts de instalação do `better-sqlite3` ainda não estão autorizados (`allowScripts`); hoje é só um aviso e o módulo instala normalmente. Se uma versão futura do npm bloquear o script e a API não conseguir abrir o banco, rode `npm install-scripts approve better-sqlite3` e depois `npm install`.

## Configuração (`.env`)

Copie `.env.example` para `.env`. O `.env` não vai para o Git. **Nunca coloque a chave do Supabase em documento, conversa ou no `.env.example`.**

| Variável | Para quê | Padrão |
| --- | --- | --- |
| `PORT` | Porta da API | `3000` |
| `SUPABASE_IOT_URL` | Endereço da função de recebimento do Supabase | — |
| `SUPABASE_SERVICE_KEY` | Chave `service_role` do Supabase | — |
| `WORKER_INTERVAL_SECONDS` | De quanto em quanto tempo o Worker envia a fila | `10` |
| `WORKER_CADASTRO_INTERVAL_SECONDS` | De quanto em quanto tempo o Worker busca os dispositivos e os vínculos | `300` |
| `WORKER_BATCH_SIZE` | Mensagens por lote | `100` |
| `REGRA_BATERIA_MINIMA` | Abaixo disso, abre o alerta de bateria baixa (%) | `15` |
| `REGRA_SINAL_MINIMO_DBM` | Abaixo disso, abre o alerta de sinal fraco (dBm) | `-105` |
| `REGRA_MINUTOS_SEM_VINCULO` | Tempo para o sistema vincular o cilindro depois da ativação; passado ele, abre o alerta de lacre sem cilindro | `10` |
| `BACKUP_PASTA` e `BACKUP_MANTER` | Pasta das cópias e quantas manter | `backups` e `14` |
| `RETENCAO_DIAS` | Depois de quantos dias o que já foi enviado pode ser apagado | `30` |

## Comandos

| Comando | Para quê |
| --- | --- |
| `npm start` | Liga a API |
| `npm run dev` | Liga a API e reinicia ao salvar um arquivo |
| `npm run worker` | Liga o Worker, em outro terminal. `Ctrl+C` encerra ao fim da rodada |
| `npm run worker -- --once` | Faz uma rodada do Worker e sai |
| `npm test` | Suíte automática (110 casos) |
| `npm run simular` | Percurso completo de um lacre (26 verificações) |
| `npm run simular:massa` | Teste em massa com 500 lacres (32 verificações) |
| `npm run backup` | Cópia consistente da `oxide.db` em `backups/`; pode rodar com a API ligada |
| `npm run retencao` | Mostra o que sairia: só o que já foi enviado há mais de 30 dias |
| `npm run retencao -- --confirmar` | Apaga de fato. Faça o backup antes |

O que o Worker envia e o que espera do Supabase está em [Contrato-Entrega-Supabase.md](Doc/Contrato-Entrega-Supabase.md).

**Cuidado com a cópia do banco.** O banco grava em modo WAL: ao lado do `oxide.db` ficam os arquivos `oxide.db-wal` e `oxide.db-shm`. Com a API ligada, não copie o `oxide.db` à mão, porque a cópia pode sair incompleta. Use sempre `npm run backup`, que gera um arquivo só.

## Testes

```bash
npx tsc --noEmit
npm test
npm run simular
npm run simular:massa
```

Os três testes rodam numa pasta temporária, com uma `oxide.db` nova e um **recebedor de teste** no lugar do Supabase. Eles não tocam no `oxide.db` do projeto nem no banco principal, e podem rodar com a sua API ligada.

| Teste | O que faz | Resultado atual |
| --- | --- | --- |
| `npm test` | Chama cada rota e confere as regras, o banco, o Worker e a migração | 110 de 110 |
| `npm run simular` | Um lacre do começo ao fim: cadastro, ativação e vínculo, leituras, posição repetida, GPS sem sinal, alertas automáticos, banco principal fora do ar e comando da válvula | 26 de 26 |
| `npm run simular:massa` | 500 lacres (um por cilindro) num cenário como o do sistema principal, com a API, o Worker e o banco principal derrubados no meio. Confere que nada se perdeu nem duplicou | 32 de 32 |

Ajustes do teste em massa: `MASSA_LACRES`, `MASSA_PONTOS`, `MASSA_PARALELO`, `MASSA_PORTA` e `MASSA_SEMENTE`.

O registro de cada entrega (validação da IA e do responsável) fica em `Doc/Doc_tese/Relatorio-de-Teste-*.md`.

## Endpoints

Todos os endereços abaixo são com a API ligada na porta 3000. De outro aparelho, troque `localhost` pelo IP do computador.

### Endpoints da API usados pelo lacre

Exigem o cabeçalho `X-API-Key`, com a chave do próprio dispositivo.

| Método | Endereço | Para quê |
| --- | --- | --- |
| `POST` | `http://localhost:3000/api/v1/iot/activations` | O lacre avisa que foi ativado ou desativado; a API gera o identificador do lacre |
| `POST` | `http://localhost:3000/api/v1/iot/telemetries` | Leitura periódica: posição, bateria, sinal e estado do lacre |
| `POST` | `http://localhost:3000/api/v1/iot/events` | Evento: algo aconteceu (ligou, o lacre mudou de estado, falha) |
| `POST` | `http://localhost:3000/api/v1/iot/alerts` | Alerta: problema identificado pelo lacre |
| `GET` | `http://localhost:3000/api/v1/iot/commands/{device_id}` | Buscar os comandos de válvula pendentes |
| `POST` | `http://localhost:3000/api/v1/iot/commands/confirm` | Confirmar o comando executado ou com erro |

O exemplo de cada mensagem e de cada resposta está em [ESP32-envio-de-dados.md](Doc/ESP32-envio-de-dados.md).

### Endpoints para ver o que está na Oxide

A Oxide é o arquivo `oxide.db`: ela **não tem porta nem endereço próprio**. Quem mostra o que está guardado nela é a API, pelos endpoints abaixo. São abertos (sem chave) e provisórios, para a equipe acompanhar os testes; abrem direto no navegador.

| Método | Endereço | O que mostra | Tabela da Oxide |
| --- | --- | --- | --- |
| `GET` | `http://localhost:3000/api/v1/iot/messages` | As últimas mensagens recebidas (até 50), da mais nova para a mais antiga. Não mostra as arquivadas do modelo antigo | `mensagens` |
| `GET` | `http://localhost:3000/api/v1/iot/messages?type=TELEMETRIA&device_id=DSP-000001&limit=20` | O mesmo, com filtro por tipo (`TELEMETRIA`, `EVENTO`, `ALERTA`, `CONFIRMACAO_COMANDO` ou `ATIVACAO`), por dispositivo e com limite (até 200) | `mensagens` |
| `GET` | `http://localhost:3000/api/v1/devices` | Todos os dispositivos: ativo ou não, último estado, identificador do lacre e vínculo com o cilindro e o cliente. Nunca mostra a chave | `devices` |
| `GET` | `http://localhost:3000/api/v1/devices/{device_id}` | Um dispositivo | `devices` |
| `GET` | `http://localhost:3000/api/v1/sync/status` | A fila em números (pendentes, enviando, com nova tentativa, paradas, enviadas e arquivadas) e a última rodada do Worker | `mensagens` |
| `GET` | `http://localhost:3000/api/v1/sync/problems` | As mensagens que não chegaram ao banco principal, com o motivo | `mensagens` |
| `POST` | `http://localhost:3000/api/v1/sync/retry` | Devolve à fila uma mensagem com erro. Corpo: `{"message_id": "..."}` | `mensagens` |
| `POST` | `http://localhost:3000/api/v1/devices` | Cadastra um dispositivo para teste de bancada. Corpo: `device_id` e `api_key` | `devices` |

Os comandos (`commands`) aparecem para o lacre em `GET /api/v1/iot/commands/{device_id}` e, em quantidade, no `/health` (`comandos_pendentes`).

### Endpoints gerais

| Método | Endereço | Para quê |
| --- | --- | --- |
| `GET` | `http://localhost:3000/` | Ver se a API está no ar (responde "API ESP32 Online") |
| `GET` | `http://localhost:3000/health` | Situação da API, da fila e do Worker (`200` normal, `503` com problema) |
| `GET` | `http://localhost:3000/api-docs` | Documentação interativa (Swagger): mostra e deixa testar todos os endpoints |

### Abrir a Oxide direto, sem a API

Para olhar as tabelas, o `oxide.db` abre em qualquer programa de SQLite (por exemplo, o DB Browser for SQLite). Dois cuidados:

- **Não abra o arquivo em uso para gravar.** Com a API ligada, faça uma cópia com `npm run backup` e abra a cópia, que fica na pasta `backups/`.
- As tabelas são três: `devices`, `mensagens` e `commands`. O que cada uma guarda está em [Oxidedb.md](Doc/Oxidedb.md).

## Regras principais

- **Chave:** as rotas do lacre exigem `X-API-Key` do próprio `device_id` enviado (`403` se for de outro). O dispositivo precisa estar cadastrado: não há criação automática (`404`). A chave nunca aparece nas respostas, e a Oxide guarda só o hash dela.
- **Posição e bateria obrigatórias:** toda mensagem do lacre leva `latitude`, `longitude` e `battery_percent` (`400` sem eles). Sem sinal de GPS, o lacre manda a última posição conhecida com `gps_ok: false`.
- **Sem duplicar:** `message_id` (ou `alert_id`) repetido responde `409` e não cria outro registro.
- **Posição repetida:** leitura com a mesma posição e o mesmo estado do lacre da anterior responde `200` e só atualiza a data e a hora da leitura anterior.
- **Ativação:** o lacre avisa que está ativo e a API gera o identificador dele (`seal_code`, como `LCR-JKFL6VBR`), uma vez só. O aviso segue ao sistema, que assim sabe quais lacres estão ativos.
- **Vínculo:** o sistema vincula o cilindro e o cliente pelo identificador do lacre, e o Worker salva o vínculo na Oxide. A partir daí, toda mensagem sai com o identificador, o cilindro e o cliente. O vínculo termina quando o sistema mandar ou quando o lacre avisar que desativou.
- **Alertas automáticos:** a API abre sozinha, uma vez a cada mudança:
  - `BATERIA_BAIXA` (abaixo de 15%);
  - `GSM_SINAL_FRACO` (abaixo de -105 dBm);
  - `LACRE_VIOLADO` (lacre `BROKEN`);
  - `LACRE_ABERTO_SEM_AUTORIZACAO` (lacre `UNLOCKED`);
  - `LACRE_SEM_CILINDRO` (lacre ativo enviando sem cilindro, 10 minutos depois da ativação).
- **Comandos:** vêm do banco principal (`TRAVAR_VALVULA`, `DESTRAVAR_VALVULA`). O lacre busca e confirma `EXECUTADO` ou `ERRO`, e a confirmação volta ao banco principal.
- **Fila:** envio inicial e mais 5 tentativas (1 min, 5 min, 15 min, 1 h e 6 h). Banco principal fora do ar não gasta tentativa.
- **O que a API não faz:** regras de rota, de geocerca e de tempo sem comunicar, e o tratamento dos alertas. Ficam no sistema principal.

## Pastas do projeto

| Pasta ou arquivo | O que tem |
| --- | --- |
| `src/` | O código da API, do Worker (`src/worker`), dos simuladores (`src/simulador`) e da manutenção (`src/manutencao`) |
| `tests/` | A suíte automática |
| `Doc/` | Os documentos do projeto; em `Doc/Doc_tese/`, o plano, o roteiro e os relatórios de teste |
| `DocumentacaoFinal/` | Registros de uso de IA para o evento INTEGRA 2026 |
| `oxide.db` | O banco local (Oxide) |
| `.env.example` | Modelo da configuração |
| `sql/fluxid/` | Scripts do banco FluxID em PostgreSQL (referência histórica) |

## Documentos

**Para entender e usar:**
- [Como o sistema se comporta](Doc/Como-o-Sistema-se-Comporta.md): explicação simples do que acontece em cada situação (comece por aqui)
- [Desenvolvimento: como a API funciona e histórico](Doc/Desenvolvimento.md)
- [Regras de negócio da API](Doc/Regras-de-Negocio-e-Banco-Oxide.md)
- [Banco local Oxide](Doc/Oxidedb.md)
- [Catálogo de tipos de erro e ocorrências](Doc/Tipos-de-Erro.md)

**Para quem programa o lacre (ESP32):**
- [Guia do firmware do lacre IoT](Doc/Guia-Firmware-Lacre-IoT.md): o contrato entre o lacre e a API (comece por este)
- [ESP32: como enviar dados](Doc/ESP32-envio-de-dados.md): o exemplo de cada mensagem e de cada resposta, campo por campo

**Para quem mantém o Supabase:**
- [Contrato de entrega ao Supabase](Doc/Contrato-Entrega-Supabase.md): o que a API envia ao banco principal e o que espera de volta

**Acompanhamento e testes:**
- [Checklist do projeto](Doc/Checklist-Projeto.md)
- [Plano de Teste](Doc/Doc_tese/PlanoDeTeste.md) e [Roteiro de Teste](Doc/Doc_tese/RoteiroDeTeste.md)
- [Documentação final para o evento INTEGRA 2026](DocumentacaoFinal): registros de uso de IA e validação humana (Template 7)

**Referência histórica** (do período em que o banco principal seria o FluxID em PostgreSQL; hoje é só banco de teste):
- [Banco PostgreSQL FluxID](Doc/Banco_FluxID.md) e scripts em [`sql/fluxid/`](sql/fluxid)
- [Integração Oxide ⇄ FluxID](Doc/Integracao-Oxide-FluxID.md)
- [Contrato da API para o frontend](Doc/Contrato-API-Frontend.md) (proposta não seguida)
