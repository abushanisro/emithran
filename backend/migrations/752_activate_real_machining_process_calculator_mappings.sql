-- ============================================================================
-- Migration 752: Activate the 38 real Machining process_taxonomy /
-- process_calculator_mappings rows that migration 691 seeded but left
-- is_active=false, machine_class=NULL
--
-- Migration 691 seeded all 43 real Machining station-name rows
-- (memory/machining/processes.json) but could not activate any of them:
-- at that time Machining had ZERO real mhr_records machine data, so every
-- row would have needed a fabricated machine_class to satisfy
-- chk_machine_class_required (migration 369/617) -- 691 correctly refused
-- to invent one and left every row disclosed as inactive/not_modeled
-- instead.
--
-- That is no longer true. This session loaded real mhr_records data for
-- 38 of the 43 stations (12 via migration 692/693, 26 via migration 738)
-- and fixed live machine selection for 7 of those 38 to route through the
-- cost engine's existing coarse cnc_* buckets (migration to
-- selector.ts's MACHINING_CATEGORY_ALIAS, same session). Every value set
-- below is real, already-verified data -- not a guess to satisfy the
-- constraint.
--
-- Two tiers, both is_active=true:
--   'production' (7 rows) -- machine_class is the ALIASED canonical class
--     (cnc_lathe / cnc_lathe_live / cnc_3ax_vmc / cnc_4ax_vmc / cnc_5ax_mc)
--     that MACHINING_CATEGORY_ALIAS now resolves the real machine to at
--     selection time -- this MUST be the canonical value, not the raw
--     mhr_records.machine_class string, because resolveProcessIdentities()
--     (bom-items.service.ts) matches against mhrRate.machineClass, which
--     IS classifyMachineRecord()'s return value. Two pairs of stations
--     share one canonical class each (2/3 Axis Lathe -> cnc_lathe; the two
--     "...with Sub Spindle" variants -> cnc_lathe_live) -- real machine
--     selection/pricing for both is correct either way (the pool includes
--     every real machine under that class), but resolveProcessIdentities'
--     own "several active routes -> lowest display_order wins absent a
--     family match" rule means only one of each pair's row supplies the
--     displayed process identity label. Disclosed, not a costing bug.
--   'thin' (31 rows) -- machine_class is the station's OWN real value from
--     mhr_records/migration 738 (e.g. 'broach', 'cylindrical_grinder').
--     These have real HR-rate data and now show correctly in the catalog,
--     but classifyMachineRecord() has no alias/keyword route to any of
--     these 31 values (no dedicated cost engine exists per-station the
--     way Sheet Metal's secondary ops each got their own registered
--     engine) -- so a live quote's mhrRate.machineClass will never equal
--     one of these values today, and these rows will not currently be
--     matched by resolveProcessIdentities. Catalog-completeness activation,
--     not a claim that all 31 are wired into live per-part costing.
--
-- The remaining 5 of the real 43 stations (Jig Bore, Shaver, No Cost
-- Feature, Perimeter Cut, Use Stock Machining) are untouched -- genuinely
-- no source machine data anywhere in memory/machining/ (disclosed gap,
-- migration 737/738's own header). 'No Cost Feature'/'Perimeter Cut' also
-- do not qualify for the 'Material Usage' non-machine exemption (migration
-- 617) since Machining's rows use process_route = station name, not
-- 'Material Usage' the way Sheet Metal's do.
-- ============================================================================

BEGIN;

-- ── Tier 1: aliased into an existing coarse cnc_* pricing bucket ───────────
WITH aliased(station, machine_class) AS (
  VALUES
    ($str$2 Axis Bar Feed Lathe with Sub Spindle$str$, $str$cnc_lathe_live$str$),
    ($str$2 Axis Lathe$str$,                           $str$cnc_lathe$str$),
    ($str$3 Axis Bar Feed Lathe with Sub Spindle$str$, $str$cnc_lathe_live$str$),
    ($str$3 Axis Lathe$str$,                           $str$cnc_lathe$str$),
    ($str$3 Axis Mill$str$,                             $str$cnc_3ax_vmc$str$),
    ($str$4 Axis Mill$str$,                             $str$cnc_4ax_vmc$str$),
    ($str$5 Axis Mill$str$,                             $str$cnc_5ax_mc$str$)
)
UPDATE process_taxonomy pt
SET machine_class = a.machine_class, roadmap_status = 'production'
FROM aliased a
WHERE pt.process_group = 'Machining' AND pt.process_name = a.station;

WITH aliased(station, machine_class) AS (
  VALUES
    ($str$2 Axis Bar Feed Lathe with Sub Spindle$str$, $str$cnc_lathe_live$str$),
    ($str$2 Axis Lathe$str$,                           $str$cnc_lathe$str$),
    ($str$3 Axis Bar Feed Lathe with Sub Spindle$str$, $str$cnc_lathe_live$str$),
    ($str$3 Axis Lathe$str$,                           $str$cnc_lathe$str$),
    ($str$3 Axis Mill$str$,                             $str$cnc_3ax_vmc$str$),
    ($str$4 Axis Mill$str$,                             $str$cnc_4ax_vmc$str$),
    ($str$5 Axis Mill$str$,                             $str$cnc_5ax_mc$str$)
)
UPDATE process_calculator_mappings pcm
SET machine_class = a.machine_class, is_active = true
FROM aliased a
WHERE pcm.process_group = 'Machining' AND pcm.process_route = a.station;

-- ── Tier 2: real machine_class, no dedicated cost engine yet (catalog-complete, 'thin') ──
WITH thin(station, machine_class) AS (
  VALUES
    ($str$3 Axis Router$str$,                    $str$3_axis_router$str$),
    ($str$5 Axis Router$str$,                    $str$5_axis_router$str$),
    ($str$Automated Deburr$str$,                 $str$automated_deburr$str$),
    ($str$Bench Operation$str$,                  $str$manual_bench_cell$str$),
    ($str$Bevel Gear Cutting Machine$str$,       $str$bevel_gear_cutting_machine$str$),
    ($str$Broach$str$,                           $str$broach$str$),
    ($str$Cylindrical Grinder$str$,               $str$cylindrical_grinder$str$),
    ($str$Deep Bore Machine$str$,                 $str$deep_bore_machine$str$),
    ($str$DeMask$str$,                            $str$demask$str$),
    ($str$Drill Press$str$,                       $str$cnc_drill_press$str$),
    ($str$Etch Cell$str$,                         $str$etch_cell$str$),
    ($str$Gun Drill$str$,                         $str$gun_drill$str$),
    ($str$Hob Machine$str$,                       $str$hob_machine$str$),
    ($str$Inspection$str$,                        $str$machining_inspection$str$),
    ($str$Internal Grinder$str$,                  $str$internal_grinder$str$),
    ($str$Jig Grind$str$,                         $str$jig_grind$str$),
    ($str$Manual Deburr$str$,                     $str$manual_deburr$str$),
    ($str$Mask Cure$str$,                         $str$mask_cure$str$),
    ($str$MillTurn$str$,                          $str$machining_millturn$str$),
    ($str$Profile Gear Grinder$str$,              $str$profile_gear_grinder$str$),
    ($str$Reciprocating Surface Grinder$str$,     $str$reciprocating_surface_grinder$str$),
    ($str$Rotary Surface Grinder$str$,            $str$rotary_surface_grinder$str$),
    ($str$Scribe$str$,                            $str$scribe$str$),
    ($str$Shaper$str$,                            $str$shaper$str$),
    ($str$Simultaneous Turning$str$,              $str$simultaneous_turning$str$),
    ($str$Special Inspection$str$,                $str$special_inspection$str$),
    ($str$Spline Roller$str$,                     $str$spline_roller$str$),
    ($str$Stock Prep Lathe$str$,                  $str$stock_prep_lathe$str$),
    ($str$Stock Prep Mill$str$,                   $str$stock_prep_mill$str$),
    ($str$Threaded Wheel Gear Grinder$str$,       $str$threaded_wheel_gear_grinder$str$),
    ($str$Wire EDM$str$,                          $str$wire_edm$str$)
)
UPDATE process_taxonomy pt
SET machine_class = t.machine_class, roadmap_status = 'thin'
FROM thin t
WHERE pt.process_group = 'Machining' AND pt.process_name = t.station;

WITH thin(station, machine_class) AS (
  VALUES
    ($str$3 Axis Router$str$,                    $str$3_axis_router$str$),
    ($str$5 Axis Router$str$,                    $str$5_axis_router$str$),
    ($str$Automated Deburr$str$,                 $str$automated_deburr$str$),
    ($str$Bench Operation$str$,                  $str$manual_bench_cell$str$),
    ($str$Bevel Gear Cutting Machine$str$,       $str$bevel_gear_cutting_machine$str$),
    ($str$Broach$str$,                           $str$broach$str$),
    ($str$Cylindrical Grinder$str$,               $str$cylindrical_grinder$str$),
    ($str$Deep Bore Machine$str$,                 $str$deep_bore_machine$str$),
    ($str$DeMask$str$,                            $str$demask$str$),
    ($str$Drill Press$str$,                       $str$cnc_drill_press$str$),
    ($str$Etch Cell$str$,                         $str$etch_cell$str$),
    ($str$Gun Drill$str$,                         $str$gun_drill$str$),
    ($str$Hob Machine$str$,                       $str$hob_machine$str$),
    ($str$Inspection$str$,                        $str$machining_inspection$str$),
    ($str$Internal Grinder$str$,                  $str$internal_grinder$str$),
    ($str$Jig Grind$str$,                         $str$jig_grind$str$),
    ($str$Manual Deburr$str$,                     $str$manual_deburr$str$),
    ($str$Mask Cure$str$,                         $str$mask_cure$str$),
    ($str$MillTurn$str$,                          $str$machining_millturn$str$),
    ($str$Profile Gear Grinder$str$,              $str$profile_gear_grinder$str$),
    ($str$Reciprocating Surface Grinder$str$,     $str$reciprocating_surface_grinder$str$),
    ($str$Rotary Surface Grinder$str$,            $str$rotary_surface_grinder$str$),
    ($str$Scribe$str$,                            $str$scribe$str$),
    ($str$Shaper$str$,                            $str$shaper$str$),
    ($str$Simultaneous Turning$str$,              $str$simultaneous_turning$str$),
    ($str$Special Inspection$str$,                $str$special_inspection$str$),
    ($str$Spline Roller$str$,                     $str$spline_roller$str$),
    ($str$Stock Prep Lathe$str$,                  $str$stock_prep_lathe$str$),
    ($str$Stock Prep Mill$str$,                   $str$stock_prep_mill$str$),
    ($str$Threaded Wheel Gear Grinder$str$,       $str$threaded_wheel_gear_grinder$str$),
    ($str$Wire EDM$str$,                          $str$wire_edm$str$)
)
UPDATE process_calculator_mappings pcm
SET machine_class = t.machine_class, is_active = true
FROM thin t
WHERE pcm.process_group = 'Machining' AND pcm.process_route = t.station;

COMMIT;

-- ── Verification (run manually after) ───────────────────────────────────────
-- SELECT count(*) FROM process_calculator_mappings WHERE process_group = 'Machining' AND is_active = true;
-- -- Expect: 38
-- SELECT process_route, machine_class FROM process_calculator_mappings
--   WHERE process_group = 'Machining' AND is_active = true ORDER BY display_order;
-- SELECT process_route FROM process_calculator_mappings
--   WHERE process_group = 'Machining' AND is_active = false;
-- -- Expect exactly: Jig Bore, Shaver, No Cost Feature, Perimeter Cut, Use Stock Machining

NOTIFY pgrst, 'reload schema';
