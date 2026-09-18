-- ============================================================================
-- Migration 780: Add a real, verified `machining_route_role` column to
-- process_taxonomy, so a Machining machine class can be discovered
-- dynamically as "a valid primary milling/turning route" or "an inspection
-- station" instead of being hardcoded as one of 6 generic TypeScript
-- literals (cnc_3ax_vmc/cnc_4ax_vmc/cnc_5ax_mc/cnc_lathe/cnc_lathe_live/
-- cnc_mill_turn). Phase 0 of the approved Machining re-architecture plan
-- (C:\Users\singi\.claude\plans\logical-noodling-lampson.md, Section G.1) --
-- additive only, zero behavior change, not yet read by any application code.
-- ============================================================================
-- WHY A NEW COLUMN, NOT A DERIVED VALUE
--
-- "Is this station a competing whole-part route, or an auxiliary operation
-- riding on top of whichever route was already chosen" cannot be derived
-- from machine_class or process_name alone -- e.g. "MillTurn" and "Wire EDM"
-- are both real station names with no naming convention distinguishing
-- them. It is a property of the canonical station TYPE (one process_taxonomy
-- row = one real machine category), verified once per row, then inherited
-- by every mhr_records/process_calculator_mappings row for that station via
-- the existing canonical_process_id FK (migrations 610/611) -- zero
-- duplication, same placement logic as this table's own roadmap_status
-- column.
--
-- WHY THESE 4 VALUES, NOT A FREE-TEXT STRING
--
-- A small, closed taxonomy of ROLES (not of machine classes) is not the
-- anti-pattern this project removes: adding a 44th real station never
-- requires a new value here, only a new row tagged with an EXISTING role.
-- Mirrors process_taxonomy's own roadmap_status 5-value CHECK enum.
--
-- VERIFICATION METHOD (same discipline as migration 732's machine_category
-- column): only rows with real, already-seeded mhr_records machine data
-- AND an unambiguous role are tagged. Populated in this migration:
--   primary_milling  -- '3 Axis Mill', '4 Axis Mill', '5 Axis Mill': real
--     migration-693 mhr_records data, each with a direct real-granular
--     equivalent to one of the 3 coarse cnc_*_vmc/cnc_5ax_mc buckets today.
--   primary_turning  -- '2 Axis Lathe', '3 Axis Lathe', '2 Axis Bar Feed
--     Lathe with Sub Spindle', '3 Axis Bar Feed Lathe with Sub Spindle':
--     same basis, real migration-693 data, equivalent to cnc_lathe/
--     cnc_lathe_live. Plus 'MillTurn': its own already-live, already-
--     registered machining_millturn engine class (a genuinely separate
--     fleet from the legacy cnc_mill_turn bucket, per cost-cnc-engine.ts's
--     CNCMachineClass union already carrying it as a 7th member).
--   inspection       -- 'Inspection', 'Special Inspection': the real,
--     already-wired machining_inspection/special_inspection MHR_RATE_
--     MACHINE_CLASSES entries added this session.
--
-- Deliberately NOT tagged in this pass (real, disclosed gaps, not fabricated):
--   - '3 Axis Router' / '5 Axis Router' / 'Automated Deburr' / 'Bevel Gear
--     Cutting Machine' / 'Bench Operation' -- real migration-693 machine
--     data exists, but NO coarse-bucket equivalent and NO settled decision
--     on whether they are primary routes or secondary operations (routers
--     in particular are a genuinely distinct machine type per selector.ts's
--     own isRouterRecord guard, which already excludes them from cnc_*
--     classification). Flagged as a future-phase decision, not guessed here.
--   - 'Gun Drill' / 'Deep Bore Machine' / 'Cylindrical Grinder' / 'Jig
--     Bore' / 'Jig Grind' / 'Internal Grinder' / 'Broach' / 'Wire EDM' --
--     real, live, tested secondary-operation engines (peer session's
--     work), correctly belonging to role 'secondary_operation', but their
--     exact current shape is mid-revision in a concurrent, uncommitted
--     peer session as of this migration -- tagging them is deferred to
--     Phase 2 (H.3) once that work is committed and reconciled, so this
--     migration cannot go stale relative to in-flight changes.
--   - The remaining ~29 process_taxonomy rows with no real machine data on
--     file at all (roadmap_status='not_modeled' throughout) -- unmodeled,
--     unmodelable until real reference data exists.
--
-- Idempotent: column add is IF NOT EXISTS; every UPDATE re-derives the same
-- result on rerun.
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

ALTER TABLE process_taxonomy
  ADD COLUMN IF NOT EXISTS machining_route_role VARCHAR(30);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_machining_route_role'
  ) THEN
    ALTER TABLE process_taxonomy
      ADD CONSTRAINT chk_machining_route_role
      CHECK (machining_route_role IN ('primary_milling', 'primary_turning', 'secondary_operation', 'inspection'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_process_taxonomy_machining_route_role
  ON process_taxonomy(machining_route_role);

-- ── primary_milling ──────────────────────────────────────────────────────
UPDATE process_taxonomy SET machining_route_role = 'primary_milling'
 WHERE process_group = 'Machining' AND process_name IN ('3 Axis Mill', '4 Axis Mill', '5 Axis Mill');

-- ── primary_turning ──────────────────────────────────────────────────────
UPDATE process_taxonomy SET machining_route_role = 'primary_turning'
 WHERE process_group = 'Machining' AND process_name IN (
   '2 Axis Lathe', '3 Axis Lathe',
   '2 Axis Bar Feed Lathe with Sub Spindle', '3 Axis Bar Feed Lathe with Sub Spindle',
   'MillTurn'
 );

-- ── inspection ───────────────────────────────────────────────────────────
UPDATE process_taxonomy SET machining_route_role = 'inspection'
 WHERE process_group = 'Machining' AND process_name IN ('Inspection', 'Special Inspection');

COMMIT;

-- Verification (run manually after):
-- SELECT machining_route_role, count(*), array_agg(process_name ORDER BY process_name)
-- FROM process_taxonomy WHERE process_group = 'Machining' GROUP BY machining_route_role;
-- Expect: primary_milling=3, primary_turning=5, inspection=2, NULL=33.
