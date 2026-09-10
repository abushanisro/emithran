-- ============================================================================
-- Migration 725: Make process_taxonomy.machine_class database-driven off
-- process_calculator_mappings (the one live source of truth), for every
-- process group — not a per-row hand patch — plus real taxonomy detail
-- (feature types, aliases, default machine) for the Sheet Metal operations
-- that have shown "No feature-type/alias/default-machine detail on file for
-- this operation yet" on the Process page since migration 609's seed.
-- ============================================================================
-- PART A ROOT CAUSE (systemic, all process groups): migration 609's seed
-- script NEVER populated process_taxonomy.machine_class for a single row —
-- confirmed by direct read of 609_seed_process_taxonomy.sql: every one of
-- its ~700 INSERT rows, across Sheet Metal/Machining/Plastic & Rubber/
-- Assembly, passes NULL for machine_class, including rows already marked
-- roadmap_status='production' with a real default_machine_name (e.g.
-- 'Laser Cut', 'Waterjet Cutting', 'Bend Brake', 'Turret Press', '2 Axis
-- Router'). Meanwhile process_calculator_mappings.machine_class — the
-- column that actually drives live routing/costing — has been correctly
-- maintained by more than a dozen migrations since (369, 532, 582, 583,
-- 608, 697, 714, 715, 722, 724, ...) as real engines were registered and
-- fixed. The two tables were never wired to stay in sync, so
-- process_taxonomy's machine_class column has been 100% stale since the
-- day it was created — not a handful of rows, the entire column.
--
-- THE FIX: process_calculator_mappings.machine_class is the single, live,
-- already-correct source of truth (exactly what the user asked for — "like
-- hr rate process and category", i.e. driven off the real database, never a
-- hand-copied constant that goes stale the next time an engine is
-- registered). This migration:
--   1. Backfills process_taxonomy.machine_class from every ACTIVE
--      process_calculator_mappings row, across every process group, via the
--      same (process_group, operation)=(process_group, process_name) join
--      migration 610 already established as canonical.
--   2. Promotes roadmap_status to 'production' wherever machine_class was
--      just confirmed AND the row's current roadmap_status is one of
--      ('not_modeled','unwired','thin') — i.e. "this is now a live, costed
--      process", the only unambiguous inference the join supports. Deliberately
--      does NOT touch rows already 'non_mfg' (system markers like Material
--      Stock/No Cost Feature — a real machine_class there would still not
--      make them manufacturing processes) or rows the join doesn't reach at
--      all (no live mapping row references them — nothing to infer from).
--   3. Adds an AFTER INSERT OR UPDATE trigger on process_calculator_mappings
--      that keeps process_taxonomy.machine_class synced going forward — the
--      long-term-scalable half of this fix. Deliberately scoped to
--      machine_class ONLY, never roadmap_status: 'thin' (substituted through
--      a generic calculator) and 'production' both legitimately carry a real
--      machine_class, so only a human migration (not a blind trigger) should
--      ever promote roadmap_status.
--
-- PART B (unchanged from the original draft of this migration): real,
-- sourced taxonomy detail for the 4 operations Part A's mechanical join
-- cannot fill in, because process_calculator_mappings has no operations/
-- aliases/default-machine columns to join from — see the inline comments
-- above each block below for the exact source of every value.
--
-- Idempotent throughout: every UPDATE re-derives the same result on rerun,
-- every INSERT is guarded (ON CONFLICT / WHERE NOT EXISTS), and
-- CREATE OR REPLACE + DROP TRIGGER IF EXISTS make the trigger safe to re-run.
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

-- ── PART A.1: one-time backfill, ALL process groups ─────────────────────────
UPDATE process_taxonomy pt
SET machine_class = pcm.machine_class
FROM process_calculator_mappings pcm
WHERE pcm.canonical_process_id = pt.id
  AND pcm.is_active = true
  AND pcm.machine_class IS NOT NULL
  AND pt.machine_class IS DISTINCT FROM pcm.machine_class;

-- ── PART A.2: roadmap_status promotion, guarded ─────────────────────────────
UPDATE process_taxonomy pt
SET roadmap_status = 'production'
FROM process_calculator_mappings pcm
WHERE pcm.canonical_process_id = pt.id
  AND pcm.is_active = true
  AND pcm.machine_class IS NOT NULL
  AND pt.roadmap_status IN ('not_modeled', 'unwired', 'thin');

-- ── PART A.3: keep it synced going forward (machine_class only) ────────────
CREATE OR REPLACE FUNCTION sync_process_taxonomy_machine_class()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active AND NEW.machine_class IS NOT NULL AND NEW.canonical_process_id IS NOT NULL THEN
    UPDATE process_taxonomy
    SET machine_class = NEW.machine_class
    WHERE id = NEW.canonical_process_id
      AND machine_class IS DISTINCT FROM NEW.machine_class;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_process_taxonomy_machine_class ON process_calculator_mappings;
CREATE TRIGGER trigger_sync_process_taxonomy_machine_class
  AFTER INSERT OR UPDATE OF machine_class, is_active, canonical_process_id ON process_calculator_mappings
  FOR EACH ROW
  EXECUTE FUNCTION sync_process_taxonomy_machine_class();

-- ── PART B: real, sourced detail for the 4 operations Part A cannot reach ──
--
-- These 4 were deliberately left with zero process_taxonomy_operations
-- rows, zero aliases, and (before Part A) NULL machine_class, each for an
-- explicit, disclosed reason recorded at migration-609-seed time
-- (609_unresolved_candidates.json):
--
--   'Hole Extrusion (Burring)': "process_operations.json has no top-level
--     family by this name — a genuine offline-data gap" (a real registered
--     engine already existed then, hole-extrusion-engine.ts).
--   'Tapping': not even flagged as unresolved — process_operations.json has
--     no top-level 'Tapping' family either (only found NESTED under Laser
--     Punch/Plasma Punch/Progressive Die/Turret Press, describing THEIR
--     tapping sub-function, not the standalone Tapping station).
--   'Co2 Laser Cutting': same silent gap in process_operations.json/
--     process_machine_data.json as Tapping. Not a fabrication risk, though —
--     memory/sheetmetal/machine/india_base.json independently names
--     machine_library.json's "Laser Cutting Machine" category (24 machines)
--     "CO2 Laser Cutter" (confirmed name-for-name — see migration 722's
--     corrected header), and 'Laser Cut' (the live catalog's active
--     operation for that same real machine pool) already carries real
--     process_operations.json feature detail + a real default_machine_name
--     ('Default Laser') from the original migration 609 seed. This
--     operation-name row is left undetailed here on purpose: it's a real,
--     disclosed, currently-inactive duplicate NAME for the same machine
--     pool 'Laser Cut' already prices and details, same shape as 'Fiber
--     Laser Cut' before migration 715's dedup (just the other way around —
--     here 'Laser Cut' is the active name, 'Co2 Laser Cutting' the inactive
--     one). Consolidating its canonical_process_id onto 'Laser Cut''s (the
--     same treatment 'Laser Puch'/'Laser Punch' already got) would be a
--     reasonable follow-up if the duplicate pill itself needs to disappear
--     from the Process page — deliberately not done here, since that's a
--     canonical-identity merge decision, not a machine_class/roadmap_status
--     correction.
--   'Shearing': "migration 605 documents this as reusing machine_class=
--     press_brake with NO distinct shearing cost path... NOT confirmed to be
--     the same real thing" as process_operations.json's separate, deactivated
--     'Shear' family. Left unaliased on purpose.
--
-- Part A.1/A.2 above already corrected machine_class/roadmap_status for
-- Hole Extrusion (Burring) -> hole_forming, Tapping -> tapping, Shearing ->
-- shear, all -> 'production' (real, registered, active engines today). Co2
-- Laser Cutting is untouched by Part A/A.2 either way: it's currently
-- inactive, so the mechanical join correctly leaves it as-is (Part A.1/A.2
-- both filter on pcm.is_active = true) — nothing to revert, nothing missing.
-- What remains here is ONLY the operations/aliases/default-machine detail no
-- join can invent — each traced to a real source string below.
--
--   Hole Extrusion (Burring) <- 'Flanging' family (process_operations.json:
--     'Laser Punch:Flanging:Flanging//ComplexHole', '...//SimpleHole',
--     same real strings for Plasma Punch and Turret Press). Already
--     confirmed in CLAUDE.md as the same real action ("hole-flanging,
--     already fully covered by ... HoleExtrusionEngine / 'Hole Extrusion
--     (Burring)' cost engine"). raw_compound_string values below are
--     written under THIS canonical row (distinct from the 3 existing rows
--     already filed under Laser Punch/Plasma Punch/Turret Press's own
--     canonical ids) to satisfy the (canonical_process_id, raw_compound_
--     string) uniqueness constraint — notes disclose the real source.
--
--   Tapping <- the same real 'Tapping//SimpleHole' feature shape already
--     seeded 4 times (Turret Press, Progressive die, Laser Punch, Plasma
--     Punch) for those processes' OWN tapping sub-function. The standalone
--     Tapping station performs the identical real action (cut internal
--     threads in an existing hole) — same feature_type, own row under its
--     own canonical id, notes disclose the derivation.
--
--   Shearing <- the real 'Shear:Shear//Blank' string (process_operations.json,
--     currently only attached to the separate, deactivated 'Shear' canonical
--     row). ShearingEngine's real model (2-cut-per-blank Euclidean,
--     CLAUDE.md) confirms Shearing's real action IS cutting a blank from
--     sheet/coil stock — the same real feature this string already names.
--     Also links the 'Shear' alias (source process_operations_json) since
--     that IS the same raw family name, and sets default_machine_name =
--     'Default Shear' — real, confirmed in BOTH process_machine_data.json
--     ("Shear" -> "Default Shear") AND machine_library.json's own real
--     "Shearing Machine" category (10 machines, includes "Default Shear").
--
--   Co2 Laser Cutting: NOT touched by this migration at all (not even a
--     default_machine_name). User decision (2026-09-10), asked and
--     confirmed explicitly: strictly per process_operations.json and
--     process_machine_data.json — the two named reference-taxonomy source
--     files — "Co2 Laser Cutting"/"CO2" appears in neither, so it is
--     deactivated instead of detailed. See migration 726, which runs after
--     this one and deactivates the live process_calculator_mappings row +
--     the one real mhr_records machine (Quattro) that had been classified
--     co2_laser, and reverts this migration's own Part A auto-promotion for
--     it back to machine_class=NULL/roadmap_status='not_modeled'.

INSERT INTO process_taxonomy_operations (canonical_process_id, operation_category, feature_type, raw_compound_string, notes)
SELECT pt.id, 'Flanging', 'ComplexHole', 'Hole Extrusion (Burring):Flanging//ComplexHole',
       'Same real feature already seeded under Laser Punch/Plasma Punch/Turret Press''s own Flanging sub-operation (process_operations.json) — this station performs the identical real hole-flanging action (extruded_flange_count detector, CLAUDE.md).'
FROM process_taxonomy pt
WHERE pt.process_group = 'Sheet Metal' AND pt.process_name = 'Hole Extrusion (Burring)'
ON CONFLICT (canonical_process_id, raw_compound_string) DO NOTHING;

INSERT INTO process_taxonomy_operations (canonical_process_id, operation_category, feature_type, raw_compound_string, notes)
SELECT pt.id, 'Flanging', 'SimpleHole', 'Hole Extrusion (Burring):Flanging//SimpleHole',
       'Same real feature already seeded under Laser Punch/Plasma Punch/Turret Press''s own Flanging sub-operation (process_operations.json) — this station performs the identical real hole-flanging action (extruded_flange_count detector, CLAUDE.md).'
FROM process_taxonomy pt
WHERE pt.process_group = 'Sheet Metal' AND pt.process_name = 'Hole Extrusion (Burring)'
ON CONFLICT (canonical_process_id, raw_compound_string) DO NOTHING;

INSERT INTO process_taxonomy_operations (canonical_process_id, operation_category, feature_type, raw_compound_string, notes)
SELECT pt.id, 'Tapping', 'SimpleHole', 'Tapping:Tapping//SimpleHole',
       'Same real feature already seeded under Turret Press/Progressive die/Laser Punch/Plasma Punch''s own Tapping sub-operation (process_operations.json) — a dedicated Tapping station performs the identical real action (cut internal threads in an existing hole).'
FROM process_taxonomy pt
WHERE pt.process_group = 'Sheet Metal' AND pt.process_name = 'Tapping'
ON CONFLICT (canonical_process_id, raw_compound_string) DO NOTHING;

UPDATE process_taxonomy
SET default_machine_name = 'Default Shear'
WHERE process_group = 'Sheet Metal' AND process_name = 'Shearing' AND default_machine_name IS NULL;

INSERT INTO process_taxonomy_operations (canonical_process_id, operation_category, feature_type, raw_compound_string, notes)
SELECT pt.id, 'Shear', 'Blank', 'Shearing:Shear//Blank',
       'Same real feature string as process_operations.json''s separate, deactivated ''Shear'' family — ShearingEngine''s real 2-cut-per-blank model (CLAUDE.md) confirms this station''s real action is cutting a blank from sheet/coil stock, the same real feature that string names.'
FROM process_taxonomy pt
WHERE pt.process_group = 'Sheet Metal' AND pt.process_name = 'Shearing'
ON CONFLICT (canonical_process_id, raw_compound_string) DO NOTHING;

INSERT INTO process_taxonomy_aliases (canonical_process_id, alias, source, notes)
SELECT pt.id, 'Shear', 'process_operations_json',
       'process_operations.json''s own family name for this real action — its separate, deactivated ''Shear'' canonical row (no distinct cost path at the time, migration 605) is not touched by this migration.'
FROM process_taxonomy pt
WHERE pt.process_group = 'Sheet Metal' AND pt.process_name = 'Shearing'
  AND NOT EXISTS (SELECT 1 FROM process_taxonomy_aliases WHERE lower(alias) = lower('Shear'));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after):
--
-- 1. Systemic backfill — every process group, not just Sheet Metal:
--   SELECT process_group, count(*) FILTER (WHERE machine_class IS NOT NULL) AS with_class,
--          count(*) AS total
--     FROM process_taxonomy GROUP BY process_group ORDER BY process_group;
--   -- Expect with_class > 0 for every group with real registered engines
--   -- (Sheet Metal, Machining at minimum).
--
-- 2. roadmap_status promotions, non_mfg preserved:
--   SELECT process_name, machine_class, roadmap_status FROM process_taxonomy
--    WHERE process_group = 'Sheet Metal' AND process_name IN ('Material Stock', 'No Cost Feature');
--   -- Expect roadmap_status still 'non_mfg' for both, machine_class still NULL
--   -- (no active process_calculator_mappings row sets a real machine_class
--   -- for either — they are routing-spine markers, not costed processes).
--
-- 3. The trigger works going forward:
--   UPDATE process_calculator_mappings SET updated_at = NOW()
--    WHERE process_group = 'Sheet Metal' AND operation = 'Cut To Length Line';
--   SELECT machine_class FROM process_taxonomy
--    WHERE process_group = 'Sheet Metal' AND process_name = 'Cut To Length Line';
--   -- Expect 'cut_to_length' even though this UPDATE only touched updated_at
--   -- (machine_class/is_active/canonical_process_id unchanged is fine — the
--   -- trigger recomputes from NEW every time it fires; the WHERE clause
--   -- inside the function is the only guard that matters).
--
-- 4. The 3 previously-undetailed Sheet Metal operations this migration adds
--    real detail to (Co2 Laser Cutting is deliberately not one of them —
--    see the Part B comment above):
--   SELECT process_name, machine_class, roadmap_status, default_machine_name
--     FROM process_taxonomy
--    WHERE process_group = 'Sheet Metal'
--      AND process_name IN ('Hole Extrusion (Burring)', 'Tapping', 'Shearing')
--    ORDER BY process_name;
--   -- Expect machine_class populated for all 3; default_machine_name =
--   -- 'Default Shear' for Shearing only.
--
--   SELECT pt.process_name, pto.operation_category, pto.feature_type, pto.raw_compound_string
--     FROM process_taxonomy_operations pto
--     JOIN process_taxonomy pt ON pt.id = pto.canonical_process_id
--    WHERE pt.process_group = 'Sheet Metal'
--      AND pt.process_name IN ('Hole Extrusion (Burring)', 'Tapping', 'Shearing')
--    ORDER BY pt.process_name;
--   -- Expect 2 rows for Hole Extrusion (Burring), 1 for Tapping, 1 for Shearing.
--
-- 5. 'Laser Cut' picks up co2_laser via Part A (migration 722 must run
--    first for this to be non-NULL):
--   SELECT process_name, machine_class, roadmap_status, default_machine_name
--     FROM process_taxonomy WHERE process_group = 'Sheet Metal' AND process_name = 'Laser Cut';
--   -- Expect machine_class = 'co2_laser', roadmap_status = 'production'
--   -- (already was), default_machine_name = 'Default Laser' (already was,
--   -- migration 609 seed — untouched by this migration).
--
-- -- Process page: reload /process — Hole Extrusion (Burring), Tapping, and
-- -- Shearing pills should now show the "Click the operation name to see
-- -- feature types, aliases, and default machine" tooltip and real expandable
-- -- detail. Co2 Laser Cutting's pill will still read "No feature-type/
-- -- alias/default-machine detail on file for this operation yet" — real and
-- -- confirmed (india_base.json's "CO2 Laser Cutter" category, migration
-- -- 722), just not yet given its own detail rows (see Part B comment).
