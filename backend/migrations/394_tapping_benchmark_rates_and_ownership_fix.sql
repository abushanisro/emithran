-- ===================================================================================
-- Migration 394: Fix migration 393's user_id + add global tapping benchmark rates (2026-07-31)
--
-- Two related fixes, both surfaced by live QA on BOM item 573ae951-99ad-4925-9cf0-
-- 10c9dcec5a23 (830-001718-00) still showing "No MHR records for USA" for Tapping
-- after migration 393 supposedly added real data for machine_class='tapping'.
--
-- Bug 1 (data ownership): migration 393 inserted its 10 mhr_records rows with
-- user_id = '417c3a4c-16c7-4467-93c6-1299c618c22b', copied from the older
-- BENCH-DEBURR seed convention, WITHOUT checking which account actually owns the
-- part being tested. mhr_records has a strict RLS SELECT policy
-- (auth.uid() = user_id AND is_user_authorized(), migration 020) with no exception
-- for shared/benchmark rows -- it is fundamentally a per-user-owned table. The real
-- owner of this BOM item (and every account testing it) is
-- '5572f34d-2f51-456e-a5d7-96f840128b50' (confirmed: bom_items.user_id for this
-- item, and the SAME user_id already owns the working "Manual Deburr" $14.13/hr row
-- that made Deburring resolve correctly while Tapping did not). Every verification
-- this session used the Supabase service-role key, which bypasses RLS entirely --
-- that bypass is exactly why the fix kept appearing correct in testing while the
-- real authenticated UI kept showing empty. Fixed directly (not re-run here, since
-- it was already applied live via script):
--   UPDATE mhr_records SET user_id = '5572f34d-2f51-456e-a5d7-96f840128b50'
--   WHERE commodity_code = 'SM-TAP-CNC' AND user_id = '417c3a4c-16c7-4467-93c6-1299c618c22b';
--
-- Bug 2 (architecture): hardcoding any single user_id on mhr_records only ever
-- benefits that one account, which conflicts with this project's standing rule
-- (established earlier this session, migration 392) that fixes must work for ALL
-- users, not one hardcoded case. The mechanism this app already uses for real,
-- globally-visible reference rates -- shown as the "★" benchmark option throughout
-- the UI (labour rates, other machine classes) whenever a user has no personal MHR
-- record -- is mhr_benchmark_rates: no user_id column, explicitly documented as
-- global/shared (migration 345), read via the admin client specifically so RLS
-- never gates it. This migration adds the SAME researched tapping data there too,
-- so any user (not just the one account patched above) sees a real tapping rate
-- instead of "No MHR records" the first time they hit this gap.
--
-- Rates are the identical derivation documented in migration 393 (BENCH-DEBURR's
-- real per-location rate + 15%, cross-validated against real India/USA pneumatic-
-- tapping-arm capital-cost research), converted to USD via this codebase's INR-
-- pivot exchange table (value_local * rate[currency] / rate['USD']):
--   India  430 INR -> 430/83.5            = 5.15
--   USA     40 USD -> 40                  = 40.00
--   China   92 CNY -> 92*11.52/83.5       = 12.69
--   Germany 46 EUR -> 46*89/83.5          = 49.03
--   Mexico 276 MXN -> 276*4.77/83.5       = 15.77
--   Vietnam  8      -> 8 (see note)       = 8.00
--   UK      35 GBP -> 35*104/83.5         = 43.59
--   France  41 EUR -> 41*89/83.5          = 43.69
--   W.Europe44 EUR -> 44*89/83.5          = 46.90
--   E.Europe14 EUR -> 14*89/83.5          = 14.93
-- Note on Vietnam: the BENCH-DEBURR anchor row this was derived from stores "7"
-- with currency=NULL, and 7-8 does not match VND's real magnitude (thousands per
-- USD) -- this is a pre-existing ambiguity in that seed row, not introduced here.
-- Carried through as-is (treated as already USD-scale) rather than mis-converting
-- it through the VND rate, which would produce an implausible fraction of a cent.
-- ===================================================================================

INSERT INTO mhr_benchmark_rates (machine_name, process_group, location, mhr_usd, machine_ref, machine_class)
VALUES
  ('Pneumatic Tapping Arm', 'Sheet Metal', 'India',     5.15, 'Bench-mount pneumatic tapping arm', 'tapping'),
  ('Pneumatic Tapping Arm', 'Sheet Metal', 'USA',      40.00, 'Bench-mount pneumatic tapping arm', 'tapping'),
  ('Pneumatic Tapping Arm', 'Sheet Metal', 'China',    12.69, 'Bench-mount pneumatic tapping arm', 'tapping'),
  ('Pneumatic Tapping Arm', 'Sheet Metal', 'Germany',  49.03, 'Bench-mount pneumatic tapping arm', 'tapping'),
  ('Pneumatic Tapping Arm', 'Sheet Metal', 'Mexico',   15.77, 'Bench-mount pneumatic tapping arm', 'tapping'),
  ('Pneumatic Tapping Arm', 'Sheet Metal', 'Vietnam',   8.00, 'Bench-mount pneumatic tapping arm', 'tapping'),
  ('Pneumatic Tapping Arm', 'Sheet Metal', 'UK',       43.59, 'Bench-mount pneumatic tapping arm', 'tapping'),
  ('Pneumatic Tapping Arm', 'Sheet Metal', 'France',   43.69, 'Bench-mount pneumatic tapping arm', 'tapping'),
  ('Pneumatic Tapping Arm', 'Sheet Metal', 'W. Europe',46.90, 'Bench-mount pneumatic tapping arm', 'tapping'),
  ('Pneumatic Tapping Arm', 'Sheet Metal', 'E. Europe',14.93, 'Bench-mount pneumatic tapping arm', 'tapping');

-- Verification:
-- SELECT location, mhr_usd, machine_ref FROM mhr_benchmark_rates WHERE machine_class = 'tapping' ORDER BY location;
-- SELECT location, user_id FROM mhr_records WHERE commodity_code = 'SM-TAP-CNC' ORDER BY location;
--   -- all 10 rows should show user_id = '5572f34d-2f51-456e-a5d7-96f840128b50'
