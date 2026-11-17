-- ============================================================================
-- Migration 1059: retire the forging calculators the forging engine no longer runs
-- ============================================================================
-- Migration 1051 created twelve forging calculators for a first forging engine that was not adopted. The forging engine
-- that prices a part whose Process is Forging runs the calculators of migrations 1053, 1054 and 1057. Five names are
-- shared and were replaced there (Band saw, Induction heating, Press, Mechanical press, Trim); the other seven are
-- helpers nothing runs and no catalog operation maps to. Retired, not deleted: a calculator run already recorded on a
-- part keeps the calculator it names.
--
-- Idempotent: a calculator already retired is left as it is.
-- Verify: SELECT name FROM calculators WHERE user_id IS NULL AND retired_at IS NULL AND name IN (...);  -- none
-- ============================================================================

DO $retire1059$
DECLARE n integer;
BEGIN
  UPDATE public.calculators
  SET retired_at = now(), updated_at = now()
  WHERE user_id IS NULL AND retired_at IS NULL
    AND name IN ('Forging - Forged shape', 'Forging - Flash', 'Forging - Billet', 'Forging - Bar', 'Forging - Material cost',
                 'Forging - Forging load', 'Forging - Die tooling');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Forging calculators retired: %', n;
  IF EXISTS (
    SELECT 1 FROM public.process_calculator_mappings m JOIN public.calculators c ON c.id = m.calculator_id
    WHERE c.retired_at IS NOT NULL AND m.process_group = 'Forging'
  ) THEN
    RAISE EXCEPTION 'migration 1059: a Forging catalog operation is linked to a retired calculator';
  END IF;
END $retire1059$;
