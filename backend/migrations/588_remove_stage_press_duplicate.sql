-- ============================================================================
-- Migration 588: Remove the "Stage Press" category entirely -- undo
-- migration 587 (2026-08-27, user decision: keep one category, "Standard
-- Press", not two)
--
-- Context: migration 587 staged stage_press.json's 16 rows under 'Stage
-- Press:%' and attempted promotion, expecting 0 new mhr_records rows (every
-- name already existed elsewhere). That expectation was wrong for exactly
-- one row: the source's own "United Power SHD-656 Ton" (a known transcription
-- typo for "United Power SHD-666 Ton", confirmed by identical price
-- ($1,060,000) and Direct/Indirect OH ($72.84/$19.03) to the real, already-
-- promoted "United Power SHD-666 Ton" row). Because "SHD-656" != "SHD-666"
-- as strings, the by-name dedup did not catch it, and it was promoted as a
-- genuinely new (but duplicate-in-substance) mhr_records row under
-- 'Stage Press:United Power SHD-656 Ton'.
--
-- User confirmed (2026-08-27) "Stage Press" should not exist as a separate
-- category at all -- back to one category, "Standard Press", matching
-- machine_library.json (the "Stage Press" category and migration 587 have
-- already been removed from the repo). This migration is the live-DB
-- counterpart of that removal: delete the one duplicate mhr_records row and
-- the 16 staged (never-promoted) sm_reference_data rows under 'Stage
-- Press:%'. Nothing else is touched -- "Standard Press" (4 rows) and every
-- other category are unaffected.
-- ============================================================================

BEGIN;

DELETE FROM mhr_records
WHERE benchmark_source_key = 'Stage Press:United Power SHD-656 Ton';

DELETE FROM sm_reference_data
WHERE category = 'machine' AND key LIKE 'Stage Press:%';

COMMIT;

-- Verification (run manually after):
-- SELECT count(*) FROM mhr_records WHERE benchmark_source_key LIKE 'Stage Press:%';
-- -- Should return 0.
-- SELECT count(*) FROM sm_reference_data WHERE category = 'machine' AND key LIKE 'Stage Press:%';
-- -- Should return 0.
-- SELECT count(*) FROM mhr_records WHERE benchmark_source_key LIKE 'Standard Press:%';
-- -- Should still return 4 -- unaffected by this migration.
