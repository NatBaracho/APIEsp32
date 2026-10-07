-- =====================================================================
-- FluxID — 005: estruturas usadas pelo frontend (etapa 006, cilindros)
-- Pedido de Natã da Silva Baracho em 07/10/2026: o FluxID_db é o banco
-- definitivo; o que o frontend (repositório fluxid_integra2026, banco de
-- teste no Supabase) usa e o FluxID não tem é replicado aqui, no padrão do
-- FluxID (português) e integrado com a Oxide. Proposta para validar com o
-- responsável pelo frontend antes da API do frontend.
--
-- Fica de fora (decisão pendente, ver Banco_FluxID.md 17.7): situação de
-- estoque (in_stock/out_of_stock) e as tabelas de login/sessão/convite.
--
-- Pode ser executado mais de uma vez. Tudo roda numa transação.
-- Executar depois do 001 ao 004.
-- =====================================================================

BEGIN;

-- (a) Tipos de cilindro (frontend: cylinder_types) ----------------------
CREATE TABLE IF NOT EXISTS public.tipos_cilindro (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organizacao_id uuid NOT NULL REFERENCES public.organizacoes(id),
  gas character varying(80) NOT NULL CHECK (char_length(btrim(gas)) BETWEEN 2 AND 80),
  capacidade_valor numeric(10,2) NOT NULL CHECK (capacidade_valor > 0),
  capacidade_unidade character varying(2) NOT NULL CHECK (capacidade_unidade IN ('L', 'M3', 'KG')),
  classificacao character varying(20) NOT NULL CHECK (classificacao IN ('MEDICINAL', 'INDUSTRIAL')),
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid REFERENCES public.usuarios(id),
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tipos_cilindro_identidade
  ON public.tipos_cilindro (organizacao_id, lower(btrim(gas)), capacidade_valor, capacidade_unidade, classificacao);

-- (b) Campos do cilindro usados pelo frontend (frontend: cylinders) ------
-- tipo_cilindro_id fica opcional: os cilindros atuais têm só o texto
-- "OXIGENIO" e não dizem se são medicinais ou industriais
ALTER TABLE public.cilindros
  ADD COLUMN IF NOT EXISTS tipo_cilindro_id uuid,
  ADD COLUMN IF NOT EXISTS fabricante character varying(120),
  ADD COLUMN IF NOT EXISTS pressao_trabalho_bar numeric(7,2),
  ADD COLUMN IF NOT EXISTS motivo_inativacao character varying(20),
  ADD COLUMN IF NOT EXISTS versao bigint NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cilindro_tipo') THEN
    ALTER TABLE public.cilindros
      ADD CONSTRAINT fk_cilindro_tipo FOREIGN KEY (tipo_cilindro_id) REFERENCES public.tipos_cilindro(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cilindros_pressao_check') THEN
    ALTER TABLE public.cilindros
      ADD CONSTRAINT cilindros_pressao_check CHECK (pressao_trabalho_bar IS NULL OR pressao_trabalho_bar > 0);
  END IF;
  -- Motivo só para cilindro INATIVO (frontend: written_off, lost, condemned, other)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cilindros_motivo_inativacao_check') THEN
    ALTER TABLE public.cilindros
      ADD CONSTRAINT cilindros_motivo_inativacao_check CHECK (
        (motivo_inativacao IS NULL)
        OR (status = 'INATIVO' AND motivo_inativacao IN ('BAIXADO', 'EXTRAVIADO', 'CONDENADO', 'OUTRO')));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cilindros_tipo ON public.cilindros (organizacao_id, tipo_cilindro_id);

-- (c) Identificadores do cilindro (frontend: cylinder_identifiers) -------
-- QR Code, Data Matrix, etiqueta NFC e número do casco. Nunca apagados:
-- desativar exige justificativa; transferir aponta o novo identificador
CREATE TABLE IF NOT EXISTS public.identificadores_cilindro (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organizacao_id uuid NOT NULL REFERENCES public.organizacoes(id),
  cilindro_id uuid NOT NULL REFERENCES public.cilindros(id),
  tipo character varying(20) NOT NULL CHECK (tipo IN ('QR_CODE', 'DATA_MATRIX', 'NFC', 'NUMERO_CASCO')),
  valor character varying(200) NOT NULL CHECK (char_length(btrim(valor)) BETWEEN 1 AND 200 AND valor !~ '[\r\n]'),
  valor_normalizado character varying(200) GENERATED ALWAYS AS (upper(btrim(valor))) STORED,
  status character varying(20) NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ATIVO', 'DESATIVADO')),
  desativado_em timestamp with time zone,
  desativado_por uuid REFERENCES public.usuarios(id),
  justificativa_desativacao text,
  transferido_para_id uuid REFERENCES public.identificadores_cilindro(id),
  criado_por uuid REFERENCES public.usuarios(id),
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT identificadores_cilindro_desativacao_check CHECK (
    (status = 'ATIVO' AND desativado_em IS NULL AND desativado_por IS NULL AND justificativa_desativacao IS NULL)
    OR (status = 'DESATIVADO' AND desativado_em IS NOT NULL
        AND char_length(btrim(justificativa_desativacao)) BETWEEN 5 AND 500))
);

-- Um valor ativo só pode identificar um cilindro na organização
CREATE UNIQUE INDEX IF NOT EXISTS uq_identificador_cilindro_ativo
  ON public.identificadores_cilindro (organizacao_id, valor_normalizado) WHERE status = 'ATIVO';
CREATE INDEX IF NOT EXISTS idx_identificadores_cilindro
  ON public.identificadores_cilindro (cilindro_id, status);

-- (d) Teste hidrostático: laudo e retificação (frontend: cylinder_tests) -
-- Teste registrado não se altera; um erro é corrigido por outro teste que
-- o retifica, com justificativa
ALTER TABLE public.testes_hidrostaticos
  ADD COLUMN IF NOT EXISTS numero_laudo character varying(60),
  ADD COLUMN IF NOT EXISTS retifica_teste_id uuid,
  ADD COLUMN IF NOT EXISTS justificativa_retificacao text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_teste_retifica') THEN
    ALTER TABLE public.testes_hidrostaticos
      ADD CONSTRAINT fk_teste_retifica FOREIGN KEY (retifica_teste_id) REFERENCES public.testes_hidrostaticos(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'testes_retificacao_check') THEN
    ALTER TABLE public.testes_hidrostaticos
      ADD CONSTRAINT testes_retificacao_check CHECK (
        retifica_teste_id IS NULL
        OR char_length(btrim(justificativa_retificacao)) BETWEEN 5 AND 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'testes_proximo_depois_check') THEN
    ALTER TABLE public.testes_hidrostaticos
      ADD CONSTRAINT testes_proximo_depois_check CHECK (proximo_teste > data_teste);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_teste_retificado_uma_vez
  ON public.testes_hidrostaticos (retifica_teste_id) WHERE retifica_teste_id IS NOT NULL;

-- (e) Histórico do cilindro, imutável (frontend: cylinder_events) --------
-- Integrado com a Oxide: vínculos com lacre e alertas vindos do lacre
-- entram sozinhos (gatilhos abaixo), com origem OXIDE ou SISTEMA
CREATE TABLE IF NOT EXISTS public.historico_cilindro (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organizacao_id uuid NOT NULL REFERENCES public.organizacoes(id),
  cilindro_id uuid NOT NULL REFERENCES public.cilindros(id),
  sequencia integer NOT NULL CHECK (sequencia >= 1),
  tipo_evento character varying(40) NOT NULL CHECK (tipo_evento IN (
    'CILINDRO_CRIADO', 'CILINDRO_ATUALIZADO', 'CILINDRO_INATIVADO', 'CILINDRO_REATIVADO',
    'IDENTIFICADOR_ADICIONADO', 'IDENTIFICADOR_DESATIVADO',
    'IDENTIFICADOR_TRANSFERIDO_SAIDA', 'IDENTIFICADOR_TRANSFERIDO_ENTRADA',
    'ENTRADA_ESTOQUE', 'SAIDA_ESTOQUE_INATIVACAO',
    'TESTE_HIDROSTATICO_REGISTRADO', 'TESTE_HIDROSTATICO_RETIFICADO',
    'LACRE_VINCULADO', 'LACRE_DESVINCULADO', 'ALERTA_REGISTRADO', 'ALERTA_ENCERRADO')),
  origem character varying(10) NOT NULL CHECK (origem IN ('USUARIO', 'OXIDE', 'SISTEMA')),
  usuario_id uuid REFERENCES public.usuarios(id),
  ocorrido_em timestamp with time zone NOT NULL DEFAULT now(),
  justificativa text CHECK (justificativa IS NULL OR char_length(justificativa) <= 500),
  dados jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (NOT (dados ?| ARRAY['senha', 'password', 'token', 'secret', 'api_key'])),
  referencia_evento_id uuid REFERENCES public.historico_cilindro(id),
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT historico_cilindro_usuario_check CHECK (origem <> 'USUARIO' OR usuario_id IS NOT NULL),
  CONSTRAINT uq_historico_cilindro_sequencia UNIQUE (cilindro_id, sequencia)
);

CREATE INDEX IF NOT EXISTS idx_historico_cilindro_pagina
  ON public.historico_cilindro (cilindro_id, sequencia DESC);

CREATE OR REPLACE FUNCTION public.fn_registro_imutavel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Registro imutável: % não pode ser alterado nem apagado', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END $$;

DROP TRIGGER IF EXISTS trg_historico_cilindro_imutavel ON public.historico_cilindro;
CREATE TRIGGER trg_historico_cilindro_imutavel
  BEFORE UPDATE OR DELETE ON public.historico_cilindro
  FOR EACH ROW EXECUTE FUNCTION public.fn_registro_imutavel();

DROP TRIGGER IF EXISTS trg_historico_cilindro_sem_truncate ON public.historico_cilindro;
CREATE TRIGGER trg_historico_cilindro_sem_truncate
  BEFORE TRUNCATE ON public.historico_cilindro
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_registro_imutavel();

DROP TRIGGER IF EXISTS trg_testes_hidrostaticos_imutavel ON public.testes_hidrostaticos;
CREATE TRIGGER trg_testes_hidrostaticos_imutavel
  BEFORE UPDATE OR DELETE ON public.testes_hidrostaticos
  FOR EACH ROW EXECUTE FUNCTION public.fn_registro_imutavel();

-- Acrescenta um evento no fim do histórico do cilindro (trava o cilindro
-- para a sequência não repetir)
CREATE OR REPLACE FUNCTION public.fn_historico_cilindro_registrar(
  p_cilindro_id uuid,
  p_tipo_evento text,
  p_origem text,
  p_ocorrido_em timestamp with time zone,
  p_dados jsonb,
  p_justificativa text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_organizacao uuid;
  v_sequencia integer;
BEGIN
  SELECT organizacao_id INTO v_organizacao
  FROM public.cilindros WHERE id = p_cilindro_id FOR UPDATE;

  SELECT COALESCE(max(sequencia), 0) + 1 INTO v_sequencia
  FROM public.historico_cilindro WHERE cilindro_id = p_cilindro_id;

  INSERT INTO public.historico_cilindro (
    organizacao_id, cilindro_id, sequencia, tipo_evento, origem, ocorrido_em, justificativa, dados
  )
  VALUES (
    v_organizacao, p_cilindro_id, v_sequencia, p_tipo_evento, p_origem,
    COALESCE(p_ocorrido_em, now()), left(p_justificativa, 500), COALESCE(p_dados, '{}'::jsonb)
  );
END $$;

-- Vínculo lacre ↔ cilindro: instalar e remover o lacre entram no histórico
CREATE OR REPLACE FUNCTION public.fn_vinculo_lacre_historico()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_lacre text;
BEGIN
  SELECT codigo INTO v_lacre FROM public.lacres WHERE id = NEW.lacre_id;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_historico_cilindro_registrar(
      NEW.cilindro_id, 'LACRE_VINCULADO', 'SISTEMA', NEW.data_inicio,
      jsonb_build_object('lacre', v_lacre, 'vinculo_id', NEW.id));
  ELSIF OLD.data_fim IS NULL AND NEW.data_fim IS NOT NULL THEN
    PERFORM public.fn_historico_cilindro_registrar(
      NEW.cilindro_id, 'LACRE_DESVINCULADO', 'SISTEMA', NEW.data_fim,
      jsonb_build_object('lacre', v_lacre, 'vinculo_id', NEW.id), NEW.motivo_encerramento);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_vinculo_lacre_historico ON public.vinculos_cilindro_lacre;
CREATE TRIGGER trg_vinculo_lacre_historico
  AFTER INSERT OR UPDATE OF data_fim ON public.vinculos_cilindro_lacre
  FOR EACH ROW EXECUTE FUNCTION public.fn_vinculo_lacre_historico();

-- Alerta do cilindro (vindo do lacre pela Oxide, ou do sistema)
CREATE OR REPLACE FUNCTION public.fn_alerta_historico()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_origem text := CASE WHEN NEW.dispositivo_id IS NOT NULL THEN 'OXIDE' ELSE 'SISTEMA' END;
BEGIN
  IF NEW.cilindro_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_historico_cilindro_registrar(
      NEW.cilindro_id, 'ALERTA_REGISTRADO', v_origem, NEW.aberto_em,
      jsonb_build_object('alerta', NEW.codigo, 'tipo', NEW.tipo, 'severidade', NEW.severidade));
  END IF;

  IF NEW.status = 'ENCERRADO' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ENCERRADO') THEN
    PERFORM public.fn_historico_cilindro_registrar(
      NEW.cilindro_id, 'ALERTA_ENCERRADO', v_origem, NEW.encerrado_em,
      jsonb_build_object('alerta', NEW.codigo, 'encerrado_por', NEW.encerrado_por_nome),
      NEW.motivo_encerramento);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_alerta_historico ON public.alertas;
CREATE TRIGGER trg_alerta_historico
  AFTER INSERT OR UPDATE OF status ON public.alertas
  FOR EACH ROW EXECUTE FUNCTION public.fn_alerta_historico();

-- (f) Histórico inicial dos cilindros que ainda não têm nenhum -----------
-- Só com fatos que já estão no banco: criação do cilindro, vínculos com
-- lacre e alertas. Nada é inventado.
WITH sem_historico AS (
  SELECT c.id, c.organizacao_id, c.criado_em, c.codigo
  FROM public.cilindros c
  WHERE NOT EXISTS (SELECT 1 FROM public.historico_cilindro h WHERE h.cilindro_id = c.id)
),
fatos AS (
  SELECT s.id AS cilindro_id, s.organizacao_id, 'CILINDRO_CRIADO' AS tipo_evento, 'SISTEMA' AS origem,
         s.criado_em AS ocorrido_em, NULL::text AS justificativa,
         jsonb_build_object('codigo', s.codigo, 'carga_inicial', true) AS dados, 0 AS ordem
  FROM sem_historico s
  UNION ALL
  SELECT s.id, s.organizacao_id, 'LACRE_VINCULADO', 'SISTEMA', v.data_inicio, NULL,
         jsonb_build_object('lacre', l.codigo, 'vinculo_id', v.id, 'carga_inicial', true), 1
  FROM sem_historico s
  JOIN public.vinculos_cilindro_lacre v ON v.cilindro_id = s.id
  JOIN public.lacres l ON l.id = v.lacre_id
  UNION ALL
  SELECT s.id, s.organizacao_id, 'LACRE_DESVINCULADO', 'SISTEMA', v.data_fim, v.motivo_encerramento,
         jsonb_build_object('lacre', l.codigo, 'vinculo_id', v.id, 'carga_inicial', true), 2
  FROM sem_historico s
  JOIN public.vinculos_cilindro_lacre v ON v.cilindro_id = s.id AND v.data_fim IS NOT NULL
  JOIN public.lacres l ON l.id = v.lacre_id
  UNION ALL
  SELECT s.id, s.organizacao_id, 'ALERTA_REGISTRADO',
         CASE WHEN a.dispositivo_id IS NOT NULL THEN 'OXIDE' ELSE 'SISTEMA' END,
         a.aberto_em, NULL,
         jsonb_build_object('alerta', a.codigo, 'tipo', a.tipo, 'severidade', a.severidade, 'carga_inicial', true), 3
  FROM sem_historico s
  JOIN public.alertas a ON a.cilindro_id = s.id
  UNION ALL
  SELECT s.id, s.organizacao_id, 'ALERTA_ENCERRADO',
         CASE WHEN a.dispositivo_id IS NOT NULL THEN 'OXIDE' ELSE 'SISTEMA' END,
         a.encerrado_em, a.motivo_encerramento,
         jsonb_build_object('alerta', a.codigo, 'carga_inicial', true), 4
  FROM sem_historico s
  JOIN public.alertas a ON a.cilindro_id = s.id AND a.status = 'ENCERRADO'
)
INSERT INTO public.historico_cilindro (
  organizacao_id, cilindro_id, sequencia, tipo_evento, origem, ocorrido_em, justificativa, dados
)
SELECT organizacao_id, cilindro_id,
       -- A criação vem sempre primeiro (na massa de testes há vínculos com
       -- data anterior à criação do cilindro no banco)
       row_number() OVER (
         PARTITION BY cilindro_id
         ORDER BY (ordem = 0) DESC, ocorrido_em, ordem
       )::integer,
       tipo_evento, origem, ocorrido_em, justificativa, dados
FROM fatos;

COMMIT;
