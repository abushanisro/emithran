-- job_queue: claim order, no double claim, retry with back-off, stale re-claim, exhaustion, API roles locked out.
DO $$
DECLARE a uuid; b uuid; got public.job_queue; n integer;
BEGIN
  a := enqueue_job('q', '{"n":1}', 2);
  b := enqueue_job('q', '{"n":2}', 2);
  PERFORM enqueue_job('other', '{}', 2);

  SELECT * INTO got FROM claim_next_job('q');
  ASSERT got.id = a AND got.state = 'running' AND got.attempts = 1, 'oldest job is claimed first';
  SELECT * INTO got FROM claim_next_job('q');
  ASSERT got.id = b, 'a claimed job is not claimed twice';
  SELECT count(*) INTO n FROM claim_next_job('q');
  ASSERT n = 0, 'an empty queue claims nothing (and does not touch other queues)';

  PERFORM complete_job(b, '{"ok":true}');
  ASSERT (SELECT state FROM job_queue WHERE id = b) = 'completed' AND (SELECT output FROM job_queue WHERE id = b) = '{"ok":true}', 'complete stores the output';

  -- attempt 1 of 2 fails: back to queued, not due yet
  PERFORM fail_job(a, 'boom');
  ASSERT (SELECT state FROM job_queue WHERE id = a) = 'queued', 'a failed attempt retries';
  SELECT count(*) INTO n FROM claim_next_job('q');
  ASSERT n = 0, 'a retry waits for its back-off';

  -- due now: attempt 2 fails: out of attempts
  UPDATE job_queue SET run_at = now() WHERE id = a;
  SELECT * INTO got FROM claim_next_job('q');
  ASSERT got.id = a AND got.attempts = 2, 'a due retry is claimed again';
  PERFORM fail_job(a, 'boom again');
  ASSERT (SELECT state FROM job_queue WHERE id = a) = 'failed' AND (SELECT error FROM job_queue WHERE id = a) = 'boom again', 'exhausted attempts fail the job';
END
$$;

DO $$
DECLARE c uuid; got public.job_queue; n integer;
BEGIN
  c := enqueue_job('s', '{}', 2);
  PERFORM claim_next_job('s');
  UPDATE job_queue SET locked_at = now() - interval '1 hour' WHERE id = c;
  SELECT * INTO got FROM claim_next_job('s', 900);
  ASSERT got.id = c AND got.attempts = 2, 'a job left running by a dead worker is claimed again once stale';
  UPDATE job_queue SET locked_at = now() - interval '1 hour' WHERE id = c;
  SELECT count(*) INTO n FROM claim_next_job('s', 900);
  ASSERT n = 0 AND (SELECT state FROM job_queue WHERE id = c) = 'failed', 'a stale job with no attempts left is failed, not claimed';
END
$$;

DO $$
BEGIN
  ASSERT NOT has_table_privilege('authenticated', 'public.job_queue', 'SELECT'), 'API roles cannot read the queue';
  ASSERT NOT has_function_privilege('authenticated', 'public.enqueue_job(text, jsonb, integer)', 'EXECUTE'), 'API roles cannot enqueue';
  ASSERT has_function_privilege('service_role', 'public.claim_next_job(text, integer)', 'EXECUTE'), 'the service role can claim';
END
$$;
