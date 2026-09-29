-- ============================================================================
-- Migration 807: allow setup_time_source = 'none'
--
-- resolveSetupMinutes no longer prices setup from a hardcoded per-class
-- constant (the old 'class_default' tier). When an operation has no real setup
-- time on file (no calculator result, no mhr_records.setup_time_hr, no
-- sm_lookup_op_setup_time row), its setup is simply not costed and the line
-- records source 'none'. Surface treatment, which genuinely has no machine
-- setup, records 'none' too.
--
-- 'class_default' stays allowed: rows already written with it are history and
-- are not rewritten.
--
-- One DO block (the SQL editor runs statements one at a time).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'process_cost_records'::regclass
      AND conname = 'ck_pcr_setup_time_source_known'
  ) THEN
    ALTER TABLE process_cost_records DROP CONSTRAINT ck_pcr_setup_time_source_known;
  END IF;

  ALTER TABLE process_cost_records
    ADD CONSTRAINT ck_pcr_setup_time_source_known
    CHECK (setup_time_source IS NULL OR setup_time_source IN
           ('calculator', 'machine', 'operation_lookup', 'none', 'class_default'));

  RAISE NOTICE 'Migration 807: ck_pcr_setup_time_source_known now allows none.';
END $$;
