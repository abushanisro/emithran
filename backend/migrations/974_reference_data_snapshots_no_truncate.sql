-- Migration 974: reference_data_snapshots cannot be truncated either
-- Date: 2026-11-07
--
-- Migration 973 made the table immutable with a row-level trigger (BEFORE UPDATE OR DELETE). A row-level trigger does not fire for TRUNCATE, so
-- `TRUNCATE reference_data_snapshots` removed every row, and the roles holding the TRUNCATE privilege (service_role) could erase the data
-- that historical replay depends on. Two guards, because either alone is a single point of failure:
--   1. a statement-level BEFORE TRUNCATE trigger that raises the same error as the row trigger;
--   2. TRUNCATE revoked from the API roles (the table owner and superusers keep it for restores; the trigger still stops them).
-- Schema only: no rows are written. Idempotent.

DROP TRIGGER IF EXISTS reference_data_snapshots_no_truncate ON public.reference_data_snapshots;
CREATE TRIGGER reference_data_snapshots_no_truncate
  BEFORE TRUNCATE ON public.reference_data_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION public.reference_data_snapshots_frozen();

REVOKE TRUNCATE ON public.reference_data_snapshots FROM PUBLIC, anon, authenticated, service_role;
