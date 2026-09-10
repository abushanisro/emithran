-- ============================================================================
-- Migration 733: Rename process_group "Injection Molding" -> "Plastic Molding"
-- ============================================================================
-- ROOT CAUSE
--
-- The plastic-forming domain has 4 real sibling processes (Compression
-- Molding, Injection Molding, Reaction Injection Molding, Structural Foam
-- Molding -- confirmed real, each with its own machine file under the
-- staged reference data and, for 3 of the 4, its own distinct cost engine).
-- process_taxonomy/process_calculator_mappings file all 4 under
-- process_group = "Injection Molding" -- which is really just the name of
-- ONE of the 4 siblings, not a category label.
--
-- This is a real, live inconsistency, not a style choice: every other real
-- table for this same domain already uses "Plastic Molding" as the
-- category/group label --
--
--   mhr_records.process_group             = 'Plastic Molding' (migration 647)
--   mhr_benchmark_rates.process_group      = 'Plastic Molding' (migration 647)
--   lhr_benchmark_rates.process_group      = 'Plastic Molding' (migration 647)
--   lhr_records.process_group              = 'Plastic Molding' (migration 647)
--
-- -- and the backend already hardcodes this same category label in two
-- places (bom-items.controller.ts's MACHINE_CLASS_TO_PROCESS_GROUP,
-- mhr.service.ts's MACHINE_CLASS_PROCESS_GROUP), plus the frontend's
-- process-planning category list and manufacturing-intelligence page's
-- FAMILY_GROUP map. Only process_taxonomy/process_calculator_mappings were
-- left on the old, only-partially-executed "Injection Molding" rename
-- (migration 614) -- migration 647/731's history is about removing a STALE
-- DUPLICATE row set, not a decision that "Injection Molding" should be the
-- final category name; the very first process-group seed (migration 302,
-- pre-dating process_taxonomy) already used "Plastic Molding" as the
-- standard category label.
--
-- This migration finishes that rename for the two remaining tables so the
-- whole platform uses one consistent category name.
--
-- Scope: ONLY process_calculator_mappings.process_group and
-- process_taxonomy.process_group, mirroring migration 614's exact shape.
-- Does NOT touch: machine_class literals (injection_molding,
-- compression_molding, reaction_injection_molding -- real, registered,
-- working identifiers, unrelated to this display-label fix), process_name
-- values (Injection Molding stays the real, correct name of that one
-- sibling process), or the unrelated "Plastic & Rubber" raw-material
-- commodity category (raw-materials.service.ts, commodityPresets.ts) --
-- same explicit scope note as migration 614.
-- ============================================================================

BEGIN;

-- ── Pre-flight guard: process_taxonomy must not already have live
-- 'Plastic Molding' rows (migration 731 deleted the orphaned duplicate set
-- entirely -- if any row unexpectedly reappeared, renaming into it would
-- silently merge two distinct row sets under one label).
DO $$
DECLARE
  existing_count INTEGER;
BEGIN
  SELECT count(*) INTO existing_count
  FROM process_taxonomy
  WHERE process_group = 'Plastic Molding';

  IF existing_count > 0 THEN
    RAISE EXCEPTION 'Migration 733 aborted: % process_taxonomy row(s) already carry process_group = ''Plastic Molding'' -- expected zero after migration 731. Investigate before renaming into a possible collision.', existing_count;
  END IF;

  SELECT count(*) INTO existing_count
  FROM process_calculator_mappings
  WHERE process_group = 'Plastic Molding';

  IF existing_count > 0 THEN
    RAISE EXCEPTION 'Migration 733 aborted: % process_calculator_mappings row(s) already carry process_group = ''Plastic Molding'' -- expected zero after migration 731. Investigate before renaming into a possible collision.', existing_count;
  END IF;
END $$;

UPDATE process_calculator_mappings
SET process_group = 'Plastic Molding'
WHERE process_group = 'Injection Molding';

UPDATE process_taxonomy
SET process_group = 'Plastic Molding'
WHERE process_group = 'Injection Molding';

-- Second real bug caught while writing this migration: migration 424 set
-- process_calculator_mappings.lhr_process_group = 'Plastic & Rubber' for
-- machine_class = 'injection_molding' (this is a SEPARATE column from
-- process_group above — it's the label resolveLHRRates joins against
-- lhr_benchmark_rates.process_group/lhr_records.process_group to find this
-- class's real labor rate). Migration 647 renamed those two target tables'
-- process_group from 'Plastic & Rubber' to 'Plastic Molding', but never
-- touched process_calculator_mappings.lhr_process_group — so this join has
-- silently never matched since migration 647 ran, for every plastic-forming
-- class (resolveLHRRates falls back past the real user/benchmark rate to a
-- generic default). Confirmed via direct migration-424 read: it is the ONLY
-- row this literal string was ever set on, so this UPDATE is precise, not a
-- guess.
UPDATE process_calculator_mappings
SET lhr_process_group = 'Plastic Molding'
WHERE lhr_process_group = 'Plastic & Rubber';

COMMIT;

-- Verification (run manually after):
-- SELECT process_group, count(*) FROM process_calculator_mappings GROUP BY process_group ORDER BY process_group;
-- -- Expect: Plastic Molding 3 (or 4 with Reaction Injection Molding), Sheet Metal 68, ... ; no "Injection Molding" row left.
-- SELECT process_group, process_name FROM process_taxonomy WHERE process_group IN ('Injection Molding', 'Plastic Molding') ORDER BY process_name;
-- -- Expect: 4 rows (Compression Molding, Injection Molding, Reaction Injection Molding, Structural Foam Molding), all under "Plastic Molding", none left under "Injection Molding".
-- SELECT machine_class, process_group, lhr_process_group FROM process_calculator_mappings WHERE machine_class = 'injection_molding';
-- -- Expect: process_group = 'Plastic Molding', lhr_process_group = 'Plastic Molding' (was 'Plastic & Rubber').
