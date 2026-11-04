-- 962: a cost snapshot is frozen; a different member reviews it once, with a note; users read their own organization's rows only and change nothing.
INSERT INTO public.bom_items (id, organization_id) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a2');
INSERT INTO public.sand_cost_snapshots (id, bom_item_id, organization_id, label, summary, context, created_by) VALUES
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'quote rev A', '{"totalCost": 11.75}', '{"batchSize": 250}', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a2', 'other org', '{"totalCost": 3}', '{}', '00000000-0000-0000-0000-0000000000c2');

DO $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM public.sand_cost_snapshots WHERE id = '00000000-0000-0000-0000-00000000f001';
  ASSERT s = 'submitted', 'a new snapshot is submitted';

  -- frozen: the summary, the context, the label and the author never change
  BEGIN
    UPDATE public.sand_cost_snapshots SET summary = '{"totalCost": 1}' WHERE id = '00000000-0000-0000-0000-00000000f001';
    ASSERT false, 'the summary of a snapshot must not change';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.sand_cost_snapshots SET label = 'something else' WHERE id = '00000000-0000-0000-0000-00000000f001';
    ASSERT false, 'the label of a snapshot must not change';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.sand_cost_snapshots SET created_by = '00000000-0000-0000-0000-0000000000c9' WHERE id = '00000000-0000-0000-0000-00000000f001';
    ASSERT false, 'the author of a snapshot must not change';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- a review needs a reviewer, a time and a note, and the reviewer is not the author
  BEGIN
    UPDATE public.sand_cost_snapshots SET status = 'approved' WHERE id = '00000000-0000-0000-0000-00000000f001';
    ASSERT false, 'a review without a reviewer, a time and a note must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.sand_cost_snapshots SET status = 'approved', reviewed_by = '00000000-0000-0000-0000-0000000000c1', reviewed_at = now(), review_note = 'looks right'
     WHERE id = '00000000-0000-0000-0000-00000000f001';
    ASSERT false, 'the author must not approve their own snapshot';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.sand_cost_snapshots SET status = 'approved', reviewed_by = '00000000-0000-0000-0000-0000000000c9', reviewed_at = now(), review_note = '  '
     WHERE id = '00000000-0000-0000-0000-00000000f001';
    ASSERT false, 'a blank review note must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.sand_cost_snapshots SET status = 'maybe' WHERE id = '00000000-0000-0000-0000-00000000f001';
    ASSERT false, 'an unknown status must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- another member approves it, once
  UPDATE public.sand_cost_snapshots SET status = 'approved', reviewed_by = '00000000-0000-0000-0000-0000000000c9', reviewed_at = now(), review_note = 'rates and route checked'
   WHERE id = '00000000-0000-0000-0000-00000000f001';
  SELECT status INTO s FROM public.sand_cost_snapshots WHERE id = '00000000-0000-0000-0000-00000000f001';
  ASSERT s = 'approved', 'a different member can approve';
  BEGIN
    UPDATE public.sand_cost_snapshots SET status = 'rejected', reviewed_by = '00000000-0000-0000-0000-0000000000c8', reviewed_at = now(), review_note = 'changed my mind'
     WHERE id = '00000000-0000-0000-0000-00000000f001';
    ASSERT false, 'a reviewed snapshot must not be reviewed again';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$$;

SET ROLE authenticated;
SET test.org_ids = '00000000-0000-0000-0000-0000000000a1';
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.sand_cost_snapshots;
  ASSERT n = 1, 'a user sees the snapshots of their own organization only';
  BEGIN
    INSERT INTO public.sand_cost_snapshots (bom_item_id, organization_id, label, summary, context, created_by)
    VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'nope nope', '{}', '{}', '00000000-0000-0000-0000-0000000000c1');
    ASSERT false, 'a user cannot insert';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.sand_cost_snapshots SET label = 'changed';
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'a user cannot update';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.sand_cost_snapshots;
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'a user cannot delete';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

-- removing the BOM item removes its snapshots
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM public.bom_items WHERE id = '00000000-0000-0000-0000-0000000000f3';
  SELECT count(*) INTO n FROM public.sand_cost_snapshots WHERE bom_item_id = '00000000-0000-0000-0000-0000000000f3';
  ASSERT n = 0, 'snapshots go with their BOM item';
END
$$;
