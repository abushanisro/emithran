-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 408: Fix hole_forming mhr_records ownership (2026-08-05)
--
-- Same bug class as migrations 394 (tapping) and 397 (waterjet), same root cause:
-- mhr_records has a strict RLS SELECT policy (auth.uid() = user_id AND
-- is_user_authorized(), migration 020) with no shared/benchmark-row exception —
-- it is fundamentally per-user-owned. Migration 407 inserted its 10 rows under
-- whichever user_id 'abushan.isro@gmail.com' resolves to, copying migration 365's
-- convention WITHOUT checking it against migration 397's explicit finding: the
-- real owner of the account actually being tested is
-- '5572f34d-2f51-456e-a5d7-96f840128b50'. If that's a different account than
-- 'abushan.isro@gmail.com' resolves to, migration 407's rows exist in the table
-- (visible to a service-role/admin query) but are invisible to the real UI
-- session — which is exactly "MHR is there per SQL, dropdown still says No MHR
-- records" reported after running 407.
--
-- This reassigns ownership of every row migration 407 created
-- (commodity_code = 'SM-BURR-FORM' uniquely identifies them) to the confirmed
-- real owner. Nothing about the rates themselves changes, only who can see them.
-- Safe/idempotent: WHERE clause only touches rows not already owned correctly.
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE mhr_records
SET user_id = '5572f34d-2f51-456e-a5d7-96f840128b50'
WHERE commodity_code = 'SM-BURR-FORM'
  AND user_id <> '5572f34d-2f51-456e-a5d7-96f840128b50';

-- ── Verification ──────────────────────────────────────────────────────────────
-- SELECT location, machine_name, user_id, total_machine_hour_rate FROM mhr_records
--   WHERE commodity_code = 'SM-BURR-FORM' ORDER BY location;
-- Every row should now show user_id = '5572f34d-2f51-456e-a5d7-96f840128b50'.
--
-- After running this, hard-refresh (or close/reopen) the Edit Process Cost
-- dialog for Hole Extrusion (Burring) and re-check the MHR dropdown. If it
-- still shows "No MHR records", the query path may filter on something other
-- than user_id/location/machine_class (e.g. an is_active/availability_status
-- flag) — flag that back rather than guessing further.
