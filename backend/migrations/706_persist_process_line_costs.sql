-- Migration: carry the engine per-line costs through the generation swap
-- Description: Adds setup_cost_per_part / total_cycle_cost_per_part /
--              total_cost_per_part to replace_active_process_cost_records.
-- Date: 2026-09-08

-- WHY THIS EXISTS
--
-- process_cost_records has three per-line cost columns. They have never been
-- written, and buildLineFromAppliedRecord reads them as `?? 0`, so once a route
-- was applied the Cost Guide showed its two CORE operations at zero:
--
--   Cost Guide  Laser Cutting 0          Press Brake 0
--   Route       Laser Cutting 0.00023952 Press Brake 0.00035928
--
-- Measured end to end on a real CAD-bearing part: Cost Guide totalProcessCost
-- 0.03988 against the applied route total 0.04096. The secondary operations
-- agreed exactly, because they are not overlaid from persistence and kept their
-- live values. Only the overlaid lines lost their cost.
--
-- There were TWO reasons the columns stayed null, and this migration fixes the
-- one that lives in the database. The writer did not send them (fixed in
-- bom-items.controller.ts alongside this), AND this function did not carry
-- them: they were absent from the jsonb_to_recordset column list, so even a
-- caller that sent them had them silently dropped. Nothing errored -- the rows
-- inserted, three columns short.
--
-- NOT CHANGED HERE: sync_process_cost_to_bom_item. Its two migration files
-- (035, 037) both assign `process_cost = COALESCE(NEW.total_cost_per_part, 0)`
-- per row, which would make the last inserted operation the whole part cost the
-- moment real values started arriving. The LIVE function does not do that --
-- verified behaviourally against this database: inserting 2,3,5 yields 10 (not
-- 5); replacing a 5,3,2 generation with 1,1 yields 2 (not 12); an inactive row
-- of 6 beside an active 4 yields 4; updating 4 to 1 alongside 6 yields 7. That
-- is an order-independent SUM over the active generation, which is exactly the
-- aggregate this change needs, so the rollup is already correct and is left
-- alone. The file/live drift is real and is reported separately -- 035 and 037
-- are CREATE OR REPLACE, so re-running either would overwrite the correct live
-- function with the broken assignment form.

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
    setup_cost_per_part, total_cycle_cost_per_part, total_cost_per_part
  )
  SELECT
    p_bom_item_id, r.user_id, r.op_nbr, r.operation, r.process_group, r.process_route,
    r.location, r.machine_class, r.machine_name, r.mhr_id, r.benchmark_mhr_id,
    r.machine_rate, r.labor_rate, r.lhr_id, r.direct_rate,
    r.setup_manning, r.setup_time, r.batch_size, r.heads, r.cycle_time,
    r.parts_per_cycle, r.scrap, r.currency, true, r.notes,
    r.setup_cost_per_part, r.total_cycle_cost_per_part, r.total_cost_per_part
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
    -- The three that were missing. Values come straight from the engine line
    -- (setupCost / runCost / totalCost); nothing is computed here.
    setup_cost_per_part      numeric,
    total_cycle_cost_per_part numeric,
    total_cost_per_part      numeric
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
  'Atomically replaces a BOM items active process_cost_records generation, '
  'including the engine per-line costs. Delete and insert share one '
  'transaction, so a failure leaves the previous generation untouched and no '
  'partial generation can ever be active.';

GRANT EXECUTE ON FUNCTION replace_active_process_cost_records(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION replace_active_process_cost_records(uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
