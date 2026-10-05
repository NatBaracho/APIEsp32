
# FluxID  
### Especificação Atualizada do MVP e do Banco de Dados  
**Segurança • Rastreabilidade • Controle Operacional**  
**Versão 3.0 — consolidada após modelagem, criação e população do banco**  
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

| Entidade | Padrão / estados |
|----------|------------------|
| Cilindro | CIL-000001; DISPONIVEL, EM_TRANSITO, COM_CLIENTE, MANUTENCAO, EXTRAVIADO, INATIVO |
| Lacre | LCR-000001; EM_ESTOQUE, INSTALADO, SUSPEITA_VIOLACAO, ROMPIDO, REMOVIDO, DANIFICADO, INUTILIZADO |
| Dispositivo | DSP-000001; ativo/inativo |
| Entrega | ENT-000001; PENDENTE, EM_ANDAMENTO, CONCLUIDA, CANCELADA |
| Movimentação | MOV-000001; CARGA, DESCARGA, ENTREGA, RECOLHIMENTO, TRANSFERENCIA, INVENTARIO |
| Alerta | ALT-000001; ABERTO, EM_ANALISE, ENCERRADO; severidade BAIXA, MEDIA, ALTA, CRITICA |

---

## 11. Massa de testes confirmada

| Tabela | Registros |
|--------|-----------|
| organizacoes | 3 |
| usuarios | 3 |
| destinatarios | 20 |
| locais_entrega | 20 |
| cilindros | 50 |
| lacres | 50 |
| dispositivos | 50 |
| telemetrias | 200 |
| eventos_lacre | 10 |
| alertas | 10 |
| testes_hidrostaticos | 50 |
| inspecoes_lacre | 50 |
| auditoria | 3 |

A massa é sintética e destinada exclusivamente a desenvolvimento e testes.

---

## 12. Situação atual e pendências técnicas

- A carga de dados principal foi concluída e validada por contagens no pgAdmin.  
- A tabela telemetrias atual usa latitude e longitude NUMERIC; migração para PostGIS é necessária antes da geocerca de produção.  
- Views de dashboard e última posição serão criadas depois dos testes CRUD.  
- Triggers de auditoria e atualização automática serão criadas depois da API inicial.  
- Índices únicos parciais para vínculos e custódia ativa devem ser confirmados no schema antes da produção.  
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

