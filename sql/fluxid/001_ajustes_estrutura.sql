-- =====================================================================
-- FluxID — 001: ajustes de estrutura (entrega E)
-- Aprovado por Natã da Silva Baracho em 06/10/2026.
--
-- Pode ser executado mais de uma vez: cada passo verifica se já foi
-- aplicado. Tudo roda numa transação; se algo falhar, nada é alterado.
-- Executar no banco FluxID_db (pgAdmin > Query Tool, ou psql -f).
-- =====================================================================

BEGIN;

-- (a) IDs gerados automaticamente pelo banco ---------------------------
-- gen_random_uuid() é nativo do PostgreSQL 13+ (a extensão pgcrypto
-- também está instalada no FluxID_db).
DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY[
    'alertas', 'auditoria', 'cilindros', 'custodias', 'destinatarios',
    'dispositivos', 'entregas', 'eventos_lacre', 'inspecoes_lacre',
    'lacres', 'locais_entrega', 'movimentacoes', 'organizacao_contatos',
    'organizacoes', 'perfis', 'permissoes', 'telemetrias',
    'testes_hidrostaticos', 'usuarios', 'vinculos_cilindro_lacre',
    'vinculos_dispositivo_lacre'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT gen_random_uuid()',
      tabela
    );
  END LOOP;
END $$;

-- (b) Última posição de cada dispositivo -------------------------------
CREATE INDEX IF NOT EXISTS idx_telemetria_dispositivo_data
  ON public.telemetrias (dispositivo_id, data_coleta DESC);

-- (c) Idempotência dos eventos vindos da Oxide --------------------------
-- Opcional (eventos cadastrados por pessoas não têm message_id), mas
-- único quando informado: o Worker não duplica eventos ao reenviar.
ALTER TABLE public.eventos_lacre
  ADD COLUMN IF NOT EXISTS message_id character varying(100);

CREATE UNIQUE INDEX IF NOT EXISTS uq_eventos_lacre_message_id
  ON public.eventos_lacre (message_id)
  WHERE message_id IS NOT NULL;

-- (d) Índice redundante --------------------------------------------------
-- A restrição UNIQUE dispositivos_identificador_hardware_key já cria um
-- índice na mesma coluna.
DROP INDEX IF EXISTS public.idx_dispositivos_hardware;

-- (e) Chave de API do dispositivo, guardada só como hash ----------------
-- Valor: SHA-256 da chave em hexadecimal, por exemplo
--   encode(digest('chave-do-lacre', 'sha256'), 'hex')
-- A chave em texto só aparece no momento do cadastro.
ALTER TABLE public.dispositivos
  ADD COLUMN IF NOT EXISTS api_key_hash character(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dispositivos_api_key_hash
  ON public.dispositivos (api_key_hash)
  WHERE api_key_hash IS NOT NULL;

-- (f) Faixa válida de coordenadas (mesma regra da API Oxide) ------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'telemetrias_coordenadas_check'
  ) THEN
    ALTER TABLE public.telemetrias
      ADD CONSTRAINT telemetrias_coordenadas_check
      CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locais_entrega_coordenadas_check'
  ) THEN
    ALTER TABLE public.locais_entrega
      ADD CONSTRAINT locais_entrega_coordenadas_check
      CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
  END IF;
END $$;

COMMIT;
