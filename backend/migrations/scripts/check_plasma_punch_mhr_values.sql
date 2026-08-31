-- Diagnostic query only — not a migration, doesn't modify data.
-- Purpose: migration 584's own text says total_machine_hour_rate/
-- manual_mhr_value should be NULL for Plasma Punch (no direct/indirect
-- overhead in the source), yet the HR Rates page shows a real dollar value
-- ("$10.26ref") for these rows, not a bare dash. Need the exact live column
-- values to know what's actually populating that number before touching
-- anything.

SELECT machine_name, direct_overhead_rate, indirect_overhead_rate,
       total_machine_hour_rate, manual_mhr_value, mhr_usd_per_hour,
       calculated_mhr_usd_hr, mhr_source, benchmark_source_key, location
FROM mhr_records
WHERE machine_name IN ('Whitney 4400 Max', 'Whitney 3700 SST', 'Ermak COP 1270 X 30')
ORDER BY machine_name, location;
