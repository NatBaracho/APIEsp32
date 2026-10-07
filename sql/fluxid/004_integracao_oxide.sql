-- =====================================================================
-- FluxID — 004: integração com a Oxide (Worker)
-- Decisões P1 a P8 de Doc/Integracao-Oxide-FluxID.md, aprovadas por
-- Natã da Silva Baracho em 06/10/2026, e gatilho do par lacre + cilindro
-- do alerta (FLX-26), aprovado em 07/10/2026.
--
-- Pode ser executado mais de uma vez: cada passo verifica se já foi
-- aplicado. Tudo roda numa transação; se algo falhar, nada é alterado.
-- Executar no banco FluxID_db (pgAdmin > Query Tool, ou psql -f),
-- depois do 001, do 002 e do 003.
-- =====================================================================

BEGIN;

-- (a) P1: a data é a da chegada ao FluxID --------------------------------
ALTER TABLE public.telemetrias ALTER COLUMN data_coleta SET DEFAULT now();
ALTER TABLE public.eventos_lacre ALTER COLUMN ocorrido_em SET DEFAULT now();

-- (b) Telemetria: lacre e cilindro do momento (para o mapa) --------------
-- Gravados pela Oxide no recebimento, a partir do vínculo ativo.
ALTER TABLE public.telemetrias
  ADD COLUMN IF NOT EXISTS lacre_id uuid,
  ADD COLUMN IF NOT EXISTS cilindro_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_telemetria_lacre') THEN
    ALTER TABLE public.telemetrias
      ADD CONSTRAINT fk_telemetria_lacre FOREIGN KEY (lacre_id) REFERENCES public.lacres(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_telemetria_cilindro') THEN
    ALTER TABLE public.telemetrias
      ADD CONSTRAINT fk_telemetria_cilindro FOREIGN KEY (cilindro_id) REFERENCES public.cilindros(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_telemetria_cilindro_data
  ON public.telemetrias (cilindro_id, data_coleta DESC);

-- (c) P2: telemetria sem GPS fica em quarentena, só armazenada -----------
-- A tabela principal continua exigindo posição (mapa do dashboard).
CREATE TABLE IF NOT EXISTS public.telemetrias_quarentena (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id character varying(100) NOT NULL UNIQUE,
  dispositivo_id uuid NOT NULL REFERENCES public.dispositivos(id),
  organizacao_id uuid NOT NULL REFERENCES public.organizacoes(id),
  lacre_id uuid REFERENCES public.lacres(id),
  cilindro_id uuid REFERENCES public.cilindros(id),
  velocidade_kmh numeric(10,2),
  bateria_percentual numeric(5,2),
  sinal_gsm integer,
  payload_raw jsonb,
  motivo character varying(30) NOT NULL DEFAULT 'SEM_POSICAO'
    CHECK (motivo IN ('SEM_POSICAO')),
  recebido_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetrias_quarentena_dispositivo
  ON public.telemetrias_quarentena (dispositivo_id, recebido_em DESC);

-- (d) P4: eventos do dispositivo (sem estado de lacre) -------------------
-- Ex.: startup, falha de hardware. O evento mostra como o lacre e o
-- cilindro se comportam.
CREATE TABLE IF NOT EXISTS public.eventos_dispositivo (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id character varying(100) NOT NULL UNIQUE,
  dispositivo_id uuid NOT NULL REFERENCES public.dispositivos(id),
  organizacao_id uuid NOT NULL REFERENCES public.organizacoes(id),
  lacre_id uuid REFERENCES public.lacres(id),
  tipo character varying(60) NOT NULL,
  codigo_erro character varying(40),
  descricao text,
  payload_raw jsonb,
  ocorrido_em timestamp with time zone NOT NULL DEFAULT now(),
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eventos_dispositivo_dispositivo
  ON public.eventos_dispositivo (dispositivo_id, ocorrido_em DESC);

-- Eventos do lacre vindos da Oxide: dispositivo de origem, conteúdo
-- original e código do catálogo detectado no recebimento
ALTER TABLE public.eventos_lacre
  ADD COLUMN IF NOT EXISTS dispositivo_id uuid,
  ADD COLUMN IF NOT EXISTS codigo_erro character varying(40),
  ADD COLUMN IF NOT EXISTS payload_raw jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_evento_lacre_dispositivo') THEN
    ALTER TABLE public.eventos_lacre
      ADD CONSTRAINT fk_evento_lacre_dispositivo FOREIGN KEY (dispositivo_id) REFERENCES public.dispositivos(id);
  END IF;
END $$;

-- (e) P5: tipos de alerta = códigos do catálogo Tipos-de-Erro.md ---------
-- Os tipos antigos do dump são convertidos (seção 7 do catálogo).
ALTER TABLE public.alertas DROP CONSTRAINT IF EXISTS alertas_tipo_check;

UPDATE public.alertas SET tipo = CASE tipo
  WHEN 'VIOLACAO_LACRE' THEN 'LACRE_VIOLADO'
  WHEN 'ABERTURA_NAO_AUTORIZADA' THEN 'LACRE_ABERTO_SEM_AUTORIZACAO'
  WHEN 'TESTE_HIDROSTATICO' THEN 'TESTE_HIDROSTATICO_VENCIDO'
  WHEN 'REVISAO_LACRE' THEN 'LACRE_REVISAO_VENCIDA'
  ELSE tipo
END
WHERE tipo IN ('VIOLACAO_LACRE', 'ABERTURA_NAO_AUTORIZADA', 'TESTE_HIDROSTATICO', 'REVISAO_LACRE');

ALTER TABLE public.alertas
  ADD CONSTRAINT alertas_tipo_check CHECK (tipo IN (
    'LACRE_VIOLADO', 'LACRE_ABERTO_EM_TRANSITO', 'LACRE_ABERTO_SEM_AUTORIZACAO',
    'DISPOSITIVO_SEM_LACRE', 'LACRE_SEM_CILINDRO', 'LACRE_SEM_DISPOSITIVO',
    'LACRE_REVISAO_VENCIDA', 'LACRE_REPROVADO_EM_USO',
    'CILINDRO_SEM_CLIENTE', 'CILINDRO_SEM_LACRE', 'TESTE_HIDROSTATICO_VENCIDO',
    'CILINDRO_REPROVADO_EM_USO',
    'GPS_INATIVO', 'GPS_SEM_SINAL', 'POSICAO_INVALIDA', 'SAIDA_GEOCERCA',
    'SAIDA_ROTA', 'MOVIMENTACAO_SUSPEITA', 'PARADA_PROLONGADA',
    'BATERIA_BAIXA', 'SEM_COMUNICACAO', 'GSM_SINAL_FRACO', 'DISPOSITIVO_FALHA',
    'DISPOSITIVO_NAO_CADASTRADO', 'CHAVE_INVALIDA',
    'COMANDO_FALHOU', 'COMANDO_SEM_RESPOSTA', 'COMANDO_DESCONTINUADO'
  ));

-- (f) P7: o alerta nasce na Oxide (codigo = alert_id da Oxide) ----------
-- dispositivo_id: de onde veio o alerta (o Worker usa para reconhecer um
-- reenvio do mesmo alerta). Quem encerrou e o motivo chegam da Oxide como
-- texto; encerrado_por (usuário do FluxID) fica para a API do frontend.
ALTER TABLE public.alertas
  ADD COLUMN IF NOT EXISTS dispositivo_id uuid,
  ADD COLUMN IF NOT EXISTS encerrado_por_nome character varying(200),
  ADD COLUMN IF NOT EXISTS motivo_encerramento text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alerta_dispositivo') THEN
    ALTER TABLE public.alertas
      ADD CONSTRAINT fk_alerta_dispositivo FOREIGN KEY (dispositivo_id) REFERENCES public.dispositivos(id);
  END IF;

  -- Encerrado sempre com data, e só ele (mesma regra da Oxide)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alertas_encerramento_check') THEN
    ALTER TABLE public.alertas
      ADD CONSTRAINT alertas_encerramento_check
      CHECK ((status = 'ENCERRADO') = (encerrado_em IS NOT NULL));
  END IF;
END $$;

-- (g) FLX-26: o par lacre + cilindro do alerta precisa ter vínculo válido
-- no momento do alarme (aberto_em). Complementa o CHECK do 003.
CREATE OR REPLACE FUNCTION public.fn_alerta_confere_vinculo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lacre_id IS NOT NULL AND NEW.cilindro_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.vinculos_cilindro_lacre v
       WHERE v.lacre_id = NEW.lacre_id
         AND v.cilindro_id = NEW.cilindro_id
         AND v.data_inicio <= NEW.aberto_em
         AND (v.data_fim IS NULL OR v.data_fim > NEW.aberto_em)
     )
  THEN
    RAISE EXCEPTION
      'Alerta %: o lacre não estava vinculado a este cilindro em %', NEW.codigo, NEW.aberto_em
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_alerta_confere_vinculo ON public.alertas;
CREATE TRIGGER trg_alerta_confere_vinculo
  BEFORE INSERT OR UPDATE OF lacre_id, cilindro_id, aberto_em ON public.alertas
  FOR EACH ROW EXECUTE FUNCTION public.fn_alerta_confere_vinculo();

-- (h) Conferência: nenhum alerta existente viola a regra do gatilho ------
DO $$
DECLARE
  pendentes text;
BEGIN
  SELECT string_agg(a.codigo, ', ' ORDER BY a.codigo)
  INTO pendentes
  FROM public.alertas a
  WHERE a.lacre_id IS NOT NULL AND a.cilindro_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.vinculos_cilindro_lacre v
      WHERE v.lacre_id = a.lacre_id AND v.cilindro_id = a.cilindro_id
        AND v.data_inicio <= a.aberto_em
        AND (v.data_fim IS NULL OR v.data_fim > a.aberto_em));

  IF pendentes IS NOT NULL THEN
    RAISE EXCEPTION 'Alertas com par lacre + cilindro sem vínculo na data, analisar antes de aplicar: %', pendentes;
  END IF;
END $$;

COMMIT;
