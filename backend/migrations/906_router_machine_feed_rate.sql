-- ============================================================================
-- Migration 906: 2-Axis Router feed rate per machine
-- Purpose: Router routes were a data gap ("no linear feed rate on file"). The
--          Countries data export lists feedRate for all 9 router machines
--          (identical in every file that has them); nothing staged it.
-- Source:  memory/Countries data/*_XML_Data_.csv, Machine Type 2 Axis Router:
--          18,000 RPM 78.6; every other machine 76.2.
-- Unit:    the export states none. Taken as mm/s (owner decision 2026-10-14):
--          76.2 mm/s is 4.6 m/min, a normal sheet-routing feed.
-- Not staged: plunge/pierce time (absent from every source), stays a disclosed gap.
-- Read by SheetMetalLookupService.getRouterMachineParams. Run once in the SQL editor.
-- ============================================================================
DO $$
DECLARE
  n INT;
BEGIN
  WITH src(name, feed) AS (VALUES
    ('2 Axis Router - 18,000 RPM', 78.6),
    ('2 Axis Router - 20,000 RPM', 76.2),
    ('2 Axis Router - 24,000 RPM', 76.2),
    ('Multicam 103', 76.2),
    ('Multicam 204', 76.2),
    ('Multicam 304', 76.2),
    ('Stratos Pro', 76.2),
    ('Stratos Pro 24', 76.2),
    ('Stratos Pro XL', 76.2)
  ), ins AS (
    INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw)
    SELECT 'machine', 'USA', '2026-10', 'routerMachine:' || name, NULL, NULL,
           'Router linear feed from the Countries data export, taken as mm/s',
           jsonb_build_object('feed_rate_mm_s', feed)
      FROM src
    ON CONFLICT (category, source_region, source_version, key) DO UPDATE SET raw = EXCLUDED.raw, notes = EXCLUDED.notes
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  IF n <> 9 THEN RAISE EXCEPTION 'Expected 9 routerMachine rows, wrote %', n; END IF;
END $$;
