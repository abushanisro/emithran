-- ===================================================================================
-- Migration 397: Fix waterjet mhr_records ownership (2026-08-03)
--
-- Same bug class as migration 394 (tapping), same root cause, same fix.
--
-- Live QA on a USA-located BOM item: applying the "Waterjet + Press Brake" route
-- showed "No MHR machine or benchmark rate on file in USA for: waterjet -- these
-- process costs are $0", even though direct DB queries (via the Supabase service-
-- role key, which bypasses RLS) confirmed 3 real mhr_records rows exist for
-- machine_class='waterjet', location='USA' (2 from migration 365, 1 from this
-- session's own follow-up migration 396). All 3 -- and every other location's
-- waterjet row from both migrations -- were inserted under
-- user_id = '417c3a4c-16c7-4467-93c6-1299c618c22b', copied from the older
-- BENCH-DEBURR seed convention, without checking which account actually owns the
-- BOM items being tested.
--
-- mhr_records has a strict RLS SELECT policy with no shared/benchmark-row
-- exception (auth.uid() = user_id AND is_user_authorized(), migration 020) -- it is
-- fundamentally a per-user-owned table. The real owner is
-- '5572f34d-2f51-456e-a5d7-96f840128b50' -- confirmed by migration 394 for the same
-- reason, and independently re-confirmed here: this is the SAME user_id that
-- already owns the real, customer-imported India waterjet catalog (17 real named
-- machines -- KMT, Maxiem, OMAX, Flow, ESAB -- currently live in mhr_records for
-- machine_class='waterjet', location='India'). Every account testing this app
-- queries mhr_records through its own Supabase JWT (fetchMachinePool() /
-- resolveMHRRates()'s Pass 1-3 all use the per-user client, never the admin
-- client) -- so rows owned by a different user_id are invisible to real UI
-- sessions even though a service-role verification query sees them fine. That
-- mismatch (service-role query succeeds, authenticated UI stays empty) is exactly
-- what was observed, and is the same false-positive trap migration 394 documents.
--
-- This reassigns ownership for every waterjet row seeded by migration 365 AND by
-- this session's migration 396 in one statement (both used the same wrong
-- user_id, both share commodity_code='SM-WATERJET') -- nothing about the rates
-- themselves changes, only who can see them.
-- ===================================================================================

UPDATE mhr_records
SET user_id = '5572f34d-2f51-456e-a5d7-96f840128b50'
WHERE commodity_code = 'SM-WATERJET'
  AND user_id = '417c3a4c-16c7-4467-93c6-1299c618c22b';

-- Verification:
-- SELECT location, machine_name, user_id FROM mhr_records
--   WHERE commodity_code = 'SM-WATERJET' ORDER BY location, machine_name;
-- Every row should now show user_id = '5572f34d-2f51-456e-a5d7-96f840128b50'.
--
-- After running this, refresh/reanalyze the USA BOM item and re-check the
-- "Waterjet + Press Brake" route comparison. If it now resolves to a real
-- machine (or at minimum the $78.00 USA mhr_benchmark_rates fallback instead of
-- "no rate on file"), this was the complete fix. If it still shows no rate,
-- the route-comparison cost path may be a separate function from
-- resolveMHRRates() with its own benchmark lookup -- flag that back and we trace
-- that path specifically next, rather than guessing further.
