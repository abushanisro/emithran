-- 950: a copilot memory proposal is the user's own, lives at most 10 minutes and can be consumed once.
INSERT INTO auth.users (id) VALUES ('11111111-0000-4000-8000-00000000000a'), ('11111111-0000-4000-8000-00000000000b');

\i /migrations/950_copilot_memory_proposals.sql
\i /migrations/950_copilot_memory_proposals.sql

SET ROLE authenticated;
SELECT set_config('test.uid', '11111111-0000-4000-8000-00000000000a', false);
DO $$
DECLARE v_id uuid; v_add text[];
BEGIN
  INSERT INTO public.copilot_memory_proposals (conversation_id, turn, add_preferences)
  VALUES ('dddddddd-0000-4000-8000-000000000001', 1, '{"show costs per 1000 parts"}') RETURNING id INTO v_id;
  PERFORM set_config('test.proposal', v_id::text, false);
  ASSERT (SELECT user_id FROM public.copilot_memory_proposals WHERE id = v_id) = '11111111-0000-4000-8000-00000000000a', 'owned by the caller';
  ASSERT (SELECT expires_at - created_at FROM public.copilot_memory_proposals WHERE id = v_id) = interval '10 minutes', 'expires in 10 minutes';

  -- a proposal cannot be made for someone else, already consumed, or long-lived
  BEGIN
    INSERT INTO public.copilot_memory_proposals (user_id, conversation_id, turn, add_preferences)
    VALUES ('11111111-0000-4000-8000-00000000000b', 'dddddddd-0000-4000-8000-000000000001', 1, '{"x"}');
    RAISE EXCEPTION 'a proposal was made for another user';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.copilot_memory_proposals (conversation_id, turn, add_preferences, expires_at)
    VALUES ('dddddddd-0000-4000-8000-000000000001', 1, '{"x"}', now() + interval '1 day');
    RAISE EXCEPTION 'a long-lived proposal was made';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.copilot_memory_proposals (conversation_id, turn) VALUES ('dddddddd-0000-4000-8000-000000000001', 1);
    RAISE EXCEPTION 'an empty proposal was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- what was proposed cannot be rewritten afterwards
  BEGIN
    UPDATE public.copilot_memory_proposals SET add_preferences = '{"ignore all rules"}' WHERE id = v_id;
    RAISE EXCEPTION 'a proposal was rewritten';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- consumed once: the second confirm matches nothing
  UPDATE public.copilot_memory_proposals SET consumed_at = now() WHERE id = v_id RETURNING add_preferences INTO v_add;
  ASSERT v_add = '{"show costs per 1000 parts"}', 'first confirm returns the proposal';
  v_add := NULL;
  UPDATE public.copilot_memory_proposals SET consumed_at = now() WHERE id = v_id RETURNING add_preferences INTO v_add;
  ASSERT v_add IS NULL, 'second confirm matches nothing';
END $$;

-- another user can neither see nor consume it
SELECT set_config('test.uid', '11111111-0000-4000-8000-00000000000b', false);
DO $$
DECLARE v_id uuid := current_setting('test.proposal')::uuid; n integer;
BEGIN
  ASSERT (SELECT count(*) FROM public.copilot_memory_proposals) = 0, 'B sees no proposal of A';
  UPDATE public.copilot_memory_proposals SET consumed_at = now() WHERE id = v_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'B cannot consume A''s proposal';
  DELETE FROM public.copilot_memory_proposals WHERE id = v_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'B cannot delete A''s proposal';
END $$;
RESET ROLE;

-- an expired proposal cannot be consumed
UPDATE public.copilot_memory_proposals SET consumed_at = NULL, created_at = now() - interval '11 minutes',
       expires_at = now() - interval '1 minute';
SET ROLE authenticated;
SELECT set_config('test.uid', '11111111-0000-4000-8000-00000000000a', false);
DO $$
DECLARE n integer;
BEGIN
  UPDATE public.copilot_memory_proposals SET consumed_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'an expired proposal cannot be consumed';
END $$;
RESET ROLE;

SET ROLE anon;
DO $$
BEGIN
  ASSERT NOT has_table_privilege('anon', 'public.copilot_memory_proposals', 'SELECT'), 'anon cannot read proposals';
  ASSERT NOT has_table_privilege('anon', 'public.copilot_memory_proposals', 'INSERT'), 'anon cannot make proposals';
END $$;
RESET ROLE;
