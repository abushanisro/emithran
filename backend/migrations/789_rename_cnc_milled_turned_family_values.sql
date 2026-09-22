-- ============================================================================
-- Migration 789: Rename the stored part-family values
-- 'cnc_milled' -> 'milled', 'cnc_turned' -> 'turned' (live data backfill)
-- ============================================================================
--
-- ROOT CAUSE
--
-- "Machining is the canonical domain, not CNC" (this repo's own CLAUDE.md
-- mandate, and this session's own CNC->Machining architecture rename of the
-- CAD-engine Python module and the backend cost-engine files/symbols --
-- cost-cnc-engine.ts -> cost-machining-engine.ts, CNCCostInput ->
-- MachiningCostInput, etc.) left one real, load-bearing piece untouched:
-- the actual stored PART-FAMILY classification value itself
-- (bom_items.family_classification / manufacturing_family_override, the
-- geometry+material classifier's `family` result, mhr_records.process_family,
-- process_calculator_mappings.applicable_families, and
-- part_family_routing_templates.part_family) was still the literal strings
-- 'cnc_milled' / 'cnc_turned' -- "CNC" named as the root of the family
-- taxonomy itself, exactly the pattern this session's earlier renames were
-- meant to remove. User-requested full rename (2026-09-20), same scope and
-- pattern already used by migration 735's injection_molded -> plastic_molded
-- rename (same team, same kind of change, same discipline): rename to
-- 'milled' / 'turned' -- plain, real, non-technology-branded names,
-- consistent with every other sibling family value already in this column
-- (sheet_metal, plastic_molded, casting, forging, extrusion, weldment,
-- additive -- none of which are named after a control technology).
--
-- This migration is the live-data half of that rename. The code-level half
-- (TypeScript family-literal comparisons across ~33 backend files, the
-- LLM prompt/tool-schema pair in process-plan-generator, and the frontend's
-- ManufacturingFamily union + the process-planning page's manual-override
-- dropdown) was done in the same session and requires this migration to
-- keep matching: without it, every existing milled/turned bom_items row and
-- every mhr_records/process_calculator_mappings/part_family_routing_templates
-- row seeded with the old literal would silently stop matching the renamed
-- code-level literal, dropping out of family-gated costing/ranking/routing
-- entirely (confirmed live consumers: process-plan-generator/ranking/
-- machine-ranker.ts compares mhr_records.process_family against the exact
-- same `family` string bom-items.service.ts resolves; resolveOperationName's
-- machiningRouteFamilyOf() and the tapping-routing
-- process_calculator_mappings.applicable_families rows from migrations
-- 392/702 depend on the same literal).
--
-- Scope: ONLY the stored family-classification VALUE, in the 6 places it is
-- actually persisted. Does NOT touch: machine_class literals (3_axis_mill,
-- 2_axis_lathe, 2_axis_bar_feed_lathe_with_sub_spindle,
-- simultaneous_turning, machining_millturn, etc. -- real, registered,
-- correct process/machine identifiers, same explicit exclusion discipline
-- as migration 735's own machine_class carve-out), 'mill_turn' (already a
-- real, non-CNC-branded family name, unchanged), the downstream
-- machine-category-hint literals 'cnc_mill'/'cnc_lathe' (derived FROM the
-- family in deterministic-planner.service.ts/rule-engine.service.ts, not
-- the family value itself), or any process_taxonomy/process_group/
-- process_name values (unrelated taxonomy layer, already correct).
--
-- bom_items.manufacturing_family_override carries an inline CHECK
-- constraint (migration 316: CHECK (... IN ('sheet_metal','cnc_turned',
-- 'cnc_milled'))) that would reject the new values outright if left as-is.
-- part_family_routing_templates.part_family carries another (created in
-- supabase/migrations/20260616_manufacturing_kb.sql), missed by the first
-- draft: its step 6 failed with part_family_routing_templates_part_family_check
-- and rolled the whole migration back. Both are now dropped in step 0, plus a
-- catalog sweep for any other CHECK on these tables that names the old values.
-- Real precedent for exactly this problem: database/migrations/183 dropped
-- an equivalent CHECK constraint on mhr_records.process_family entirely,
-- with the team's own stated reasoning ("the column has a text type and the
-- DB itself doesn't need to enforce the vocabulary -- the application layer
-- does"). Same fix applied here rather than widen-and-hope.
-- ============================================================================

BEGIN;

-- 0. Drop every CHECK constraint that pins the OLD family vocabulary BEFORE
--    updating any stored value, or the UPDATEs below are rejected by the old
--    constraint own list and the whole migration rolls back.
--
--    Two are known:
--      bom_items.manufacturing_family_override        (migration 316)
--      part_family_routing_templates.part_family      (supabase 20260616,
--        inline CHECK listing cnc_turned and cnc_milled; a first run of this
--        migration failed on exactly this one at step 6)
--    Postgres auto-names an inline column CHECK <table>_<column>_check;
--    IF EXISTS keeps the named drops safe to re-run if the live name differs.
ALTER TABLE bom_items
  DROP CONSTRAINT IF EXISTS bom_items_manufacturing_family_override_check;

ALTER TABLE part_family_routing_templates
  DROP CONSTRAINT IF EXISTS part_family_routing_templates_part_family_check;

--    Safety net: a constraint under any other name, or one added by a
--    migration not reviewed here, that still lists the old values would fail
--    the same way. Drop any CHECK on the four tables this migration updates
--    whose definition mentions the old values, and say so.
DO $sweep$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, c.conname
    FROM pg_constraint c
    WHERE c.contype = 'c'
      AND c.conrelid IN (
        to_regclass('bom_items'),
        to_regclass('mhr_records'),
        to_regclass('process_calculator_mappings'),
        to_regclass('part_family_routing_templates')
      )
      AND pg_get_constraintdef(c.oid) ~ 'cnc_(milled|turned)'
  LOOP
    RAISE NOTICE 'Dropping CHECK % on % (pins the old cnc_milled/cnc_turned values)', r.conname, r.tbl;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END
$sweep$;

-- 1. bom_items.family_classification — the geometry+material classifier's
--    cached family result for each part.
UPDATE bom_items
SET family_classification = 'milled'
WHERE family_classification = 'cnc_milled';

UPDATE bom_items
SET family_classification = 'turned'
WHERE family_classification = 'cnc_turned';

-- 2. bom_items.manufacturing_family_override — explicit user-set family
--    overrides (always wins in resolveEffectiveFamily's precedence chain,
--    bom-items.service.ts). Any part a user manually pinned to the old
--    family literal must keep resolving to the same real family after this
--    rename, not silently fall through to "no override" and re-classify.
UPDATE bom_items
SET manufacturing_family_override = 'milled'
WHERE manufacturing_family_override = 'cnc_milled';

UPDATE bom_items
SET manufacturing_family_override = 'turned'
WHERE manufacturing_family_override = 'cnc_turned';

-- 3. bom_items.feature_graph -> classification.family — the CAD-classifier's
--    own cached JSONB result (feature_graph->'classification'->>'family'),
--    read as a fallback source in resolveEffectiveFamily ahead of the
--    column-level family_classification above. jsonb_set replaces only the
--    one nested key; every other feature_graph field on the row is
--    untouched. Guarded to rows that actually carry this exact nested value
--    (via ->> text extraction) so no row without this shape is touched.
UPDATE bom_items
SET feature_graph = jsonb_set(feature_graph, '{classification,family}', '"milled"')
WHERE feature_graph IS NOT NULL
  AND feature_graph -> 'classification' ->> 'family' = 'cnc_milled';

UPDATE bom_items
SET feature_graph = jsonb_set(feature_graph, '{classification,family}', '"turned"')
WHERE feature_graph IS NOT NULL
  AND feature_graph -> 'classification' ->> 'family' = 'cnc_turned';

-- 4. mhr_records.process_family — set by multiple seed migrations (152, 179,
--    183, and others) across every real Machining domain machine (mill and
--    lathe classes alike). Actively read by process-plan-generator/ranking/
--    machine-ranker.ts, compared against the same `family` string this
--    migration's items 1-3 renamed. No CHECK constraint left on this column
--    (the equivalent mhr_process_family_vocab constraint was already
--    dropped by database/migrations/183 for the same real reason item 0
--    above applies here).
UPDATE mhr_records
SET process_family = 'milled'
WHERE process_family = 'cnc_milled';

UPDATE mhr_records
SET process_family = 'turned'
WHERE process_family = 'cnc_turned';

-- 5. process_calculator_mappings.applicable_families (TEXT[]) — real rows
--    from migrations 392/702 (tapping routing) carry ARRAY['cnc_turned',
--    'mill_turn'] / ARRAY['cnc_milled']. array_replace swaps only the
--    matching element in place, leaving 'mill_turn' and any other real
--    sibling value in the same array untouched.
UPDATE process_calculator_mappings
SET applicable_families = array_replace(applicable_families, 'cnc_milled', 'milled')
WHERE 'cnc_milled' = ANY(applicable_families);

UPDATE process_calculator_mappings
SET applicable_families = array_replace(applicable_families, 'cnc_turned', 'turned')
WHERE 'cnc_turned' = ANY(applicable_families);

-- 6. part_family_routing_templates.part_family — real seeded routing
--    templates (src/database/migrations/332) keyed by this exact literal.
UPDATE part_family_routing_templates
SET part_family = 'milled'
WHERE part_family = 'cnc_milled';

UPDATE part_family_routing_templates
SET part_family = 'turned'
WHERE part_family = 'cnc_turned';

COMMIT;

-- Verification (run manually after):
-- SELECT count(*) FROM bom_items WHERE family_classification IN ('cnc_milled','cnc_turned'); -- expect 0
-- SELECT count(*) FROM bom_items WHERE manufacturing_family_override IN ('cnc_milled','cnc_turned'); -- expect 0
-- SELECT count(*) FROM bom_items WHERE feature_graph -> 'classification' ->> 'family' IN ('cnc_milled','cnc_turned'); -- expect 0
-- SELECT count(*) FROM mhr_records WHERE process_family IN ('cnc_milled','cnc_turned'); -- expect 0
-- SELECT count(*) FROM process_calculator_mappings WHERE 'cnc_milled' = ANY(applicable_families) OR 'cnc_turned' = ANY(applicable_families); -- expect 0
-- SELECT count(*) FROM part_family_routing_templates WHERE part_family IN ('cnc_milled','cnc_turned'); -- expect 0
-- SELECT family_classification, count(*) FROM bom_items GROUP BY 1 ORDER BY 1; -- eyeball the new distribution (milled/turned present, cnc_milled/cnc_turned gone)
