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

Se a `oxide.db` for de uma versão anterior, a API faz uma cópia de segurança ao lado do arquivo (`oxide.db.bak-antes-da-fila-unica-<data>`), passa as mensagens antigas para a fila nova (as que têm posição e bateria seguem para o banco principal; as outras ficam arquivadas) e remove as tabelas que saíram. Detalhes: [Oxidedb.md](Doc/Oxidedb.md).

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

### Manutenção

```bash
npm run backup                    # cópia consistente em backups/ (pode rodar com a API ligada)
npm run retencao                  # mostra o que sairia (só o já enviado, há mais de 30 dias)
npm run retencao -- --confirmar   # apaga de fato; faça o backup antes
```

## Testes

```bash
npx tsc --noEmit
npm test
```

A suíte roda numa pasta temporária, com uma `oxide.db` nova e um recebedor de teste no lugar do Supabase. Ela não toca no `oxide.db` do projeto nem no banco principal, e pode rodar com a sua API ligada. Resultado atual: 71/71.

O registro de cada entrega (validação da IA e do responsável) fica em `Doc/Doc_tese/Relatorio-de-Teste-*.md`.

## Documentação interativa

Com o servidor ativo, acesse o Swagger UI em:

```text
http://localhost:3000/api-docs
```

Use **Try it out** para executar as requisições. Para as rotas do lacre, clique em **Authorize** e informe a chave do dispositivo no header `X-API-Key`.

**Quem programa o lacre (ESP32)** deve começar pelo [Guia do firmware do lacre IoT](Doc/Guia-Firmware-Lacre-IoT.md).

## Endpoints

| Método | Endpoint | Uso |
| --- | --- | --- |
| `POST` | `/api/v1/iot/telemetries` | Leitura periódica do lacre |
| `POST` | `/api/v1/iot/events` | Evento do lacre (ligou, lacre mudou, falha) |
| `POST` | `/api/v1/iot/alerts` | Alerta identificado pelo lacre |
| `GET` | `/api/v1/iot/commands/:deviceId` | Comandos pendentes do dispositivo |
| `POST` | `/api/v1/iot/commands/confirm` | Confirmar execução ou erro de comando |
| `GET` | `/api/v1/iot/messages` | Últimas mensagens recebidas (aberta e provisória) |
| `GET` | `/api/v1/devices` e `/api/v1/devices/:deviceId` | Consultar dispositivos, sem a chave |
| `POST` | `/api/v1/devices` | Cadastrar dispositivo (provisório, para testes) |
| `GET` | `/api/v1/sync/status` | Situação da fila e da última rodada do Worker |
| `GET` | `/api/v1/sync/problems` | Mensagens que não chegaram ao banco principal |
| `POST` | `/api/v1/sync/retry` | Devolver à fila uma mensagem com erro |
| `GET` | `/health` | Saúde da API, da fila e do Worker |

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

- [Guia do firmware do lacre IoT](Doc/Guia-Firmware-Lacre-IoT.md): o contrato entre o lacre e a API
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
- [Payloads antigos do ESP32](Doc/ESP32-envio-de-dados.md) (substituído pelo guia do firmware 2.0)
