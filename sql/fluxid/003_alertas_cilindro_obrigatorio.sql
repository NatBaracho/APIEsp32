-- =====================================================================
-- FluxID — 003: alerta sempre ligado ao lacre e ao cilindro
-- Aprovado por Natã da Silva Baracho em 07/10/2026.
--
-- Regra: todo alerta pertence a um lacre que está num cilindro. O par
-- gravado é o do momento do alarme (vínculo válido em aberto_em), o que
-- permite à auditoria conferir se o lacre está no cilindro do cliente.
-- Exceções: só os códigos de cadastro que, por definição, não têm
-- cilindro (ou nem lacre).
--
-- Pode ser executado mais de uma vez: cada passo verifica se já foi
-- aplicado. Tudo roda numa transação; se algo falhar, nada é alterado.
-- Executar no banco FluxID_db (pgAdmin > Query Tool, ou psql -f),
-- depois do 001 e do 002.
-- =====================================================================

BEGIN;

-- (a) Alertas sem cilindro: preenche pelo vínculo lacre → cilindro que
-- valia no momento do alerta. Nunca usa um vínculo de outro momento.
UPDATE public.alertas a
SET cilindro_id = v.cilindro_id
FROM public.vinculos_cilindro_lacre v
WHERE a.cilindro_id IS NULL
  AND a.lacre_id IS NOT NULL
  AND v.lacre_id = a.lacre_id
  AND v.data_inicio <= a.aberto_em
  AND (v.data_fim IS NULL OR v.data_fim > a.aberto_em);

-- (b) Se ainda sobrar alerta fora da regra, para tudo (nada é alterado)
-- e lista os códigos para análise. Não se inventa cilindro nem lacre.
DO $$
DECLARE
  pendentes text;
BEGIN
  SELECT string_agg(codigo, ', ' ORDER BY codigo)
  INTO pendentes
  FROM public.alertas
  WHERE (cilindro_id IS NULL AND tipo NOT IN (
           'LACRE_SEM_CILINDRO', 'DISPOSITIVO_SEM_LACRE',
           'DISPOSITIVO_NAO_CADASTRADO', 'CHAVE_INVALIDA'))
     OR (lacre_id IS NULL AND tipo NOT IN (
           'DISPOSITIVO_SEM_LACRE', 'DISPOSITIVO_NAO_CADASTRADO',
           'CHAVE_INVALIDA'));

  IF pendentes IS NOT NULL THEN
    RAISE EXCEPTION
      'Alertas sem lacre/cilindro no momento do alarme, analisar antes de aplicar: %',
      pendentes;
  END IF;
END $$;

-- (c) Regra no banco: cilindro e lacre obrigatórios, salvo os códigos
-- de cadastro (catálogo Tipos-de-Erro.md).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alertas_cilindro_lacre_obrigatorio_check'
  ) THEN
    ALTER TABLE public.alertas
      ADD CONSTRAINT alertas_cilindro_lacre_obrigatorio_check
      CHECK (
        (cilindro_id IS NOT NULL OR tipo IN (
          'LACRE_SEM_CILINDRO', 'DISPOSITIVO_SEM_LACRE',
          'DISPOSITIVO_NAO_CADASTRADO', 'CHAVE_INVALIDA'))
        AND
        (lacre_id IS NOT NULL OR tipo IN (
          'DISPOSITIVO_SEM_LACRE', 'DISPOSITIVO_NAO_CADASTRADO',
          'CHAVE_INVALIDA'))
      );
  END IF;
END $$;

COMMIT;
