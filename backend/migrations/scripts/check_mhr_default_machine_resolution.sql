-- ============================================================================
-- READ-ONLY diagnostic. Changes nothing. Run each block, paste results back.
--
-- Question being answered: the Edit Process Cost dialog shows
--   Machine: Default - $14.20/hr (USA)
-- Is that a silent fallback, or a real mhr_records row, and is it ever
-- attached to a line that is NOT an inspection line?
-- ============================================================================

-- ── Q1. Every mhr_records row whose machine name is literally a "Default" ───
-- Expected per migration 738 and memory/machining/machine/inspection_usa.csv:
-- machining_inspection / USA / Default / 0.30 + 13.90 = 14.20, LHR 43.21.
SELECT id, machine_class, location, machine_name, process_group,
       benchmark_source_key,
       direct_overhead_rate, indirect_overhead_rate,
       total_machine_hour_rate, mhr_usd_per_hour, usd_lhr_total
FROM mhr_records
WHERE lower(trim(machine_name)) = 'default'
ORDER BY machine_class, location;

-- ── Q2. Haas DS-30 with BAR3010SS Feeder, every location ────────────────────
-- Expected (migration 693): 2_axis_bar_feed_lathe_with_sub_spindle / USA /
-- 14.62 + 19.40 = 34.03 MHR, LHR 47.36.
SELECT id, machine_class, location, machine_name, process_group,
       benchmark_source_key,
       direct_overhead_rate, indirect_overhead_rate,
       total_machine_hour_rate, mhr_usd_per_hour, usd_lhr_total
FROM mhr_records
WHERE machine_name ILIKE 'Haas DS-30%'
ORDER BY machine_name, location;

-- ── Q3. THE KEY CHECK. Saved process lines linked to a "Default" machine ────
-- If every row here has line_class = machine_class_of_linked_row
-- (machining_inspection / special_inspection) and an inspection operation,
-- the $14.20 is the correct, real Inspection work-center rate and no line
-- is being mis-linked. Any row where the two classes DIFFER is a real
-- mis-link bug and is the thing to fix.
SELECT pcr.id AS process_cost_record_id, pcr.bom_item_id, pcr.op_nbr,
       pcr.operation, pcr.process_group, pcr.category,
       pcr.machine_class AS line_class,
       m.machine_class   AS machine_class_of_linked_row,
       pcr.machine_name, pcr.machine_rate, pcr.line_labour_rate, pcr.labor_rate,
       pcr.location, pcr.updated_at
FROM process_cost_records pcr
JOIN mhr_records m ON m.id::text = pcr.mhr_id::text
WHERE lower(trim(m.machine_name)) = 'default'
ORDER BY (pcr.machine_class IS DISTINCT FROM m.machine_class) DESC, pcr.updated_at DESC
LIMIT 200;

-- ── Q4. Any saved line whose own machine_class disagrees with its linked ────
-- machine (all machines, not only Default). Should be zero rows.
SELECT pcr.id, pcr.bom_item_id, pcr.operation, pcr.machine_class AS line_class,
       m.machine_class AS linked_class, m.machine_name, m.location
FROM process_cost_records pcr
JOIN mhr_records m ON m.id::text = pcr.mhr_id::text
WHERE pcr.machine_class IS NOT NULL
  AND m.machine_class IS NOT NULL
  AND pcr.machine_class <> m.machine_class
LIMIT 200;

-- ── Q5. Integrity counts requested (report only, nothing deleted) ───────────
SELECT
  (SELECT count(*) FROM (
     SELECT lower(trim(machine_name)), location, machine_class
     FROM mhr_records
     GROUP BY 1, 2, 3 HAVING count(*) > 1) d)                          AS duplicate_name_location_class_groups,
  (SELECT count(*) FROM process_cost_records pcr
     WHERE pcr.mhr_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM mhr_records m
                       WHERE m.id::text = pcr.mhr_id::text))            AS orphan_process_line_mhr_ids,
  (SELECT count(*) FROM mhr_records
     WHERE coalesce(total_machine_hour_rate, 0) <= 0
       AND coalesce(mhr_usd_per_hour, 0) <= 0)                          AS rows_missing_mhr,
  (SELECT count(*) FROM mhr_records
     WHERE coalesce(usd_lhr_total, 0) <= 0)                             AS rows_missing_lhr,
  (SELECT count(*) FROM mhr_records
     WHERE direct_overhead_rate IS NOT NULL
       AND indirect_overhead_rate IS NOT NULL
       AND total_machine_hour_rate IS NOT NULL
       AND abs(total_machine_hour_rate
               - (direct_overhead_rate + indirect_overhead_rate)) > 0.02) AS rows_mhr_not_equal_direct_plus_indirect,
  (SELECT count(*) FROM mhr_records
     WHERE machine_name ~* 'global\s*$')                                AS rows_with_global_suffix,
  (SELECT count(*) FROM mhr_records WHERE machine_class IS NULL)        AS rows_missing_machine_class,
  (SELECT count(DISTINCT location) FROM mhr_records)                    AS distinct_locations;

-- ── Q6. Detail for the MHR != Direct + Indirect rows (first 50) ─────────────
-- Migration 581 defines canonical MHR = Direct OH + Indirect OH. Rows here
-- either predate 581 or carry a currency-local total against USD overheads.
SELECT id, machine_class, location, machine_name, currency_code,
       direct_overhead_rate, indirect_overhead_rate, total_machine_hour_rate,
       round((total_machine_hour_rate - (direct_overhead_rate + indirect_overhead_rate))::numeric, 2) AS delta
FROM mhr_records
WHERE direct_overhead_rate IS NOT NULL
  AND indirect_overhead_rate IS NOT NULL
  AND total_machine_hour_rate IS NOT NULL
  AND abs(total_machine_hour_rate - (direct_overhead_rate + indirect_overhead_rate)) > 0.02
ORDER BY abs(total_machine_hour_rate - (direct_overhead_rate + indirect_overhead_rate)) DESC
LIMIT 50;

-- ── Q8. The 393 orphaned links, grouped. Is each one re-linkable? ──────────
-- live_matches = how many CURRENT mhr_records rows share this line's saved
-- machine name + location + class. 1 = safely re-linkable, 0 = machine is
-- genuinely gone, >1 = ambiguous (one of the 92 duplicate groups).
SELECT pcr.machine_class, pcr.machine_name, pcr.location,
       count(*) AS orphaned_lines,
       min(pcr.created_at) AS first_saved, max(pcr.created_at) AS last_saved,
       (SELECT count(*) FROM mhr_records m
         WHERE lower(trim(m.machine_name)) = lower(trim(pcr.machine_name))
           AND m.location = pcr.location
           AND m.machine_class IS NOT DISTINCT FROM pcr.machine_class) AS live_matches
FROM process_cost_records pcr
WHERE pcr.mhr_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM mhr_records m WHERE m.id::text = pcr.mhr_id::text)
GROUP BY pcr.machine_class, pcr.machine_name, pcr.location
ORDER BY orphaned_lines DESC
LIMIT 200;

-- ── Q9. The 92 duplicate groups, with how the copies differ ─────────────────
SELECT lower(trim(machine_name)) AS name_key, location, machine_class,
       count(*) AS copies,
       array_agg(DISTINCT total_machine_hour_rate) AS mhr_values,
       array_agg(DISTINCT usd_lhr_total)           AS lhr_values,
       array_agg(DISTINCT coalesce(process_group, commodity_code)) AS groups,
       array_agg(DISTINCT coalesce(user_id::text, 'global'))      AS owners,
       array_agg(DISTINCT benchmark_source_key)    AS source_keys
FROM mhr_records
GROUP BY 1, 2, 3
HAVING count(*) > 1
ORDER BY copies DESC, name_key
LIMIT 100;

-- ── Q10. The 154 rows with no machine_class, by where they came from ────────
-- A row with no class can never be picked by the cost engine (it selects by
-- class), so these can only ever appear in the dialog, never in a quote.
SELECT coalesce(process_group, commodity_code, '-') AS grp,
       split_part(coalesce(benchmark_source_key, ''), ':', 1) AS category,
       location, count(*)
FROM mhr_records
WHERE machine_class IS NULL
GROUP BY 1, 2, 3
ORDER BY 4 DESC
LIMIT 100;

-- ── Q11. Rows missing MHR (8) or LHR (31) ───────────────────────────────────
SELECT id, machine_class, location, machine_name,
       coalesce(process_group, commodity_code) AS grp,
       total_machine_hour_rate, mhr_usd_per_hour, usd_lhr_total,
       CASE WHEN coalesce(total_machine_hour_rate,0) <= 0 AND coalesce(mhr_usd_per_hour,0) <= 0
            THEN 'no MHR' ELSE '' END AS missing_mhr,
       CASE WHEN coalesce(usd_lhr_total,0) <= 0 THEN 'no LHR' ELSE '' END AS missing_lhr
FROM mhr_records
WHERE (coalesce(total_machine_hour_rate,0) <= 0 AND coalesce(mhr_usd_per_hour,0) <= 0)
   OR coalesce(usd_lhr_total,0) <= 0
ORDER BY grp, machine_class, machine_name;

-- ── Q7. Names ending in Global (the scope-suffix concern) ───────────────────
SELECT machine_name, location, machine_class, count(*)
FROM mhr_records
WHERE machine_name ~* 'global\s*$'
GROUP BY 1, 2, 3
ORDER BY 1
LIMIT 100;
