-- ============================================================================
-- Migration 607: Seed real Direct/Indirect overhead for the 12 USA "Plasma
-- Punch" machines, and correct 4 machine_name/spec values that were wrong
-- since original import (migration 584)
--
-- Context: migration 584's own header already documented the gap -- its
-- source ("Shop Fleet" screenshot) had NO direct_overhead_rate_usd_hr /
-- indirect_overhead_rate_usd_hr columns at all, so total_machine_hour_rate/
-- manual_mhr_value were deliberately left NULL rather than fabricated. The
-- user has now supplied a second, complete screenshot of the same real
-- catalog from the tool's "World Average" sector view (Digital Factory
-- Manager, USA), which DOES carry Direct/Indirect Overhead columns for the
-- same 12 named machines -- verified image, read directly, not guessed.
-- Same supplementation pattern as every other category (582/583's own
-- "World Average"-sourced capex+overhead), not a scope mismatch.
--
-- Naming correction (verified against 3 independent real sources before
-- writing this -- the World Average screenshot AND india_base.json/
-- mexico_delta.json/france_delta.json's own already-staged Plasma Punch Combo
-- entries, which migration 596/597 explicitly declined to alias onto the live
-- catalog because they are genuinely different specs, not typos -- see 596's
-- generator script header):
--   'Ficep Tipo C23'              -> 'Ficep Tipo C16' (lower overhead of the
--                                     pair in all 4 independent sources: USA
--                                     49.78, India 40.02, Mexico 51.04,
--                                     France 52.58)
--   'Ficep Tipo C23 (second unit)' -> 'Ficep Tipo C25' (higher overhead of
--                                     the pair: USA 54.17, India 43.53,
--                                     Mexico 55.28, France 57.13)
--   'Plasma Punch - 200 Watts, 350kN Press Force' -> 'Plasma Punch - 200
--                                     Watts, 450kN Press Force' (real press
--                                     force per the complete World Average
--                                     screenshot; the India/Mexico/France
--                                     delta files independently carry the
--                                     same 450kN figure, previously flagged
--                                     "unverified" there only because their
--                                     own truncated source screenshot didn't
--                                     show the digit -- now confirmed)
--   'Plasma Punch - 200 Watts, 550kN Press Force' -> 'Plasma Punch - 300
--                                     Watts, 550kN Press Force' (real wattage
--                                     is 300, not 200 -- same reasoning)
-- The DB never had a real "Ficep Tipo C23" or "200 Watts, 350/550kN" machine
-- -- those were placeholder/mis-transcribed names invented at migration 584's
-- original import, not a rename of a correct value.
--
-- 'Plasma Punch - 400 Watts, 1000kN Press Force' already has the correct
-- name (matches the World Average screenshot exactly) -- only its overhead
-- was missing, no rename needed.
--
-- Scope: USA only (the location the user's screenshot and original bug
-- report both concern). India/Mexico/France already have real, sourced
-- Direct/Indirect overhead for these exact 12 real machines staged in
-- india_base.json/mexico_delta.json/france_delta.json (unconsumed for the
-- 2 Ficep + 2 Plasma Punch spec rows specifically, since migrations 596/597
-- deliberately skipped them) -- left for a follow-up migration, not done here.
-- ============================================================================

BEGIN;

-- Step 1: Correct machine_name for the 4 rows that were mis-transcribed at
-- original import (see header). USA only -- these names are USA-specific
-- placeholders, not shared with any other location's rows.
UPDATE mhr_records
SET machine_name = 'Ficep Tipo C16'
WHERE machine_name = 'Ficep Tipo C23' AND location = 'USA';

UPDATE mhr_records
SET machine_name = 'Ficep Tipo C25'
WHERE machine_name = 'Ficep Tipo C23 (second unit)' AND location = 'USA';

UPDATE mhr_records
SET machine_name = 'Plasma Punch - 200 Watts, 450kN Press Force'
WHERE machine_name = 'Plasma Punch - 200 Watts, 350kN Press Force' AND location = 'USA';

UPDATE mhr_records
SET machine_name = 'Plasma Punch - 300 Watts, 550kN Press Force'
WHERE machine_name = 'Plasma Punch - 200 Watts, 550kN Press Force' AND location = 'USA';

-- Step 2: Seed real Direct/Indirect overhead (read directly off the World
-- Average screenshot, memory/sheetmetal/machine/image.png) and recompute
-- total_machine_hour_rate/manual_mhr_value = direct + indirect, matching
-- every other category's convention (582/583). Labor rate and every other
-- field are deliberately left untouched -- this migration only fills the
-- previously-NULL overhead columns, per the user's explicit scope choice.
UPDATE mhr_records m
SET
  direct_overhead_rate = v.direct_oh,
  indirect_overhead_rate = v.indirect_oh,
  total_machine_hour_rate = ROUND(v.direct_oh + v.indirect_oh, 2),
  manual_mhr_value = ROUND(v.direct_oh + v.indirect_oh, 2),
  fully_burdened_local_per_hr = ROUND(v.direct_oh + v.indirect_oh, 2),
  direct_overhead_source = 'benchmark',
  indirect_overhead_source = 'benchmark',
  benchmark_direct_overhead_rate_usd_hr = v.direct_oh,
  benchmark_indirect_overhead_rate_usd_hr = v.indirect_oh
FROM (VALUES
  ('Ermak COP 1270 X 30', 21.79, 18.20),
  ('Ficep Tipo C16', 49.78, 22.94),
  ('Ficep Tipo C25', 54.17, 22.94),
  ('Muratec Magnium - 5000 Plasma', 45.63, 21.30),
  ('Plasma Punch - 100 Watts, 300kN Press Force', 22.39, 18.20),
  ('Plasma Punch - 200 Watts, 450kN Press Force', 39.94, 21.17),
  ('Plasma Punch - 300 Watts, 550kN Press Force', 51.45, 21.34),
  ('Plasma Punch - 400 Watts, 1000kN Press Force', 54.47, 23.05),
  ('Whitney 3400 Heavy', 50.39, 26.35),
  ('Whitney 3400 XP', 38.13, 26.35),
  ('Whitney 3700 SST', 50.69, 17.65),
  ('Whitney 4400 Max', 65.67, 15.74)
) AS v(machine_name, direct_oh, indirect_oh)
WHERE m.machine_name = v.machine_name
  AND m.location = 'USA'
  AND m.benchmark_source_key LIKE 'Plasma Punch:%';

COMMIT;

-- Verification (run manually after):
-- SELECT machine_name, direct_overhead_rate, indirect_overhead_rate,
--        total_machine_hour_rate, manual_mhr_value
--   FROM mhr_records
--   WHERE benchmark_source_key LIKE 'Plasma Punch:%' AND location = 'USA'
--   ORDER BY machine_name;
-- -- Expect all 12 rows with non-NULL direct/indirect overhead, and names
-- -- 'Ficep Tipo C16'/'Ficep Tipo C25'/'Plasma Punch - 200 Watts, 450kN...'/
-- -- 'Plasma Punch - 300 Watts, 550kN...' (no more 'C23'/'350kN'/'550kN' at
-- -- 200 Watts anywhere).
