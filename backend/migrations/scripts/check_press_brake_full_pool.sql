-- Diagnostic query only — not a migration, doesn't modify data.
-- Purpose: get the COMPLETE list of every mhr_records row currently tagged
-- machine_class='press_brake' for USA, so we can see exactly which real
-- bend-brake machines belong there vs. which Press/Forming-family machines
-- (Progressive Die Press, Standard Press, Tandem Press, Turret Press —
-- CLAUDE.md's own documented "unwired placeholders") were mis-tagged into
-- this class, corrupting the real, live Bend Brake candidate pool.
-- Real Bend Press Brake category names (from machine_library.json), for
-- reference while eyeballing the result: 11010/15010/18510 (Heller-
-- hydraulic), Autobrake 2000 Model AB1016 (Roper Whitney), Bend Brake -
-- 800/1500/2500kN Press Force, Default Bend Brake, FBD1253-NT (Amada-
-- Upacting), HFE2204 (Amada- DownActing), HG-1303/2204/5020/8025 (Amada),
-- SPH-30C/60C (Amada).

SELECT id, machine_name, machine_class, process_group, total_machine_hour_rate,
       direct_overhead_rate, indirect_overhead_rate, created_at
FROM mhr_records
WHERE machine_class = 'press_brake'
  AND location = 'USA'
ORDER BY machine_name;
