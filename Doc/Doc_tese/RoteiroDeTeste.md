# Roteiro de Teste para IA — API do lacre (FluxID / Oxide IoT)

**Versão:** 2.0
**Data:** 10/10/2026
**Uso:** instruções executáveis para uma IA (ou pessoa) testar a API do lacre e produzir um relatório padronizado.
**Base:** `Doc/Doc_tese/PlanoDeTeste.md`, seção 0 (IDs dos casos entre colchetes, ex.: `[V2-TEL-06]`).

> A versão 1.x deste roteiro testava o modelo anterior (filas separadas, lacres, cilindros e envio ao FluxID), com dezenas de chamadas manuais no `oxide.db` real. Ela está no histórico do Git até o PR #19. No modelo enxuto, quase tudo é automático e roda fora do banco do projeto.

---

## 1. Papel e regras de conduta

1. Execute os passos na ordem. Não pule nem "adapte" um passo sem registrar.
2. **Não altere o código** durante o teste. Defeito encontrado vira achado no relatório.
3. **Nunca toque no `oxide.db` do projeto.** Os testes automáticos usam pasta temporária. O passo 4 usa uma **cópia**.
4. **Nunca use o banco principal (Supabase) neste roteiro**, salvo o passo 6, que só roda quando o responsável pedir.
5. **Nunca registre chave ou senha** no relatório. Credenciais ficam só no `.env`.
6. Registre a saída real de cada comando. Não deduza resultado.
7. Se uma condição de parada (seção 7) acontecer, pare e relate.

## 2. Contexto do sistema

```text
Lacre (ESP32) ──► API (valida) ──► Oxide (fila: mensagens) ──► Worker ──► Supabase
```

- Toda leitura, evento e alerta do lacre precisa de posição e bateria.
- A fila local tem três tabelas: `devices`, `mensagens` e `commands`.
- Nos testes, o Supabase é substituído por um **recebedor de teste** (`src/simulador/recebedor.ts`), que segue o `Contrato-Entrega-Supabase.md`.

## 3. Testes automáticos

Rode na raiz do projeto. A API do projeto pode ficar ligada: os testes usam outras portas (3197 e 3199).

```bash
# Checksum do banco do projeto, para conferir no fim que nada mudou
sha256sum oxide.db

# [compilação] Esperado: nenhuma saída
npx tsc --noEmit

# [V2-GER-01 a V2-OPE-02] Esperado: "Total de Testes: 71", "Passaram: 71", "Falharam: 0"
npm test 2>&1 | grep -E "❌|Total de Testes|Passaram|Falharam"

# [simulador] Esperado: "Resultado: 23 de 23 verificações conforme; 0 falha(s)."
npm run simular 2>&1 | grep -E "^❌|^===|Resultado:"

# Esperado: o mesmo checksum do começo
sha256sum oxide.db
```

A linha `SyntaxError: Expected property name` na saída da suíte é esperada: é o caso que envia um JSON quebrado de propósito.

## 4. Migração numa cópia do banco real [V2-MIG-01]

Mostra o que vai acontecer com o `oxide.db` do projeto quando a API nova subir.

```bash
mkdir -p /tmp/rt-migracao && cp oxide.db /tmp/rt-migracao/oxide.db
P="$(pwd)"
(cd /tmp/rt-migracao && TS_NODE_PROJECT="$P/tsconfig.json" node --require "$P/node_modules/ts-node/register" "$P/src/database/connection.ts")
(cd /tmp/rt-migracao && ls | grep bak && node -e "
const D=require('$P/node_modules/better-sqlite3');const d=new D('oxide.db',{readonly:true});
console.log(d.prepare(\"select name from sqlite_master where type='table' and name not like 'sqlite_%' order by 1\").all().map(t=>t.name).join(','));
console.log(d.prepare('select tipo,status,count(*) n from mensagens group by 1,2').all());
console.log(d.pragma('integrity_check',{simple:true}), d.pragma('foreign_key_check').length);")
```

**Esperado:**
- a mensagem "Modelo antigo encontrado. Cópia de segurança: ..." e um arquivo `oxide.db.bak-antes-da-fila-unica-<data>`;
- tabelas: `commands,devices,mensagens`;
- as leituras antigas com posição e bateria como `PENDING`, e as demais mensagens antigas como `ARQUIVADA`;
- `ok` e `0` (banco íntegro, sem chave estrangeira quebrada).

Se o banco copiado já estiver no modelo novo, não há migração: registre "já migrado".

## 5. Conferência manual rápida (opcional)

Com a API do projeto ligada (`npm run dev`), para ver com os próprios olhos. **Atenção:** estes comandos gravam no `oxide.db` do projeto. Só rode se o responsável pedir.

```bash
BASE=http://localhost:3000
curl -s $BASE/health
curl -s -X POST $BASE/api/v1/devices -H "content-type: application/json" -d '{"device_id":"DSP-RT-1","api_key":"key-rt-1"}'
# Esperado: 202
curl -s -X POST $BASE/api/v1/iot/telemetries -H "content-type: application/json" -H "x-api-key: key-rt-1" \
  -d '{"message_id":"MSG-RT-1","device_id":"DSP-RT-1","latitude":-7.21,"longitude":-39.31,"battery_percent":80}'
# Esperado: 400 "latitude, longitude e battery_percent são obrigatórios"
curl -s -X POST $BASE/api/v1/iot/telemetries -H "content-type: application/json" -H "x-api-key: key-rt-1" \
  -d '{"message_id":"MSG-RT-2","device_id":"DSP-RT-1","latitude":-7.21,"longitude":-39.31}'
curl -s "$BASE/api/v1/iot/messages?device_id=DSP-RT-1"
curl -s $BASE/api/v1/sync/status
```

## 6. Envio ao Supabase de verdade [V2-INT-01]

**Só quando a função de recebimento existir** e o responsável tiver colocado `SUPABASE_IOT_URL` e `SUPABASE_SERVICE_KEY` no `.env`.

```bash
npm run worker -- --once
curl -s http://localhost:3000/api/v1/sync/status
curl -s http://localhost:3000/api/v1/sync/problems
```

**Esperado:** rodada `OK`; mensagens `SYNCED`; nada em `problems`. Confira no Supabase se as mensagens chegaram. Sem a função no ar, marque `NÃO EXECUTADO – depende do Supabase`.

## 7. Condições de parada

Pare e relate se:
- a compilação falhar;
- o checksum do `oxide.db` do projeto mudar depois do passo 3;
- a suíte ou o simulador não terminarem;
- algum passo pedir uma chave ou senha que não esteja no `.env`.

## 8. Classificação de resultado

| Resultado | Quando |
| --- | --- |
| `PASSOU` | A saída é a esperada |
| `FALHOU` | A saída é diferente da esperada |
| `ACHADO` | O sistema funciona, mas o comportamento merece decisão do responsável |
| `NÃO EXECUTADO` | Com o motivo (ex.: depende do Supabase ou do equipamento) |

## 9. Formato do relatório (entregar em Markdown)

Arquivo: `Doc/Doc_tese/Relatorio-de-Teste-AAAA-MM-DD-HHhMM.md`, com:

1. **Resumo:** tabela com compilação, suíte, simulador, migração, checksum do banco do projeto, falhas e achados.
2. **O que mudou** nesta entrega.
3. **Resultados** por passo deste roteiro.
4. **Defeitos e achados.**
5. **O que não foi executado** e por quê.
6. **Questionário de validação** para o responsável (perguntas de sim ou não).

## 10. Prompt sugerido para entregar a outra IA

```text
Você vai testar a API do lacre deste repositório seguindo Doc/Doc_tese/RoteiroDeTeste.md.
Leia o roteiro inteiro antes de começar. Execute as seções 3 e 4 na ordem, registre a saída
real de cada comando e não altere o código. Não toque no oxide.db do projeto nem no Supabase.
Não registre chaves nem senhas. Ao final, entregue o relatório no formato da seção 9.
```

## 11. Histórico do documento

| Versão | Data | Descrição |
| --- | --- | --- |
| 1.0 a 1.10 | 05 a 07/10/2026 | Roteiro do modelo anterior: casos manuais por rota no `oxide.db` real (com backup e restauração) e seção do Worker contra o FluxID de análise no Docker. Última execução em 07/10/2026, sem falhas |
| 2.0 | 10/10/2026 | Modelo enxuto: suíte e simulador em pasta temporária com recebedor de teste; migração numa cópia do banco real; passo do Supabase de verdade para quando a função existir |
