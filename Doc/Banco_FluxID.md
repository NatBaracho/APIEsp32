
# FluxID  

> **Referência histórica (10/10/2026).** O banco principal do projeto passou a ser o **Supabase** do repositório `fluxid_integra2026`. Este banco FluxID em PostgreSQL e os scripts de `sql/fluxid/` ficam só como banco de teste e registro do que foi estudado. O que vale hoje: [Contrato-Entrega-Supabase.md](Contrato-Entrega-Supabase.md).
### Especificação Atualizada do MVP e do Banco de Dados  
**Segurança • Rastreabilidade • Controle Operacional**  
**Versão 3.3 — revisada em 07/10/2026: integração com a Oxide (script 004) e estruturas do frontend (script 005)**  
Documento substitutivo da versão 1 anexada

---

## 1. Controle da atualização
Esta versão atualiza integralmente o documento *FluxID_Especificacao_MVP_v1.docx* com todas as decisões tomadas durante a modelagem, a estrutura efetivamente criada no PostgreSQL e a massa de testes confirmada no pgAdmin.

| Item | Situação atual |
|------|----------------|
| Escopo do MVP | Congelado: segurança, rastreabilidade e controle operacional |
| Modelo de dados | Criado e populado para testes |
| Telemetria atual | Latitude e longitude em colunas NUMERIC |
| PostGIS | Planejado para evolução de geocercas; ainda não refletido na tabela atual de telemetria |
| Views e triggers | Adiados para depois dos testes CRUD da API |
| Ajustes da entrega E e do script 003 | Scripts versionados em `sql/fluxid/` (seção 17), validados em servidor PostgreSQL temporário; aguardando aplicação no banco e novo dump |
| Próxima fase | API NestJS + TypeScript conectada ao PostgreSQL |

---

## 2. Visão do produto e cadeia de negócio
FluxID → Distribuidora de gases (cliente da FluxID) → Hospital, clínica ou indústria (cliente final da distribuidora)

- A FluxID não vende gás, cilindros ou transporte.  
- A FluxID fornece plataforma, lacres inteligentes, rastreabilidade e controle operacional.  
- O cilindro é o ativo principal do MVP.  
- O cilindro continua pertencendo à distribuidora; no destinatário ocorre transferência de custódia, não de propriedade.  
- O cliente final não possui login no MVP.  
- Usuário é somente a pessoa que opera o sistema.  
- A FluxID administra o ambiente global e mantém governança sobre dados sensíveis.

---

## 3. Escopo final do MVP

### Pilar → Entregas do MVP

**Segurança**  
Integridade do lacre, eventos de abertura/violação, alertas, controle de acesso, permissões e auditoria.

**Rastreabilidade**  
GPS, velocidade, histórico de telemetria, vínculos, movimentações, entregas e custódias.

**Controle operacional**  
Cadastros, estados de ativos, busca amigável, testes hidrostáticos, inspeções e consultas gerenciais.

### Fora do MVP
- Financeiro e faturamento  
- Portal do cliente final  
- Gestão de contratos avançada  
- Outros ativos além de cilindros  
- Inteligência artificial e previsão de perdas  
- Integração produtiva com ERP  
- Workflow avançado de aprovações  

---

## 4. Regras de negócio consolidadas

| Código | Regra |
|--------|-------|
| RN01 | Cada entidade operacional relevante possui UUID interno e código humano pesquisável, como CIL-000001 e LCR-000001. |
| RN02 | Cada cilindro possui número de série único no escopo da organização. |
| RN03 | Cada lacre possui código e UID NFC únicos; cada dispositivo possui identificador de hardware único. |
| RN04 | Um cilindro pode ter somente um lacre ativo por vez e um lacre somente um cilindro ativo por vez. |
| RN05 | Um lacre pode ter somente um dispositivo ativo por vez e o histórico de trocas deve ser preservado. |
| RN06 | O cilindro continua sendo propriedade da distribuidora; a entrega abre a custódia no destinatário. |
| RN07 | Movimentações e entregas podem conter vários cilindros para suportar leitura em lote. |
| RN08 | O lacre permanece fechado no transporte; manipulação não autorizada gera evento e alerta. |
| RN09 | Abertura no cliente só é regular com autorização registrada. |
| RN10 | Após a entrega, o cilindro deve permanecer na geocerca do local; referência inicial de 10 metros, configurável. |
| RN11 | Saída da área permitida, movimento incompatível ou violação sem autorização gera alerta. |
| RN12 | A velocidade enviada pelo GPS deve ser armazenada para investigação operacional e forense. |
| RN13 | A telemetria armazena data, posição, velocidade, bateria, sinal GSM e payload bruto. |
| RN14 | message_id deve ser único para impedir telemetria duplicada. |
| RN15 | O próximo teste hidrostático é obrigatório no ciclo operacional e gera alerta de vencimento. |
| RN16 | O lacre possui revisão a cada cinco anos e pode ser reutilizado se aprovado em inspeção. |
| RN17 | Estados de cilindros, lacres, entregas e alertas usam valores controlados. |
| RN18 | Usuários pertencem a uma organização e recebem acesso por perfis e permissões. |
| RN19 | O administrador pode conceder acesso dentro do próprio escopo; ações privilegiadas devem ser auditadas. |
| RN20 | Toda alteração relevante registra usuário, instante, entidade, registro e valores anterior e novo. |
| RN21 | Histórico operacional não deve ser apagado fisicamente no fluxo normal. |
| RN22 | A organização A não pode consultar ou alterar dados da organização B. |
| RN23 | Alertas possuem código humano, tipo, severidade, estado, abertura e encerramento rastreáveis. |

---

## 5. Requisitos funcionais

| Código | Requisito |
|--------|-----------|
| RF01 | Gerenciar organizações e seus contatos. |
| RF02 | Gerenciar usuários, perfis, permissões e vínculos de acesso. |
| RF03 | Gerenciar destinatários e locais de entrega. |
| RF04 | Executar CRUD de cilindros, lacres e dispositivos. |
| RF05 | Vincular e desvincular cilindro, lacre e dispositivo mantendo histórico. |
| RF06 | Criar movimentações e itens em lote. |
| RF07 | Criar entregas, itens e custodias. |
| RF08 | Receber, armazenar e consultar telemetria. |
| RF09 | Registrar eventos do lacre e associá-los à telemetria quando disponível. |
| RF10 | Gerar, listar, analisar e encerrar alertas. |
| RF11 | Registrar testes hidrostáticos e próximo vencimento. |
| RF12 | Registrar inspeções de lacre e decisão de reutilização. |
| RF13 | Pesquisar por código, número de série, UID NFC e identificador de hardware. |
| RF14 | Exibir contagens por estado para futura composição do dashboard. |
| RF15 | Auditar ações críticas dos usuários. |
| RF16 | Disponibilizar CRUD via API REST documentada. |

---

## 6. Requisitos não funcionais

| Código | Requisito |
|--------|-----------|
| RNF01 | PostgreSQL como banco transacional; PostGIS planejado para consultas geográficas de produção. |
| RNF02 | API em NestJS e TypeScript, com Swagger e validação de DTOs. |
| RNF03 | Autenticação JWT e autorização por perfis/permissões. |
| RNF04 | Senhas somente com hash forte; segredos em arquivo .env não versionado. |
| RNF05 | Isolamento multiempresa e princípio do menor privilégio. |
| RNF06 | TIMESTAMPTZ para instantes e padrão UTC no backend. |
| RNF07 | Integridade referencial, constraints, transações e índices para regras críticas. |
| RNF08 | Telemetria indexada por dispositivo e data; message_id único. |
| RNF09 | Operações compostas de vínculo, entrega e custódia devem ser transacionais. |
| RNF10 | API deve retornar erros padronizados e não expor detalhes sensíveis. |
| RNF11 | Logs, auditoria, backup, RPO, RTO e retenção deverão ser formalizados antes da produção. |
| RNF12 | Tratamento de dados pessoais conforme LGPD. |
| RNF13 | A API deve usar usuário PostgreSQL próprio, sem privilégios de superusuário. |
| RNF14 | Código humano deve ser pesquisável sem exposição do UUID ao usuário final. |

---

## 7. Modelo Entidade–Relacionamento
O MER abaixo representa a arquitetura lógica consolidada.  
A implementação atual mantém latitude/longitude numéricas; a coluna *geography* do desenho é a evolução planejada para PostGIS.

*(Imagem não incluída no documento original)*

---

## 8. Estrutura do banco criada

### Módulo → Tabelas

**Identidade e acesso**  
organizacoes; organizacao_contatos; usuarios; perfis; permissoes; perfil_permissoes; usuario_perfis

**Clientes finais e locais**  
destinatarios; locais_entrega

**Ativos**  
cilindros; lacres; dispositivos

**Histórico de vínculos**  
vinculos_cilindro_lacre; vinculos_dispositivo_lacre

**Logística**  
movimentacoes; movimentacao_itens; entregas; entrega_itens; custodias

**IoT e segurança**  
telemetrias; eventos_lacre; alertas

**Conformidade**  
testes_hidrostaticos; inspecoes_lacre

**Governança**  
auditoria

---

## 9. Explicação detalhada das tabelas

*(Mantido exatamente como no documento, agora em Markdown)*

- **organizacoes** — Representa a FluxID no contexto administrativo e as distribuidoras contratantes. Possui código, dados empresariais e estado.  
- **organizacao_contatos** — Permite vários números e responsáveis por organização.  
- **usuarios** — Pessoas que acessam o sistema; vinculadas à organização e usadas como responsáveis por operações.  
- **perfis / permissoes** — Implementam RBAC; as tabelas associativas ligam usuários a perfis e perfis a permissões.  
- **destinatarios** — Hospitais, clínicas e indústrias atendidos pelas distribuidoras; não possuem login no MVP.  
- **locais_entrega** — Pontos físicos dos destinatários, com endereço, coordenadas e raio permitido.  
- **cilindros** — Ativo principal, com código amigável, série, tipo, capacidade e estado atual.  
- **lacres** — Ativo de segurança com UID NFC, fabricação, próxima revisão e estado.  
- **dispositivos** — Módulo eletrônico responsável por telemetria, firmware e hardware.  
- **vinculos_cilindro_lacre** — Histórico de instalação e remoção do lacre no cilindro.  
- **vinculos_dispositivo_lacre** — Histórico de associação do dispositivo ao lacre.  
- **movimentacoes / itens** — Registram eventos operacionais em lote.  
- **entregas / itens** — Representam a missão de entrega e seus cilindros.  
- **custodias** — Registra o local e o intervalo de posse temporária do cilindro.  
- **telemetrias** — Latitude, longitude, velocidade, bateria, sinal GSM, payload JSONB e message_id.  
- **eventos_lacre** — Abertura, fechamento, violação, instalação, remoção e troca.  
- **alertas** — Ocorrências acionáveis com tipo, severidade, estado e tratamento.  
- **testes_hidrostaticos** — Histórico do teste do cilindro e próxima data.  
- **inspecoes_lacre** — Histórico da revisão quinquenal e decisão de reutilizar ou inutilizar.  
- **auditoria** — Registra usuário, organização, ação, entidade, registro, valores anterior/novo, IP e instante.

---

## 10. Estados e códigos utilizados

Valores conferidos nos `CHECK` do dump:

| Entidade | Padrão / estados |
|----------|------------------|
| Organização | ORG-000001; ATIVA, INATIVA, SUSPENSA |
| Contato da organização | tipo COMERCIAL, FINANCEIRO, LOGISTICA, SUPORTE, EMERGENCIA, OUTRO |
| Cilindro | CIL-000001; DISPONIVEL, EM_TRANSITO, COM_CLIENTE, MANUTENCAO, EXTRAVIADO, INATIVO |
| Lacre | LCR-000001; EM_ESTOQUE, INSTALADO, SUSPEITA_VIOLACAO, ROMPIDO, REMOVIDO, DANIFICADO, INUTILIZADO |
| Dispositivo | DSP-000001; ativo/inativo (booleano). O código é o mesmo `device_id` usado pela API Oxide |
| Entrega | ENT-000001; PENDENTE, EM_ANDAMENTO, CONCLUIDA, CANCELADA |
| Movimentação | MOV-000001; CARGA, DESCARGA, ENTREGA, RECOLHIMENTO, TRANSFERENCIA, INVENTARIO |
| Evento do lacre | ABERTURA_AUTORIZADA, ABERTURA_NAO_AUTORIZADA, FECHAMENTO, VIOLACAO, INSTALACAO, REMOCAO, TROCA |
| Alerta | ALT-000001; tipo VIOLACAO_LACRE, ABERTURA_NAO_AUTORIZADA, SAIDA_GEOCERCA, MOVIMENTACAO_SUSPEITA, BATERIA_BAIXA, SEM_COMUNICACAO, TESTE_HIDROSTATICO, REVISAO_LACRE; status ABERTO, EM_ANALISE, ENCERRADO; severidade BAIXA, MEDIA, ALTA, CRITICA |
| Teste hidrostático | APROVADO, REPROVADO |
| Inspeção do lacre | APROVADO, APROVADO_COM_RESTRICAO, REPROVADO, INUTILIZADO |
| Auditoria | INSERT, UPDATE, DELETE, LOGIN, LOGOUT, AUTORIZACAO |

---

## 11. Massa de testes confirmada

Contagens conferidas no dump de 23/09/2026 (todas as tabelas):

| Tabela | Registros | Tabela | Registros |
|--------|-----------|--------|-----------|
| organizacoes | 3 | telemetrias | 200 |
| organizacao_contatos | 3 | eventos_lacre | 10 |
| usuarios | 3 | alertas | 10 |
| perfis | 6 | testes_hidrostaticos | 50 |
| permissoes | 10 | inspecoes_lacre | 50 |
| perfil_permissoes | 0 (34 após o script 002) | vinculos_cilindro_lacre | 30 (todos ativos) |
| usuario_perfis | 0 (3 após o script 002) | vinculos_dispositivo_lacre | 30 (todos ativos) |
| destinatarios | 20 | entregas | 10 (todas CONCLUIDA) |
| locais_entrega | 20 | entrega_itens | 30 |
| cilindros | 50 | custodias | 30 (todas ativas) |
| lacres | 50 | movimentacoes | 0 |
| dispositivos | 50 | movimentacao_itens | 0 |
| auditoria | 3 | | |

A massa é sintética e destinada exclusivamente a desenvolvimento e testes. As incoerências encontradas e a correção estão na seção 17.2.

---

## 12. Situação atual e pendências técnicas

- A carga de dados principal foi concluída e validada por contagens no pgAdmin.  
- A tabela telemetrias atual usa latitude e longitude NUMERIC; migração para PostGIS é necessária antes da geocerca de produção.  
- Views de dashboard e última posição serão criadas depois dos testes CRUD.  
- Triggers de auditoria e atualização automática serão criadas depois da API inicial.  
- Índices únicos parciais confirmados no dump: `uq_cilindro_vinculo_ativo`, `uq_lacre_vinculo_ativo`, `uq_dispositivo_ativo`, `uq_lacre_dispositivo_ativo` e `uq_custodia_ativa` (RN04, RN05 e custódia ativa única).
- A extensão PostGIS já está instalada no banco, embora ainda não usada pelas tabelas.
- As tabelas não geravam UUID sozinhas (sem `DEFAULT`); corrigido pelo script 001.  
- O banco possui apenas três usuários de teste; os demais serão criados pela API.  
- Políticas de RLS, backup, retenção, LGPD e observabilidade devem ser fechadas antes da publicação.

---

## 13. Próxima fase — API REST em TypeScript

### Stack recomendada
NestJS + TypeScript + PostgreSQL + Prisma (ou TypeORM após decisão) + JWT + Swagger

### Sequência de implementação
1. Criar o projeto NestJS.  
2. Criar usuário PostgreSQL exclusivo da aplicação.  
3. Configurar .env e conexão com o banco.  
4. Testar a conexão e mapear as tabelas existentes.  
5. Implementar tratamento global de erros e validação de DTOs.  
6. Criar autenticação e autorização.  
7. Implementar CRUD de organizações, usuários, destinatários e locais.  
8. Implementar CRUD de cilindros, lacres e dispositivos.  
9. Implementar vínculos, entregas, movimentações e custódias em transações.  
10. Implementar telemetria, eventos e alertas.  
11. Testar todos os endpoints no Swagger/Postman.  
12. Somente depois criar views e triggers.

---

## 14. CRUD e rotas iniciais previstas

| Recurso | Rotas |
|---------|-------|
| Organizações | GET /organizacoes; GET /organizacoes/:id; POST; PATCH; desativação lógica |
| Usuários | CRUD, ativação/desativação e associação de perfis |
| Destinatários | CRUD e consulta por organização |
| Locais de entrega | CRUD e consulta por destinatário |
| Cilindros | CRUD, filtros por status, código e série |
| Lacres | CRUD, filtros por estado e histórico de vínculo |
| Dispositivos | CRUD e versão de firmware |
| Vínculos | vincular/remover lacre; vincular/remover dispositivo |
| Entregas | criar, iniciar, concluir, cancelar e consultar itens |
| Movimentações | registrar operações em lote |
| Custódias | abrir, encerrar e consultar histórico |
| Telemetrias | POST de ingestão; consultas por dispositivo/cilindro |
| Alertas | listar, analisar e encerrar |
| Conformidade | CRUD de testes hidrostáticos e inspeções |

---

## 15. Critérios de aceite da próxima fase

- API conecta ao banco usando usuário sem privilégio de superusuário.  
- Swagger exibe e executa todas as rotas CRUD.  
- DTOs rejeitam dados inválidos.  
- Acesso respeita organização e permissões.  
- Operações compostas usam transação.  
- DELETE físico não é usado em histórico operacional.  
- Erros de chave única e chave estrangeira são convertidos em respostas HTTP legíveis.  
- Cada alteração crítica fornece contexto suficiente para futura auditoria automática.

---

## 16. Assunções e ressalvas

- Os números da massa de testes foram extraídos das contagens mostradas pelo usuário no pgAdmin.  
- O MER ainda apresenta a evolução PostGIS, enquanto a tabela telemetrias existente usa latitude/longitude; essa diferença está explicitamente documentada.  
- Não foram inventados SLA, RPO, RTO, frequência real de telemetria ou prazos de alerta; esses itens permanecem para definição.  
- Este documento descreve o estado conhecido do projeto, mas o schema SQL e as futuras migrations devem permanecer como fonte executável versionada.

---

---

## 17. Revisão da entrega E (06/10/2026)

Análise do dump `FluxID.sql` de 23/09/2026 e ajustes aprovados por **Natã da Silva Baracho**. Os scripts ficam em `sql/fluxid/`, podem ser executados mais de uma vez e rodam em transação. Foram validados num servidor PostgreSQL 18.6 temporário, separado do banco principal: restauração do dump sem erros, duas execuções seguidas (a segunda sem nenhuma alteração) e testes das regras novas.

### 17.1 Ajustes de estrutura — `001_ajustes_estrutura.sql`

| Ajuste | Motivo |
| --- | --- |
| `DEFAULT gen_random_uuid()` no `id` das 21 tabelas | O banco passa a gerar os UUIDs; a API não precisa |
| Índice `idx_telemetria_dispositivo_data (dispositivo_id, data_coleta DESC)` | Última posição de cada dispositivo (RNF08) |
| `eventos_lacre.message_id`, único quando informado | Idempotência dos eventos vindos da Oxide |
| Remoção de `idx_dispositivos_hardware` | Redundante: o `UNIQUE` de `identificador_hardware` já cria índice |
| `dispositivos.api_key_hash` (SHA-256 em hexadecimal), único quando informado | Chave do dispositivo guardada só como hash (RNF04) |
| `CHECK` de faixa em `telemetrias` e `locais_entrega` (latitude -90 a 90, longitude -180 a 180) | Mesma regra da API Oxide |

### 17.2 Correção da massa de testes — `002_correcao_massa_de_testes.sql`

| Incoerência encontrada | Correção |
| --- | --- |
| Empresas reais (White Martins, Air Liquide) e seus domínios num repositório público | ORG-000002 → **Alfa Gases Industriais Ltda**; ORG-000003 → **Beta Gases Medicinais Ltda**; e-mails em `.teste`; usuários renomeados |
| 5 cilindros reprovados no teste hidrostático circulando | 2 disponíveis → `MANUTENCAO`; nos 3 que estão com cliente, o teste passa a `APROVADO` (entregas e custódias preservadas) |
| 10 lacres com violação e alerta crítico aberto ainda `INSTALADO` (RN08) | → `SUSPEITA_VIOLACAO` |
| Todos os ativos na mesma organização (RN22 sem massa de teste) | 20 cilindros, 20 lacres e 20 dispositivos sem vínculo → Beta; os 30 conjuntos vinculados ficam na Alfa. Verificado: nenhuma mistura de organizações em vínculos, entregas, alertas ou custódias |
| Usuários sem perfil e perfis sem permissão | Matriz aplicada: FLUXID_MASTER 10 permissões; ORG_ADMIN 9; SUPERVISOR 7; OPERADOR 5; AUDITOR 2; VISUALIZADOR 1. USR-000001 → FLUXID_MASTER; USR-000002 e USR-000003 → ORG_ADMIN |

Observações que continuam valendo (sem correção nesta entrega):

- 20 dispositivos sem vínculo têm telemetria (80 linhas); não se ligam a nenhum cilindro.
- Nenhum evento do lacre está ligado a uma telemetria (`telemetria_id` vazio).
- Movimentações vazias; vencimentos de testes (2030) e revisões (2031) idênticos em todos os registros.
- Senhas `HASH_PROVISORIO` (sem segredo exposto) e e-mails de teste em `teste.com`.

### 17.3 Como aplicar no banco

1. Fazer backup do banco (pgAdmin > Backup).
2. No `FluxID_db`, abrir o Query Tool e executar, nesta ordem:
   1. `sql/fluxid/001_ajustes_estrutura.sql`;
   2. `sql/fluxid/002_correcao_massa_de_testes.sql`;
   3. `sql/fluxid/003_alertas_cilindro_obrigatorio.sql` (seção 17.5);
   4. `sql/fluxid/004_integracao_oxide.sql` (seção 17.6);
   5. `sql/fluxid/005_estruturas_do_frontend.sql` (seção 17.7).

   Os cinco podem rodar mais de uma vez. Se um deles parar com erro, nada daquele script é alterado.
3. Gerar um novo dump no formato custom e substituir o `sql/fluxid/FluxID.sql` do projeto (o dump fica junto dos scripts desde 07/10/2026).
4. Pedir a conferência do novo dump (contagens e verificações das seções 17.2, 17.5, 17.6 e 17.7).

### 17.4 Integração com a Oxide

O plano de como cada dado da Oxide vira um registro do FluxID, e as decisões para o Worker, está em [Integracao-Oxide-FluxID.md](Integracao-Oxide-FluxID.md).

### 17.5 Alerta sempre ligado ao lacre e ao cilindro — `003_alertas_cilindro_obrigatorio.sql` (07/10/2026)

Decisão de **Natã da Silva Baracho**: todo alerta tem **cilindro e lacre obrigatórios**, os do vínculo válido no momento do alarme (`aberto_em`). Exceções, só para códigos de cadastro: sem cilindro, `LACRE_SEM_CILINDRO`, `DISPOSITIVO_SEM_LACRE`, `DISPOSITIVO_NAO_CADASTRADO` e `CHAVE_INVALIDA`; sem lacre, só os três últimos.

**Por quê:** o lacre está vinculado ao cilindro e o cilindro ao lacre, e essa ligação é uma das formas de provar que o cilindro pertence àquele cliente. Com o par lacre + cilindro gravado no alerta, a auditoria confere o cilindro físico e o lacre contra o cadastro. Se o lacre que disparou o alarme estiver em outro cilindro, não é o cilindro que o cliente comprou.

| Passo do script | O que faz |
| --- | --- |
| (a) Preencher | Alertas sem cilindro recebem o cilindro do vínculo lacre → cilindro **válido em `aberto_em`** (`data_inicio <= aberto_em` e `data_fim` vazia ou depois). Nunca usa um vínculo de outro momento |
| (b) Conferir | Se ainda sobrar alerta fora da regra, o script para e lista os códigos ("analisar antes de aplicar"); nada é alterado |
| (c) Proteger | `CHECK alertas_cilindro_lacre_obrigatorio_check` com a regra e as exceções |

Resultado no servidor temporário (dump + `001` + `002`): os 10 alertas de teste estavam sem cilindro; todos foram preenchidos pelo vínculo da data (`LCR-000001` → `CIL-000001` … `LCR-000010` → `CIL-000010`). Segunda execução sem alteração; demais tabelas sem mudança.

**No Worker:** o cilindro e o lacre do alerta vêm do histórico de vínculos do FluxID na data do alerta da Oxide (`created_at`). Sem vínculo naquela data, o alerta não é enviado e fica na Oxide como erro, para o gestor resolver.

**Validação também no Docker (07/10/2026):** com a virtualização habilitada, os scripts foram aplicados num container `fluxid-analise` (imagem `postgis/postgis:18-3.6`, porta `127.0.0.1:54329`, senha gerada na hora e não registrada). O container tem dois bancos: `FluxID_original` (dump sem alteração) e `FluxID_db` (dump + `001`, `002` e `003`). Resultado igual ao do servidor temporário: `001` sem erros, `002` corrigiu a massa, `003` preencheu os 10 alertas e, executado de novo, não alterou nada. O container fica disponível para análise no pgAdmin e no Docker Desktop.

**Gatilho do par lacre + cilindro (aprovado como entrega futura):** implementado no script `004` (seção 17.6).

### 17.6 Integração com a Oxide — `004_integracao_oxide.sql` (07/10/2026)

Aplica no banco as decisões P1 a P8 (`Integracao-Oxide-FluxID.md`, seção 5) e o gatilho FLX-26. Testado pela IA no Docker em 07/10/2026 (Roteiro v1.10, sem falhas). **Aprovado por Natã da Silva Baracho em 07/10/2026.**

| Passo | O que muda | Decisão |
| --- | --- | --- |
| (a) | `telemetrias.data_coleta` e `eventos_lacre.ocorrido_em` com `DEFAULT now()` | P1 |
| (b) | `telemetrias.lacre_id` e `cilindro_id` (com chave estrangeira) e índice `(cilindro_id, data_coleta)` | Mapa: onde está cada lacre e cilindro |
| (c) | Tabela `telemetrias_quarentena` (telemetria sem posição, `motivo = SEM_POSICAO`) | P2 |
| (d) | Tabela `eventos_dispositivo`; em `eventos_lacre`, as colunas `dispositivo_id`, `codigo_erro` e `payload_raw` | P4 |
| (e) | `CHECK` de `alertas.tipo` com os 28 códigos do catálogo. Tipos antigos convertidos: `VIOLACAO_LACRE` → `LACRE_VIOLADO`, `ABERTURA_NAO_AUTORIZADA` → `LACRE_ABERTO_SEM_AUTORIZACAO`, `TESTE_HIDROSTATICO` → `TESTE_HIDROSTATICO_VENCIDO`, `REVISAO_LACRE` → `LACRE_REVISAO_VENCIDA` | P5 |
| (f) | Em `alertas`: `dispositivo_id`, `encerrado_por_nome` e `motivo_encerramento`; `CHECK` de que só o `ENCERRADO` tem data de encerramento | P7 |
| (g) | Gatilho `trg_alerta_confere_vinculo`: recusa alerta cujo par lacre + cilindro não tinha vínculo em `aberto_em` | FLX-26 |
| (h) | Conferência: se algum alerta existente violar o gatilho, o script para e lista os códigos | — |

Resultado no Docker (dump + `001` a `004`): sem erros; na segunda execução, nada mudou. Os 10 alertas da massa viraram `LACRE_VIOLADO`. O gatilho recusou um alerta de `LCR-000001` com `CIL-000002`.

### 17.7 Estruturas do frontend — `005_estruturas_do_frontend.sql` (07/10/2026)

O FluxID_db é o banco definitivo (decisão de Natã da Silva Baracho, 07/10/2026). O frontend (repositório `fluxid_integra2026`) foi feito sobre um banco de teste no Supabase, com tabelas que o FluxID não tinha. O `005` replica no FluxID, no padrão dele (português), o que as telas de cilindros do frontend (etapa 006) usam e que não deixa dúvida. **Aprovado por Natã da Silva Baracho em 07/10/2026 como proposta**, para confirmar com o responsável pelo frontend (pontos de 1 a 4 abaixo).

| Frontend (Supabase) | FluxID (`005`) | Observação |
| --- | --- | --- |
| `cylinder_types` | `tipos_cilindro` (gás, capacidade e unidade, classificação `MEDICINAL`/`INDUSTRIAL`, ativo) | Os cilindros atuais **não** recebem tipo: a massa diz só "OXIGENIO" e não informa se é medicinal ou industrial |
| `cylinders` (fabricante, pressão, motivo da inativação, versão) | `cilindros.tipo_cilindro_id`, `fabricante`, `pressao_trabalho_bar`, `motivo_inativacao` (`BAIXADO`, `EXTRAVIADO`, `CONDENADO`, `OUTRO`, só com `INATIVO`), `versao` | — |
| `cylinder_identifiers` | `identificadores_cilindro` (`QR_CODE`, `DATA_MATRIX`, `NFC`, `NUMERO_CASCO`; desativar exige justificativa; um valor ativo por organização) | Nunca apagados |
| `cylinder_tests` (laudo, retificação, imutável) | `testes_hidrostaticos.numero_laudo`, `retifica_teste_id`, `justificativa_retificacao`; teste não pode ser alterado nem apagado | Erro se corrige com outro teste que retifica |
| `cylinder_events` | `historico_cilindro` (sequência por cilindro, imutável, origem `USUARIO`/`OXIDE`/`SISTEMA`) | Integrado com a Oxide: vínculo e desvínculo de lacre e alerta registrado ou encerrado entram sozinhos, por gatilho |

O histórico inicial foi montado só com fatos que já estavam no banco: criação do cilindro, vínculos com lacre e alertas. A criação vem sempre primeiro, porque na massa os vínculos começam em 25/07/2026, antes da data de criação dos cilindros (23/09/2026, dia da geração do dump).

Resultado no Docker (dump + `001` a `005`): sem erros; o `005` rodado de novo não mudou nada; 90 eventos no histórico inicial; os gatilhos registraram um alerta vindo da Oxide e o encerramento dele; alterar o histórico foi recusado.

**Ficou de fora, para decidir com o frontend:**

1. **Situação de estoque** (`in_stock`/`out_of_stock` no frontend) × `cilindros.status` do FluxID (`DISPONIVEL`, `COM_CLIENTE`...): os dois conceitos se sobrepõem.
2. **Classificação dos tipos** dos cilindros já cadastrados (medicinal ou industrial).
3. **Login, sessões, convites, recuperação de senha e limites de tentativa** (tabelas privadas do Supabase): dependem de como será o login da API do frontend.
4. **Papéis por organização** (`memberships`/`membership_roles` no frontend) × `usuario_perfis` no FluxID.
