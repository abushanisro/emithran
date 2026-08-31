-- Diagnostic queries only -- not a migration, doesn't modify data.
-- Purpose: root-cause the 5 real gaps flagged live on part 830-001720-00
-- (Sheet Metal, USA): fiber laser $0 cost, press brake stroke-time gap,
-- PEM press $0, CMM/inspection-bench $0. Each query below targets one
-- specific claim from the UI's own warnings so we know exactly what's
-- missing before writing any fix (sourced data vs. a real code bug).

-- 1) Fiber laser: does USA have ANY fiber_laser-class machine with a real
--    power_kw on file? (CLAUDE.md's own checklist says 3 of 7 USA
--    fiber_laser rows have zero thickness/bed capability data -- this checks
--    whether ALL 7 are actually missing power_kw, or just those 3.)
SELECT machine_name, machine_class, process_group, power_kw,
       max_thickness_mild_steel_mm, max_thickness_stainless_steel_mm, max_thickness_aluminum_mm,
       direct_overhead_rate, indirect_overhead_rate, total_machine_hour_rate, capability_source
FROM mhr_records
WHERE location = 'USA'
  AND (machine_class = 'fiber_laser' OR process_group ILIKE '%laser%' OR machine_name ILIKE '%laser%')
ORDER BY machine_name;

-- 2) sm_lookup_laser_cut: what laser_power_w values actually exist for
--    Carbon Steel / fiber technology (the material this part is costed as --
--    SECC -- normalises to)?
SELECT material, laser_technology, thickness_mm, laser_power_w, cutting_speed_m_per_min, pierce_time_min, kerf_mm
FROM sm_lookup_laser_cut
WHERE material = 'Carbon Steel' AND laser_technology = 'fiber'
ORDER BY thickness_mm, laser_power_w;

-- 3) PEM press: does USA have ANY pem-class machine/benchmark rate on file?
SELECT machine_name, machine_class, process_group, direct_overhead_rate, indirect_overhead_rate, total_machine_hour_rate
FROM mhr_records
WHERE location = 'USA'
  AND (machine_class ILIKE '%pem%' OR machine_name ILIKE '%pem%' OR process_group ILIKE '%pem%');

-- 4) CMM / inspection bench: what inspection-related rows exist for USA?
SELECT machine_name, machine_class, process_group, direct_overhead_rate, indirect_overhead_rate, total_machine_hour_rate
FROM mhr_records
WHERE location = 'USA'
  AND (machine_class ILIKE '%cmm%' OR machine_class ILIKE '%inspect%' OR machine_name ILIKE '%cmm%' OR machine_name ILIKE '%inspection%');

-- 5) Press brake: real spec for the machine the UI selected ("11010
--    (Heller-hydraulic)") -- what's its real tonnage/kN rating, and is
--    111.8t a live column value or a runtime kN->t conversion?
SELECT machine_name, machine_class, max_tonnage, machine_description
FROM mhr_records
WHERE location = 'USA' AND machine_name ILIKE '%11010%';

-- 6) sm_lookup_manual_stroke: full real table contents (all tonnage classes
--    actually seeded, vs. the 111.8T this part's machine needs).
SELECT thickness_mm, tonnage, complexity, stroke_time_sec
FROM sm_lookup_manual_stroke
ORDER BY complexity, tonnage, thickness_mm;
