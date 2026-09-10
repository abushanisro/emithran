-- ============================================================================
-- Migration 729: Rename the "CO2 Laser Cutter" real machine category back to
-- "Laser Cutting Machine" — the human-facing name for this real 24-machine
-- pool stays what the live catalog operation and machine_library.json's own
-- category label already use, confirmed live in the HR Rates page (2026-09-10:
-- user screenshot showing this category already reads "CO2 Laser Cutter",
-- 24 machines including Quattro, in production).
-- ============================================================================
-- ROOT CAUSE
--
-- Every real category label this app shows for these 24 machines — HR
-- Rates' category grouping, MHRFormDialog's category suggestions, the
-- "Category" field on process_cost_records (migration 719) — traces back to
-- exactly ONE derivation (confirmed by direct read):
--
--   backend: MHRService.getDistinctCategories (mhr.service.ts)
--   frontend: mhrCategoryOf() (lib/utils/mhrCategoryOf.ts)
--
-- Both take `benchmark_source_key.split(':')[0]` as the category name — i.e.
-- the text before the first colon in mhr_records.benchmark_source_key. There
-- is no second, independent category source anywhere to patch around; the
-- only real root is the stored prefix itself.
--
-- A previous migration (726, since removed from this repo without ever being
-- run from it) reasoned that "CO2 Laser Cutter" — india_base.json's own name
-- for this exact same 24-machine set (confirmed name-for-name against
-- machine_library.json's "Laser Cutting Machine" label, only OCR-level
-- spelling differences, e.g. "FO-Mil" vs "FO-MII") — should become the
-- human-facing category, on the theory that the more specific, technology-
-- accurate name is the better one. That rename reached the live database by
-- some path (726 itself, or an equivalent hand-run statement) before this
-- migration was written — confirmed live via the HR Rates page.
--
-- Explicit user decision (2026-09-10), stated directly and reconfirmed
-- across this same session: the human-facing name for this pool stays
-- "Laser Cut"/"Laser Cutting Machine" — matching the live catalog's active
-- "Laser Cut" operation and the same "[Technology] [Cutting] Machine" naming
-- convention every sibling category already uses in this exact HR Rates
-- list ("Fiber Laser Cutting Machine", "3D Laser Cutting Machine",
-- "Oxyfuel Cutting Machine", "Plasma Cutting Machine", "Waterjet Cutting
-- Machine", ...) — never "CO2 Laser Cutter", which breaks that pattern and
-- reads as a fourth, different-sounding category next to its two real
-- siblings.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
--
-- machine_class stays 'co2_laser' internally (migration 722/456) — an
-- engine-bucket identifier never shown to a user, unrelated to this
-- human-facing label question.
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
-- Idempotent: every UPDATE is scoped to the exact current (CO2 Laser Cutter)
-- prefix, so re-running this migration after it has already succeeded is a
-- no-op (the WHERE clause matches nothing the second time).
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

-- ── 1. mhr_records: the real category every category-derivation reads ──────
UPDATE mhr_records
SET benchmark_source_key = 'Laser Cutting Machine:' || substring(benchmark_source_key FROM position(':' IN benchmark_source_key) + 1)
WHERE benchmark_source_key LIKE 'CO2 Laser Cutter:%';

-- ── 2. sm_reference_data: keep the audit/join invariant intact —
-- mhr_records.benchmark_source_key is documented (migration 536) as
-- "sm_reference_data.key this row was matched to, for audit", and several
-- real migrations (570/608/697/724) join `srd.key = m.benchmark_source_key`
-- directly — both sides must be renamed together or that join silently
-- breaks for every one of these 24 machines. ──────────────────────────────
UPDATE sm_reference_data
SET key = 'Laser Cutting Machine:' || substring(key FROM position(':' IN key) + 1)
WHERE category = 'machine'
  AND key LIKE 'CO2 Laser Cutter:%';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after):
--
-- 1. Category renamed, machine identity untouched:
--   SELECT machine_name, benchmark_source_key, machine_class
--     FROM mhr_records WHERE benchmark_source_key LIKE 'Laser Cutting Machine:%'
--    ORDER BY machine_name;
--   -- Expect 24 rows (same 24 real machines: Cincinnati CL 850, Quattro,
--   -- Default Laser, ...), machine_class = 'co2_laser' (unchanged),
--   -- benchmark_source_key now prefixed "Laser Cutting Machine:".
--
--   SELECT COUNT(*) FROM mhr_records WHERE benchmark_source_key LIKE 'CO2 Laser Cutter:%';
--   -- Expect 0.
--
-- 2. sm_reference_data join invariant still holds (no orphaned audit keys):
--   SELECT COUNT(*) FROM mhr_records m
--    WHERE m.benchmark_source_key LIKE 'Laser Cutting Machine:%'
--      AND NOT EXISTS (SELECT 1 FROM sm_reference_data srd WHERE srd.key = m.benchmark_source_key AND srd.category = 'machine');
--   -- Expect 0 — every renamed mhr_records row still finds its matching
--   -- sm_reference_data row under the new key.
--
-- 3. HR Rates page / MHRFormDialog category picker / Process page's Lookup
--    Tables link: reload and confirm the sidebar/category list now reads
--    "Laser Cutting Machine" (not "CO2 Laser Cutter") for this real
--    24-machine category, with the same 24 rows and same real values.
