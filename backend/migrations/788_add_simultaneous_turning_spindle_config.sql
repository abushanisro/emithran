-- ============================================================================
-- Migration 788: Real spindle-config columns for mhr_records (2026-09-19)
--
-- Source: memory/machining/machine/simultaneous_turning_usa.csv. Generated
-- by gen_788_add_simultaneous_turning_spindle_config.js -- see that script's
-- header. Promotes real per-machine spindle count + index-cycle overhead
-- times (drum index / transfer / stock feed / speed sync) so
-- computeCNCTurnedCostSummary's real multi-station adjustment (Machining
-- Simultaneous Turning engine) can read them the same way every other real
-- per-machine field (press_cycle_time_s, cut_to_length_cycle_const_s, ...)
-- is already resolved through MachineCandidate/MHRRateInput.
--
-- Additive, nullable columns -- every other machine class leaves these
-- null (not zero, so a real capability check can tell "no real spindle
-- data" apart from "genuinely 1 spindle").
-- ============================================================================

BEGIN;

ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS number_spindles NUMERIC,
  ADD COLUMN IF NOT EXISTS drum_index_time_s NUMERIC,
  ADD COLUMN IF NOT EXISTS transfer_time_s NUMERIC,
  ADD COLUMN IF NOT EXISTS stock_feed_time_s NUMERIC,
  ADD COLUMN IF NOT EXISTS speed_synchronization_time_s NUMERIC;

-- ── Populate the 14 real Simultaneous Turning rows (migrations 737/738) ────
UPDATE mhr_records SET
  number_spindles = 6,
  drum_index_time_s = 0.7,
  transfer_time_s = 1,
  stock_feed_time_s = 2.5,
  speed_synchronization_time_s = 1.5
WHERE machine_class = 'simultaneous_turning' AND machine_name = $str$DMG Mori GMC25ISM-6$str$;
UPDATE mhr_records SET
  number_spindles = 2,
  drum_index_time_s = 0,
  transfer_time_s = 1,
  stock_feed_time_s = 2.5,
  speed_synchronization_time_s = 1.5
WHERE machine_class = 'simultaneous_turning' AND machine_name = $str$Dooson Puma TT2500SY$str$;
UPDATE mhr_records SET
  number_spindles = 2,
  drum_index_time_s = 0,
  transfer_time_s = 1,
  stock_feed_time_s = 2.5,
  speed_synchronization_time_s = 1.5
WHERE machine_class = 'simultaneous_turning' AND machine_name = $str$HAAS DS-30Y$str$;
UPDATE mhr_records SET
  number_spindles = 6,
  drum_index_time_s = 0.7,
  transfer_time_s = 1,
  stock_feed_time_s = 2.5,
  speed_synchronization_time_s = 1.5
WHERE machine_class = 'simultaneous_turning' AND machine_name = $str$Index MS16C-6$str$;
UPDATE mhr_records SET
  number_spindles = 8,
  drum_index_time_s = 1.2,
  transfer_time_s = 1,
  stock_feed_time_s = 2.5,
  speed_synchronization_time_s = 1.5
WHERE machine_class = 'simultaneous_turning' AND machine_name = $str$Index MS22-8$str$;
UPDATE mhr_records SET
  number_spindles = 6,
  drum_index_time_s = 0.7,
  transfer_time_s = 1,
  stock_feed_time_s = 2.5,
  speed_synchronization_time_s = 1.5
WHERE machine_class = 'simultaneous_turning' AND machine_name = $str$Index MS32-6$str$;
UPDATE mhr_records SET
  number_spindles = 8,
  drum_index_time_s = 1.2,
  transfer_time_s = 1,
  stock_feed_time_s = 2.5,
  speed_synchronization_time_s = 1.5
WHERE machine_class = 'simultaneous_turning' AND machine_name = $str$Index MS40-8$str$;
UPDATE mhr_records SET
  number_spindles = 2,
  drum_index_time_s = 0,
  transfer_time_s = 1,
  stock_feed_time_s = 2.5,
  speed_synchronization_time_s = 1.5
WHERE machine_class = 'simultaneous_turning' AND machine_name = $str$Tsugami M08SY$str$;
UPDATE mhr_records SET
  number_spindles = 6,
  drum_index_time_s = 0.7,
  transfer_time_s = 1,
  stock_feed_time_s = 2.5,
  speed_synchronization_time_s = 1.5
WHERE machine_class = 'simultaneous_turning' AND machine_name = $str$Virtual CNC Multi-Spindle, 6 Spindles, Large$str$;
UPDATE mhr_records SET
  number_spindles = 6,
  drum_index_time_s = 0.7,
  transfer_time_s = 1,
  stock_feed_time_s = 2.5,
  speed_synchronization_time_s = 1.5
WHERE machine_class = 'simultaneous_turning' AND machine_name = $str$Virtual CNC Multi-Spindle, 6 Spindles, Small$str$;
UPDATE mhr_records SET
  number_spindles = 8,
  drum_index_time_s = 1.2,
  transfer_time_s = 1,
  stock_feed_time_s = 2.5,
  speed_synchronization_time_s = 1.5
WHERE machine_class = 'simultaneous_turning' AND machine_name = $str$Virtual CNC Multi-Spindle, 8 Spindles, Large$str$;
UPDATE mhr_records SET
  number_spindles = 8,
  drum_index_time_s = 1.2,
  transfer_time_s = 1,
  stock_feed_time_s = 2.5,
  speed_synchronization_time_s = 1.5
WHERE machine_class = 'simultaneous_turning' AND machine_name = $str$Virtual CNC Multi-Spindle, 8 Spindles, Small$str$;
UPDATE mhr_records SET
  number_spindles = 2,
  drum_index_time_s = 0,
  transfer_time_s = 1,
  stock_feed_time_s = 2.5,
  speed_synchronization_time_s = 1.5
WHERE machine_class = 'simultaneous_turning' AND machine_name = $str$Virtual CNC Turning Center with Sub Spindle, Large$str$;
UPDATE mhr_records SET
  number_spindles = 2,
  drum_index_time_s = 0,
  transfer_time_s = 1,
  stock_feed_time_s = 2.5,
  speed_synchronization_time_s = 1.5
WHERE machine_class = 'simultaneous_turning' AND machine_name = $str$Virtual CNC Turning Center with Sub Spindle, Medium$str$;
UPDATE mhr_records SET
  number_spindles = 2,
  drum_index_time_s = 0,
  transfer_time_s = 1,
  stock_feed_time_s = 2.5,
  speed_synchronization_time_s = 1.5
WHERE machine_class = 'simultaneous_turning' AND machine_name = $str$Virtual CNC Turning Center with Sub Spindle, Small$str$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after, once 737/738 have also been run):
-- SELECT machine_name, number_spindles, drum_index_time_s FROM mhr_records
--   WHERE machine_class = 'simultaneous_turning' ORDER BY machine_name;
-- -- Expect 14 rows, number_spindles in {2,6,8}, drum_index_time_s real per row.
