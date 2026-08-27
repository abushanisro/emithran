-- ============================================================================
-- Migration 566: Capability backfill pilot — Progressive Die Press / Tandem Press
--
-- The generic capability columns (max_x_mm, max_y_mm, max_tonnage, ...) that
-- selector.ts reads for real machine-selection/job-routing decisions were
-- deliberately left NULL for these two categories by migrations 564/565 —
-- "per-category capability-column mapping is genuinely category-specific
-- work... left for a later pass." This is that pass, scoped as an explicit
-- pilot to exactly the two categories the user asked about (Progressive Die
-- Press machine "Default Press"), before extending to the other 13
-- machine_library categories in later, individually-reviewed passes — same
-- one-category-at-a-time discipline as migrations 509/510/532.
--
-- Mapping (physically justified, not guessed):
--   press_table_length_mm -> max_x_mm   (the press table IS the machine's
--   press_table_width_mm  -> max_y_mm    working envelope for this category)
--   press_force_kn / 9.80665 -> max_tonnage (metric tons-force — the EXACT
--     same conversion factor migration 510 already established for
--     press_brake's own press_force_kn -> max_tonnage backfill; not a new
--     convention.)
--
-- Only fills a column that is currently NULL — never overwrites a value a
-- human or another process already set (checked per-column, not per-row,
-- so a row with e.g. max_tonnage already set still gets max_x_mm/max_y_mm
-- filled if those are still NULL). Matches rows via benchmark_source_key
-- (set by migrations 537/564/565), not by name — avoids the exact
-- name-collision ambiguity migration 565 already had to resolve.
-- ============================================================================

DO $$
DECLARE
  touched_count INTEGER;
BEGIN
  UPDATE mhr_records mr
  SET
    max_x_mm = CASE WHEN mr.max_x_mm IS NULL
      THEN NULLIF(sr.raw->>'press_table_length_mm', '')::numeric ELSE mr.max_x_mm END,
    max_y_mm = CASE WHEN mr.max_y_mm IS NULL
      THEN NULLIF(sr.raw->>'press_table_width_mm', '')::numeric ELSE mr.max_y_mm END,
    max_tonnage = CASE WHEN mr.max_tonnage IS NULL
      THEN ROUND(NULLIF(sr.raw->>'press_force_kn', '')::numeric / 9.80665, 2) ELSE mr.max_tonnage END
  FROM sm_reference_data sr
  WHERE sr.category = 'machine'
    AND sr.key = mr.benchmark_source_key
    AND sr.raw->>'machine_category' IN ('Progressive Die Press', 'Tandem Press')
    AND (mr.max_x_mm IS NULL OR mr.max_y_mm IS NULL OR mr.max_tonnage IS NULL);

  GET DIAGNOSTICS touched_count = ROW_COUNT;
  RAISE NOTICE 'Migration 566: backfilled capability (bed X/Y from press table dims, tonnage from press force ÷ 9.80665) on % Progressive Die Press / Tandem Press mhr_records row(s).',
    touched_count;
END $$;

-- ── Verification ───────────────────────────────────────────────────────────
-- SELECT mr.machine_name, mr.machine_description, mr.max_x_mm, mr.max_y_mm, mr.max_tonnage
--   FROM mhr_records mr
--   JOIN sm_reference_data sr ON sr.key = mr.benchmark_source_key AND sr.category = 'machine'
--   WHERE sr.raw->>'machine_category' IN ('Progressive Die Press', 'Tandem Press')
--   ORDER BY mr.machine_name;
