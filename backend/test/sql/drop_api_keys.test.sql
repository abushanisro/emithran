-- 954: API keys and the request log are gone, and the nightly prune still runs.
\set ON_ERROR_STOP on

DO $$
BEGIN
  ASSERT to_regclass('public.api_keys') IS NULL, 'the API key table is dropped';
  ASSERT to_regclass('public.api_request_logs') IS NULL, 'the request log table is dropped';
  ASSERT to_regprocedure('public.authenticate_api_key(text)') IS NULL, 'the key lookup function is dropped';
  ASSERT to_regprocedure('public.my_sole_active_organization()') IS NULL, 'the helper only the key policy used is dropped';
  ASSERT NOT (prune_old_rows() ? 'api_request_logs'), 'the nightly prune no longer mentions the request log';
  ASSERT has_function_privilege('service_role', 'prune_old_rows()', 'EXECUTE'), 'the backend can still run the prune';
  ASSERT NOT has_function_privilege('authenticated', 'prune_old_rows()', 'EXECUTE'), 'signed-in users still cannot';
END $$;
