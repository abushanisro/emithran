-- Migration: make the process-cost table enforce what its own file claims (P4)
-- Description: Applies the integrity constraints migration 034 declares but
--              never installed, corrects the one of them that is wrong, and
--              guards new rows against a zero cycle time. No row is modified,
--              deleted or deactivated.
-- Date: 2026-09-09

-- WHY THIS EXISTS
--
-- Audit finding RC-5: the migration files and the live database disagree, in
-- both directions, and neither is authoritative.
--
-- Migration 034 declares process_cost_records inside CREATE TABLE IF NOT
-- EXISTS. The table already existed when 034 ran, so the entire column list --
-- including every CHECK in it -- was skipped silently. The file has read like
-- a specification of this table ever since without ever having constrained it.
--
-- That is not a theoretical gap. writeProcessLinesAsRecords reasons from those
-- constraints in a comment, stating that cycle_time is NOT NULL CHECK
-- (cycle_time >= 1) per migration 034, and concluding that a line whose cycle
-- time could not be resolved is schema-impossible to persist.
--
-- It is not schema-impossible. Nothing in the database enforces it, and two
-- rows in the live table hold cycle_time = 0 (see below). The safety net that
-- comment describes is imaginary; findRouteDataGaps in that same function is
-- the only thing actually preventing it.
--
-- WHAT WAS MEASURED, BEFORE DECIDING WHAT TO APPLY
--
-- All 507 live rows, checked column by column. None of these five columns has
-- a single NULL, so no constraint below is silently satisfied by absence:
--
--   setup_time      >= 0                  507 / 507 satisfy
--   batch_size      >= 1                  507 / 507 satisfy
--   parts_per_cycle >= 1                  507 / 507 satisfy
--   scrap  >= 0 AND scrap < 100           507 / 507 satisfy
--   cycle_time      >= 1                  504 / 507 satisfy   <- the 034 version
--   cycle_time      >  0                  505 / 507 satisfy
--
-- THE ONE DECLARED CONSTRAINT THAT IS SIMPLY WRONG
--
-- cycle_time is stored in SECONDS, so >= 1 asserts that no operation can take
-- less than one second. That is false, and the row that proves it is the
-- newest real row in the table:
--
--   fce24614  3 Roll Bending  roll_bending_3  cycle_time 0.60  2026-09-09
--
-- A 0.6 second cycle is a genuine press or roll figure the engine derived from
-- real machine data, not a defect. Had the 034 CHECK ever been installed, that
-- correct quote would have been rejected at insert. So this migration does NOT
-- restore >= 1; it installs the invariant the application actually enforces
-- (findRouteDataGaps rejects a route whose cycle time is unresolved), which is
-- that a persisted operation takes a positive amount of time.
--
-- WHY cycle_time IS ADDED NOT VALID
--
-- Two rows would fail it:
--
--   6c57a193  operation fixture  machine_class NULL  cycle_time 0.00
--   be45866f  operation fixture  machine_class NULL  cycle_time 0.00
--
-- Both are from 2026-07-12, both carry notes auto_fill_from_route:cnc-5ax,
-- both have NULL machine_class, NULL location and NULL total_cost_per_part --
-- the shape an older auto-fill path produced and the current writer cannot
-- produce at all. They are also is_active = true, so they sit on two real BOM
-- items today.
--
-- NOT VALID enforces the rule on every INSERT and UPDATE from now on while
-- leaving those two rows exactly as they are. Deactivating or rewriting live
-- rows on two real parts is a decision with user-visible consequences and is
-- deliberately not taken here on the strength of a schema tidy-up. They stay
-- visible, and the query at the bottom of this file finds them again when
-- somebody wants to decide what they should be. Once they are resolved,
--   ALTER TABLE process_cost_records VALIDATE CONSTRAINT ck_pcr_cycle_time_positive;
-- promotes it with no other change.
--
-- The other four are added VALIDATED, because the live data already satisfies
-- them and a constraint that is true should say so.

DO $$
BEGIN
  -- The 034 version, in case any environment did install it. It rejects real
  -- sub-second cycle times, so it must go before the correct one goes on.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'process_cost_records'::regclass
      AND conname = 'process_cost_records_cycle_time_check'
  ) THEN
    ALTER TABLE process_cost_records DROP CONSTRAINT process_cost_records_cycle_time_check;
    RAISE NOTICE 'Dropped process_cost_records_cycle_time_check - it rejects real sub-second cycles.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'process_cost_records'::regclass AND conname = 'ck_pcr_cycle_time_positive'
  ) THEN
    ALTER TABLE process_cost_records
      ADD CONSTRAINT ck_pcr_cycle_time_positive CHECK (cycle_time > 0) NOT VALID;
    RAISE NOTICE 'Added ck_pcr_cycle_time_positive NOT VALID - two legacy fixture rows are exempt.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'process_cost_records'::regclass AND conname = 'ck_pcr_setup_time_non_negative'
  ) THEN
    ALTER TABLE process_cost_records
      ADD CONSTRAINT ck_pcr_setup_time_non_negative CHECK (setup_time >= 0);
    RAISE NOTICE 'Added ck_pcr_setup_time_non_negative.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'process_cost_records'::regclass AND conname = 'ck_pcr_batch_size_at_least_one'
  ) THEN
    ALTER TABLE process_cost_records
      ADD CONSTRAINT ck_pcr_batch_size_at_least_one CHECK (batch_size >= 1);
    RAISE NOTICE 'Added ck_pcr_batch_size_at_least_one.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'process_cost_records'::regclass AND conname = 'ck_pcr_parts_per_cycle_at_least_one'
  ) THEN
    ALTER TABLE process_cost_records
      ADD CONSTRAINT ck_pcr_parts_per_cycle_at_least_one CHECK (parts_per_cycle >= 1);
    RAISE NOTICE 'Added ck_pcr_parts_per_cycle_at_least_one.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'process_cost_records'::regclass AND conname = 'ck_pcr_scrap_is_a_percentage'
  ) THEN
    ALTER TABLE process_cost_records
      ADD CONSTRAINT ck_pcr_scrap_is_a_percentage CHECK (scrap >= 0 AND scrap < 100);
    RAISE NOTICE 'Added ck_pcr_scrap_is_a_percentage.';
  END IF;
END $$;

COMMENT ON COLUMN process_cost_records.cycle_time IS
  'Cycle time in SECONDS. Constrained > 0 by ck_pcr_cycle_time_positive '
  '(migration 717, NOT VALID - two legacy fixture rows from 2026-07-12 hold 0). '
  'Sub-second values are real: a press or roll operation can genuinely cycle in '
  'under a second, which is why the CHECK (cycle_time >= 1) declared by '
  'migration 034 is NOT restored.';

-- ── Verification ─────────────────────────────────────────────────────────────
-- 1. The constraints now exist:
-- SELECT conname, convalidated FROM pg_constraint
--  WHERE conrelid = 'process_cost_records'::regclass AND conname LIKE 'ck_pcr_%'
--  ORDER BY conname;
-- Expect five rows; ck_pcr_cycle_time_positive with convalidated = false, the
-- other four true.
--
-- 2. The two rows the cycle-time constraint is not yet validated against:
-- SELECT id, bom_item_id, operation, machine_class, location, is_active, notes
--   FROM process_cost_records WHERE cycle_time <= 0;
-- Expect exactly 6c57a193 and be45866f, both with operation fixture.
