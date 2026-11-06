-- Migration 970: process_cost_records keeps the machine / labour split of an operation's cycle cost
-- Date: 2026-11-06
--
-- An operation's cost is machine time plus the people who run it. The engine states the two apart per part (machineCostPerPart, laborCostPerPart:
-- the cycle only, the setup is already setup_cost_per_part), but only their sum was stored, so the Excel view could not show Labor and Direct
-- Overhead as separate columns. Two nullable columns carry them; a row whose engine does not report the split leaves them NULL (not 0).
--
-- replace_active_process_cost_records is the migration 891 body with the two columns added and nothing else altered. Schema only: no reference rows.

ALTER TABLE process_cost_records
  ADD COLUMN IF NOT EXISTS machine_cost_per_part numeric CHECK (machine_cost_per_part IS NULL OR machine_cost_per_part >= 0),
  ADD COLUMN IF NOT EXISTS labor_cost_per_part   numeric CHECK (labor_cost_per_part   IS NULL OR labor_cost_per_part   >= 0);

COMMENT ON COLUMN process_cost_records.machine_cost_per_part IS 'The cycle machine cost per part (machine rate x cycle time), USD. NULL when the engine does not state the split. With labor_cost_per_part and setup_cost_per_part it adds up to total_cost_per_part for engines that report it.';
COMMENT ON COLUMN process_cost_records.labor_cost_per_part IS 'The cycle operator labour cost per part (labour rate x operators x cycle time), USD. NULL when the engine does not state the split.';

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
    line_hourly_rate, line_labour_rate, engine_version, setup_time_source,
    charge_basis, machine_cost_per_part, labor_cost_per_part
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
    r.line_hourly_rate, r.line_labour_rate, r.engine_version, r.setup_time_source,
    COALESCE(r.charge_basis, 'time'), r.machine_cost_per_part, r.labor_cost_per_part
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
    line_hourly_rate         numeric,
    line_labour_rate         numeric,
    engine_version           text,
    setup_time_source        text,
    charge_basis             text,
    -- Added by migration 970.
    machine_cost_per_part    numeric,
    labor_cost_per_part      numeric
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
  'Atomically replaces the active process_cost_records generation for a BOM item, including the engine per-line costs (706), the explicit currency contract columns (707), the costed-operation provenance columns (718), the charge basis (890/891) and the machine / labour split (970). Delete and insert share one transaction, so a failure leaves the previous generation untouched and no partial generation can ever be active.';

GRANT EXECUTE ON FUNCTION replace_active_process_cost_records(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION replace_active_process_cost_records(uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
