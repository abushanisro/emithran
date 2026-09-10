-- Migration: transactional replacement of a BOM item's active process routing
-- Description: One function that swaps an item's active process_cost_records
--              generation inside a single transaction.
-- Date: 2026-09-06

-- WHY THIS EXISTS
--
-- Applying a route replaces every active process_cost_records row for a BOM
-- item. That was done from the application as two separate statements, and
-- neither ordering is safe:
--
--   delete-then-insert  a failure after the delete leaves the item with FEWER
--                       operations than it started with, or none at all.
--                       Confirmed live: an apply-route call rejected on a bad
--                       user id destroyed all five of a parts operations.
--
--   insert-then-delete  violates uq_process_cost_records_active_op, the partial
--                       unique index on (bom_item_id, op_nbr) WHERE is_active,
--                       because both generations use op numbers 10, 20, 30...
--                       Confirmed live: re-applying a route failed outright.
--
-- Neither is fixable from the client, because the client cannot span two
-- statements in one transaction. A function body is one transaction, so the
-- delete and the insert commit together or not at all: no window in which the
-- item has a partial routing, and no moment when two generations are active at
-- the same op number. The unique index is left exactly as migration 477 defined
-- it -- it is the invariant being protected, not the obstacle.

CREATE OR REPLACE FUNCTION replace_active_process_cost_records(
  p_bom_item_id uuid,
  p_rows        jsonb
)
RETURNS integer
LANGUAGE plpgsql
-- SECURITY INVOKER (the default): the function runs as its caller, so row level
-- security applies exactly as it does to the direct statements this replaces.
-- Deliberately NOT SECURITY DEFINER, which would let any caller rewrite any
-- items routing.
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

  -- Refuse to blank an items routing. A caller with nothing to write should not
  -- be calling a REPLACE at all, and treating it as "delete everything" is how
  -- an upstream bug turns into silent data loss.
  IF jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'replace_active_process_cost_records: refusing to replace with an empty generation';
  END IF;

  -- Serialise concurrent applies for this one item. Held to the end of the
  -- transaction, released automatically on commit or rollback. Without it two
  -- simultaneous applies both delete, then both insert, and one dies on the
  -- unique index -- correct, but only by accident and after doing work.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_bom_item_id::text, 0));

  DELETE FROM process_cost_records
   WHERE bom_item_id = p_bom_item_id
     AND is_active = true;

  INSERT INTO process_cost_records (
    bom_item_id, user_id, op_nbr, operation, process_group, process_route,
    location, machine_class, machine_name, mhr_id, benchmark_mhr_id,
    machine_rate, labor_rate, lhr_id, direct_rate,
    setup_manning, setup_time, batch_size, heads, cycle_time,
    parts_per_cycle, scrap, currency, is_active, notes
  )
  SELECT
    p_bom_item_id, r.user_id, r.op_nbr, r.operation, r.process_group, r.process_route,
    r.location, r.machine_class, r.machine_name, r.mhr_id, r.benchmark_mhr_id,
    r.machine_rate, r.labor_rate, r.lhr_id, r.direct_rate,
    r.setup_manning, r.setup_time, r.batch_size, r.heads, r.cycle_time,
    r.parts_per_cycle, r.scrap, r.currency, true, r.notes
  FROM jsonb_to_recordset(p_rows) AS r(
    user_id          uuid,
    op_nbr           integer,
    operation        varchar,
    process_group    varchar,
    process_route    varchar,
    location         text,
    machine_class    varchar,
    machine_name     varchar,
    mhr_id           uuid,
    benchmark_mhr_id text,
    machine_rate     numeric,
    labor_rate       numeric,
    lhr_id           uuid,
    direct_rate      numeric,
    setup_manning    numeric,
    setup_time       numeric,
    batch_size       numeric,
    heads            numeric,
    cycle_time       numeric,
    parts_per_cycle  numeric,
    scrap            numeric,
    currency         varchar,
    notes            text
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Every row the caller sent must have landed. A mismatch means the payload
  -- carried something jsonb_to_recordset silently dropped; failing here rolls
  -- the whole swap back rather than leaving a short routing behind.
  IF v_inserted <> jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'replace_active_process_cost_records: expected % rows, inserted %',
      jsonb_array_length(p_rows), v_inserted;
  END IF;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION replace_active_process_cost_records(uuid, jsonb) IS
  'Atomically replaces a BOM items active process_cost_records generation. '
  'Delete and insert share one transaction, so a failure leaves the previous '
  'generation untouched and no partial generation can ever be active.';

GRANT EXECUTE ON FUNCTION replace_active_process_cost_records(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION replace_active_process_cost_records(uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
