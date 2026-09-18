-- ============================================================================
-- Migration 753: Self-contained upsert of all 43 real Machining
-- process_taxonomy + process_calculator_mappings rows, superseding
-- reliance on migration 691/752 having previously run
--
-- Migration 752 only UPDATEd rows migration 691 was supposed to have
-- seeded. The Process Calculator Mappings page still showed zero
-- Machining rows after 752 was run, which means 691 (or the 752 update
-- against it) never actually took effect against the live DB -- most
-- likely 691 itself was never run, so 752's UPDATEs matched zero rows.
-- Rather than chase migration history further, this migration INSERTs
-- the same real data 691 sourced from memory/machining/processes.json
-- directly with ON CONFLICT DO UPDATE, so it reaches the correct end
-- state whether or not 691/752 ever ran, and is safe to re-run.
--
-- Same two-tier real-data discipline as migration 752 (see its own header
-- for the full rationale): 7 rows aliased to an existing coarse cnc_*
-- pricing bucket (roadmap_status='production', matches
-- selector.ts's MACHINING_CATEGORY_ALIAS), 31 rows get their own real
-- station-specific machine_class with roadmap_status='thin' (real HR-rate
-- data, catalog-visible, no dedicated per-station cost engine yet), and
-- the 5 genuinely gapped stations (Jig Bore, Shaver, No Cost Feature,
-- Perimeter Cut, Use Stock Machining -- no source machine data anywhere
-- in memory/machining/) stay inactive/not_modeled, machine_class NULL.
--
-- Does NOT touch process_taxonomy_operations (691's other 1174-row
-- insert) -- that table isn't read by the Process Calculator Mappings
-- page this migration targets; revisit separately if it's also empty.
-- ============================================================================

BEGIN;

INSERT INTO process_taxonomy (process_group, process_name, machine_class, roadmap_status, default_machine_name, default_tool_shop_name)
VALUES
  ('Machining', $str$2 Axis Bar Feed Lathe with Sub Spindle$str$, $str$cnc_lathe_live$str$, 'production', $str$Haas DS-30 with BAR3010SS Feeder$str$, NULL),
  ('Machining', $str$2 Axis Lathe$str$, $str$cnc_lathe$str$, 'production', $str$Acra 2800 CET$str$, NULL),
  ('Machining', $str$3 Axis Bar Feed Lathe with Sub Spindle$str$, $str$cnc_lathe_live$str$, 'production', $str$Haas DS-30SSY with BAR3010SS Feeder$str$, NULL),
  ('Machining', $str$3 Axis Lathe$str$, $str$cnc_lathe$str$, 'production', $str$Boehringer VDF 400$str$, NULL),
  ('Machining', $str$3 Axis Mill$str$, $str$cnc_3ax_vmc$str$, 'production', $str$Giddings & Lewis H60F$str$, NULL),
  ('Machining', $str$3 Axis Router$str$, $str$3_axis_router$str$, 'thin', $str$Multicam 7000 Series CNC Router, Model 103$str$, NULL),
  ('Machining', $str$4 Axis Mill$str$, $str$cnc_4ax_vmc$str$, 'production', $str$Giddings & Lewis H60F w Rotary Table$str$, NULL),
  ('Machining', $str$5 Axis Mill$str$, $str$cnc_5ax_mc$str$, 'production', $str$DMG MORI DMU 105 monoBLOCK$str$, NULL),
  ('Machining', $str$5 Axis Router$str$, $str$5_axis_router$str$, 'thin', $str$Thermwood Multipurpose 67, 5' x 10'$str$, NULL),
  ('Machining', $str$Automated Deburr$str$, $str$automated_deburr$str$, 'thin', $str$Default Automated Deburr$str$, NULL),
  ('Machining', $str$Bench Operation$str$, $str$manual_bench_cell$str$, 'thin', $str$Manual Bench Cell - 16m x 4m Footprint$str$, $str$Default$str$),
  ('Machining', $str$Bevel Gear Cutting Machine$str$, $str$bevel_gear_cutting_machine$str$, 'thin', $str$Gleason Coniflex 104$str$, $str$Bevel Gear Cutting Machine$str$),
  ('Machining', $str$Broach$str$, $str$broach$str$, 'thin', $str$Cell-Mate$str$, $str$Broach$str$),
  ('Machining', $str$Cylindrical Grinder$str$, $str$cylindrical_grinder$str$, 'thin', $str$Flex Grind Schaudt M$str$, NULL),
  ('Machining', $str$Deep Bore Machine$str$, $str$deep_bore_machine$str$, 'thin', $str$Fortune 2225$str$, NULL),
  ('Machining', $str$DeMask$str$, $str$demask$str$, 'thin', $str$DeMask Cell - 10m x 10m Footprint$str$, NULL),
  ('Machining', $str$Drill Press$str$, $str$cnc_drill_press$str$, 'thin', $str$Carlton 5 ft X 13 in$str$, NULL),
  ('Machining', $str$Etch Cell$str$, $str$etch_cell$str$, 'thin', $str$Etch Cell - 1.8m x 1.0m x 1.2m Tank Size$str$, NULL),
  ('Machining', $str$Gun Drill$str$, $str$gun_drill$str$, 'thin', $str$Honge XE 1200-CNC$str$, NULL),
  ('Machining', $str$Hob Machine$str$, $str$hob_machine$str$, 'thin', $str$Gleason Genesis 130H Vertical$str$, $str$Hob Machine$str$),
  ('Machining', $str$Inspection$str$, $str$machining_inspection$str$, 'thin', $str$Default$str$, NULL),
  ('Machining', $str$Internal Grinder$str$, $str$internal_grinder$str$, 'thin', $str$Danobat Overbeck IC/iD$str$, NULL),
  ('Machining', $str$Jig Bore$str$, NULL, 'not_modeled', $str$SIP Hydroptic 6A$str$, NULL),
  ('Machining', $str$Jig Grind$str$, $str$jig_grind$str$, 'thin', $str$Hauser S3-DR$str$, NULL),
  ('Machining', $str$Manual Deburr$str$, $str$manual_deburr$str$, 'thin', $str$Default Manual Deburr$str$, NULL),
  ('Machining', $str$Mask Cure$str$, $str$mask_cure$str$, 'thin', $str$Curing Oven - 1.3m x 1.3m x 1.4m Useable Oven Size$str$, NULL),
  ('Machining', $str$MillTurn$str$, $str$machining_millturn$str$, 'thin', $str$GILDEMEISTER GMX 400 LINEAR$str$, NULL),
  ('Machining', $str$No Cost Feature$str$, NULL, 'not_modeled', NULL, NULL),
  ('Machining', $str$Perimeter Cut$str$, NULL, 'not_modeled', NULL, NULL),
  ('Machining', $str$Profile Gear Grinder$str$, $str$profile_gear_grinder$str$, 'thin', $str$Gleason P 2400 G$str$, $str$Profile Gear Grinder$str$),
  ('Machining', $str$Reciprocating Surface Grinder$str$, $str$reciprocating_surface_grinder$str$, 'thin', $str$Danobat RTU$str$, NULL),
  ('Machining', $str$Rotary Surface Grinder$str$, $str$rotary_surface_grinder$str$, 'thin', $str$ABA Z&B MR$str$, NULL),
  ('Machining', $str$Scribe$str$, $str$scribe$str$, 'thin', $str$Gantry Laser Scribe - 15m x 4m x 1.5m Bed Size$str$, NULL),
  ('Machining', $str$Shaper$str$, $str$shaper$str$, 'thin', $str$Gleason 800ES Shaper$str$, $str$Shaper$str$),
  ('Machining', $str$Shaver$str$, NULL, 'not_modeled', $str$Gleason Genesis 130 SV$str$, $str$Shaver$str$),
  ('Machining', $str$Simultaneous Turning$str$, $str$simultaneous_turning$str$, 'thin', $str$Virtual CNC Multi-Spindle, 6 Spindles, Large$str$, NULL),
  ('Machining', $str$Special Inspection$str$, $str$special_inspection$str$, 'thin', $str$Default$str$, NULL),
  ('Machining', $str$Spline Roller$str$, $str$spline_roller$str$, 'thin', $str$Yieh Chen YC-800$str$, $str$Spline Roller$str$),
  ('Machining', $str$Stock Prep Lathe$str$, $str$stock_prep_lathe$str$, 'thin', $str$Acra 2800 CET$str$, NULL),
  ('Machining', $str$Stock Prep Mill$str$, $str$stock_prep_mill$str$, 'thin', $str$Giddings & Lewis H60F$str$, NULL),
  ('Machining', $str$Threaded Wheel Gear Grinder$str$, $str$threaded_wheel_gear_grinder$str$, 'thin', $str$Gleason 300 TWG$str$, $str$Threaded Wheel Gear Grinder$str$),
  ('Machining', $str$Use Stock Machining$str$, NULL, 'not_modeled', NULL, NULL),
  ('Machining', $str$Wire EDM$str$, $str$wire_edm$str$, 'thin', $str$Fanuc 0id$str$, NULL)
ON CONFLICT (process_group, process_name) DO UPDATE
SET machine_class = EXCLUDED.machine_class,
    roadmap_status = EXCLUDED.roadmap_status;

INSERT INTO process_calculator_mappings (process_group, process_route, operation, calculator_id, calculator_name, is_active, display_order, machine_class, canonical_process_id)
SELECT 'Machining', v.station, v.station, NULL, NULL, v.is_active, v.display_order, v.machine_class, pt.id
FROM process_taxonomy pt
JOIN (VALUES
    ($str$2 Axis Bar Feed Lathe with Sub Spindle$str$, true, 600, $str$cnc_lathe_live$str$),
  ($str$2 Axis Lathe$str$, true, 601, $str$cnc_lathe$str$),
  ($str$3 Axis Bar Feed Lathe with Sub Spindle$str$, true, 602, $str$cnc_lathe_live$str$),
  ($str$3 Axis Lathe$str$, true, 603, $str$cnc_lathe$str$),
  ($str$3 Axis Mill$str$, true, 604, $str$cnc_3ax_vmc$str$),
  ($str$3 Axis Router$str$, true, 605, $str$3_axis_router$str$),
  ($str$4 Axis Mill$str$, true, 606, $str$cnc_4ax_vmc$str$),
  ($str$5 Axis Mill$str$, true, 607, $str$cnc_5ax_mc$str$),
  ($str$5 Axis Router$str$, true, 608, $str$5_axis_router$str$),
  ($str$Automated Deburr$str$, true, 609, $str$automated_deburr$str$),
  ($str$Bench Operation$str$, true, 610, $str$manual_bench_cell$str$),
  ($str$Bevel Gear Cutting Machine$str$, true, 611, $str$bevel_gear_cutting_machine$str$),
  ($str$Broach$str$, true, 612, $str$broach$str$),
  ($str$Cylindrical Grinder$str$, true, 613, $str$cylindrical_grinder$str$),
  ($str$Deep Bore Machine$str$, true, 614, $str$deep_bore_machine$str$),
  ($str$DeMask$str$, true, 615, $str$demask$str$),
  ($str$Drill Press$str$, true, 616, $str$cnc_drill_press$str$),
  ($str$Etch Cell$str$, true, 617, $str$etch_cell$str$),
  ($str$Gun Drill$str$, true, 618, $str$gun_drill$str$),
  ($str$Hob Machine$str$, true, 619, $str$hob_machine$str$),
  ($str$Inspection$str$, true, 620, $str$machining_inspection$str$),
  ($str$Internal Grinder$str$, true, 621, $str$internal_grinder$str$),
  ($str$Jig Bore$str$, false, 622, NULL),
  ($str$Jig Grind$str$, true, 623, $str$jig_grind$str$),
  ($str$Manual Deburr$str$, true, 624, $str$manual_deburr$str$),
  ($str$Mask Cure$str$, true, 625, $str$mask_cure$str$),
  ($str$MillTurn$str$, true, 626, $str$machining_millturn$str$),
  ($str$No Cost Feature$str$, false, 627, NULL),
  ($str$Perimeter Cut$str$, false, 628, NULL),
  ($str$Profile Gear Grinder$str$, true, 629, $str$profile_gear_grinder$str$),
  ($str$Reciprocating Surface Grinder$str$, true, 630, $str$reciprocating_surface_grinder$str$),
  ($str$Rotary Surface Grinder$str$, true, 631, $str$rotary_surface_grinder$str$),
  ($str$Scribe$str$, true, 632, $str$scribe$str$),
  ($str$Shaper$str$, true, 633, $str$shaper$str$),
  ($str$Shaver$str$, false, 634, NULL),
  ($str$Simultaneous Turning$str$, true, 635, $str$simultaneous_turning$str$),
  ($str$Special Inspection$str$, true, 636, $str$special_inspection$str$),
  ($str$Spline Roller$str$, true, 637, $str$spline_roller$str$),
  ($str$Stock Prep Lathe$str$, true, 638, $str$stock_prep_lathe$str$),
  ($str$Stock Prep Mill$str$, true, 639, $str$stock_prep_mill$str$),
  ($str$Threaded Wheel Gear Grinder$str$, true, 640, $str$threaded_wheel_gear_grinder$str$),
  ($str$Use Stock Machining$str$, false, 641, NULL),
  ($str$Wire EDM$str$, true, 642, $str$wire_edm$str$)
) AS v(station, is_active, display_order, machine_class)
  ON pt.process_group = 'Machining' AND pt.process_name = v.station
ON CONFLICT (process_group, process_route, operation) DO UPDATE
SET machine_class = EXCLUDED.machine_class,
    is_active = EXCLUDED.is_active,
    canonical_process_id = EXCLUDED.canonical_process_id;

COMMIT;

-- ── Verification (run manually after) ───────────────────────────────────────
-- SELECT count(*) FROM process_taxonomy WHERE process_group = 'Machining';
-- -- Expect: 43
-- SELECT count(*) FROM process_calculator_mappings WHERE process_group = 'Machining' AND is_active = true;
-- -- Expect: 38

NOTIFY pgrst, 'reload schema';
