-- ============================================================================
-- Migration 421: atomic merge for bom_items.scenario_overrides — fixes a real
-- race condition in patchScenarioOverrides' client-driven read-modify-write.
-- ============================================================================
-- Root cause: BOMItemsService.patchScenarioOverrides (added in migration 420)
-- reads the current scenario_overrides, merges the patch into it in
-- application code, then writes the whole merged object back. That's NOT
-- atomic across two independent PATCH requests: if a user sets Blank
-- Thickness (fires one PATCH for {sheetThicknessMm}) and shortly after clicks
-- Apply Scenario (fires a second PATCH for {location, batchSize}) close
-- enough together, request B can read scenario_overrides BEFORE request A's
-- write has landed, merge against that stale snapshot, and write back a
-- result that's missing A's key entirely — silently reverting it. This is
-- exactly the symptom reported: Blank Thickness's override survived a
-- refresh, but Digital Factory/Batch Size (saved together via Apply Scenario,
-- around the same time as another override save) did not.
--
-- Fix: move the merge into the database itself, inside a single function
-- call that Postgres runs as one implicit transaction with a row lock held
-- for its full duration — so two concurrent calls for the same bom_items row
-- serialize correctly instead of racing on a client-side read.
--
-- A null value in the patch still means "clear this key" (see migration 420's
-- own contract) — the jsonb `||` operator can only ADD/OVERWRITE keys, never
-- remove one, so null-valued keys are deleted in a second pass inside the
-- same function call.
-- ============================================================================

CREATE OR REPLACE FUNCTION merge_scenario_overrides(p_id uuid, p_patch jsonb)
RETURNS bom_items
LANGUAGE plpgsql
AS $$
DECLARE
  v_row bom_items;
  v_key text;
BEGIN
  UPDATE bom_items
  SET scenario_overrides = COALESCE(scenario_overrides, '{}'::jsonb) || p_patch,
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'BOM item % not found', p_id;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF (p_patch -> v_key) = 'null'::jsonb THEN
      UPDATE bom_items
      SET scenario_overrides = scenario_overrides - v_key
      WHERE id = p_id
      RETURNING * INTO v_row;
    END IF;
  END LOOP;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION merge_scenario_overrides IS
  'Atomically merges a partial patch into bom_items.scenario_overrides — see migration 421. '
  'A null value for a key deletes that key instead of storing null. Always use this for writes '
  'to scenario_overrides instead of a client-side read-merge-write, which races when two '
  'overrides are saved close together in time.';

-- Verification:
-- SELECT merge_scenario_overrides('<some bom_items.id>'::uuid, '{"sheetThicknessMm": 2}'::jsonb);
-- SELECT merge_scenario_overrides('<same id>'::uuid, '{"location": "Germany", "batchSize": 10000}'::jsonb);
-- SELECT scenario_overrides FROM bom_items WHERE id = '<same id>';
-- Expect: {"sheetThicknessMm": 2, "location": "Germany", "batchSize": 10000} — both merges present.
