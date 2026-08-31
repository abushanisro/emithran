-- Diagnostic query only — not a migration, doesn't modify data.
-- Purpose: determine whether Aida UMX-600/Aida UMX-800 (real Progressive Die
-- Press machines) showing up as Press Brake candidates is caused by:
--   (a) mhr_records.machine_class literally storing the canonical string
--       'press_brake' for these rows (a data problem — classifyMachineRecord's
--       Tier 0 trusts this directly and never runs keyword matching at all,
--       so the code fix to press_brake's MACHINE_REGISTRY keywords would be
--       irrelevant here), or
--   (b) machine_class stores something else (e.g. 'Progressive Die Press')
--       and Tier 2 keyword matching is still misclassifying it (meaning the
--       code fix should have resolved it, and this is a stale-server issue
--       instead).
-- Also pulls the real bend brake ('11010 (Heller-hydraulic)') for comparison.

SELECT id, machine_name, machine_class, process_group, commodity_code, location,
       direct_overhead_rate, indirect_overhead_rate, total_machine_hour_rate
FROM mhr_records
WHERE machine_name IN ('Aida UMX-600', 'Aida UMX-800', '11010 (Heller-hydraulic)')
  AND location = 'USA'
ORDER BY machine_name;
