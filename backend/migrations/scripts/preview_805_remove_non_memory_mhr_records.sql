-- ============================================================================
-- READ-ONLY preview for migration 805. Changes nothing.
--
-- "Old" = an mhr_records row with no benchmark_source_key. Every seed that
-- came from the memory/ reference exports stamps that key as
-- "<Category>:<Machine>" (migrations 564-598, 693, 738, 758, 793-797, and
-- 734 which backfilled it for the Injection Molding fleet from 633). Rows
-- without it came from researched/placeholder seeds (365, 393, 407, 409,
-- 445, 465, 466, 491), early Excel imports, or manual HR Rates entries.
-- ============================================================================

-- P1. What would be deleted, grouped by where it came from
SELECT coalesce(machine_class, '(no class)')            AS machine_class,
       coalesce(process_group, commodity_code, '-')     AS grp,
       location,
       coalesce(source_type, '-')                       AS source_type,
       coalesce(user_id::text, 'global')                AS owner,
       count(*)                                         AS rows_to_delete,
       min(created_at)                                  AS oldest,
       max(created_at)                                  AS newest,
       (array_agg(machine_name ORDER BY machine_name))[1:5] AS sample_names
FROM mhr_records
WHERE nullif(trim(benchmark_source_key), '') IS NULL
GROUP BY 1, 2, 3, 4, 5
ORDER BY rows_to_delete DESC;

-- P2. Totals: kept vs deleted
SELECT count(*) FILTER (WHERE nullif(trim(benchmark_source_key), '') IS NULL)     AS rows_to_delete,
       count(*) FILTER (WHERE nullif(trim(benchmark_source_key), '') IS NOT NULL) AS rows_kept
FROM mhr_records;

-- P3. IMPORTANT: machine classes that will have NO machine left in a location.
-- Every line costed on one of these will price that machine at $0 with a
-- "no MHR rate on file" warning until real memory/ data is loaded for it.
SELECT d.machine_class, d.location, count(*) AS rows_deleted
FROM mhr_records d
WHERE nullif(trim(d.benchmark_source_key), '') IS NULL
  AND d.machine_class IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM mhr_records k
    WHERE k.machine_class = d.machine_class
      AND k.location = d.location
      AND nullif(trim(k.benchmark_source_key), '') IS NOT NULL)
GROUP BY 1, 2
ORDER BY 1, 2;

-- P4. Saved process lines whose machine link will be cleared
-- (link to a row being deleted, or already pointing at a row that no longer
-- exists). machine_name and machine_rate on the line are NOT changed.
SELECT CASE WHEN m.id IS NULL THEN 'already orphaned' ELSE 'machine being deleted' END AS reason,
       count(*) AS process_lines
FROM process_cost_records pcr
LEFT JOIN mhr_records m ON m.id::text = pcr.mhr_id::text
WHERE pcr.mhr_id IS NOT NULL
  AND (m.id IS NULL OR nullif(trim(m.benchmark_source_key), '') IS NULL)
GROUP BY 1;

-- P5. Per-part machine overrides that will be removed (they point at a
-- machine being deleted, or one already gone)
SELECT CASE WHEN m.id IS NULL THEN 'already orphaned' ELSE 'machine being deleted' END AS reason,
       count(*) AS overrides
FROM bom_item_machine_overrides o
LEFT JOIN mhr_records m ON m.id::text = o.mhr_record_id::text
WHERE m.id IS NULL OR nullif(trim(m.benchmark_source_key), '') IS NULL
GROUP BY 1;

-- P6. Safety check that must return ZERO rows: Injection Molding fleet rows
-- (real memory/ data from migration 633) still missing their key. If any
-- appear, migration 805 aborts instead of deleting them.
SELECT id, machine_class, location, machine_name
FROM mhr_records
WHERE nullif(trim(benchmark_source_key), '') IS NULL
  AND machine_class IN ('injection_molding', 'compression_molding',
                        'structural_foam_molding', 'reaction_injection_molding');
