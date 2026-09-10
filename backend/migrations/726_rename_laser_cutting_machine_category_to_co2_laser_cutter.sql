-- ============================================================================
-- Migration 726: Rename the "Laser Cutting Machine" real machine category to
-- "CO2 Laser Cutter" — the single, root-cause fix for its category label
-- everywhere in the app (HR Rates, Process page, MHR forms, category
-- suggestions), not a per-page display patch.
-- ============================================================================
-- ROOT CAUSE
--
-- Every real category label this app shows for these 24 machines — HR
-- Rates' category grouping, MHRFormDialog's category suggestions, the
-- "Category" field on process_cost_records (migration 719) — traces back to
-- exactly ONE derivation, done identically in two places on purpose
-- (confirmed by direct read):
--
--   backend: MHRService.getDistinctCategories (mhr.service.ts)
--   frontend: mhrCategoryOf() (lib/utils/mhrCategoryOf.ts)
--
-- Both take `benchmark_source_key.split(':')[0]` as the category name when a
-- reference-library match exists — i.e. the text before the first colon in
-- mhr_records.benchmark_source_key (e.g. "Laser Cutting Machine:Cincinnati
-- CL 850"). There is no second, independent category source anywhere to
-- patch around — a category display override added to only mhrCategoryOf.ts
-- (an earlier draft of this migration) would have fixed the frontend read
-- but left MHRService.getDistinctCategories, and any future consumer of the
-- same real column, still saying the old name. The actual root is the
-- stored prefix itself.
--
-- "Laser Cutting Machine" was machine_library.json's own generic label for
-- this real 24-machine category (e.g. "Cincinnati CL 850", "Quattro").
-- Migration 722 already corrected the COST-ENGINE identity for these
-- machines (machine_class: co2_laser, not a separate 'laser_cut' class) once
-- memory/sheetmetal/machine/india_base.json — an independent, real reference
-- export — was found to name this exact same 24-machine set "CO2 Laser
-- Cutter" (confirmed name-for-name, only OCR-level spelling differences,
-- e.g. "FO-Mil" vs "FO-MII"). This migration brings the HUMAN-FACING
-- category label into agreement with that same, already-corrected reality.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
--
-- process_cost_records.category (migration 719) is a real, resolved-at-the-
-- time snapshot for manually-configured lines — the same discipline this
-- app already applies to FX/rate snapshots (a later reference-data
-- correction must never silently rewrite a historical quote's recorded
-- value). Existing snapshotted rows keep whatever category string they were
-- written with; only mhr_records/sm_reference_data (the live, current
-- reference identity every NEW read/quote resolves from) are corrected here.
--
-- Only the category prefix changes — the machine-name suffix after the
-- colon (and every other column: machine_class, rates, capability, prices)
-- is completely untouched.
--
-- Idempotent: every UPDATE is scoped to the exact current (old) prefix, so
-- re-running this migration after it has already succeeded is a no-op
-- (the WHERE clause matches nothing the second time).
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

-- ── 1. mhr_records: the real category every category-derivation reads ──────
UPDATE mhr_records
SET benchmark_source_key = 'CO2 Laser Cutter:' || substring(benchmark_source_key FROM position(':' IN benchmark_source_key) + 1)
WHERE benchmark_source_key LIKE 'Laser Cutting Machine:%';

-- ── 2. sm_reference_data: keep the audit/join invariant intact —
-- mhr_records.benchmark_source_key is documented (migration 536) as
-- "sm_reference_data.key this row was matched to, for audit", and several
-- real migrations (570/608/697/724) join `srd.key = m.benchmark_source_key`
-- directly — both sides must be renamed together or that join silently
-- breaks for every one of these 24 machines. ──────────────────────────────
UPDATE sm_reference_data
SET key = 'CO2 Laser Cutter:' || substring(key FROM position(':' IN key) + 1)
WHERE category = 'machine'
  AND key LIKE 'Laser Cutting Machine:%';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after):
--
-- 1. Category renamed, machine identity untouched:
--   SELECT machine_name, benchmark_source_key, machine_class
--     FROM mhr_records WHERE benchmark_source_key LIKE 'CO2 Laser Cutter:%'
--    ORDER BY machine_name;
--   -- Expect 24 rows (same 24 real machines: Cincinnati CL 850, Quattro,
--   -- Default Laser, ...), machine_class = 'co2_laser' (from migration
--   -- 722, untouched by this one), benchmark_source_key now prefixed
--   -- "CO2 Laser Cutter:".
--
--   SELECT COUNT(*) FROM mhr_records WHERE benchmark_source_key LIKE 'Laser Cutting Machine:%';
--   -- Expect 0.
--
-- 2. sm_reference_data join invariant still holds (no orphaned audit keys):
--   SELECT COUNT(*) FROM mhr_records m
--    WHERE m.benchmark_source_key LIKE 'CO2 Laser Cutter:%'
--      AND NOT EXISTS (SELECT 1 FROM sm_reference_data srd WHERE srd.key = m.benchmark_source_key AND srd.category = 'machine');
--   -- Expect 0 — every renamed mhr_records row still finds its matching
--   -- sm_reference_data row under the new key.
--
-- 3. HR Rates page / MHRFormDialog category picker / Process page's Lookup
--    Tables link: reload and confirm the sidebar/category list now reads
--    "CO2 Laser Cutter" (not "Laser Cutting Machine") for this real
--    24-machine category, with the same 24 rows and same real values.
