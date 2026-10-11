# Segurança e operação da API do lacre

Como a API se protege e como mantê-la funcionando no dia a dia. Serve para quem instala, configura e acompanha a API.

**Versão:** 1.0, de 11/10/2026.

Documentos relacionados: [Como-o-Sistema-se-Comporta.md](Como-o-Sistema-se-Comporta.md) (comportamento em linguagem simples), [Oxidedb.md](Oxidedb.md) (banco local) e [README](../README.md) (como ligar e configurar).

---

## 1. Resumo

| Assunto | Como está |
| --- | --- |
| Rotas do lacre | Exigem a chave do próprio dispositivo (`X-API-Key`) |
| Rotas da equipe (dispositivos, mensagens, fila e métricas) | Exigem a chave de administrador (`X-Admin-Key`). Sem chave configurada, ficam fechadas |
| Chave do lacre no banco | Só o hash (SHA-256). O texto da chave não fica guardado |
| Tentativas com chave errada | Depois de 60 por minuto, o endereço fica bloqueado até a janela acabar |
| Limite por lacre | 120 mensagens por minuto |
| Tamanho do pedido | Até 32 KB |
| HTTPS | Direto na API, com o certificado no `.env`, ou por um proxy na frente |
| Gravação no banco | Garantida em disco antes de responder ao lacre |
| Métricas | `GET /metrics` |
| Aviso de problema | `npm run vigia`: tela, arquivo e, se configurado, um endereço que recebe o aviso |
| Manter ligado | `npm run servico`: religa a API, o Worker e o vigia, e faz o backup diário |

## 2. As três chaves

| Chave | Quem usa | Onde fica | Cabeçalho |
| --- | --- | --- | --- |
| Chave do dispositivo | O lacre | No lacre e em quem fez o cadastro. Na Oxide, só o hash | `X-API-Key` |
| Chave de administrador | A equipe | No `.env` do servidor (`ADMIN_API_KEY`) | `X-Admin-Key` |
| Chave do Supabase | O Worker | No `.env` do servidor (`SUPABASE_SERVICE_KEY`) | — |

**Nenhuma chave vai para documento, conversa, log ou resposta da API.** O `.env` fica fora do Git.

### 2.1 Chave de administrador

- Precisa ter **pelo menos 16 caracteres**. Para gerar uma: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.
- Coloque no `.env`: `ADMIN_API_KEY=<a chave gerada>` e ligue a API de novo.
- Uma chave não serve no lugar da outra: a do lacre não abre as rotas da equipe, e a de administrador não envia como lacre.

| Situação | Resposta nas rotas da equipe |
| --- | --- |
| Chave certa | A rota responde |
| Sem a chave ou com a chave errada | `401` |
| `ADMIN_API_KEY` não definida, ou com menos de 16 caracteres | `503` (rotas fechadas) |
| `ROTAS_DA_EQUIPE_ABERTAS=true` no `.env` | A rota responde sem chave. **Só para teste de bancada**; a API avisa ao ligar e no `/health` |

O `/health` mostra a situação em `rotas_da_equipe`: `PROTEGIDAS`, `FECHADAS_SEM_CHAVE_CONFIGURADA` ou `ABERTAS_SEM_CHAVE`.

### 2.2 Chave do dispositivo

- A Oxide guarda só o **hash** da chave. Quem abrir o `oxide.db` não descobre a chave de nenhum lacre.
- No cadastro de bancada (`POST /api/v1/devices`), a chave enviada é transformada em hash na hora.
- Banco de versão anterior, que guardava a chave em texto: ao ligar, a API troca o texto pelo hash. O lacre continua entrando com a mesma chave.

## 3. Quem pode chamar o quê

| Rotas | Quem | Chave |
| --- | --- | --- |
| `POST /api/v1/iot/activations`, `/telemetries`, `/events`, `/alerts` | Lacre | `X-API-Key` do próprio dispositivo |
| `GET /api/v1/iot/commands/{device_id}`, `POST /api/v1/iot/commands/confirm` | Lacre | `X-API-Key` do próprio dispositivo |
| `GET` e `POST /api/v1/devices`, `GET /api/v1/devices/{device_id}` | Equipe | `X-Admin-Key` |
| `GET /api/v1/iot/messages` | Equipe | `X-Admin-Key` |
| `GET /api/v1/sync/status`, `/sync/problems`, `POST /api/v1/sync/retry` | Equipe | `X-Admin-Key` |
| `GET /metrics` | Equipe | `X-Admin-Key` |
| `GET /`, `GET /health`, `GET /api-docs` | Qualquer um | Nenhuma. Não mostram chave nem dado de lacre |

No Swagger (`/api-docs`), o botão **Authorize** tem os dois campos: a chave do dispositivo e a chave de administrador.

## 4. Limites

| Limite | Padrão | Variável no `.env` | O que acontece ao passar |
| --- | --- | --- | --- |
| Mensagens por lacre, por minuto | 120 | `LIMITE_MENSAGENS_POR_MINUTO` | `429` para aquele lacre até a janela acabar. Os outros lacres não são afetados |
| Chaves erradas por endereço, por minuto | 60 | `LIMITE_FALHAS_DE_CHAVE_POR_MINUTO` | `429` para aquele endereço, mesmo com a chave certa, até a janela acabar |
| Tamanho do pedido | 32 KB | — | `413` |

- A resposta `429` traz o cabeçalho `Retry-After`, com quantos segundos esperar.
- **Para o lacre:** `429` significa "espere e envie de novo, com o mesmo `message_id`". A mensagem não foi gravada.
- As contagens ficam na memória da API e zeram quando ela reinicia.
- **Vários lacres atrás do mesmo endereço** (mesmo roteador): eles dividem o limite de chaves erradas. Um lacre com a chave errada, insistindo sem parar, pode bloquear os outros por até 1 minuto. Por isso o firmware não deve insistir quando recebe `401` ou `403`.

## 5. HTTPS

Há dois jeitos. Em rede local de teste, a API pode ficar em HTTP.

**Direto na API.** Coloque no `.env` o caminho do certificado e da chave dele:

```text
HTTPS_CERT_FILE=C:\certificados\api.crt
HTTPS_KEY_FILE=C:\certificados\api.key
```

A API passa a atender só em HTTPS, na mesma porta, e manda o cabeçalho `Strict-Transport-Security`.

**Com um proxy na frente** (nginx, Caddy ou parecido), que cuida do certificado e repassa para a API em HTTP. Nesse caso, coloque `PROXY_CONFIAVEL=true` no `.env`, para os limites por endereço usarem o endereço de quem chamou, e não o do proxy.

Em toda resposta a API manda os cabeçalhos `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` e `Referrer-Policy: no-referrer`, e não informa qual programa é.

## 6. Gravação garantida

Por padrão, a API só responde ao lacre depois que a mensagem está gravada no disco. Assim, um corte de energia não leva o que já foi confirmado.

| Modo | `.env` | Efeito |
| --- | --- | --- |
| Garantida (padrão) | nada, ou `GRAVACAO_GARANTIDA=true` | Cada mensagem confirmada está no disco |
| Rápida | `GRAVACAO_GARANTIDA=false` | Mais rápida. Um corte de energia pode levar as mensagens do último instante; o banco não corrompe |

Medido no teste em massa (500 lacres, 40 enviando ao mesmo tempo, sem pausa):

| Medida | Garantida | Rápida |
| --- | --- | --- |
| Pedidos por segundo | 226 | 607 |
| Metade das respostas em até | 99 ms | 37 ms |
| 95% das respostas em até | 536 ms | 82 ms |
| Resposta mais lenta | 3.046 ms | 328 ms |

Para comparar: 600 lacres enviando uma leitura por minuto são 10 pedidos por segundo. O modo garantido atende isso com folga.

**Sobre os testes de 10/10/2026:** os números de velocidade publicados naquele dia (cerca de 600 pedidos por segundo) foram medidos no modo rápido, que era o padrão do componente de banco. O modo garantido passou a ser o padrão em 11/10/2026.

## 7. Métricas

`GET /metrics`, com a chave de administrador. Com `?formato=prometheus`, responde em texto.

| Parte | O que mostra |
| --- | --- |
| `pedidos` | Total, respostas por classe (`2xx`, `4xx`, `5xx`), recusados por limite (`429`) e, por rota, a quantidade, o tempo médio e o mais lento |
| `tempo_de_resposta_ms` | Dos últimos 5.000 pedidos: metade até, 95%, 99% e o mais lento |
| `fila` | Pendentes, enviando, com nova tentativa, paradas, enviadas, arquivadas e há quantos segundos a mensagem mais antiga espera |
| `comandos_pendentes` | Comandos de válvula que o lacre ainda não buscou ou confirmou |
| `banco` | Tamanho do `oxide.db` e do arquivo WAL |
| `memoria_mb` | Memória usada pela API |
| `worker` | Última rodada e o resultado |

Os contadores de pedidos ficam na memória e zeram quando a API reinicia. As rotas aparecem pelo nome declarado, sem o código dos dispositivos.

## 8. Vigia

`npm run vigia` confere a cada minuto e avisa quando algo sai do normal. Cada problema é avisado **quando aparece** e **quando se resolve**.

| Problema | Quando | Ajuste no `.env` |
| --- | --- | --- |
| `API_FORA_DO_AR` | A API não responde | `VIGIA_API_URL` |
| `BANCO_PRINCIPAL_FORA_DO_AR` | A última rodada do Worker falhou | — |
| `WORKER_PARADO` | O Worker não faz uma rodada há mais de 5 minutos | `VIGIA_WORKER_PARADO_MIN` |
| `FILA_GRANDE` | Mais de 5.000 mensagens esperando | `VIGIA_FILA_MAXIMA` |
| `FILA_ATRASADA` | A mensagem mais antiga espera há mais de 30 minutos | `VIGIA_ESPERA_MAXIMA_MIN` |
| `MENSAGENS_PARADAS` | Há mensagem recusada pelo banco principal ou sem tentativas | — |
| `BANCO_GRANDE` | O `oxide.db` passou de 1.024 MB | `VIGIA_BANCO_MAXIMO_MB` |

Onde o aviso aparece:

- na tela;
- no arquivo `oxide-alertas.log`, na pasta da API;
- num endereço que você configurar em `VIGIA_WEBHOOK_URL`: o vigia faz um `POST` com `quando`, `situacao` (`ABERTO` ou `RESOLVIDO`), `problema`, `detalhe` e `text`. Serve para mandar o aviso a um chat ou a um celular.

`npm run vigia -- --once` confere uma vez e sai (código 1 se houver problema), para usar numa tarefa agendada.

## 9. Manter tudo ligado

`npm run servico` liga a API, o Worker e o vigia, e cuida deles:

- **Religa** o que parar, esperando um pouco mais a cada queda seguida (1, 2, 4… até 30 segundos).
- **Backup diário** na hora de `BACKUP_HORA` (padrão `03:00`).
- **Registros** na pasta `logs/`, um arquivo por dia para cada parte (`api-`, `worker-`, `vigia-`, `backup-` e `servico-`).
- **Para parar:** `Ctrl+C`, ou `npm run servico -- --parar` de outro terminal.

### Ligar junto com o computador (Windows)

1. Abra o **Agendador de Tarefas** e escolha **Criar Tarefa**.
2. Em **Disparadores**, crie um novo: **Ao inicializar**.
3. Em **Ações**, crie uma nova: programa `cmd.exe`, argumentos `/c npm run servico`, e em **Iniciar em** a pasta do projeto.
4. Em **Geral**, marque **Executar estando o usuário conectado ou não**.

No Linux, o equivalente é um serviço do systemd que roda `npm run servico` na pasta do projeto.

## 10. Lista para colocar em uso

- [ ] `ADMIN_API_KEY` gerada e colocada no `.env`.
- [ ] `ROTAS_DA_EQUIPE_ABERTAS` **fora** do `.env` (ou `false`).
- [ ] `SUPABASE_IOT_URL` e `SUPABASE_SERVICE_KEY` no `.env`.
- [ ] HTTPS: certificado no `.env` ou proxy na frente.
- [ ] `npm run servico` agendado para ligar com o computador.
- [ ] `VIGIA_WEBHOOK_URL` apontando para onde alguém vê o aviso.
- [ ] Banco fora de pasta sincronizada (OneDrive e parecidos).
- [ ] Comandos de exemplo apagados do banco: `DELETE FROM commands WHERE command_id LIKE 'CMD-EXEMPLO-%';`
- [ ] Dispositivos de teste desativados ou com chave nova.

## 11. O que ainda não está coberto

- **Uma chave de administrador só.** Não há usuários nem perfis: quem tem a chave pode tudo nas rotas da equipe. O controle por pessoa fica no sistema principal.
- **Limites na memória de uma API só.** Zeram ao reiniciar e não valem entre duas APIs rodando ao mesmo tempo.
- **Corte de energia de verdade não foi testado.** O teste de desligamento (`npm run simular:desligamento`) encerra os programas à força, com o sistema operacional de pé. A gravação garantida existe para o corte de energia, mas só um teste com o equipamento prova.
- **Chaves de teste antigas no histórico do Git.** O repositório é público, e versões antigas do `oxide.db` têm as chaves de teste em texto. Elas não devem ser usadas em lacre real.
- **Registros sem limite de tamanho.** A pasta `logs/` tem um arquivo por dia, mas nada apaga os antigos.

## 12. Histórico do documento

| Versão | Data | Mudança |
| --- | --- | --- |
| 1.0 | 11/10/2026 | Primeira versão: chave de administrador, chave do lacre só em hash, limites, HTTPS, gravação garantida, métricas, vigia e serviço |
