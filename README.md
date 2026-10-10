# API ESP32

API REST em Node.js, TypeScript, Express e SQLite que recebe os dados dos lacres (ESP32) e os entrega ao banco principal do FluxID.

```text
Lacre (ESP32) ──► API (valida) ──► Oxide (fila local) ──► Worker ──► Supabase (banco principal)
```

- **API:** recebe leituras, eventos e alertas do lacre, confere a chave de cada dispositivo e não grava a mesma mensagem duas vezes.
- **Oxide (`oxide.db`):** fila local em SQLite, com três tabelas. Se o banco principal cair, nada se perde.
- **Worker:** envia a fila ao Supabase e traz de lá o cadastro dos dispositivos e os comandos da válvula.
- **Supabase:** banco principal, mantido no projeto do frontend (`fluxid_integra2026`). Lacre, cilindro, cliente, rota e geocerca ficam lá.

## Executar localmente

```bash
npm install
npm start        # ou npm run dev (recarrega ao salvar)
```

O servidor inicia na porta `3000`. As tabelas são criadas sozinhas.

### Porta e endereços

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
- **Rotas `/api/v1/app/...` não existem.** Elas são da proposta antiga [Contrato-API-Frontend.md](Doc/Contrato-API-Frontend.md), que não foi seguida: a API não atende o frontend.

Se a `oxide.db` for de uma versão anterior, a API faz uma cópia de segurança ao lado do arquivo (`oxide.db.bak-antes-da-fila-unica-<data>`), passa as mensagens antigas para a fila nova (as que têm posição e bateria seguem para o banco principal; as outras ficam arquivadas) refaz `devices` e `commands` no formato atual e remove as tabelas que saíram. Detalhes: [Oxidedb.md](Doc/Oxidedb.md).

O npm 11 avisa que os scripts de instalação do `better-sqlite3` ainda não estão autorizados (`allowScripts`); hoje é só um aviso e o módulo instala normalmente. Se uma versão futura do npm bloquear o script e a API não conseguir abrir o banco, rode `npm install-scripts approve better-sqlite3` e depois `npm install`.

### Worker (envio ao banco principal)

Copie `.env.example` para `.env` e preencha `SUPABASE_IOT_URL` e `SUPABASE_SERVICE_KEY`. A chave fica só no `.env`, que não vai para o Git. Depois, em outro terminal:

```bash
npm run worker            # roda sem parar; Ctrl+C encerra ao fim da rodada
npm run worker -- --once  # uma rodada e sai
```

O que o Worker envia e o que espera do Supabase está em [Contrato-Entrega-Supabase.md](Doc/Contrato-Entrega-Supabase.md).

### Simular um lacre (`npm run simular`)

Faz o percurso completo de um lacre, sem o equipamento e sem o Supabase:
- cadastro vindo do banco principal;
- leituras com posição e bateria;
- posição repetida e mensagem duplicada;
- GPS sem sinal;
- alertas automáticos;
- banco principal fora do ar e reenvio;
- comando da válvula e confirmação.

Roda numa pasta temporária, com uma `oxide.db` nova e um recebedor de teste no lugar do Supabase. O `oxide.db` do projeto não é tocado.

### Teste em massa (`npm run simular:massa`)

Põe 500 lacres (um por cilindro) enviando ao mesmo tempo, num cenário como o do sistema principal: organizações, clientes, unidades com geocerca, veículos e motoristas. A API e o Worker rodam em processos separados e são derrubados no meio do teste, junto com o banco principal. No fim, o teste confere que nada se perdeu e nada duplicou.

Roda numa pasta temporária, com o recebedor de teste no lugar do Supabase. Ajustes: `MASSA_LACRES`, `MASSA_PONTOS`, `MASSA_PARALELO`, `MASSA_PORTA` e `MASSA_SEMENTE`.

### Manutenção

```bash
npm run backup                    # cópia consistente em backups/ (pode rodar com a API ligada)
npm run retencao                  # mostra o que sairia (só o já enviado, há mais de 30 dias)
npm run retencao -- --confirmar   # apaga de fato; faça o backup antes
```

O banco grava em modo WAL: ao lado do `oxide.db` ficam os arquivos `oxide.db-wal` e `oxide.db-shm`. **Com a API ligada, não copie o `oxide.db` à mão:** a cópia pode sair incompleta. Use sempre `npm run backup`, que gera um arquivo só.

## Testes

```bash
npx tsc --noEmit
npm test
npm run simular
npm run simular:massa
```

A suíte roda numa pasta temporária, com uma `oxide.db` nova e um recebedor de teste no lugar do Supabase. Ela não toca no `oxide.db` do projeto nem no banco principal, e pode rodar com a sua API ligada. Resultado atual: suíte 110/110, simulador 26/26 e teste em massa 32/32.

O registro de cada entrega (validação da IA e do responsável) fica em `Doc/Doc_tese/Relatorio-de-Teste-*.md`.

## Documentação interativa

Com o servidor ativo, acesse o Swagger UI em:

```text
http://localhost:3000/api-docs
```

Use **Try it out** para executar as requisições. Para as rotas do lacre, clique em **Authorize** e informe a chave do dispositivo no header `X-API-Key`.

**Quem programa o lacre (ESP32)** deve começar pelo [Guia do firmware do lacre IoT](Doc/Guia-Firmware-Lacre-IoT.md).

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

- **Chave:** as rotas do lacre exigem `X-API-Key` do próprio `device_id` enviado (`403` se for de outro). O dispositivo precisa estar cadastrado: não há criação automática (`404`). A chave nunca aparece nas respostas.
- **Posição e bateria obrigatórias:** toda leitura, evento e alerta leva `latitude`, `longitude` e `battery_percent` (`400` sem eles). Sem sinal de GPS, o lacre manda a última posição conhecida com `gps_ok: false`.
- **Sem duplicar:** `message_id` (ou `alert_id`) repetido responde `409` e não cria outro registro.
- **Posição repetida:** leitura com a mesma posição e o mesmo estado do lacre da anterior responde `200` e só atualiza a data e a hora da leitura anterior.
- **Alertas automáticos:** a API abre sozinha, uma vez a cada mudança: `BATERIA_BAIXA` (abaixo de 15%), `GSM_SINAL_FRACO` (abaixo de -105 dBm), `LACRE_VIOLADO` (lacre `BROKEN`) e `LACRE_ABERTO_SEM_AUTORIZACAO` (lacre `UNLOCKED`). Os limites mudam no `.env`.
- **O que a API não faz:** regras de rota, de geocerca e de tempo sem comunicar, e o tratamento dos alertas. Ficam no sistema principal.
- **Comandos:** vêm do banco principal (`TRAVAR_VALVULA`, `DESTRAVAR_VALVULA`). O lacre busca e confirma `EXECUTADO` ou `ERRO`, e a confirmação volta ao banco principal.
- **Fila:** envio inicial e mais 5 tentativas (1 min, 5 min, 15 min, 1 h e 6 h). Banco principal fora do ar não gasta tentativa.

## Documentos

- [Como o sistema se comporta](Doc/Como-o-Sistema-se-Comporta.md): explicação simples do que acontece em cada situação (comece por aqui)
- [Guia do firmware do lacre IoT](Doc/Guia-Firmware-Lacre-IoT.md): o contrato entre o lacre e a API
- [ESP32: como enviar dados](Doc/ESP32-envio-de-dados.md): o exemplo de cada mensagem e de cada resposta, campo por campo
- [Contrato de entrega ao Supabase](Doc/Contrato-Entrega-Supabase.md): o que a API envia ao banco principal
- [Banco local Oxide](Doc/Oxidedb.md)
- [Desenvolvimento: como a API funciona e histórico](Doc/Desenvolvimento.md)
- [Regras de negócio da API](Doc/Regras-de-Negocio-e-Banco-Oxide.md)
- [Catálogo de tipos de erro e ocorrências](Doc/Tipos-de-Erro.md)
- [Checklist do projeto](Doc/Checklist-Projeto.md)
- [Plano de Teste](Doc/Doc_tese/PlanoDeTeste.md) e [Roteiro de Teste](Doc/Doc_tese/RoteiroDeTeste.md)
- [Documentação final para o evento INTEGRA 2026](DocumentacaoFinal): registros de uso de IA e validação humana (Template 7)

**Referência histórica** (do período em que o banco principal seria o FluxID em PostgreSQL; hoje é só banco de teste):
- [Banco PostgreSQL FluxID](Doc/Banco_FluxID.md) e scripts em [`sql/fluxid/`](sql/fluxid)
- [Integração Oxide ⇄ FluxID](Doc/Integracao-Oxide-FluxID.md)
- [Contrato da API para o frontend](Doc/Contrato-API-Frontend.md) (proposta não seguida)

