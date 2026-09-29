-- ============================================================================
-- Migration 808: put the real Drill Press station on the drill_press class
--
-- Source of truth: memory/Machining.
--   machine/drill_press_usa.csv            9 real Radial / Upright drill presses
--   operations_full__operations.csv        Drill Press:Drilling, Center Drilling,
--       Pecking, Step Drilling, Boring, Reaming, Countersinking, Multistep
--       Holemaking (Counterboring, Back Counterboring), Tapping //SimpleHole
--
-- Those are exactly the operations the cost engine prices under machine class
-- drill_press (counterbore / countersink / ream, and sheet-metal tapping).
-- Migration 738 seeded the 9 machines as cnc_drill_press and migration 802
-- renamed them machining_drill_press, only to avoid a name collision. Neither
-- name is known to the engine (MACHINE_REGISTRY / MHR_RATE_MACHINE_CLASSES),
-- so the 9 real machines were invisible and every drill_press line had no
-- machine. They are one real category, so they get the one real class.
--
-- Touches the Machining Drill Press station row in process_taxonomy and
-- process_calculator_mappings, and the 9 mhr_records rows. Machining
-- Counterboring / Countersinking catalog rows are already drill_press.
--
-- One DO block (the SQL editor runs statements one at a time); aborts and
-- rolls back if the machine count is not the 9 expected rows. Safe to re-run.
-- ============================================================================

DO $$
DECLARE
  n_machines integer;
  n_old      integer;
  n_done     integer;
  n_pcm      integer;
  n_pt       integer;
  classes    text;
BEGIN
  -- Count the 9 real USA Drill Press rows by class, so a re-run (rows
  -- already drill_press) is told apart from 738 never having run (no rows).
  -- Only USA is counted: migration 829 clones USA machines to India under
  -- key '<Category>:<Machine>:India', which also matches 'Drill Press:%'.
  -- The UPDATE below still moves every location, so India copies follow.
  SELECT count(*),
         count(*) FILTER (WHERE machine_class IN ('machining_drill_press', 'cnc_drill_press')),
         count(*) FILTER (WHERE machine_class = 'drill_press'),
         string_agg(DISTINCT coalesce(machine_class, 'NULL'), ', ')
  INTO n_machines, n_old, n_done, classes
  FROM mhr_records
  WHERE benchmark_source_key LIKE 'Drill Press:%'
    AND location = 'USA';

  IF n_machines = 0 THEN
    RAISE EXCEPTION 'Migration 808 aborted: no USA mhr_records row has benchmark_source_key Drill Press:* - run migration 738 first';
  END IF;
  IF n_machines <> 9 OR n_old + n_done <> 9 THEN
    RAISE EXCEPTION 'Migration 808 aborted: expected 9 USA Drill Press machines on machining_drill_press/cnc_drill_press/drill_press, found % (classes: %)', n_machines, classes;
  END IF;
  IF n_done = 9 THEN
    RAISE NOTICE 'Migration 808: the 9 USA drill presses are already drill_press (re-run); only the catalog rows are re-checked';
  END IF;

  UPDATE mhr_records
  SET machine_class = 'drill_press'
  WHERE machine_class IN ('machining_drill_press', 'cnc_drill_press')
    AND benchmark_source_key LIKE 'Drill Press:%';

  UPDATE process_calculator_mappings
  SET machine_class = 'drill_press'
  WHERE process_group = 'Machining'
    AND operation = 'Drill Press'
    AND machine_class IN ('machining_drill_press', 'cnc_drill_press');
  GET DIAGNOSTICS n_pcm = ROW_COUNT;

  UPDATE process_taxonomy
  SET machine_class = 'drill_press'
  WHERE process_group = 'Machining'
    AND process_name = 'Drill Press'
    AND machine_class IN ('machining_drill_press', 'cnc_drill_press');
  GET DIAGNOSTICS n_pt = ROW_COUNT;

  RAISE NOTICE 'Migration 808: % drill presses moved (% already drill_press), % catalog mapping rows, % taxonomy rows now drill_press', n_old, n_done, n_pcm, n_pt;
END $$;

-- Verify (expect 9 USA rows plus any India copies from 829, all drill_press):
-- SELECT location, machine_name, machine_class, total_machine_hour_rate, usd_lhr_total, setup_time_hr
-- FROM mhr_records WHERE benchmark_source_key LIKE 'Drill Press:%' ORDER BY location, machine_name;
