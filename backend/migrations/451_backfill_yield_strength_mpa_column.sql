-- ===================================================================================
-- Migration 451: Backfill yield_strength_mpa from its legacy equivalent
-- column (2026-08-09)
--
-- Migration 395 backfilled uts_mpa/shear_strength_mpa from their legacy
-- ultimate_tensile_strength/shearing_strength columns, but explicitly did NOT
-- touch yield_strength_mpa (added alongside uts_mpa/shear_strength_mpa in
-- migration 360) — left NULL for every row that only ever had the legacy
-- yield_tensile_strength populated, including SECC (yield_tensile_strength=140,
-- a real, cited JIS G3313 spec minimum from migration 386 — see that
-- migration's own source comment).
--
-- No calculator currently reads yield_strength_mpa (grepped bom-items.service.ts
-- and the calculator formula strings — Press Brake/Burring/etc. use UTS, per
-- migration 009/052's own formula text), so this has caused no wrong output.
-- It closes a real, uncontroversial data gap left by 395, using the exact same
-- straight-copy convention: only fills where the target is NULL and the
-- source has real data, never overwrites an existing yield_strength_mpa value.
-- ===================================================================================

UPDATE raw_materials
SET yield_strength_mpa = yield_tensile_strength
WHERE yield_strength_mpa IS NULL
  AND yield_tensile_strength IS NOT NULL;

-- Verification:
-- SELECT count(*) FROM raw_materials WHERE yield_strength_mpa IS NULL AND yield_tensile_strength IS NOT NULL; -- expect 0
-- SELECT material, yield_tensile_strength, yield_strength_mpa FROM raw_materials WHERE material ILIKE '%SECC%'; -- expect 140/140
