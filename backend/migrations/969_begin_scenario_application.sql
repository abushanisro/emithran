-- ============================================================================
-- Migration 969: one Apply Scenario at a time per BOM item, against the revision the caller saw
-- ============================================================================
-- Apply Scenario is one backend operation (ScenarioApplicationService). Its state is bom_items.scenario_overrides.appliedScenario:
--   { revision, status: 'applying' | 'applied' | 'failed', startedAt, appliedAt, failedAt, error, analysisVersion }
-- `revision` counts successful applies. The operation starts with begin_scenario_application, which in one statement under a row lock:
--   - refuses (scenario_revision_conflict) when the caller's expected revision is not the stored one: someone else applied since the caller read it;
--   - refuses (scenario_apply_in_progress) when another apply is running and started within p_stale_after_seconds (a crashed apply does not block the
--     item for ever: after that it may be taken over);
--   - otherwise marks the apply as 'applying' and returns the stored revision.
-- The operation ends with merge_scenario_overrides (migration 421) writing 'applied' (revision + 1) or 'failed' (revision unchanged, with the error).
-- No new table and no data: the state lives in the column that already holds the scenario. SECURITY INVOKER: row-level security on bom_items decides
-- whether the caller may touch the item, exactly as for merge_scenario_overrides. Idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.begin_scenario_application(
  p_id uuid,
  p_expected_revision integer DEFAULT NULL,
  p_stale_after_seconds integer DEFAULT 900
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_state   jsonb;
  v_rev     integer;
  v_started timestamptz;
BEGIN
  SELECT scenario_overrides -> 'appliedScenario' INTO v_state FROM public.bom_items WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOM item % not found', p_id;
  END IF;

  v_rev := COALESCE((v_state ->> 'revision')::integer, 0);
  IF p_expected_revision IS NOT NULL AND p_expected_revision <> v_rev THEN
    RAISE EXCEPTION 'scenario_revision_conflict: the scenario is at revision %, not %', v_rev, p_expected_revision;
  END IF;

  v_started := NULLIF(v_state ->> 'startedAt', '')::timestamptz;
  IF v_state ->> 'status' = 'applying' AND v_started IS NOT NULL AND v_started > now() - make_interval(secs => p_stale_after_seconds) THEN
    RAISE EXCEPTION 'scenario_apply_in_progress: another apply of this scenario started at %', v_started;
  END IF;

  UPDATE public.bom_items
  SET scenario_overrides = COALESCE(scenario_overrides, '{}'::jsonb)
        || jsonb_build_object('appliedScenario', jsonb_build_object('revision', v_rev, 'status', 'applying', 'startedAt', now())),
      updated_at = now()
  WHERE id = p_id;

  RETURN v_rev;
END;
$$;

COMMENT ON FUNCTION public.begin_scenario_application IS
  'Starts an Apply Scenario for one BOM item: refuses a stale revision or a running apply, marks it applying, returns the stored revision (migration 969).';
