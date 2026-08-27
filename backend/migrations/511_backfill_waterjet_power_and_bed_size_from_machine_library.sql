-- ============================================================================
-- Migration: Backfill/correct waterjet power_kw and bed size from the
--            Machine Library reference export
-- Purpose: ALL 56 mhr_records waterjet rows have power_kw = NULL (not
--          previously tracked as an open gap in this reconciliation --
--          found only now that real waterjet machine data arrived). Every
--          one of the 27 distinct waterjet machine names in this app's
--          catalog matches EXACTLY (case-insensitive) one of the export's
--          27 "Waterjet Cutting Machine" entries -- a 100% name-match rate,
--          the cleanest cross-reference found all session. power_kw is
--          confirmed UNUSED by any live waterjet costing/selection logic
--          today (grepped machine-selection/selector.ts and
--          waterjet-engine.ts -- no 'waterjet' case reads capability.powerKw
--          at all), so this is purely accurate-catalog-data value, zero
--          risk of changing any existing quote.
--
--          Two real, independent fixes bundled here:
--
--          1. power_kw: pure gap-fill for all 27 matched names (all were
--             NULL). Source: the export's own machine_power_kw field
--             (waterjet has no separate "cutting power" concept the way
--             lasers do -- pump electrical draw IS the meaningful power
--             rating here).
--
--          2. max_x_mm/max_y_mm (bed size): 16 of the 27 matched rows were
--             NULL (pure gap-fill). The other 11 (all 5 "OMAX ..." rows +
--             all 6 "Waterjet Cutter - <W>mm x <H>mm Bed Size" rows) were
--             NOT null -- they all shared the IDENTICAL placeholder value
--             3000.0 x 1500.0 x (100.0 max_thickness_mm), regardless of
--             each row's own distinct real size -- clearly a generic
--             capability default stamped across every row in some earlier
--             bulk seed, not real data. This is an OVERWRITE of an existing
--             (wrong) value, not a gap-fill -- flagged explicitly rather
--             than folded silently into the gap-fill above. Justified two
--             ways at once: (a) for the "Waterjet Cutter - <W>mm x <H>mm
--             Bed Size" family, the bed size is LITERALLY stated in the
--             machine's own name (e.g. "...700mm x 400mm..." currently
--             reads max_x_mm=3000/max_y_mm=1500 in the DB -- self-evidently
--             wrong), and (b) the independent export corroborates the exact
--             same real dimensions for all 11. max_thickness_mm (also
--             100.0 on all 11) is NOT touched -- the export has no
--             thickness-capability field for waterjet machines at all
--             (waterjet has no hard machine thickness ceiling the way
--             laser/press-brake do), so there is no sourced value to
--             correct it to; left as-is, flagged for separate attention.
-- Author: Principal Engineering Team
-- Date: 2026-08-20
-- Version: 1.0.0
-- ============================================================================

-- ── power_kw: gap-fill, all 27 were NULL ────────────────────────────────────
UPDATE mhr_records SET power_kw = 93.21 WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'ESAB Hydrocut LX 6500';
UPDATE mhr_records SET power_kw = 37.3  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Flow Mach 2 1313b';
UPDATE mhr_records SET power_kw = 37.3  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Flow Mach 2 4020b';
UPDATE mhr_records SET power_kw = 37.3  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Flow Mach 3 1313b';
UPDATE mhr_records SET power_kw = 37.3  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Flow Mach 3 7320b';
UPDATE mhr_records SET power_kw = 72.0  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Flow Mach 300 3020';
UPDATE mhr_records SET power_kw = 37.3  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Flow Mach 4 2020c';
UPDATE mhr_records SET power_kw = 72.0  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Flow Mach 4 40140c';
UPDATE mhr_records SET power_kw = 72.0  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Flow Mach 500 4080';
UPDATE mhr_records SET power_kw = 72.0  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Flow Mach 700 50240';
UPDATE mhr_records SET power_kw = 75.0  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'KMT SL-V 100 PLUS';
UPDATE mhr_records SET power_kw = 77.0  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'KMT SL-V E-50';
UPDATE mhr_records SET power_kw = 93.0  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'KMT STREAMLINE PRO 125HP';
UPDATE mhr_records SET power_kw = 29.83 WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Maxiem 0707';
UPDATE mhr_records SET power_kw = 29.83 WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Maxiem 1530';
UPDATE mhr_records SET power_kw = 29.83 WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Maxiem 2040';
UPDATE mhr_records SET power_kw = 29.83 WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'OMAX 2626';
UPDATE mhr_records SET power_kw = 29.83 WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'OMAX 2652';
UPDATE mhr_records SET power_kw = 29.83 WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'OMAX 55100';
UPDATE mhr_records SET power_kw = 29.83 WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'OMAX 60120';
UPDATE mhr_records SET power_kw = 29.83 WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'OMAX 80160';
UPDATE mhr_records SET power_kw = 38.0  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Waterjet Cutter - 1300mm x 1300mm Bed Size';
UPDATE mhr_records SET power_kw = 38.0  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Waterjet Cutter - 14000mm x 4000mm Bed Size';
UPDATE mhr_records SET power_kw = 38.0  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Waterjet Cutter - 2000mm x 1500mm Bed Size';
UPDATE mhr_records SET power_kw = 38.0  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Waterjet Cutter - 3000mm x 1600mm Bed Size';
UPDATE mhr_records SET power_kw = 38.0  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Waterjet Cutter - 7000mm x 2000mm Bed Size';
UPDATE mhr_records SET power_kw = 30.0  WHERE machine_class = 'waterjet' AND power_kw IS NULL AND machine_name = 'Waterjet Cutter - 700mm x 400mm Bed Size';

-- ── bed size: gap-fill for 16 rows that were NULL ───────────────────────────
UPDATE mhr_records SET max_x_mm = 6000.0,  max_y_mm = 5992.0 WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'ESAB Hydrocut LX 6500';
UPDATE mhr_records SET max_x_mm = 1295.4,  max_y_mm = 1295.4 WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'Flow Mach 2 1313b';
UPDATE mhr_records SET max_x_mm = 3987.8,  max_y_mm = 2006.6 WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'Flow Mach 2 4020b';
UPDATE mhr_records SET max_x_mm = 1295.4,  max_y_mm = 1295.4 WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'Flow Mach 3 1313b';
UPDATE mhr_records SET max_x_mm = 7289.8,  max_y_mm = 2006.6 WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'Flow Mach 3 7320b';
UPDATE mhr_records SET max_x_mm = 3000.0,  max_y_mm = 1500.0 WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'Flow Mach 300 3020';
UPDATE mhr_records SET max_x_mm = 2006.6,  max_y_mm = 2006.6 WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'Flow Mach 4 2020c';
UPDATE mhr_records SET max_x_mm = 13995.4, max_y_mm = 3987.8 WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'Flow Mach 4 40140c';
UPDATE mhr_records SET max_x_mm = 8000.0,  max_y_mm = 4000.0 WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'Flow Mach 500 4080';
UPDATE mhr_records SET max_x_mm = 24000.0, max_y_mm = 5000.0 WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'Flow Mach 700 50240';
UPDATE mhr_records SET max_x_mm = 2000.0,  max_y_mm = 914.0  WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'KMT SL-V 100 PLUS';
UPDATE mhr_records SET max_x_mm = 1727.0,  max_y_mm = 914.0  WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'KMT SL-V E-50';
UPDATE mhr_records SET max_x_mm = 2230.0,  max_y_mm = 1500.0 WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'KMT STREAMLINE PRO 125HP';
UPDATE mhr_records SET max_x_mm = 762.0,   max_y_mm = 762.0  WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'Maxiem 0707';
UPDATE mhr_records SET max_x_mm = 3100.0,  max_y_mm = 1575.0 WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'Maxiem 1530';
UPDATE mhr_records SET max_x_mm = 4064.0,  max_y_mm = 2006.6 WHERE machine_class = 'waterjet' AND max_x_mm IS NULL AND machine_name = 'Maxiem 2040';

-- ── bed size: CORRECTION -- overwrites an existing, shared, wrong 3000x1500
--    placeholder that ignored each row's own real (and, for the "Waterjet
--    Cutter" family, name-stated) size. See header for justification.
UPDATE mhr_records SET max_x_mm = 660.0,   max_y_mm = 373.0  WHERE machine_class = 'waterjet' AND max_x_mm = 3000.0 AND max_y_mm = 1500.0 AND machine_name = 'OMAX 2626';
UPDATE mhr_records SET max_x_mm = 1321.0,  max_y_mm = 660.0  WHERE machine_class = 'waterjet' AND max_x_mm = 3000.0 AND max_y_mm = 1500.0 AND machine_name = 'OMAX 2652';
UPDATE mhr_records SET max_x_mm = 2540.0,  max_y_mm = 1397.0 WHERE machine_class = 'waterjet' AND max_x_mm = 3000.0 AND max_y_mm = 1500.0 AND machine_name = 'OMAX 55100';
UPDATE mhr_records SET max_x_mm = 3200.0,  max_y_mm = 1575.0 WHERE machine_class = 'waterjet' AND max_x_mm = 3000.0 AND max_y_mm = 1500.0 AND machine_name = 'OMAX 60120';
UPDATE mhr_records SET max_x_mm = 4267.0,  max_y_mm = 2030.0 WHERE machine_class = 'waterjet' AND max_x_mm = 3000.0 AND max_y_mm = 1500.0 AND machine_name = 'OMAX 80160';
UPDATE mhr_records SET max_x_mm = 1300.0,  max_y_mm = 1300.0 WHERE machine_class = 'waterjet' AND max_x_mm = 3000.0 AND max_y_mm = 1500.0 AND machine_name = 'Waterjet Cutter - 1300mm x 1300mm Bed Size';
UPDATE mhr_records SET max_x_mm = 14000.0, max_y_mm = 4000.0 WHERE machine_class = 'waterjet' AND max_x_mm = 3000.0 AND max_y_mm = 1500.0 AND machine_name = 'Waterjet Cutter - 14000mm x 4000mm Bed Size';
UPDATE mhr_records SET max_x_mm = 2000.0,  max_y_mm = 1500.0 WHERE machine_class = 'waterjet' AND max_x_mm = 3000.0 AND max_y_mm = 1500.0 AND machine_name = 'Waterjet Cutter - 2000mm x 1500mm Bed Size';
UPDATE mhr_records SET max_x_mm = 3000.0,  max_y_mm = 1600.0 WHERE machine_class = 'waterjet' AND max_x_mm = 3000.0 AND max_y_mm = 1500.0 AND machine_name = 'Waterjet Cutter - 3000mm x 1600mm Bed Size';
UPDATE mhr_records SET max_x_mm = 7000.0,  max_y_mm = 2000.0 WHERE machine_class = 'waterjet' AND max_x_mm = 3000.0 AND max_y_mm = 1500.0 AND machine_name = 'Waterjet Cutter - 7000mm x 2000mm Bed Size';
UPDATE mhr_records SET max_x_mm = 700.0,   max_y_mm = 400.0  WHERE machine_class = 'waterjet' AND max_x_mm = 3000.0 AND max_y_mm = 1500.0 AND machine_name = 'Waterjet Cutter - 700mm x 400mm Bed Size';
