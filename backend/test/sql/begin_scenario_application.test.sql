-- 969: one Apply Scenario at a time per BOM item, against the revision the caller saw.
-- The stub bom_items has no scenario columns; the real table does (migrations 420/421).
ALTER TABLE public.bom_items ADD COLUMN IF NOT EXISTS scenario_overrides jsonb, ADD COLUMN IF NOT EXISTS updated_at timestamptz;
INSERT INTO public.bom_items (id) VALUES ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2');

DO $$
DECLARE
  v_rev integer;
  v_state jsonb;
BEGIN
  -- a first apply on an item that never had one starts at revision 0 and is marked applying
  SELECT public.begin_scenario_application('00000000-0000-0000-0000-0000000000b1', 0) INTO v_rev;
  ASSERT v_rev = 0, 'a never-applied item is at revision 0';
  SELECT scenario_overrides -> 'appliedScenario' INTO v_state FROM public.bom_items WHERE id = '00000000-0000-0000-0000-0000000000b1';
  ASSERT v_state ->> 'status' = 'applying' AND (v_state ->> 'revision')::int = 0 AND v_state ? 'startedAt', 'the state says applying, with its start';

  -- a second apply while the first runs is refused
  BEGIN
    PERFORM public.begin_scenario_application('00000000-0000-0000-0000-0000000000b1', 0);
    ASSERT false, 'a running apply must block another';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE 'scenario_apply_in_progress%', 'the refusal names the running apply: ' || SQLERRM;
  END;

  -- the first apply finishes (what the service writes through merge_scenario_overrides): revision + 1
  UPDATE public.bom_items
  SET scenario_overrides = scenario_overrides || '{"appliedScenario": {"revision": 1, "status": "applied"}}'::jsonb
  WHERE id = '00000000-0000-0000-0000-0000000000b1';

  -- a caller that still holds revision 0 is told someone applied since
  BEGIN
    PERFORM public.begin_scenario_application('00000000-0000-0000-0000-0000000000b1', 0);
    ASSERT false, 'a stale revision must be refused';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE 'scenario_revision_conflict%', 'the refusal says the revision moved: ' || SQLERRM;
  END;

  -- the caller at the current revision may apply again, and a caller that states none is not checked
  SELECT public.begin_scenario_application('00000000-0000-0000-0000-0000000000b1', 1) INTO v_rev;
  ASSERT v_rev = 1, 'the current revision is accepted';

  -- a failed apply releases the item: the next one is not blocked and the revision did not move
  UPDATE public.bom_items
  SET scenario_overrides = scenario_overrides || '{"appliedScenario": {"revision": 1, "status": "failed", "error": "x"}}'::jsonb
  WHERE id = '00000000-0000-0000-0000-0000000000b1';
  SELECT public.begin_scenario_application('00000000-0000-0000-0000-0000000000b1', NULL) INTO v_rev;
  ASSERT v_rev = 1, 'after a failure the stored revision is unchanged and a new apply may start';

  -- an apply that began long ago and never finished does not block the item for ever
  UPDATE public.bom_items
  SET scenario_overrides = jsonb_set(scenario_overrides, '{appliedScenario,startedAt}', to_jsonb(now() - interval '2 hours'))
  WHERE id = '00000000-0000-0000-0000-0000000000b1';
  SELECT public.begin_scenario_application('00000000-0000-0000-0000-0000000000b1', 1, 900) INTO v_rev;
  ASSERT v_rev = 1, 'a stale applying state may be taken over';

  -- other scenario keys are kept
  UPDATE public.bom_items SET scenario_overrides = '{"location": "India", "batchSize": 500}'::jsonb WHERE id = '00000000-0000-0000-0000-0000000000b2';
  PERFORM public.begin_scenario_application('00000000-0000-0000-0000-0000000000b2', NULL);
  ASSERT (SELECT scenario_overrides ->> 'location' FROM public.bom_items WHERE id = '00000000-0000-0000-0000-0000000000b2') = 'India', 'the rest of the scenario is untouched';

  -- an unknown item is not found
  BEGIN
    PERFORM public.begin_scenario_application('00000000-0000-0000-0000-0000000000ff', NULL);
    ASSERT false, 'an unknown item must fail';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE '%not found%', 'not found: ' || SQLERRM;
  END;
END
$$;
