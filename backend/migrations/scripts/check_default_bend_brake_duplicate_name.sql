-- Diagnostic query only — not a migration, doesn't modify data.
-- Purpose: confirm the root cause of the live "Cannot apply this route —
-- 'Press Brake' cycle time is unavailable... Add a real, sourced row to
-- sm_lookup_manual_stroke for thickness_mm=1.6mm, tonnage=7.6T,
-- complexity=simple" apply failure.
--
-- Hypothesis (from code inspection, not yet DB-confirmed): "Default Bend
-- Brake" (75kN -> 7.6T real capacity) has a real bend_cycle_time_s=3.5 on
-- file (migration 506, sm_reference_data, source_region='World Average').
-- getBendCycleTimeForMachine() should prefer that real per-machine value
-- outright over the generic thickness/tonnage/complexity curve (which has
-- no 7.6T column — 7.6T isn't one of the standard press-brake tonnage
-- classes). But that lookup requires the machine name to match EXACTLY ONE
-- row in sm_reference_data (category='machine') — and migration 594 later
-- seeded a per-location RATE-ONLY row (IND/CHN/MEX/FRA — no physics fields,
-- just direct/indirect/labor) under the exact same name "Default Bend
-- Brake". If that landed, "Default Bend Brake" now matches >1 row, the
-- uniqueness guard trips, and the real 3.5s value is silently discarded —
-- which is exactly what produces this error.

-- 1) How many 'machine' rows share the name "Default Bend Brake", and what
--    does each one actually carry? Expect: 1 row with bend_cycle_time_s
--    (World Average), plus one rate-only row per multi-location batch that
--    already ran (IND/CHN/MEX/FRA) — each WITHOUT bend_cycle_time_s.
SELECT
  id,
  source_region,
  source_version,
  key,
  raw->>'name'                AS name,
  raw->'bend_cycle_time_s'    AS bend_cycle_time_s,
  raw->'press_force_kn'       AS press_force_kn,
  raw->'direct'                AS rate_only_direct,
  raw->'indirect'              AS rate_only_indirect,
  raw->'labor'                 AS rate_only_labor
FROM sm_reference_data
WHERE category = 'machine'
  AND lower(trim(raw->>'name')) = lower('Default Bend Brake')
ORDER BY source_region;

-- 2) Blast radius: how many DISTINCT machine names in sm_reference_data
--    (category='machine') currently resolve to more than one row? This is
--    the same ambiguity guard tripping for every one of them, in
--    getBendCycleTimeForMachine / getTurretPunchParamsForMachine /
--    getWaterjetAbrasiveRateForMachine / getRollBendingCycleTime.
SELECT
  lower(trim(raw->>'name')) AS machine_name_lower,
  count(*)                   AS row_count,
  array_agg(DISTINCT source_region) AS source_regions
FROM sm_reference_data
WHERE category = 'machine'
  AND raw->>'name' IS NOT NULL
GROUP BY lower(trim(raw->>'name'))
HAVING count(*) > 1
ORDER BY row_count DESC, machine_name_lower
LIMIT 50;

-- 3) Confirm 7.6T genuinely has no row in the generic manual-stroke curve
--    (so a fabricated row there would NOT be the right fix — the real fix
--    is restoring the per-machine value above). Shows every distinct
--    tonnage actually seeded.
SELECT DISTINCT tonnage
FROM sm_lookup_manual_stroke
ORDER BY tonnage;

-- 4) Which real mhr_records press-brake rows currently have a max_tonnage
--    at/near 7.6T (across all locations) — i.e. which real machines this
--    bug is actually affecting today, not just "Default Bend Brake" by name.
SELECT id, machine_name, location, machine_class, max_tonnage
FROM mhr_records
WHERE machine_class = 'press_brake'
  AND max_tonnage IS NOT NULL
  AND max_tonnage BETWEEN 6 AND 9
ORDER BY location, machine_name;
