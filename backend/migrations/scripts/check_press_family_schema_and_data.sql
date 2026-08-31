-- Diagnostic queries only -- not a migration, doesn't modify data.
-- Purpose: before building a Press family (Progressive Die/Tandem/Standard
-- Press) cost engine, confirm (a) whether mhr_records already has columns
-- for the real per-machine physics data migration 585 staged in
-- sm_reference_data.raw but never promoted (press_cycle_time_s,
-- press_force_kn, max_part_length_mm, max_part_width_mm,
-- const_coeff_handling_time, mass_coeff_handling_time_s_kg), and (b) the
-- current machine_class / process_route / operation state for the 35 real
-- press-family machines (shared across Progressive Die/Tandem/Standard
-- Press categories per machine_library.json).

-- 1) Does mhr_records have these columns already?
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'mhr_records'
  AND column_name IN (
    'press_cycle_time_s', 'press_force_kn', 'max_part_length_mm', 'max_part_width_mm',
    'const_coeff_handling_time', 'mass_coeff_handling_time_s_kg', 'max_tonnage'
  );

-- 2) Current state of all 35 real press-family machines in USA: machine_class,
--    process_route/operation, and whether the physics columns above (if they
--    exist) are already populated.
SELECT machine_name, machine_class, process_route, operation,
       direct_overhead_rate, indirect_overhead_rate, total_machine_hour_rate,
       benchmark_source_key
FROM mhr_records
WHERE location = 'USA'
  AND machine_name IN (
    'Aida SMX-0-L2-3000','Aida SMX-0-L2-4000','Aida SMX-0-L2-5000','Aida SMX-0-L2-6000',
    'Aida UMX-1100','Aida UMX-600','Aida UMX-800',
    'Bliss - B-35','Default Press','Niagara - E511B',
    'Progressive Die Press - 1,500kN Press Force','Progressive Die Press - 10,000kN Press Force',
    'Progressive Die Press - 3,000kN Press Force','Progressive Die Press - 5,000kN Press Force',
    'Progressive Die Press - 7,000kN Press Force',
    'STD_PRESS_17 (name unknown)',
    'Schuler 1150 Ton','Schuler A2/200 - 360','Schuler TSD 2000',
    'Standard Press - 1,500kN Press Force','Standard Press - 3,000kN Press Force',
    'Standard Press - 5,000kN Press Force','Standard Press - 7,000kN Press Force',
    'Tandem Press - 1,500kN Press Force','Tandem Press - 3,000kN Press Force',
    'Tandem Press - 5,000kN Press Force','Tandem Press - 7,000kN Press Force',
    'United Power SHD-220 Ton','United Power SHD-400 Ton','United Power SHD-666 Ton',
    'United Power SHS-166 Ton','United Power SHS-666 Ton',
    'United Power THD-137 High Speed','United Power THD-333 High Speed','United Power THD-66 High Speed'
  )
ORDER BY machine_name;

-- 3) process_calculator_mappings state for the 3 named operations (identity
--    already linked per migrations 572/585, but confirm is_active/machine_class
--    live state before deciding what this migration needs to flip).
SELECT id, operation, process_route, machine_class, is_active
FROM process_calculator_mappings
WHERE operation IN ('Progressive Die Press', 'Tandem Press', 'Std Press')
ORDER BY operation;

-- 4) sm_reference_data.raw -- confirm the real per-machine physics fields are
--    still there and intact for a couple of sample rows (sanity check before
--    writing a promotion query against this JSON shape).
SELECT key, raw->>'press_cycle_time_s' AS press_cycle_time_s,
       raw->>'press_force_kn' AS press_force_kn,
       raw->>'max_part_length_mm' AS max_part_length_mm,
       raw->>'max_part_width_mm' AS max_part_width_mm,
       raw->>'const_coeff_handling_time' AS const_coeff_handling_time,
       raw->>'mass_coeff_handling_time_s_kg' AS mass_coeff_handling_time_s_kg
FROM sm_reference_data
WHERE category = 'machine'
  AND (key LIKE 'Standard Press:%' OR key LIKE 'Progressive Die Press:%' OR key LIKE 'Tandem Press:%')
ORDER BY key
LIMIT 10;
