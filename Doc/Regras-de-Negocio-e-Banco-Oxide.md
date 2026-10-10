# Regras de Negócio da API do Lacre e do Banco Oxide

**Versão:** 2.0 — 10/10/2026 — **aguardando a validação de Natã da Silva Baracho**

Este documento descreve as regras que a API aplica hoje. O banco local está em [Oxidedb.md](Oxidedb.md); o que vai para o banco principal, em [Contrato-Entrega-Supabase.md](Contrato-Entrega-Supabase.md).

## 1. Escopo

- API REST em Node.js, TypeScript e Express, com prefixo `/api/v1`.
- **Banco principal:** o Supabase do projeto do frontend (`fluxid_integra2026`). A API não atende o frontend; ela só entrega os dados do lacre.
- **Banco local:** `oxide.db` (SQLite) no diretório de trabalho do processo. É uma fila: guarda as mensagens até o Worker entregá-las.
- **Fica no banco principal, e não na API:** lacre, cilindro, cliente, vínculos, rotas, geocercas, tratamento dos alertas e histórico.

## 2. Rotas

| Método e rota | Regra principal | Respostas |
| --- | --- | --- |
| `GET /` | Verifica se a API está ativa | `200` |
| `POST /api/v1/iot/telemetries` | Leitura periódica do lacre | `202` nova; `200` posição repetida; `400`; `401`; `403`; `404`; `409` |
| `POST /api/v1/iot/events` | Evento do lacre | `202`; `400`; `401`; `403`; `404`; `409` |
| `POST /api/v1/iot/alerts` | Alerta identificado pelo lacre | `201`; `400`; `401`; `403`; `404`; `409` |
| `GET /api/v1/iot/commands/:deviceId` | Comandos pendentes do dispositivo | `200`; `401`; `403`; `404` |
| `POST /api/v1/iot/commands/confirm` | Confirma execução ou erro de comando | `200`; `400`; `404`; `409` |
| `GET /api/v1/iot/messages` | Últimas mensagens recebidas (aberta e provisória) | `200`; `400` |
| `GET /api/v1/devices`, `GET /api/v1/devices/:deviceId` | Consulta de dispositivos, sem a chave | `200`; `404` |
| `POST /api/v1/devices` | Cadastro provisório, para testes | `201`; `400`; `409` |
| `GET /api/v1/sync/status`, `GET /api/v1/sync/problems`, `POST /api/v1/sync/retry` | Acompanhamento da fila (abertas e provisórias) | `200`; `400`; `404` |
| `GET /health` | Saúde da API, da fila e do Worker | `200`; `503` |

Não existem mais rotas de lacres, cilindros, vínculos, nem de análise e encerramento de alertas: isso é do sistema principal.

## 3. Autenticação

- As rotas do lacre exigem o cabeçalho `X-API-Key`.
- Sem chave ou com chave desconhecida: `401`.
- Dispositivo desativado: `403`.
- A chave precisa ser do **próprio** `device_id` da mensagem: chave de outro dispositivo responde `403`, e `device_id` não cadastrado responde `404`.
- Dispositivo vindo do banco principal é conferido pelo **hash** (SHA-256 da chave). A chave em texto guardada para ele não autentica.
- A chave e o hash nunca aparecem nas respostas.
- As rotas de dispositivos e de acompanhamento são abertas, por decisão do responsável, enquanto a equipe testa.

## 4. Regras por tipo de mensagem

### 4.1 Campos comuns (leitura, evento e alerta)

- `device_id`, `latitude`, `longitude` e `battery_percent` são **obrigatórios**. Sem eles: `400`.
- Latitude de -90 a 90, longitude de -180 a 180 e bateria de 0 a 100. Fora disso: `400`.
- `gps_ok` é opcional (verdadeiro ou falso; padrão verdadeiro). `false` quer dizer que o lacre estava sem sinal e mandou a última posição conhecida.
- `seal_status`, quando enviado, é `LOCKED`, `UNLOCKED` ou `BROKEN`.
- `speed_kmh`, `gsm_signal`, `satellites` (ou `satelites`) e `hdop` são opcionais e precisam ser números.
- `attempt_count` é do lacre (tentativas de envio) e fica em `device_attempt_count`. A situação e as tentativas da fila são sempre do servidor.
- A data oficial é a de chegada (`received_at`).

### 4.2 Leitura (`telemetries`)

- Exige `message_id`. Repetido: `409`, sem novo registro.
- **Posição repetida:** se a posição, o `gps_ok` e o estado do lacre forem iguais aos da última leitura do dispositivo, a API responde `200` e não cria outra linha. Ela atualiza `last_seen_at`, a bateria e o sinal da leitura anterior. Se essa leitura já tinha sido enviada, ela volta para a fila, para o banco principal receber a atualização.
- O `message_id` da posição repetida também não pode ser reenviado (`409`).

### 4.3 Evento (`events`)

- Exige `message_id` e `event_type`. Repetido: `409`.

### 4.4 Alerta (`alerts`)

- Exige `alert_id`, `alert_type` e `title`. `alert_id` repetido: `409`.
- `alert_type` é um dos códigos do catálogo [Tipos-de-Erro.md](Tipos-de-Erro.md). Os seis nomes antigos em inglês continuam aceitos e são convertidos.
- `severity` é opcional (`BAIXA`, `MEDIA`, `ALTA`, `CRITICA`); sem ela, vale a do catálogo.

### 4.5 Alertas automáticos

A API abre sozinha os alertas que saem da própria mensagem. Eles entram na fila como alerta com `origin: "servidor"` e código `AUT-...`.

| Alerta | Quando |
| --- | --- |
| `BATERIA_BAIXA` | A bateria cai abaixo de `REGRA_BATERIA_MINIMA` (15%) |
| `GSM_SINAL_FRACO` | O sinal cai abaixo de `REGRA_SINAL_MINIMO_DBM` (-105 dBm) |
| `LACRE_VIOLADO` | O lacre passa a `BROKEN` |
| `LACRE_ABERTO_SEM_AUTORIZACAO` | O lacre passa a `UNLOCKED` |

- Cada alerta é aberto **na mudança**: ao cruzar o limite ou quando o estado do lacre muda. Enquanto a situação continua a mesma, não repete.
- A API não sabe se a abertura do lacre era autorizada. Quem confere é o sistema principal.
- Regras de rota, de geocerca e de tempo sem comunicar **não** são da API.

### 4.6 Comandos

- Os comandos são criados no sistema principal. O Worker os traz para a tabela `commands`.
- Tipos aceitos: `TRAVAR_VALVULA` e `DESTRAVAR_VALVULA`. Outro tipo é ignorado, com aviso na rodada.
- `GET /iot/commands/:deviceId` devolve só os `PENDENTE`, na ordem de criação, e conta como contato do lacre.
- `POST /iot/commands/confirm` exige `command_id`, `device_id` e `status` (`EXECUTADO` ou `ERRO`). Comando inexistente: `404`; já confirmado: `409`.
- A confirmação entra na fila como mensagem `CONFIRMACAO_COMANDO`, para o sistema principal saber o resultado.
- Não existe rota aberta para criar comando.

### 4.7 Dispositivos

- O cadastro oficial vem do banco principal: código, hash da chave, ativo ou não e versão do firmware. O Worker o copia a cada 5 minutos.
- O que vem do banco principal manda. Nada é apagado: para bloquear um lacre, o banco principal manda `active: false`.
- `POST /devices` é provisório, para testes de bancada: `device_id` e `api_key` obrigatórios; repetidos respondem `409`; `active` só `0` ou `1`.
- A API guarda o último estado de cada dispositivo (contato, posição, GPS, lacre, bateria e sinal).

## 5. Fila e envio ao banco principal

- O Worker envia em lotes de até 100 mensagens e espera um resultado por mensagem: `stored`, `duplicate` ou `rejected`.
- `stored` e `duplicate`: a mensagem fica `SYNCED`.
- `rejected`: a mensagem para, com o motivo, para o gestor.
- Sem resultado: nova tentativa em 1 min, 5 min, 15 min, 1 h e 6 h; depois da sexta falha, para.
- Banco principal fora do ar, chave recusada ou função não encontrada: a rodada falha, nada se perde e **nenhuma tentativa é gasta**.
- Reenviar a mesma mensagem não duplica: a chave é o `message_id`.
- O gestor acompanha em `/sync/status` e `/sync/problems` e devolve uma mensagem à fila com `/sync/retry`.

## 6. Fora do escopo implementado

- Teste contra o Supabase de verdade: depende da função de recebimento e das tabelas do lacre, que ainda não estão no repositório do frontend.
- Controle por perfil nas rotas abertas da equipe.
- HTTPS e limite de requisições.
- Aviso ativo ao motorista e ao gestor.

## 7. Histórico do documento

| Versão | Data | Mudança |
| --- | --- | --- |
| 1.x | até 07/10/2026 | Regras do modelo com filas separadas, cópia do cadastro de lacres e cilindros e envio ao FluxID |
| 2.0 | 10/10/2026 | Modelo enxuto: fila única, posição e bateria obrigatórias, alertas automáticos só da própria mensagem e envio ao Supabase |
