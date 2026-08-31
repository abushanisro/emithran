-- Diagnostic only -- not a migration, doesn't modify data.
-- Purpose: determine whether migration 360 already comprehensively seeded
-- sm_lookup_laser_cut from the same source table migration 609 was about to
-- re-seed, before writing/running anything that might be redundant.

SELECT material, laser_technology, count(*) AS rows,
       min(laser_power_w) AS min_power_w, max(laser_power_w) AS max_power_w,
       min(thickness_mm) AS min_thickness_mm, max(thickness_mm) AS max_thickness_mm
FROM sm_lookup_laser_cut
GROUP BY material, laser_technology
ORDER BY material, laser_technology;
