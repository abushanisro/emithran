-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 375: Fill lhr_benchmark_rates gaps for process groups that
-- process_calculator_mappings actually uses but lhr_benchmark_rates never
-- covered — 'Machining', 'Assembly', 'Post Processing', 'Injection Molding',
-- 'Plastic & Rubber'.
--
-- Root cause: migration 361 seeded lhr_benchmark_rates with exactly 4 process
-- groups (Sheet Metal, CNC Machining, Plastics, Quality). mhr_benchmark_rates
-- (the machine-side sibling table) already covers the fuller vocabulary —
-- migration 345 explicitly seeds the SAME injection-molding machine rate under
-- THREE group aliases ('Injection Molding', 'Plastics', 'Plastic & Rubber')
-- specifically so every naming convention resolves to real data. LHR never got
-- the same treatment, so ProcessCostDialog.tsx's labour byGroup filter finds
-- zero rows for any operation whose process_group is 'Post Processing',
-- 'Assembly', 'Machining' (plain), 'Injection Molding', or 'Plastic & Rubber' —
-- previously this silently widened to "every labour record for the location"
-- (now fixed in ProcessCostDialog.tsx to show an honest "not configured"
-- warning instead) but the actual gap was always the missing seed data, not
-- the matching logic.
--
-- Two different fixes bundled here, by how confident the source rate is:
--
--   1. 'Machining' ← alias of 'CNC Machining'; 'Injection Molding' and
--      'Plastic & Rubber' ← alias of 'Plastics'. Zero guesswork — these are
--      the exact same underlying labour, just referenced by a different name
--      in different subsystems (deterministic planner vs. dialog hierarchy vs.
--      legacy migration-024 naming). Mirrors mhr_benchmark_rates' existing
--      alias pattern exactly.
--
--   2. 'Assembly' and 'Post Processing' ← alias of 'Sheet Metal'. There is no
--      existing distinct rate for either in this system. Assembly (welding,
--      pick & place, screwing) and Post Processing (deburring, inspection,
--      heat treatment, surface treatment) are general shop-floor labour, the
--      same wage tier as Sheet Metal Fabricator — not machine-specific,
--      comparable skill level. This is a deliberate, documented default, not
--      claimed to be authoritative distinct market data — override via HR
--      Rates with real Assembly/Post-Processing wage data if/when available.
--
-- Copies rows via INSERT ... SELECT from the existing source rows rather than
-- retyping ~50 numbers by hand, so every rate/currency/lhr_usd_effective value
-- is guaranteed byte-for-byte identical to its already-reviewed source row.
--
-- Idempotent: ON CONFLICT (location, process_group) DO NOTHING (matches the
-- table's existing unique constraint).
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 'Machining' ← alias of 'CNC Machining' ─────────────────────────────────────
INSERT INTO lhr_benchmark_rates
  (labour_code, labour_type, description, lhr, location, process_group, currency, currency_symbol, lhr_usd_effective)
SELECT
  REPLACE(labour_code, '-CNC', '-MACH'),
  labour_type,
  description || ' (aliased from CNC Machining for the plain ''Machining'' process group)',
  lhr, location, 'Machining', currency, currency_symbol, lhr_usd_effective
FROM lhr_benchmark_rates
WHERE process_group = 'CNC Machining'
ON CONFLICT (location, process_group) DO NOTHING;

-- ── 'Injection Molding' ← alias of 'Plastics' ──────────────────────────────────
INSERT INTO lhr_benchmark_rates
  (labour_code, labour_type, description, lhr, location, process_group, currency, currency_symbol, lhr_usd_effective)
SELECT
  REPLACE(labour_code, '-PL', '-IM'),
  labour_type,
  description || ' (aliased from Plastics for the ''Injection Molding'' process group)',
  lhr, location, 'Injection Molding', currency, currency_symbol, lhr_usd_effective
FROM lhr_benchmark_rates
WHERE process_group = 'Plastics'
ON CONFLICT (location, process_group) DO NOTHING;

-- ── 'Plastic & Rubber' ← alias of 'Plastics' ───────────────────────────────────
INSERT INTO lhr_benchmark_rates
  (labour_code, labour_type, description, lhr, location, process_group, currency, currency_symbol, lhr_usd_effective)
SELECT
  REPLACE(labour_code, '-PL', '-PR'),
  labour_type,
  description || ' (aliased from Plastics for the ''Plastic & Rubber'' process group)',
  lhr, location, 'Plastic & Rubber', currency, currency_symbol, lhr_usd_effective
FROM lhr_benchmark_rates
WHERE process_group = 'Plastics'
ON CONFLICT (location, process_group) DO NOTHING;

-- ── 'Assembly' ← alias of 'Sheet Metal' ────────────────────────────────────────
INSERT INTO lhr_benchmark_rates
  (labour_code, labour_type, description, lhr, location, process_group, currency, currency_symbol, lhr_usd_effective)
SELECT
  REPLACE(labour_code, '-SM', '-ASM'),
  labour_type,
  description || ' (aliased from Sheet Metal — general shop-floor labour, no distinct Assembly rate seeded yet; override in HR Rates if you have real data)',
  lhr, location, 'Assembly', currency, currency_symbol, lhr_usd_effective
FROM lhr_benchmark_rates
WHERE process_group = 'Sheet Metal'
ON CONFLICT (location, process_group) DO NOTHING;

-- ── 'Post Processing' ← alias of 'Sheet Metal' ─────────────────────────────────
INSERT INTO lhr_benchmark_rates
  (labour_code, labour_type, description, lhr, location, process_group, currency, currency_symbol, lhr_usd_effective)
SELECT
  REPLACE(labour_code, '-SM', '-PP'),
  labour_type,
  description || ' (aliased from Sheet Metal — general shop-floor labour, no distinct Post Processing rate seeded yet; override in HR Rates if you have real data)',
  lhr, location, 'Post Processing', currency, currency_symbol, lhr_usd_effective
FROM lhr_benchmark_rates
WHERE process_group = 'Sheet Metal'
ON CONFLICT (location, process_group) DO NOTHING;

-- ── Diagnostic: confirm every process_calculator_mappings process_group that
-- needs a labour rate now has one, for every location that has ANY benchmark
-- coverage at all (excludes non-machine groups like 'Raw Material'/
-- 'Packing & Delivery' the same way migration 369 does for machine_class) ────
DO $$
DECLARE
  missing_count INTEGER;
  missing_list  TEXT;
BEGIN
  SELECT COUNT(*), string_agg(DISTINCT m.process_group, '; ')
    INTO missing_count, missing_list
  FROM (SELECT DISTINCT process_group FROM process_calculator_mappings
        WHERE is_active = true
          AND process_group NOT IN ('Packing & Delivery')) m
  WHERE NOT EXISTS (
    SELECT 1 FROM lhr_benchmark_rates b WHERE b.process_group = m.process_group
  );

  IF missing_count > 0 THEN
    RAISE NOTICE
      'Migration 375: % process_calculator_mappings process_group(s) still have no lhr_benchmark_rates coverage at all: %. These will still show the "no labour rate configured" warning until seeded.',
      missing_count, missing_list;
  ELSE
    RAISE NOTICE 'Migration 375: every active process_group now has lhr_benchmark_rates coverage.';
  END IF;
END $$;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT process_group, COUNT(*) FROM lhr_benchmark_rates GROUP BY 1 ORDER BY 1;
-- Expected: Sheet Metal, CNC Machining, Plastics, Quality, Machining, Assembly,
--           Post Processing, Injection Molding, Plastic & Rubber — 10 rows each
--           (one per location).
