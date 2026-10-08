-- =====================================================================
-- FluxID — 006: API do frontend, login e rotas
-- Decisões D1 a D9 de Doc/Contrato-API-Frontend.md (recomendações),
-- assumidas em 07/10/2026 a pedido de Natã da Silva Baracho ("faça tudo
-- hoje, amanhã eu valido"). A validar.
--
-- Pode ser executado mais de uma vez. Tudo roda numa transação.
-- Executar depois do 001 ao 005.
-- =====================================================================

BEGIN;

-- (a) D4: a pessoa pode pertencer a mais de uma organização ----------------
CREATE TABLE IF NOT EXISTS public.usuario_organizacoes (
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id),
  organizacao_id uuid NOT NULL REFERENCES public.organizacoes(id),
  status character varying(20) NOT NULL DEFAULT 'ATIVO'
    CHECK (status IN ('ATIVO', 'BLOQUEADO', 'INATIVO')),
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, organizacao_id)
);

-- Papéis por organização (o papel vale só dentro daquela organização)
CREATE TABLE IF NOT EXISTS public.usuario_organizacao_perfis (
  usuario_id uuid NOT NULL,
  organizacao_id uuid NOT NULL,
  perfil_id uuid NOT NULL REFERENCES public.perfis(id),
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, organizacao_id, perfil_id),
  FOREIGN KEY (usuario_id, organizacao_id)
    REFERENCES public.usuario_organizacoes (usuario_id, organizacao_id)
);

-- Carga inicial: a organização de cada usuário e os papéis atuais dele nela
INSERT INTO public.usuario_organizacoes (usuario_id, organizacao_id, status)
SELECT id, organizacao_id, CASE WHEN ativo THEN 'ATIVO' ELSE 'INATIVO' END
FROM public.usuarios
ON CONFLICT DO NOTHING;

INSERT INTO public.usuario_organizacao_perfis (usuario_id, organizacao_id, perfil_id)
SELECT up.usuario_id, u.organizacao_id, up.perfil_id
FROM public.usuario_perfis up
JOIN public.usuarios u ON u.id = up.usuario_id
ON CONFLICT DO NOTHING;

-- (b) D3: login da própria API ---------------------------------------------
-- O token entregue ao frontend nunca é guardado: só o hash dele
CREATE TABLE IF NOT EXISTS public.sessoes_usuario (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id),
  token_hash character(64) NOT NULL UNIQUE,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  ultimo_acesso_em timestamp with time zone NOT NULL DEFAULT now(),
  expira_em timestamp with time zone NOT NULL,
  revogada_em timestamp with time zone,
  motivo_revogacao character varying(30)
);
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario_ativas
  ON public.sessoes_usuario (usuario_id) WHERE revogada_em IS NULL;

-- Bloqueio por tentativas: só o hash do e-mail, nunca a senha
CREATE TABLE IF NOT EXISTS public.tentativas_login (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email_hash character(64) NOT NULL,
  sucesso boolean NOT NULL,
  ocorrido_em timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tentativas_login_email
  ON public.tentativas_login (email_hash, ocorrido_em DESC);

CREATE TABLE IF NOT EXISTS public.recuperacoes_senha (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id),
  token_hash character(64) NOT NULL UNIQUE,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  expira_em timestamp with time zone NOT NULL,
  usado_em timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.convites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organizacao_id uuid NOT NULL REFERENCES public.organizacoes(id),
  email character varying(255) NOT NULL,
  perfil_id uuid NOT NULL REFERENCES public.perfis(id),
  token_hash character(64) NOT NULL UNIQUE,
  status character varying(20) NOT NULL DEFAULT 'ENVIADO'
    CHECK (status IN ('ENVIADO', 'ACEITO', 'REVOGADO', 'EXPIRADO')),
  criado_por uuid NOT NULL REFERENCES public.usuarios(id),
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  expira_em timestamp with time zone NOT NULL,
  aceito_em timestamp with time zone
);
CREATE INDEX IF NOT EXISTS idx_convites_email ON public.convites (organizacao_id, lower(email));

-- Foto da pessoa (D7: arquivo no servidor; aqui só o caminho)
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS foto_caminho character varying(255);

-- (c) D2 e D8: permissões que faltavam ----------------------------------------
INSERT INTO public.permissoes (codigo, nome, descricao)
SELECT v.codigo, v.nome, v.descricao
FROM (VALUES
  ('VER_CILINDROS', 'Ver cilindros', 'Lista, detalhe, busca e catálogo de tipos'),
  ('INATIVAR_CILINDRO', 'Inativar cilindro', 'Inativar e reativar cilindros'),
  ('GERENCIAR_IDENTIFICADORES', 'Gerenciar identificadores', 'QR Code, Data Matrix, NFC e número do casco'),
  ('ENTRADA_ESTOQUE', 'Entrada no estoque', 'Registrar a entrada do cilindro no estoque'),
  ('REGISTRAR_TESTE_HIDROSTATICO', 'Registrar teste hidrostático', 'Registrar e retificar testes'),
  ('VER_HISTORICO_CILINDRO', 'Ver histórico do cilindro', 'Linha do tempo do cilindro'),
  ('ENVIAR_COMANDOS', 'Enviar comandos', 'Travar e destravar a válvula pelo sistema'),
  ('JUSTIFICAR_ALERTAS', 'Justificar alertas', 'Motorista justifica a saída de rota'),
  ('PLANEJAR_ROTAS', 'Planejar rotas', 'Rota da entrega e desvios programados')
) AS v(codigo, nome, descricao)
WHERE NOT EXISTS (SELECT 1 FROM public.permissoes p WHERE p.codigo = v.codigo);

-- Concessão: o que cada perfil passa a ter (nenhum perfil perde permissão)
INSERT INTO public.perfil_permissoes (perfil_id, permissao_id)
SELECT pf.id, pm.id
FROM (VALUES
  ('FLUXID_MASTER', 'VER_CILINDROS'), ('FLUXID_MASTER', 'INATIVAR_CILINDRO'), ('FLUXID_MASTER', 'GERENCIAR_IDENTIFICADORES'),
  ('FLUXID_MASTER', 'ENTRADA_ESTOQUE'), ('FLUXID_MASTER', 'REGISTRAR_TESTE_HIDROSTATICO'), ('FLUXID_MASTER', 'VER_HISTORICO_CILINDRO'),
  ('FLUXID_MASTER', 'ENVIAR_COMANDOS'), ('FLUXID_MASTER', 'JUSTIFICAR_ALERTAS'), ('FLUXID_MASTER', 'PLANEJAR_ROTAS'),
  ('ORG_ADMIN', 'VER_CILINDROS'), ('ORG_ADMIN', 'INATIVAR_CILINDRO'), ('ORG_ADMIN', 'GERENCIAR_IDENTIFICADORES'),
  ('ORG_ADMIN', 'ENTRADA_ESTOQUE'), ('ORG_ADMIN', 'REGISTRAR_TESTE_HIDROSTATICO'), ('ORG_ADMIN', 'VER_HISTORICO_CILINDRO'),
  ('ORG_ADMIN', 'ENVIAR_COMANDOS'), ('ORG_ADMIN', 'JUSTIFICAR_ALERTAS'), ('ORG_ADMIN', 'PLANEJAR_ROTAS'),
  ('SUPERVISOR', 'VER_CILINDROS'), ('SUPERVISOR', 'INATIVAR_CILINDRO'), ('SUPERVISOR', 'GERENCIAR_IDENTIFICADORES'),
  ('SUPERVISOR', 'ENTRADA_ESTOQUE'), ('SUPERVISOR', 'REGISTRAR_TESTE_HIDROSTATICO'), ('SUPERVISOR', 'VER_HISTORICO_CILINDRO'),
  ('SUPERVISOR', 'ENVIAR_COMANDOS'), ('SUPERVISOR', 'JUSTIFICAR_ALERTAS'), ('SUPERVISOR', 'PLANEJAR_ROTAS'),
  ('OPERADOR', 'VER_CILINDROS'), ('OPERADOR', 'GERENCIAR_IDENTIFICADORES'), ('OPERADOR', 'ENTRADA_ESTOQUE'),
  ('OPERADOR', 'REGISTRAR_TESTE_HIDROSTATICO'), ('OPERADOR', 'VER_HISTORICO_CILINDRO'), ('OPERADOR', 'JUSTIFICAR_ALERTAS'),
  ('AUDITOR', 'VER_CILINDROS'), ('AUDITOR', 'VER_HISTORICO_CILINDRO'),
  ('VISUALIZADOR', 'VER_CILINDROS')
) AS v(perfil, permissao)
JOIN public.perfis pf ON pf.codigo = v.perfil
JOIN public.permissoes pm ON pm.codigo = v.permissao
WHERE NOT EXISTS (
  SELECT 1 FROM public.perfil_permissoes pp WHERE pp.perfil_id = pf.id AND pp.permissao_id = pm.id
);

-- (d) D1: situação de estoque, separada do status do cilindro --------------
ALTER TABLE public.cilindros
  ADD COLUMN IF NOT EXISTS situacao_estoque character varying(20) NOT NULL DEFAULT 'FORA_DO_ESTOQUE';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cilindros_situacao_estoque_check') THEN
    ALTER TABLE public.cilindros
      ADD CONSTRAINT cilindros_situacao_estoque_check
      CHECK (situacao_estoque IN ('EM_ESTOQUE', 'FORA_DO_ESTOQUE')
             AND (status <> 'INATIVO' OR situacao_estoque = 'FORA_DO_ESTOQUE'));
  END IF;
END $$;

-- Cilindros disponíveis no depósito começam em estoque
UPDATE public.cilindros SET situacao_estoque = 'EM_ESTOQUE'
WHERE status = 'DISPONIVEL' AND situacao_estoque = 'FORA_DO_ESTOQUE'
  AND NOT EXISTS (SELECT 1 FROM public.historico_cilindro h WHERE h.cilindro_id = cilindros.id AND h.tipo_evento = 'ENTRADA_ESTOQUE');

-- Operações que não podem repetir (ex.: entrada no estoque): a mesma chave
-- devolve o resultado da primeira vez
CREATE TABLE IF NOT EXISTS public.chaves_operacao (
  organizacao_id uuid NOT NULL REFERENCES public.organizacoes(id),
  chave uuid NOT NULL,
  operacao character varying(40) NOT NULL,
  pedido_hash character(64) NOT NULL,
  resultado jsonb NOT NULL,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id),
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, chave)
);

-- (e) Rota da entrega e desvios (geocerca e rota automáticas) ---------------
CREATE TABLE IF NOT EXISTS public.rotas_entrega (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entrega_id uuid NOT NULL UNIQUE REFERENCES public.entregas(id),
  pontos jsonb NOT NULL
    CHECK (jsonb_typeof(pontos) = 'array' AND jsonb_array_length(pontos) >= 2),
  margem_metros integer NOT NULL DEFAULT 50 CHECK (margem_metros BETWEEN 5 AND 5000),
  criado_por uuid REFERENCES public.usuarios(id),
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now()
);

-- Desvio programado (antes) ou justificado: enquanto vale, sair da rota não gera alerta
CREATE TABLE IF NOT EXISTS public.desvios_rota (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entrega_id uuid NOT NULL REFERENCES public.entregas(id),
  tipo character varying(20) NOT NULL CHECK (tipo IN ('PROGRAMADO', 'JUSTIFICADO')),
  inicio timestamp with time zone NOT NULL DEFAULT now(),
  fim timestamp with time zone NOT NULL,
  justificativa text NOT NULL CHECK (char_length(btrim(justificativa)) BETWEEN 5 AND 500),
  criado_por uuid REFERENCES public.usuarios(id),
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  CHECK (fim > inicio)
);
CREATE INDEX IF NOT EXISTS idx_desvios_rota_entrega ON public.desvios_rota (entrega_id, inicio, fim);

-- (f) Alerta: justificativa do motorista e tratamento pelo frontend (D5) ---
ALTER TABLE public.alertas
  ADD COLUMN IF NOT EXISTS justificativa text,
  ADD COLUMN IF NOT EXISTS justificado_por uuid,
  ADD COLUMN IF NOT EXISTS justificado_em timestamp with time zone,
  ADD COLUMN IF NOT EXISTS tratado_no_fluxid boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alerta_justificado_por') THEN
    ALTER TABLE public.alertas
      ADD CONSTRAINT fk_alerta_justificado_por FOREIGN KEY (justificado_por) REFERENCES public.usuarios(id);
  END IF;
END $$;

-- (g) Histórico: criação do cilindro registrada sempre (achado A1) ---------
-- Na hora do cadastro. Quando quem cadastra é a API do frontend, ela informa
-- o usuário em "SET LOCAL fluxid.usuario_id" e o evento sai com origem
-- USUARIO; por outra via (ex.: carga de dados), sai com origem SISTEMA
CREATE OR REPLACE FUNCTION public.fn_cilindro_criado_historico()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario uuid := NULLIF(current_setting('fluxid.usuario_id', true), '')::uuid;
  v_sequencia integer;
BEGIN
  SELECT COALESCE(max(sequencia), 0) + 1 INTO v_sequencia
  FROM public.historico_cilindro WHERE cilindro_id = NEW.id;

  INSERT INTO public.historico_cilindro (
    organizacao_id, cilindro_id, sequencia, tipo_evento, origem, usuario_id, ocorrido_em, dados
  )
  VALUES (
    NEW.organizacao_id, NEW.id, v_sequencia, 'CILINDRO_CRIADO',
    CASE WHEN v_usuario IS NULL THEN 'SISTEMA' ELSE 'USUARIO' END, v_usuario, NEW.criado_em,
    jsonb_build_object('codigo', NEW.codigo, 'serie', NEW.numero_serie)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cilindro_criado_historico ON public.cilindros;
CREATE TRIGGER trg_cilindro_criado_historico
  AFTER INSERT ON public.cilindros
  FOR EACH ROW EXECUTE FUNCTION public.fn_cilindro_criado_historico();

COMMIT;
