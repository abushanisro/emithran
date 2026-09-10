-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 703: Promote real per-machine setup time and crew size from the
-- staged machine library into mhr_records (2026-09-05)
--
-- WHY: every applied process was persisting a hardcoded 15-minute setup and a
-- crew of 1, for every operation on every machine, regardless of what the cost
-- engine had actually charged. The engine side of that is now fixed --
-- resolveSetupMinutes() (engine-kernel.ts) ranks three real sources
-- most-specific-first:
--     1. mhr_records.setup_time_hr        <- this machine, real
--     2. sm_lookup_op_setup_time          <- this operation, real
--     3. the cited per-class *_SETUP_MIN  <- disclosed fallback
-- and apply-route now writes the resolved value instead of the literal 15.
--
-- But tier 1 is mostly EMPTY for sheet metal, so nearly every line still lands
-- on tier 2 or 3 and two different machines of the same class still cost the
-- same setup. Confirmed live against this deployment: of the five process lines
-- on a real sheet-metal quote, only the fiber_laser candidate carried a real
-- setup_time_hr (0.08 hr); press_brake, deburring, pem_press and cmm were all
-- null.
--
-- The data is not missing -- it is staged and unused. sm_reference_data holds
-- one 'machine' row per library machine with the full spec in `raw`, and 336 of
-- the 337 machines carry a real setup_time_hr. Migration 573 already promoted
-- ELEVEN economics fields from those very rows into mhr_records through the
-- join below; it simply did not include setup_time_hr or operators. This
-- migration closes exactly that gap, using 573's identical join and COALESCE
-- convention.
--
-- SCOPE: deliberately only the two fields with a real consumer today --
--   setup_time_hr -> MachineCandidate.setupTimeHr -> resolveSetupMinutes tier 1
--   operators     -> MHRRateInput.operators -> eMithranTerms setupNDL/cycleNDL
-- Other staged fields (number_of_heads, work_center_labor_rate_factor,
-- is_preferred, ...) are NOT promoted here: nothing reads them yet, and
-- importing data no code path consumes only creates the illusion of coverage.
--
-- SAFETY: COALESCE means an existing non-null value is never overwritten -- a
-- shop that has entered its own real setup time keeps it. Nothing is computed,
-- averaged, or defaulted; a machine with no staged value stays null and keeps
-- falling back through the ranked resolver, which discloses that it did.
-- ════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- mhr_records.benchmark_source_key is '<Machine Category>:<Machine Name>' --
-- byte-identical to sm_reference_data.key for category='machine'. This is the
-- established join (migrations 570, 571, 573, 576), not a new heuristic match.
UPDATE mhr_records m
SET
  setup_time_hr = COALESCE(
    m.setup_time_hr,
    CASE
      -- Real hours only. Every staged machine setup time is a fraction of an
      -- hour to a few hours; anything outside 0 < v <= 24 would mean the source
      -- value is in different units (or is a placeholder), and guessing which
      -- would corrupt every quote on that machine. Left null instead, so the
      -- resolver falls back and says so.
      WHEN (srd.raw->>'setup_time_hr') ~ '^[0-9]+(\.[0-9]+)?$'
       AND (srd.raw->>'setup_time_hr')::numeric > 0
       AND (srd.raw->>'setup_time_hr')::numeric <= 24
      THEN (srd.raw->>'setup_time_hr')::numeric
      ELSE NULL
    END
  ),
  operators = COALESCE(
    m.operators,
    CASE
      -- A crew is a whole number of people, at least one. 0 in the source means
      -- "not recorded", never "runs unattended".
      WHEN (srd.raw->>'number_of_operators') ~ '^[0-9]+(\.[0-9]+)?$'
       AND (srd.raw->>'number_of_operators')::numeric >= 1
       AND (srd.raw->>'number_of_operators')::numeric <= 10
      THEN ROUND((srd.raw->>'number_of_operators')::numeric)
      ELSE NULL
    END
  )
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND (m.setup_time_hr IS NULL OR m.operators IS NULL);

COMMIT;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  linked   INTEGER;
  with_setup INTEGER;
  still_null INTEGER;
BEGIN
  SELECT count(*) INTO linked
    FROM mhr_records m JOIN sm_reference_data srd
      ON srd.key = m.benchmark_source_key AND srd.category = 'machine';

  SELECT count(*) INTO with_setup
    FROM mhr_records m JOIN sm_reference_data srd
      ON srd.key = m.benchmark_source_key AND srd.category = 'machine'
   WHERE m.setup_time_hr IS NOT NULL;

  SELECT count(*) INTO still_null
    FROM mhr_records m JOIN sm_reference_data srd
      ON srd.key = m.benchmark_source_key AND srd.category = 'machine'
   WHERE m.setup_time_hr IS NULL;

  RAISE NOTICE 'Migration 703: % mhr_records rows link to a staged machine row; % now carry a real setup_time_hr, % still null.',
    linked, with_setup, still_null;

  IF still_null > 0 THEN
    RAISE NOTICE 'The % row(s) with no setup time keep falling back through resolveSetupMinutes, which discloses the tier it used. Inspect with the query below.', still_null;
  END IF;
END $$;

-- Which linked machines still have no real setup time (expect very few --
-- 336 of 337 library machines carry one):
--   SELECT m.machine_class, m.machine_name, m.benchmark_source_key,
--          srd.raw->>'setup_time_hr' AS staged_value
--     FROM mhr_records m
--     JOIN sm_reference_data srd ON srd.key = m.benchmark_source_key AND srd.category = 'machine'
--    WHERE m.setup_time_hr IS NULL
--    ORDER BY m.machine_class, m.machine_name;
--
-- Spot-check that setup now varies per machine within one class (this is the
-- whole point -- it was a single constant per class before):
--   SELECT machine_class, machine_name, setup_time_hr, operators
--     FROM mhr_records
--    WHERE machine_class IN ('fiber_laser','press_brake','turret_punch','progressive_die_press')
--      AND setup_time_hr IS NOT NULL
--    ORDER BY machine_class, setup_time_hr;
--
-- Then re-cost the part: each process row Setup line should read the machine's
-- own time with a "machine spec" tag instead of "class default", and applying
-- the route should persist that same number rather than 15.
