-- =====================================================================
-- FluxID — 002: correção da massa de testes (entrega E)
-- Aprovado por Natã da Silva Baracho em 06/10/2026.
--
-- Corrige incoerências de negócio encontradas na análise do dump de
-- 23/09/2026. Pode ser executado mais de uma vez (cada passo só altera o
-- que ainda está no estado antigo). Tudo roda numa transação.
-- Aplicar depois do 001_ajustes_estrutura.sql.
-- =====================================================================

BEGIN;

-- 1. Nomes fictícios no lugar de empresas reais --------------------------
UPDATE public.organizacoes
SET razao_social = 'Alfa Gases Industriais Ltda',
    nome_fantasia = 'Alfa Gases',
    email = 'contato@alfagases.teste',
    atualizado_em = now()
WHERE codigo = 'ORG-000002'
  AND razao_social <> 'Alfa Gases Industriais Ltda';

UPDATE public.organizacoes
SET razao_social = 'Beta Gases Medicinais Ltda',
    nome_fantasia = 'Beta Gases',
    email = 'contato@betagases.teste',
    atualizado_em = now()
WHERE codigo = 'ORG-000003'
  AND razao_social <> 'Beta Gases Medicinais Ltda';

UPDATE public.usuarios
SET nome = 'Alfa Gases Admin', email = 'admin@alfagases.teste', atualizado_em = now()
WHERE codigo = 'USR-000002' AND nome <> 'Alfa Gases Admin';

UPDATE public.usuarios
SET nome = 'Beta Gases Admin', email = 'admin@betagases.teste', atualizado_em = now()
WHERE codigo = 'USR-000003' AND nome <> 'Beta Gases Admin';

-- 2. Cilindros reprovados no teste hidrostático --------------------------
-- Os que estão com cliente mantêm entrega e custódia: o teste passa a
-- APROVADO. Os disponíveis não podem circular: vão para MANUTENCAO.
UPDATE public.testes_hidrostaticos t
SET resultado = 'APROVADO'
FROM public.cilindros c
WHERE c.id = t.cilindro_id
  AND t.resultado = 'REPROVADO'
  AND c.status = 'COM_CLIENTE';

UPDATE public.cilindros c
SET status = 'MANUTENCAO', atualizado_em = now()
WHERE c.status = 'DISPONIVEL'
  AND EXISTS (
    SELECT 1 FROM public.testes_hidrostaticos t
    WHERE t.cilindro_id = c.id AND t.resultado = 'REPROVADO'
  );

-- 3. Lacres com violação registrada (RN08) --------------------------------
-- Alertas ainda ABERTO: a violação está sob análise.
UPDATE public.lacres l
SET status = 'SUSPEITA_VIOLACAO', atualizado_em = now()
WHERE l.status = 'INSTALADO'
  AND EXISTS (
    SELECT 1 FROM public.eventos_lacre e
    WHERE e.lacre_id = l.id
      AND e.tipo IN ('VIOLACAO', 'ABERTURA_NAO_AUTORIZADA')
  );

-- 4. Ativos sem vínculo ativo passam para a Beta (testes da RN22) --------
-- Os 30 conjuntos vinculados, entregues e em custódia continuam na Alfa.
UPDATE public.cilindros c
SET organizacao_id = (SELECT id FROM public.organizacoes WHERE codigo = 'ORG-000003'),
    atualizado_em = now()
WHERE c.organizacao_id = (SELECT id FROM public.organizacoes WHERE codigo = 'ORG-000002')
  AND NOT EXISTS (SELECT 1 FROM public.vinculos_cilindro_lacre v WHERE v.cilindro_id = c.id AND v.data_fim IS NULL)
  AND NOT EXISTS (SELECT 1 FROM public.custodias cu WHERE cu.cilindro_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.entrega_itens ei WHERE ei.cilindro_id = c.id);

UPDATE public.lacres l
SET organizacao_id = (SELECT id FROM public.organizacoes WHERE codigo = 'ORG-000003'),
    atualizado_em = now()
WHERE l.organizacao_id = (SELECT id FROM public.organizacoes WHERE codigo = 'ORG-000002')
  AND NOT EXISTS (SELECT 1 FROM public.vinculos_cilindro_lacre v WHERE v.lacre_id = l.id AND v.data_fim IS NULL)
  AND NOT EXISTS (SELECT 1 FROM public.vinculos_dispositivo_lacre v WHERE v.lacre_id = l.id AND v.data_fim IS NULL);

UPDATE public.dispositivos d
SET organizacao_id = (SELECT id FROM public.organizacoes WHERE codigo = 'ORG-000003'),
    atualizado_em = now()
WHERE d.organizacao_id = (SELECT id FROM public.organizacoes WHERE codigo = 'ORG-000002')
  AND NOT EXISTS (SELECT 1 FROM public.vinculos_dispositivo_lacre v WHERE v.dispositivo_id = d.id AND v.data_fim IS NULL);

-- 5. Perfis e permissões (RBAC) -------------------------------------------
INSERT INTO public.perfil_permissoes (perfil_id, permissao_id)
SELECT p.id, pe.id
FROM (VALUES
  ('FLUXID_MASTER', 'CRIAR_USUARIO'), ('FLUXID_MASTER', 'EDITAR_USUARIO'),
  ('FLUXID_MASTER', 'CRIAR_CILINDRO'), ('FLUXID_MASTER', 'EDITAR_CILINDRO'),
  ('FLUXID_MASTER', 'CRIAR_LACRE'), ('FLUXID_MASTER', 'EDITAR_LACRE'),
  ('FLUXID_MASTER', 'VISUALIZAR_ALERTAS'), ('FLUXID_MASTER', 'ENCERRAR_ALERTAS'),
  ('FLUXID_MASTER', 'GERAR_RELATORIOS'), ('FLUXID_MASTER', 'ADMINISTRAR_SISTEMA'),
  ('ORG_ADMIN', 'CRIAR_USUARIO'), ('ORG_ADMIN', 'EDITAR_USUARIO'),
  ('ORG_ADMIN', 'CRIAR_CILINDRO'), ('ORG_ADMIN', 'EDITAR_CILINDRO'),
  ('ORG_ADMIN', 'CRIAR_LACRE'), ('ORG_ADMIN', 'EDITAR_LACRE'),
  ('ORG_ADMIN', 'VISUALIZAR_ALERTAS'), ('ORG_ADMIN', 'ENCERRAR_ALERTAS'),
  ('ORG_ADMIN', 'GERAR_RELATORIOS'),
  ('SUPERVISOR', 'CRIAR_CILINDRO'), ('SUPERVISOR', 'EDITAR_CILINDRO'),
  ('SUPERVISOR', 'CRIAR_LACRE'), ('SUPERVISOR', 'EDITAR_LACRE'),
  ('SUPERVISOR', 'VISUALIZAR_ALERTAS'), ('SUPERVISOR', 'ENCERRAR_ALERTAS'),
  ('SUPERVISOR', 'GERAR_RELATORIOS'),
  ('OPERADOR', 'CRIAR_CILINDRO'), ('OPERADOR', 'EDITAR_CILINDRO'),
  ('OPERADOR', 'CRIAR_LACRE'), ('OPERADOR', 'EDITAR_LACRE'),
  ('OPERADOR', 'VISUALIZAR_ALERTAS'),
  ('AUDITOR', 'VISUALIZAR_ALERTAS'), ('AUDITOR', 'GERAR_RELATORIOS'),
  ('VISUALIZADOR', 'VISUALIZAR_ALERTAS')
) AS m (perfil, permissao)
JOIN public.perfis p ON p.codigo = m.perfil
JOIN public.permissoes pe ON pe.codigo = m.permissao
ON CONFLICT (perfil_id, permissao_id) DO NOTHING;

INSERT INTO public.usuario_perfis (usuario_id, perfil_id)
SELECT u.id, p.id
FROM (VALUES
  ('USR-000001', 'FLUXID_MASTER'),
  ('USR-000002', 'ORG_ADMIN'),
  ('USR-000003', 'ORG_ADMIN')
) AS m (usuario, perfil)
JOIN public.usuarios u ON u.codigo = m.usuario
JOIN public.perfis p ON p.codigo = m.perfil
ON CONFLICT (usuario_id, perfil_id) DO NOTHING;

COMMIT;
