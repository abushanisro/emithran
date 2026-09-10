-- ============================================================================
-- Migration 735: Rename the stored part-family value
-- 'injection_molded' -> 'plastic_molded' (live data backfill)
-- ============================================================================
--
-- ROOT CAUSE
--
-- The plastic-forming domain has 4 real sibling PROCESSES (Injection Molding,
-- Compression Molding, Reaction Injection Molding, Structural Foam Molding --
-- confirmed real, each with its own machine file under the staged reference
-- data and, for 3 of the 4, its own distinct cost engine; see migration 733's
-- own root cause for the process_group category-label half of this same
-- rename). Despite that, the platform's actual PART-FAMILY classification
-- value (bom_items.family_classification / manufacturing_family_override,
-- the geometry+material classifier's `family` result, and mhr_records'
-- process_family column) was still the literal string 'injection_molded' --
-- naming the whole family after just ONE of its 4 real sibling processes,
-- exactly the same category-vs-member confusion migration 733 already fixed
-- for process_group. User-requested full rename (2026-09-11): 'Injection
-- Molding' becomes what it actually is -- one process INSIDE the 'Plastic
-- Molding' family -- consistently at the code level (this session's
-- accompanying code changes) AND at the stored-data level (this migration).
--
-- This migration is the live-data half of that rename. The code-level half
-- (TypeScript family-literal comparisons across ~17 files, the
-- costing/injection-molding/ -> costing/plastic-molding/ folder rename) was
-- done in the same session and requires this migration to keep matching:
-- without it, every existing plastic-molded bom_items row and all 127
-- mhr_records rows staged by migration 633 would silently stop matching the
-- renamed code-level literal, dropping out of family-gated costing/ranking
-- entirely (confirmed live consumer: process-plan-generator/ranking/
-- machine-ranker.ts compares mhr_records.process_family against the exact
-- same `family` string bom-items.service.ts resolves).
--
-- Scope: ONLY the stored family-classification VALUE, in the 4 places it is
-- actually persisted. Does NOT touch: machine_class literals (injection_
-- molding, compression_molding, reaction_injection_molding,
-- structural_foam_molding -- real, registered, correct process identifiers,
-- same explicit exclusion as migration 733), process_taxonomy/process_
-- calculator_mappings.process_group (already renamed by migration 733/734),
-- or process_name values (Injection Molding stays the real, correct name of
-- that one sibling process).
-- ============================================================================

BEGIN;

-- 1. bom_items.family_classification — the geometry+material classifier's
--    cached family result for each part.
UPDATE bom_items
SET family_classification = 'plastic_molded'
WHERE family_classification = 'injection_molded';

-- 2. bom_items.manufacturing_family_override — explicit user-set family
--    overrides (always wins in resolveEffectiveFamily's precedence chain,
--    bom-items.service.ts). Any part a user manually pinned to the old
--    family literal must keep resolving to the same real family after this
--    rename, not silently fall through to "no override" and re-classify.
UPDATE bom_items
SET manufacturing_family_override = 'plastic_molded'
WHERE manufacturing_family_override = 'injection_molded';

-- 3. bom_items.feature_graph -> classification.family — the CAD-classifier's
--    own cached JSONB result (feature_graph->'classification'->>'family'),
--    read as a fallback source in resolveEffectiveFamily ahead of the
--    column-level family_classification above. jsonb_set replaces only the
--    one nested key; every other feature_graph field on the row is
--    untouched. Guarded to rows that actually carry this exact nested value
--    (via ->> text extraction) so no row without this shape is touched.
UPDATE bom_items
SET feature_graph = jsonb_set(feature_graph, '{classification,family}', '"plastic_molded"')
WHERE feature_graph IS NOT NULL
  AND feature_graph -> 'classification' ->> 'family' = 'injection_molded';

-- 4. mhr_records.process_family — set by migration 633 on all 127 real
--    Plastic Molding domain rows (Injection/Compression/Reaction Injection/
--    Structural Foam Molding machines alike; migration 633's own INSERT used
--    this one literal for every row in that batch, real bug this migration
--    fixes rather than perpetuates). Actively read by process-plan-
--    generator/ranking/machine-ranker.ts, compared against the same
--    `family` string this migration's item 1-3 renamed.
UPDATE mhr_records
SET process_family = 'plastic_molded'
WHERE process_family = 'injection_molded';

COMMIT;

-- Verification (run manually after):
-- SELECT count(*) FROM bom_items WHERE family_classification = 'injection_molded'; -- expect 0
-- SELECT count(*) FROM bom_items WHERE manufacturing_family_override = 'injection_molded'; -- expect 0
-- SELECT count(*) FROM bom_items WHERE feature_graph -> 'classification' ->> 'family' = 'injection_molded'; -- expect 0
-- SELECT count(*) FROM mhr_records WHERE process_family = 'injection_molded'; -- expect 0
-- SELECT machine_class, process_family, count(*) FROM mhr_records WHERE machine_class IN ('injection_molding','compression_molding','reaction_injection_molding','structural_foam_molding') GROUP BY 1,2;
-- -- Expect: process_family = 'plastic_molded' for all 4 classes, no 'injection_molded' rows left.
