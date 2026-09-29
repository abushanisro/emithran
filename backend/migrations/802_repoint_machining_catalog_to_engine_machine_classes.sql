-- 802: Repoint the Machining catalog from the retired cnc_* machine classes
-- to the machine classes the registered engines and mhr_records actually use.
--
-- ROOT CAUSE
--
-- The Machining Engine Re-Architecture replaced the six coarse cnc_* buckets
-- (cnc_3ax_vmc, cnc_4ax_vmc, cnc_5ax_mc, cnc_lathe, cnc_lathe_live,
-- cnc_mill_turn) with one engine per real catalog machine (3_axis_mill,
-- 2_axis_lathe, ...), and migration 693 seeded mhr_records under those same
-- classes. Migration 753 however wired the 7 engine-backed catalog stations
-- in process_taxonomy / process_calculator_mappings to the retired buckets.
-- Nothing joins them: an applied "3 Axis Mill" line (machine_class
-- 3_axis_mill) finds no mapping row, so it loses its catalog hierarchy and
-- its labour tier, and the catalog keeps showing "cnc_*" identities.
--
-- What this migration does (self-contained, idempotent, post-checked):
--   1. The 7 engine-backed stations -> their engine machine class, in both
--      process_calculator_mappings and process_taxonomy.
--   2. The Drill Press station class cnc_drill_press -> machining_drill_press
--      (same station-specific naming as machining_millturn /
--      machining_inspection; distinct from the sheet-metal drill_press
--      engine), in the catalog and its 9 mhr_records rows.
--   3. The 3 generic India benchmark mhr_records rows still on retired
--      buckets -> the engine class of the same machine type, with the
--      "CNC " prefix dropped from their generic names.
--   4. Labour tiers: the lhr_benchmark_rates "CNC Machining" rows are exact
--      duplicates of the "Machining" rows (same lhr and lhr_usd_effective at
--      every location; verified below, the migration aborts otherwise) and
--      are removed. The migration 464 tier "CNC 5-Axis / Mill-Turn"
--      is renamed "5-Axis / Mill-Turn" and re-attached to the 5 Axis Mill
--      station (the Makino D-series machines 464 sourced it from are
--      5_axis_mill rows). MillTurn stays on the standard tier: none of the
--      mill-turn machines 464 named exist in mhr_records to verify it.
--
-- Not touched: lhr_records rows grouped "CNC Machining" (imported wage
-- grades). Renaming them would make them outrank the benchmark for every
-- machining line (resolveLHRRates prefers imported records), which changes
-- machining labour cost -- a pricing decision, not a rename. Also not
-- touched: the 12 process_cost_records rows grouped "CNC Machining". They
-- are historical snapshots from the retired cnc-5ax route (source
-- legacy_unverified, cycle_time 0) that migration 717 deliberately left
-- exempt from ck_pcr_cycle_time_positive (added NOT VALID); any UPDATE of
-- them re-checks that constraint and fails. A snapshot keeps the group it
-- was costed under.
--
-- One transaction: any failure leaves the database unchanged.

BEGIN;

-- 1. Engine-backed stations -> engine machine class.
UPDATE process_calculator_mappings pcm
SET machine_class = v.engine_class
FROM (VALUES
  ('2 Axis Lathe', '2_axis_lathe'),
  ('3 Axis Lathe', '3_axis_lathe'),
  ('2 Axis Bar Feed Lathe with Sub Spindle', '2_axis_bar_feed_lathe_with_sub_spindle'),
  ('3 Axis Bar Feed Lathe with Sub Spindle', '3_axis_bar_feed_lathe_with_sub_spindle'),
  ('3 Axis Mill', '3_axis_mill'),
  ('4 Axis Mill', '4_axis_mill'),
  ('5 Axis Mill', '5_axis_mill'),
  ('Drill Press', 'machining_drill_press')
) AS v(station, engine_class)
WHERE pcm.process_group = 'Machining'
  AND pcm.operation = v.station
  AND pcm.machine_class IS DISTINCT FROM v.engine_class;

UPDATE process_taxonomy pt
SET machine_class = v.engine_class
FROM (VALUES
  ('2 Axis Lathe', '2_axis_lathe'),
  ('3 Axis Lathe', '3_axis_lathe'),
  ('2 Axis Bar Feed Lathe with Sub Spindle', '2_axis_bar_feed_lathe_with_sub_spindle'),
  ('3 Axis Bar Feed Lathe with Sub Spindle', '3_axis_bar_feed_lathe_with_sub_spindle'),
  ('3 Axis Mill', '3_axis_mill'),
  ('4 Axis Mill', '4_axis_mill'),
  ('5 Axis Mill', '5_axis_mill'),
  ('Drill Press', 'machining_drill_press')
) AS v(station, engine_class)
WHERE pt.process_group = 'Machining'
  AND pt.process_name = v.station
  AND pt.machine_class IS DISTINCT FROM v.engine_class;

-- 2. Drill Press machines.
UPDATE mhr_records SET machine_class = 'machining_drill_press'
WHERE machine_class = 'cnc_drill_press';

-- 3. Generic India benchmark rows on retired buckets.
UPDATE mhr_records
SET machine_class = CASE machine_class
                      WHEN 'cnc_3ax_vmc' THEN '3_axis_mill'
                      WHEN 'cnc_4ax_vmc' THEN '4_axis_mill'
                      WHEN 'cnc_5ax_mc'  THEN '5_axis_mill'
                      WHEN 'cnc_lathe'   THEN '2_axis_lathe'
                    END,
    machine_name = regexp_replace(machine_name, '^CNC ', '')
WHERE machine_class IN ('cnc_3ax_vmc', 'cnc_4ax_vmc', 'cnc_5ax_mc', 'cnc_lathe');

-- 4a. Duplicate "CNC Machining" benchmark labour rows: verify, then remove.
DO $do$
DECLARE mismatched int;
BEGIN
  SELECT count(*) INTO mismatched
  FROM lhr_benchmark_rates c
  LEFT JOIN lhr_benchmark_rates m
    ON m.location = c.location AND m.process_group = 'Machining'
  WHERE c.process_group = 'CNC Machining'
    AND (m.location IS NULL
         OR m.lhr IS DISTINCT FROM c.lhr
         OR m.lhr_usd_effective IS DISTINCT FROM c.lhr_usd_effective);
  IF mismatched > 0 THEN
    RAISE EXCEPTION 'migration 802: % CNC Machining benchmark rows are not exact duplicates of a Machining row; not deleting', mismatched;
  END IF;
END
$do$;

DELETE FROM lhr_benchmark_rates WHERE process_group = 'CNC Machining';

-- 4b. The 5-axis labour tier.
UPDATE lhr_benchmark_rates
SET process_group = '5-Axis / Mill-Turn',
    description = replace(description, 'CNC 5-Axis / Mill-Turn', '5-Axis / Mill-Turn')
WHERE process_group = 'CNC 5-Axis / Mill-Turn';

UPDATE process_calculator_mappings
SET lhr_process_group = '5-Axis / Mill-Turn'
WHERE lhr_process_group = 'CNC 5-Axis / Mill-Turn'
   OR (process_group = 'Machining' AND operation = '5 Axis Mill'
       AND lhr_process_group IS DISTINCT FROM '5-Axis / Mill-Turn');

-- Post-check: no catalog, machine or labour row may still use a CNC identity.
DO $do$
DECLARE leftover int;
BEGIN
  SELECT
      (SELECT count(*) FROM process_calculator_mappings
        WHERE machine_class LIKE 'cnc\_%' OR lhr_process_group LIKE 'CNC %')
    + (SELECT count(*) FROM process_taxonomy WHERE machine_class LIKE 'cnc\_%')
    + (SELECT count(*) FROM mhr_records WHERE machine_class LIKE 'cnc\_%')
    + (SELECT count(*) FROM lhr_benchmark_rates WHERE process_group LIKE 'CNC %')
  INTO leftover;
  IF leftover > 0 THEN
    RAISE EXCEPTION 'migration 802: % rows still carry a cnc_* class or CNC group', leftover;
  END IF;
END
$do$;

COMMIT;
