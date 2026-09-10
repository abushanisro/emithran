-- Migration: make a persisted operation say what it was costed with (P2)
-- Description: Adds the four columns a persisted process line needs in order to
--              be an unambiguous serialisation of the engine line it came from,
--              rather than a set of loose columns each reader interprets for
--              itself. Declares only. No existing column is changed, no money
--              value moves, no reader behaviour changes until the code that
--              reads these columns ships alongside.
-- Date: 2026-09-09

-- WHY THIS EXISTS
--
-- Audit finding RC-3: persistence is a second cost model, not a snapshot of the
-- first. process_cost_records stores 25 loose columns that
-- buildLineFromAppliedRecord re-assembles into something shaped like a
-- ProcessLineCost, and every field is an independent opportunity to diverge.
-- Three cost columns were never written at all (migration 706), setup_time was
-- written as a literal 15 (fixed alongside 706), currency was hardcoded
-- (migration 707). Each was found by measurement, one at a time.
--
-- THE ONE THAT IS STILL OPEN, AND WHY IT CANNOT BE FIXED BY PICKING A COLUMN
--
-- ProcessLineCost.hourlyRate is the MACHINE hour rate and nothing else. That is
-- not a matter of interpretation: eMithranTerms takes mhrPerHr and dlrPerHr as
-- two separate arguments and charges machineCost = mhrPerHr/60 * cycleTimeMin
-- and laborCost = dlrPerHr/60 * cycleNDL * cycleTimeMin, and every registered
-- engine sets hourlyRate from MHRRateInput.rate, which is the machine rate,
-- with labourRate carried beside it.
--
-- buildLineFromAppliedRecord nevertheless reads direct_rate into hourlyRate.
-- On a real live row (fce24614, 3 Roll Bending, Faccin HCU 300 X 1) that is
--
--   mhr_records.total_machine_hour_rate    15.85   what the engine costed with
--   process_cost_records.direct_rate       62.52   what the applied line reports
--
-- so applying a route multiplies the displayed hourly rate for that operation
-- by 3.9 without any rate having changed.
--
-- The obvious repair -- read machine_rate instead -- does not work, because
-- direct_rate does not have one meaning in this table. Live active rows, all
-- four of these read from the database:
--
--   operation                 machine_rate  labor_rate  direct_rate
--   Face milling                   2600.00       36.21      2636.21   sum
--   Laser Cut                        19.00        1.73        19.227545  machine
--   Hand Deburring                   30.00       23.00        30.00      machine
--   Inspect                           0.00       46.67         0.00      neither
--
-- Three conventions in one column, written by different producers over time.
-- On the Laser Cut row it is machine_rate that is the rounded, less precise
-- value (19.00) and direct_rate that carries the exact rate the engine used
-- (19.227545) -- the reverse of the newest rows, where machine_rate holds the
-- exact engine rate. So neither column can be declared correct for all rows
-- without rewriting history and guessing which producer wrote each row.
--
-- WHAT THIS MIGRATION DOES INSTEAD
--
-- Adds columns that are unambiguous BY CONSTRUCTION because only one producer
-- has ever written them, and leaves every existing column exactly as it is:
--
--   line_hourly_rate    the machine hour rate the engine costed this line at,
--                       i.e. ProcessLineCost.hourlyRate verbatim, in the row
--                       currency. NOT a sum, NOT rounded.
--   line_labour_rate    the labour hour rate the engine costed this line at,
--                       i.e. ProcessLineCost.labourRate, same currency.
--   engine_version      which cost-engine contract produced the row, so a
--                       reader can tell a row it can trust field-for-field from
--                       a legacy row it must interpret.
--   setup_time_source   which of the four real setup sources resolveSetupMinutes
--                       actually used (calculator / machine / operation_lookup /
--                       class_default). Already computed and already surfaced on
--                       the engine line; never persisted, so an applied quote
--                       could not say whether its setup came from the selected
--                       machine or from a class default.
--
-- A reader takes line_hourly_rate when engine_version is present and falls back
-- to exactly today behaviour when it is not. Old rows keep reading exactly as
-- they read now -- nothing is backfilled, because there is no evidence with
-- which to backfill them, and inventing one is what produced three conventions
-- in direct_rate in the first place.

ALTER TABLE process_cost_records
  ADD COLUMN IF NOT EXISTS line_hourly_rate  NUMERIC(14,6),
  ADD COLUMN IF NOT EXISTS line_labour_rate  NUMERIC(14,6),
  ADD COLUMN IF NOT EXISTS engine_version    TEXT,
  ADD COLUMN IF NOT EXISTS setup_time_source TEXT;

-- Only the four values resolveSetupMinutes can actually return. A free-text
-- provenance column that can hold anything is not provenance.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'process_cost_records'::regclass
      AND conname = 'ck_pcr_setup_time_source_known'
  ) THEN
    ALTER TABLE process_cost_records
      ADD CONSTRAINT ck_pcr_setup_time_source_known
      CHECK (setup_time_source IS NULL OR setup_time_source IN
             ('calculator', 'machine', 'operation_lookup', 'class_default'));
    RAISE NOTICE 'Added ck_pcr_setup_time_source_known.';
  END IF;

  -- A rate is either absent or a real non-negative number. 0 is legitimate:
  -- Inspect lines genuinely have no machine rate, and surface treatment sets
  -- hourlyRate 0 deliberately.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'process_cost_records'::regclass
      AND conname = 'ck_pcr_line_rates_non_negative'
  ) THEN
    ALTER TABLE process_cost_records
      ADD CONSTRAINT ck_pcr_line_rates_non_negative
      CHECK ((line_hourly_rate IS NULL OR line_hourly_rate >= 0)
         AND (line_labour_rate IS NULL OR line_labour_rate >= 0));
    RAISE NOTICE 'Added ck_pcr_line_rates_non_negative.';
  END IF;
END $$;

COMMENT ON COLUMN process_cost_records.line_hourly_rate IS
  'The MACHINE hour rate this line was costed at - ProcessLineCost.hourlyRate '
  'verbatim, denominated in this row currency column. Not a sum and not rounded. '
  'Added by migration 718 because direct_rate carries three different '
  'conventions across historical producers and cannot be read unambiguously. '
  'NULL on every row written before 718.';

COMMENT ON COLUMN process_cost_records.line_labour_rate IS
  'The LABOUR hour rate this line was costed at - ProcessLineCost.labourRate, '
  'same currency as line_hourly_rate. eMithranTerms charges machine and labour '
  'from two separate rates; this is the second one. NULL before migration 718.';

COMMENT ON COLUMN process_cost_records.engine_version IS
  'Which cost-engine contract produced this row. Present means every column on '
  'the row was written by that contract and can be read field-for-field; NULL '
  'means a legacy producer wrote it and a reader must fall back to the older, '
  'looser interpretation. Migration 718.';

COMMENT ON COLUMN process_cost_records.setup_time_source IS
  'Which real source resolveSetupMinutes used for setup_time on this line: '
  'calculator, machine (mhr_records.setup_time_hr), operation_lookup '
  '(sm_lookup_op_setup_time) or class_default (the cited per-class constant). '
  'Disclosed so an applied quote never presents a class default as if it were '
  'the selected machine real setup time. Migration 718.';

-- ── The writer RPC must carry the new columns ────────────────────────────────
--
-- replace_active_process_cost_records lists every column explicitly, twice: an
-- INSERT column list and a jsonb_to_recordset signature. A column the writer
-- sends that is missing from the signature is silently discarded -- no error,
-- no warning, the row simply arrives short. That is exactly how the three cost
-- columns went unwritten until migration 706 found them by measurement.
--
-- So the function is replaced here, in the same migration that adds the
-- columns, rather than left for the code change to discover at runtime. This is
-- the migration 707 body with four fields added and nothing else altered.

CREATE OR REPLACE FUNCTION replace_active_process_cost_records(
  p_bom_item_id uuid,
  p_rows        jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_inserted integer;
BEGIN
  IF p_bom_item_id IS NULL THEN
    RAISE EXCEPTION 'replace_active_process_cost_records: bom item id is required';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'replace_active_process_cost_records: rows must be a json array, got %',
      COALESCE(jsonb_typeof(p_rows), 'null');
  END IF;

  IF jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'replace_active_process_cost_records: refusing to replace with an empty generation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_bom_item_id::text, 0));

  DELETE FROM process_cost_records
   WHERE bom_item_id = p_bom_item_id
     AND is_active = true;

  INSERT INTO process_cost_records (
    bom_item_id, user_id, op_nbr, operation, process_group, process_route,
    location, machine_class, machine_name, mhr_id, benchmark_mhr_id,
    machine_rate, labor_rate, lhr_id, direct_rate,
    setup_manning, setup_time, batch_size, heads, cycle_time,
    parts_per_cycle, scrap, currency, is_active, notes,
    setup_cost_per_part, total_cycle_cost_per_part, total_cost_per_part,
    cost_currency_basis, cost_currency_local, cost_fx_rate_from_local,
    line_hourly_rate, line_labour_rate, engine_version, setup_time_source
  )
  SELECT
    p_bom_item_id, r.user_id, r.op_nbr, r.operation, r.process_group, r.process_route,
    r.location, r.machine_class, r.machine_name, r.mhr_id, r.benchmark_mhr_id,
    r.machine_rate, r.labor_rate, r.lhr_id, r.direct_rate,
    r.setup_manning, r.setup_time, r.batch_size, r.heads, r.cycle_time,
    r.parts_per_cycle, r.scrap, r.currency, true, r.notes,
    r.setup_cost_per_part, r.total_cycle_cost_per_part, r.total_cost_per_part,
    COALESCE(r.cost_currency_basis, 'legacy_unverified'),
    r.cost_currency_local, r.cost_fx_rate_from_local,
    r.line_hourly_rate, r.line_labour_rate, r.engine_version, r.setup_time_source
  FROM jsonb_to_recordset(p_rows) AS r(
    user_id                  uuid,
    op_nbr                   integer,
    operation                varchar,
    process_group            varchar,
    process_route            varchar,
    location                 text,
    machine_class            varchar,
    machine_name             varchar,
    mhr_id                   uuid,
    benchmark_mhr_id         text,
    machine_rate             numeric,
    labor_rate               numeric,
    lhr_id                   uuid,
    direct_rate              numeric,
    setup_manning            numeric,
    setup_time               numeric,
    batch_size               numeric,
    heads                    numeric,
    cycle_time               numeric,
    parts_per_cycle          numeric,
    scrap                    numeric,
    currency                 varchar,
    notes                    text,
    setup_cost_per_part      numeric,
    total_cycle_cost_per_part numeric,
    total_cost_per_part      numeric,
    cost_currency_basis      text,
    cost_currency_local      varchar,
    cost_fx_rate_from_local  numeric,
    -- Added by migration 718.
    line_hourly_rate         numeric,
    line_labour_rate         numeric,
    engine_version           text,
    setup_time_source        text
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted <> jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'replace_active_process_cost_records: expected % rows, inserted %',
      jsonb_array_length(p_rows), v_inserted;
  END IF;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION replace_active_process_cost_records(uuid, jsonb) IS
  'Atomically replaces the active process_cost_records generation for a BOM item, including the engine per-line costs (706), the explicit currency contract columns (707) and the costed-operation provenance columns (718). Delete and insert share one transaction, so a failure leaves the previous generation untouched and no partial generation can ever be active.';

GRANT EXECUTE ON FUNCTION replace_active_process_cost_records(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION replace_active_process_cost_records(uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── Verification ─────────────────────────────────────────────────────────────
-- 1. Columns exist, all NULL, nothing backfilled:
-- SELECT count(*) AS total,
--        count(line_hourly_rate)  AS with_line_rate,
--        count(engine_version)    AS with_engine_version
--   FROM process_cost_records;
-- Expect total 507, with_line_rate 0, with_engine_version 0 immediately after
-- this migration. Both climb only as routes are re-applied.
--
-- 2. After applying one route, that row can answer the question direct_rate
--    could not:
-- SELECT operation, machine_rate, labor_rate, direct_rate,
--        line_hourly_rate, line_labour_rate, engine_version, setup_time_source
--   FROM process_cost_records
--  WHERE engine_version IS NOT NULL ORDER BY created_at DESC LIMIT 5;
