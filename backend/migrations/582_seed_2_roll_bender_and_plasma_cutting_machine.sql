-- ============================================================================
-- Migration 582: Seed "2 Roll Bender" and "Plasma Cutting Machine" --
-- two real, previously-missing machine_library.json categories
--
-- Context: CLAUDE.md's Sheet Metal readiness checklist flags "2/3/4 Roll
-- Bending (taxonomy exists, no cost engine)" and "Plasma, Oxyfuel (no cost
-- engine yet)". machine_library.json already had 3 Roll Bender (25) and
-- 4 Roll Bender (19), but NO "2 Roll Bender" and NO Plasma category at all --
-- confirmed by a live audit of the file (2026-08-27) before writing this.
-- The user supplied real, sourced machine data for both (4 machines / 13
-- machines respectively); memory/sheetmetal/machine/machine_library.json was
-- updated first (17 categories now, up from 15) with field names normalized
-- to the file's own established convention (e.g. "_pct" suffix not
-- "_percent", "machine_life_yr" not "machine_life_years",
-- "wage_grade_name" not "wage_grade") and the licensed source name replaced
-- with "the system Baseline"/"the system", matching every other category in
-- this same file.
--
-- This migration replays the exact, already-proven staging -> promotion ->
-- linking -> backfill pipeline the other 15 categories went through
-- (migrations 505-508, 564, 569, 573, 580) for just these 17 new machines --
-- same column lists, same SQL, not a new mechanism:
--   1. Stage into sm_reference_data (category='machine'), same shape as
--      migrations 505-508.
--   2. Promote into mhr_records via migration 564's own dedup query,
--      unmodified (name-uniqueness-checked, skips anything already present)
--      -- safe to run standalone even if re-run later.
--   3. Link process_route/operation/machine_class via a live, CONFIRMED
--      (2026-08-27) query against process_calculator_mappings -- both
--      operations already exist there as real, active rows:
--        '2 Roll Bending' (Bending/Floating /Forming route, machine_class
--          'roll_forming') -- same family as the existing 3/4 Roll Bender
--          linkage from migration 569.
--        'Plasma Cut' (Cutting route, machine_class 'plasma') -- preferring
--          the 'Cutting' route's 'Plasma Cut' over 'Sheet Cutting' route's
--          duplicate 'Plasma Cutting' operation, matching migration 569's
--          own documented precedent for resolving same-machine_class
--          duplicate operation names across routes (e.g. Waterjet, Fiber
--          Laser).
--      Note: neither 'roll_forming' nor 'plasma' exists in
--      default-rates.ts's MACHINE_REGISTRY (the cost-engine/machine-
--      selection capability layer) -- these rows are real, taxonomy-correct,
--      and visible in the HR Rates / MHR reference data, but still cannot be
--      selected by machine-selection/selector.ts for live quote costing
--      until that separate, larger "build the cost engine" work happens
--      (unchanged CLAUDE.md gap -- this migration seeds data, it does not
--      close that gap).
--   4. Backfill the Tier-1 universal economics fields via migration 573's
--      own JOIN/COALESCE UPDATE, unmodified.
--   5. Backfill wage_grade/operators/setup_time_hr from the real per-machine
--      source data (better than migration 577's category-level heuristic,
--      which was only ever a fallback for rows with no real source value).
--   6. Backfill calculated_mhr_usd_hr/mhr_source via migration 580's own
--      UPDATE, unmodified -- both new categories have complete real
--      machine-economics inputs (price, life, salvage, maintenance,
--      installation, supplies, uptime, utilization), so this computes a real
--      bottom-up MHR estimate for them too, reference-only exactly as it is
--      for the other 281 rows (never authoritative for MHR or live costing
--      -- see migration 581).
--
-- Data-quality note (Plasma Cutting Machine only): several machines' names
-- embed a cutting-current rating (e.g. "CSI Series 4 - 200A") that matches
-- their power_watts value exactly (200A -> power_watts=200) -- power_watts
-- is very likely amperage mislabeled as watts for at least those rows, not a
-- real wattage figure. Left as-is in sm_reference_data.raw (never
-- fabricated/renamed) and deliberately NOT mapped into machine_power_kw
-- (which is given correctly and separately per machine, e.g. 10/52/122 kW)
-- or any other power column. Flagged in the category's own _data_note in
-- machine_library.json too.
-- ============================================================================

BEGIN;

-- Step 1: Stage into sm_reference_data
INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
('machine', 'World Average', '2026-08', '2 Roll Bender:2 Roll Bender - 1400mm Roll Length x 300mm Roll Diameter', '54000.0', 'Currency', '2 Roll Bender reference spec', '{"name": "2 Roll Bender - 1400mm Roll Length x 300mm Roll Diameter", "labor_rate_usd_hr": 43.21, "direct_overhead_rate_usd_hr": 4.33, "indirect_overhead_rate_usd_hr": 14.91, "overhead_multiplier": 0.0, "labor_time_standard": 1.0, "number_of_operators": 1.0, "wage_grade_name": "Skilled", "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.5, "rolling_speed_mm_s": 110.0, "roll_working_length_mm": 1400.0, "steel_thickness_mm": 3.5, "top_roll_diameter_mm": 300.0, "reference_yield_strength_mpa": 296.0, "is_preferred": true, "avg_utilization": 1.0, "good_part_yield": 1.0, "machine_price_usd": 54000.0, "machine_length_mm": 2100.0, "machine_width_mm": 1200.0, "footprint_allowance_factor": 5.0, "machine_power_kw": 7.0, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "Virtual", "data_source": "the system Baseline", "machine_life_yr": 10, "machine_category": "2 Roll Bender"}'::jsonb),
('machine', 'World Average', '2026-08', '2 Roll Bender:2 Roll Bender - 2000mm Roll Length x 125mm Roll Diameter', '32000.0', 'Currency', '2 Roll Bender reference spec', '{"name": "2 Roll Bender - 2000mm Roll Length x 125mm Roll Diameter", "labor_rate_usd_hr": 43.21, "direct_overhead_rate_usd_hr": 2.11, "indirect_overhead_rate_usd_hr": 14.08, "overhead_multiplier": 0.0, "labor_time_standard": 1.0, "number_of_operators": 1.0, "wage_grade_name": "Skilled", "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.5, "rolling_speed_mm_s": 117.9, "roll_working_length_mm": 762.0, "steel_thickness_mm": 2.7, "top_roll_diameter_mm": 125.0, "reference_yield_strength_mpa": 278.0, "is_preferred": true, "avg_utilization": 1.0, "good_part_yield": 1.0, "machine_price_usd": 32000.0, "machine_length_mm": 1143.0, "machine_width_mm": 509.02, "footprint_allowance_factor": 5.0, "machine_power_kw": 1.12, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "Virtual", "data_source": "the system Baseline", "machine_life_yr": 10, "machine_category": "2 Roll Bender"}'::jsonb),
('machine', 'World Average', '2026-08', '2 Roll Bender:2 Roll Bender - 2050mm Roll Length x 450mm Roll Diameter', '65000.0', 'Currency', '2 Roll Bender reference spec', '{"name": "2 Roll Bender - 2050mm Roll Length x 450mm Roll Diameter", "labor_rate_usd_hr": 43.21, "direct_overhead_rate_usd_hr": 6.35, "indirect_overhead_rate_usd_hr": 16.2, "overhead_multiplier": 0.0, "labor_time_standard": 1.0, "number_of_operators": 1.0, "wage_grade_name": "Skilled", "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.5, "rolling_speed_mm_s": 100.0, "roll_working_length_mm": 2050.0, "steel_thickness_mm": 5.0, "top_roll_diameter_mm": 450.0, "reference_yield_strength_mpa": 296.0, "is_preferred": true, "avg_utilization": 1.0, "good_part_yield": 1.0, "machine_price_usd": 65000.0, "machine_length_mm": 3075.0, "machine_width_mm": 1800.0, "footprint_allowance_factor": 5.0, "machine_power_kw": 16.0, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "Virtual", "data_source": "the system Baseline", "machine_life_yr": 10, "machine_category": "2 Roll Bender"}'::jsonb),
('machine', 'World Average', '2026-08', '2 Roll Bender:2 Roll Bender - 8000mm Roll Length x 200mm Roll Diameter', '43000.0', 'Currency', '2 Roll Bender reference spec', '{"name": "2 Roll Bender - 8000mm Roll Length x 200mm Roll Diameter", "labor_rate_usd_hr": 43.21, "direct_overhead_rate_usd_hr": 3.06, "indirect_overhead_rate_usd_hr": 14.24, "overhead_multiplier": 0.0, "labor_time_standard": 1.0, "number_of_operators": 1.0, "wage_grade_name": "Skilled", "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.5, "rolling_speed_mm_s": 120.0, "roll_working_length_mm": 800.0, "steel_thickness_mm": 2.0, "top_roll_diameter_mm": 200.0, "reference_yield_strength_mpa": 296.0, "is_preferred": true, "avg_utilization": 1.0, "good_part_yield": 1.0, "machine_price_usd": 43000.0, "machine_length_mm": 1200.0, "machine_width_mm": 800.0, "footprint_allowance_factor": 5.0, "machine_power_kw": 3.0, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "Virtual", "data_source": "the system Baseline", "machine_life_yr": 10, "machine_category": "2 Roll Bender"}'::jsonb),
('machine', 'World Average', '2026-08', 'Plasma Cutting Machine:Vulcan 3100D', '90000.0', 'Currency', 'Plasma Cutting Machine reference spec', '{"name": "Vulcan 3100D", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 6.96, "indirect_overhead_rate_usd_hr": 24.32, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.08, "shuttle_time_s": 18.0, "power_watts": 100.0, "rapid_traverse_rate_mm_min": 25400.0, "bed_length_mm": 3048.0, "bed_width_mm": 1524.0, "small_feature_feed_radius_mm": 5.0, "small_feature_thickness_ratio": 0.0, "nozzle_cost_usd": 43.0, "nozzle_life_cycles": 1000.0, "number_of_heads": 1, "scrap_cuts_per_sheet": 3.0, "is_preferred": false, "avg_utilization": 0.71, "good_part_yield": 1.0, "machine_price_usd": 90000.0, "machine_length_mm": 12192.0, "machine_width_mm": 3352.8, "footprint_allowance_factor": 3.0, "machine_power_kw": 10.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "USA", "labor_time_standard": 1.75, "wage_grade_name": "Skilled", "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "sheet_length_trim_strip_mm": 0.0, "sheet_width_trim_strip_mm": 0.0, "machine_life_yr": 10, "data_source": "the system Baseline", "machine_category": "Plasma Cutting Machine"}'::jsonb),
('machine', 'World Average', '2026-08', 'Plasma Cutting Machine:CSI Series 4 - 200A', '115672.0', 'Currency', 'Plasma Cutting Machine reference spec', '{"name": "CSI Series 4 - 200A", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 6.96, "indirect_overhead_rate_usd_hr": 24.32, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.08, "shuttle_time_s": 18.0, "power_watts": 200.0, "rapid_traverse_rate_mm_min": 25400.0, "bed_length_mm": 3657.6, "bed_width_mm": 1828.8, "small_feature_feed_radius_mm": 5.0, "small_feature_thickness_ratio": 0.0, "nozzle_cost_usd": 43.0, "nozzle_life_cycles": 1000.0, "number_of_heads": 1, "scrap_cuts_per_sheet": 3.0, "is_preferred": false, "avg_utilization": 0.71, "good_part_yield": 1.0, "machine_price_usd": 115672.0, "machine_length_mm": 16459.2, "machine_width_mm": 3352.8, "footprint_allowance_factor": 3.0, "machine_power_kw": 10.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "USA", "labor_time_standard": 1.75, "wage_grade_name": "Skilled", "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "sheet_length_trim_strip_mm": 0.0, "sheet_width_trim_strip_mm": 0.0, "machine_life_yr": 10, "data_source": "the system Baseline", "machine_category": "Plasma Cutting Machine"}'::jsonb),
('machine', 'World Average', '2026-08', 'Plasma Cutting Machine:Default Plasma', '90000.0', 'Currency', 'Plasma Cutting Machine reference spec', '{"name": "Default Plasma", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 6.96, "indirect_overhead_rate_usd_hr": 24.32, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.08, "shuttle_time_s": 18.0, "power_watts": 200.0, "rapid_traverse_rate_mm_min": 9000.0, "bed_length_mm": 3657.6, "bed_width_mm": 1828.8, "small_feature_feed_radius_mm": 5.0, "small_feature_thickness_ratio": 0.0, "nozzle_cost_usd": 43.0, "nozzle_life_cycles": 1000.0, "number_of_heads": 1, "scrap_cuts_per_sheet": 3.0, "is_preferred": false, "avg_utilization": 0.71, "good_part_yield": 1.0, "machine_price_usd": 90000.0, "machine_length_mm": 12192.0, "machine_width_mm": 3352.8, "footprint_allowance_factor": 3.0, "machine_power_kw": 10.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "USA", "labor_time_standard": 1.75, "wage_grade_name": "Skilled", "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "sheet_length_trim_strip_mm": 0.0, "sheet_width_trim_strip_mm": 0.0, "machine_life_yr": 10, "data_source": "the system Baseline", "machine_category": "Plasma Cutting Machine"}'::jsonb),
('machine', 'World Average', '2026-08', 'Plasma Cutting Machine:CSI Series 5 - 300A', '115672.0', 'Currency', 'Plasma Cutting Machine reference spec', '{"name": "CSI Series 5 - 300A", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 8.51, "indirect_overhead_rate_usd_hr": 27.99, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.08, "shuttle_time_s": 18.0, "power_watts": 300.0, "rapid_traverse_rate_mm_min": 25400.0, "bed_length_mm": 7315.2, "bed_width_mm": 3048.0, "small_feature_feed_radius_mm": 5.0, "small_feature_thickness_ratio": 0.0, "nozzle_cost_usd": 43.0, "nozzle_life_cycles": 1000.0, "number_of_heads": 1, "scrap_cuts_per_sheet": 3.0, "is_preferred": false, "avg_utilization": 0.71, "good_part_yield": 1.0, "machine_price_usd": 115672.0, "machine_length_mm": 16459.2, "machine_width_mm": 3352.8, "footprint_allowance_factor": 3.0, "machine_power_kw": 10.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "USA", "labor_time_standard": 1.75, "wage_grade_name": "Skilled", "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "sheet_length_trim_strip_mm": 0.0, "sheet_width_trim_strip_mm": 0.0, "machine_life_yr": 10, "data_source": "the system Baseline", "machine_category": "Plasma Cutting Machine"}'::jsonb),
('machine', 'World Average', '2026-08', 'Plasma Cutting Machine:Plasma Cutter - 400 Watts, 1 Head', '90000.0', 'Currency', 'Plasma Cutting Machine reference spec', '{"name": "Plasma Cutter - 400 Watts, 1 Head", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 6.96, "indirect_overhead_rate_usd_hr": 24.32, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.08, "shuttle_time_s": 18.0, "power_watts": 400.0, "rapid_traverse_rate_mm_min": 25400.0, "bed_length_mm": 6069.0, "bed_width_mm": 3048.0, "small_feature_feed_radius_mm": 5.0, "small_feature_thickness_ratio": 0.0, "nozzle_cost_usd": 43.0, "nozzle_life_cycles": 1000.0, "number_of_heads": 1, "scrap_cuts_per_sheet": 3.0, "is_preferred": true, "avg_utilization": 0.71, "good_part_yield": 1.0, "machine_price_usd": 90000.0, "machine_length_mm": 12192.0, "machine_width_mm": 3352.8, "footprint_allowance_factor": 3.0, "machine_power_kw": 10.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "Virtual", "labor_time_standard": 1.75, "wage_grade_name": "Skilled", "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "sheet_length_trim_strip_mm": 0.0, "sheet_width_trim_strip_mm": 0.0, "machine_life_yr": 10, "data_source": "the system Baseline", "machine_category": "Plasma Cutting Machine"}'::jsonb),
('machine', 'World Average', '2026-08', 'Plasma Cutting Machine:Precision CS - Platemaster XMR', '90000.0', 'Currency', 'Plasma Cutting Machine reference spec', '{"name": "Precision CS - Platemaster XMR", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 6.96, "indirect_overhead_rate_usd_hr": 24.32, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.08, "shuttle_time_s": 18.0, "power_watts": 400.0, "rapid_traverse_rate_mm_min": 30480.0, "bed_length_mm": 6069.0, "bed_width_mm": 3048.0, "small_feature_feed_radius_mm": 5.0, "small_feature_thickness_ratio": 0.0, "nozzle_cost_usd": 43.0, "nozzle_life_cycles": 1000.0, "number_of_heads": 1, "scrap_cuts_per_sheet": 3.0, "is_preferred": false, "avg_utilization": 0.71, "good_part_yield": 1.0, "machine_price_usd": 90000.0, "machine_length_mm": 12192.0, "machine_width_mm": 3352.8, "footprint_allowance_factor": 3.0, "machine_power_kw": 10.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "USA", "labor_time_standard": 1.75, "wage_grade_name": "Skilled", "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "sheet_length_trim_strip_mm": 0.0, "sheet_width_trim_strip_mm": 0.0, "machine_life_yr": 10, "data_source": "the system Baseline", "machine_category": "Plasma Cutting Machine"}'::jsonb),
('machine', 'World Average', '2026-08', 'Plasma Cutting Machine:ESAB - Avenger Plus', '90000.0', 'Currency', 'Plasma Cutting Machine reference spec', '{"name": "ESAB - Avenger Plus", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 6.96, "indirect_overhead_rate_usd_hr": 24.32, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.08, "shuttle_time_s": 18.0, "power_watts": 1000.0, "rapid_traverse_rate_mm_min": 25400.0, "bed_length_mm": 2438.4, "bed_width_mm": 1219.2, "small_feature_feed_radius_mm": 5.0, "small_feature_thickness_ratio": 0.0, "nozzle_cost_usd": 43.0, "nozzle_life_cycles": 1000.0, "number_of_heads": 4, "scrap_cuts_per_sheet": 3.0, "is_preferred": false, "avg_utilization": 0.71, "good_part_yield": 1.0, "machine_price_usd": 90000.0, "machine_length_mm": 12192.0, "machine_width_mm": 3352.8, "footprint_allowance_factor": 3.0, "machine_power_kw": 10.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "Virtual", "labor_time_standard": 1.75, "wage_grade_name": "Skilled", "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "sheet_length_trim_strip_mm": 0.0, "sheet_width_trim_strip_mm": 0.0, "machine_life_yr": 10, "data_source": "the system Baseline", "machine_category": "Plasma Cutting Machine"}'::jsonb),
('machine', 'World Average', '2026-08', 'Plasma Cutting Machine:Plasma Cutter - 1000 Watts, 4 Heads', '100000.0', 'Currency', 'Plasma Cutting Machine reference spec', '{"name": "Plasma Cutter - 1000 Watts, 4 Heads", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 7.56, "indirect_overhead_rate_usd_hr": 24.32, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.08, "shuttle_time_s": 18.0, "power_watts": 1000.0, "rapid_traverse_rate_mm_min": 25400.0, "bed_length_mm": 3200.0, "bed_width_mm": 1250.0, "small_feature_feed_radius_mm": 5.0, "small_feature_thickness_ratio": 0.0, "nozzle_cost_usd": 43.0, "nozzle_life_cycles": 1000.0, "number_of_heads": 4, "scrap_cuts_per_sheet": 3.0, "is_preferred": true, "avg_utilization": 0.71, "good_part_yield": 1.0, "machine_price_usd": 100000.0, "machine_length_mm": 12192.0, "machine_width_mm": 3352.8, "footprint_allowance_factor": 3.0, "machine_power_kw": 10.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "USA", "labor_time_standard": 1.75, "wage_grade_name": "Skilled", "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "sheet_length_trim_strip_mm": 0.0, "sheet_width_trim_strip_mm": 0.0, "machine_life_yr": 10, "data_source": "the system Baseline", "machine_category": "Plasma Cutting Machine"}'::jsonb),
('machine', 'World Average', '2026-08', 'Plasma Cutting Machine:Storm - 4 head', '90000.0', 'Currency', 'Plasma Cutting Machine reference spec', '{"name": "Storm - 4 head", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 6.96, "indirect_overhead_rate_usd_hr": 24.32, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.08, "shuttle_time_s": 18.0, "power_watts": 1000.0, "rapid_traverse_rate_mm_min": 25400.0, "bed_length_mm": 3225.8, "bed_width_mm": 1250.0, "small_feature_feed_radius_mm": 5.0, "small_feature_thickness_ratio": 0.0, "nozzle_cost_usd": 43.0, "nozzle_life_cycles": 1000.0, "number_of_heads": 4, "scrap_cuts_per_sheet": 3.0, "is_preferred": false, "avg_utilization": 0.71, "good_part_yield": 1.0, "machine_price_usd": 90000.0, "machine_length_mm": 12192.0, "machine_width_mm": 3352.8, "footprint_allowance_factor": 3.0, "machine_power_kw": 10.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "USA", "labor_time_standard": 1.75, "wage_grade_name": "Skilled", "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "sheet_length_trim_strip_mm": 0.0, "sheet_width_trim_strip_mm": 0.0, "machine_life_yr": 10, "data_source": "the system Baseline", "machine_category": "Plasma Cutting Machine"}'::jsonb),
('machine', 'World Average', '2026-08', 'Plasma Cutting Machine:Komatsu TFPL301', '151800.0', 'Currency', 'Plasma Cutting Machine reference spec', '{"name": "Komatsu TFPL301", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 17.05, "indirect_overhead_rate_usd_hr": 53.75, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.08, "shuttle_time_s": 18.0, "power_watts": 30000.0, "rapid_traverse_rate_mm_min": 20000.0, "bed_length_mm": 27000.0, "bed_width_mm": 3100.0, "small_feature_feed_radius_mm": 5.0, "small_feature_thickness_ratio": 0.0, "nozzle_cost_usd": 43.0, "nozzle_life_cycles": 1000.0, "number_of_heads": 1, "scrap_cuts_per_sheet": 3.0, "is_preferred": false, "avg_utilization": 0.71, "good_part_yield": 1.0, "machine_price_usd": 151800.0, "machine_length_mm": 31748.0, "machine_width_mm": 4899.66, "footprint_allowance_factor": 3.0, "machine_power_kw": 52.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "Japan", "labor_time_standard": 1.75, "wage_grade_name": "Skilled", "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "sheet_length_trim_strip_mm": 0.0, "sheet_width_trim_strip_mm": 0.0, "machine_life_yr": 10, "data_source": "the system Baseline", "machine_category": "Plasma Cutting Machine"}'::jsonb),
('machine', 'World Average', '2026-08', 'Plasma Cutting Machine:Komatsu TFPL308', '139900.0', 'Currency', 'Plasma Cutting Machine reference spec', '{"name": "Komatsu TFPL308", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 16.33, "indirect_overhead_rate_usd_hr": 58.63, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.08, "shuttle_time_s": 18.0, "power_watts": 30000.0, "rapid_traverse_rate_mm_min": 20000.0, "bed_length_mm": 27000.0, "bed_width_mm": 2500.0, "small_feature_feed_radius_mm": 5.0, "small_feature_thickness_ratio": 0.0, "nozzle_cost_usd": 43.0, "nozzle_life_cycles": 1000.0, "number_of_heads": 1, "scrap_cuts_per_sheet": 3.0, "is_preferred": false, "avg_utilization": 0.71, "good_part_yield": 1.0, "machine_price_usd": 139900.0, "machine_length_mm": 31748.0, "machine_width_mm": 5499.1, "footprint_allowance_factor": 3.0, "machine_power_kw": 52.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "Japan", "labor_time_standard": 1.75, "wage_grade_name": "Skilled", "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "sheet_length_trim_strip_mm": 0.0, "sheet_width_trim_strip_mm": 0.0, "machine_life_yr": 10, "data_source": "the system Baseline", "machine_category": "Plasma Cutting Machine"}'::jsonb),
('machine', 'World Average', '2026-08', 'Plasma Cutting Machine:Komatsu TFPL101', '151800.0', 'Currency', 'Plasma Cutting Machine reference spec', '{"name": "Komatsu TFPL101", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 27.62, "indirect_overhead_rate_usd_hr": 53.75, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.08, "shuttle_time_s": 18.0, "power_watts": 100000.0, "rapid_traverse_rate_mm_min": 20000.0, "bed_length_mm": 27000.0, "bed_width_mm": 3100.0, "small_feature_feed_radius_mm": 5.0, "small_feature_thickness_ratio": 0.0, "nozzle_cost_usd": 43.0, "nozzle_life_cycles": 1000.0, "number_of_heads": 1, "scrap_cuts_per_sheet": 3.0, "is_preferred": false, "avg_utilization": 0.71, "good_part_yield": 1.0, "machine_price_usd": 151800.0, "machine_length_mm": 31748.0, "machine_width_mm": 4899.66, "footprint_allowance_factor": 3.0, "machine_power_kw": 122.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "Japan", "labor_time_standard": 1.75, "wage_grade_name": "Skilled", "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "sheet_length_trim_strip_mm": 0.0, "sheet_width_trim_strip_mm": 0.0, "machine_life_yr": 10, "data_source": "the system Baseline", "machine_category": "Plasma Cutting Machine"}'::jsonb),
('machine', 'World Average', '2026-08', 'Plasma Cutting Machine:Komatsu TFPL108', '139900.0', 'Currency', 'Plasma Cutting Machine reference spec', '{"name": "Komatsu TFPL108", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 26.9, "indirect_overhead_rate_usd_hr": 58.63, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.08, "shuttle_time_s": 18.0, "power_watts": 100000.0, "rapid_traverse_rate_mm_min": 20000.0, "bed_length_mm": 27000.0, "bed_width_mm": 2500.0, "small_feature_feed_radius_mm": 5.0, "small_feature_thickness_ratio": 0.0, "nozzle_cost_usd": 43.0, "nozzle_life_cycles": 1000.0, "number_of_heads": 1, "scrap_cuts_per_sheet": 3.0, "is_preferred": false, "avg_utilization": 0.71, "good_part_yield": 1.0, "machine_price_usd": 139900.0, "machine_length_mm": 31748.0, "machine_width_mm": 5499.1, "footprint_allowance_factor": 3.0, "machine_power_kw": 122.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "Japan", "labor_time_standard": 1.75, "wage_grade_name": "Skilled", "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "salvage_value_factor_pct": 0.0, "sheet_length_trim_strip_mm": 0.0, "sheet_width_trim_strip_mm": 0.0, "machine_life_yr": 10, "data_source": "the system Baseline", "machine_category": "Plasma Cutting Machine"}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;


-- Step 2: Promote into mhr_records (migration 564's exact query, scoped to these 2 new categories)
DO $$
DECLARE
  matched_count      INTEGER;
BEGIN
  WITH name_counts AS (
    SELECT lower(raw->>'name') AS name_lower, COUNT(*) AS cnt
    FROM sm_reference_data
    WHERE category = 'machine'
    GROUP BY lower(raw->>'name')
  ),
  unambiguous AS (
    SELECT sr.key, sr.raw
    FROM sm_reference_data sr
    JOIN name_counts c ON c.name_lower = lower(sr.raw->>'name')
    WHERE sr.category = 'machine' AND c.cnt = 1
  ),
  to_promote AS (
    SELECT u.key, u.raw
    FROM unambiguous u
    WHERE NOT EXISTS (
      SELECT 1 FROM mhr_records mr WHERE lower(mr.machine_name) = lower(u.raw->>'name')
    )
    AND (u.key LIKE '2 Roll Bender:%' OR u.key LIKE 'Plasma Cutting Machine:%')
  )
  INSERT INTO mhr_records (
    user_id, organization_id, location, commodity_code, process_group, machine_class,
    machine_name, machine_description, manufacturer_country, machine_price_usd,
    landed_machine_cost, is_manual_entry, manual_mhr_value, total_machine_hour_rate,
    fully_burdened_local_per_hr,
    shifts_per_day, hours_per_shift, working_days_per_year, planned_maintenance_hours_per_year,
    capacity_utilization_rate, accessories_cost_percentage, installation_cost_percentage,
    payback_period_years, interest_rate_percentage, insurance_rate_percentage,
    machine_footprint_sqm, rent_per_sqm_per_month, maintenance_cost_percentage,
    power_kwh_per_hour, electricity_cost_per_kwh, admin_overhead_percentage, profit_margin_percentage,
    power_kw, currency, currency_symbol,
    direct_overhead_rate, indirect_overhead_rate, usd_lhr_total,
    direct_overhead_source, indirect_overhead_source, labor_rate_source,
    economics_version, economics_updated_at,
    capability_source, benchmark_source_key,
    benchmark_direct_overhead_rate_usd_hr, benchmark_indirect_overhead_rate_usd_hr, benchmark_labor_rate_usd_hr
  )
  SELECT
    NULL, NULL,
    'USA', 'Sheet Metal', 'Sheet Metal', NULL,
    tp.raw->>'name',
    tp.raw->>'description',
    tp.raw->>'machine_manufacturer_location',
    NULLIF(tp.raw->>'machine_price_usd', '')::numeric,
    GREATEST(COALESCE(NULLIF(tp.raw->>'machine_price_usd', '')::numeric, 1), 1),
    true,
    ROUND(COALESCE(NULLIF(tp.raw->>'direct_overhead_rate_usd_hr','')::numeric,0) + COALESCE(NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr','')::numeric,0), 2),
    ROUND(COALESCE(NULLIF(tp.raw->>'direct_overhead_rate_usd_hr','')::numeric,0) + COALESCE(NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr','')::numeric,0), 2),
    ROUND(COALESCE(NULLIF(tp.raw->>'direct_overhead_rate_usd_hr','')::numeric,0) + COALESCE(NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr','')::numeric,0), 2),
    3, 8, 260, 0,
    95, 6, 20, 10, 8, 1, 0, 0, 6, 0, 0, 0, 0,
    NULLIF(tp.raw->>'machine_power_kw', '')::numeric,
    'USD', '$',
    NULLIF(tp.raw->>'direct_overhead_rate_usd_hr', '')::numeric,
    NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr', '')::numeric,
    NULLIF(tp.raw->>'labor_rate_usd_hr', '')::numeric,
    'benchmark', 'benchmark', 'benchmark',
    1, NOW(),
    'benchmark', tp.key,
    NULLIF(tp.raw->>'direct_overhead_rate_usd_hr', '')::numeric,
    NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr', '')::numeric,
    NULLIF(tp.raw->>'labor_rate_usd_hr', '')::numeric
  FROM to_promote tp;

  GET DIAGNOSTICS matched_count = ROW_COUNT;
  RAISE NOTICE 'Migration 582: promoted % new mhr_records row(s) for 2 Roll Bender / Plasma Cutting Machine.', matched_count;
END $$;

-- Step 3: Link process taxonomy (real, live process_calculator_mappings)
UPDATE mhr_records SET process_route = 'Bending/Floating /Forming', operation = '2 Roll Bending', machine_class = COALESCE(machine_class, 'roll_forming')
WHERE benchmark_source_key LIKE '2 Roll Bender:%' AND process_route IS NULL;

UPDATE mhr_records SET process_route = 'Cutting', operation = 'Plasma Cut', machine_class = COALESCE(machine_class, 'plasma')
WHERE benchmark_source_key LIKE 'Plasma Cutting Machine:%' AND process_route IS NULL;

-- Step 4: Backfill Tier-1 universal economics fields (migration 573's exact UPDATE)
UPDATE mhr_records m
SET
  labor_time_standard = COALESCE(m.labor_time_standard, (srd.raw->>'labor_time_standard')::numeric),
  avg_utilization = COALESCE(m.avg_utilization, (srd.raw->>'avg_utilization')::numeric),
  good_part_yield = COALESCE(m.good_part_yield, (srd.raw->>'good_part_yield')::numeric),
  machine_length_mm = COALESCE(m.machine_length_mm, (srd.raw->>'machine_length_mm')::numeric),
  machine_width_mm = COALESCE(m.machine_width_mm, (srd.raw->>'machine_width_mm')::numeric),
  machine_life_yr = COALESCE(m.machine_life_yr, (srd.raw->>'machine_life_yr')::numeric),
  machine_power_kw = COALESCE(m.machine_power_kw, (srd.raw->>'machine_power_kw')::numeric),
  machine_uptime_pct = COALESCE(m.machine_uptime_pct, (srd.raw->>'machine_uptime_pct')::numeric),
  annual_maintenance_factor_pct = COALESCE(m.annual_maintenance_factor_pct, (srd.raw->>'annual_maintenance_factor_pct')::numeric),
  footprint_allowance_factor = COALESCE(m.footprint_allowance_factor, (srd.raw->>'footprint_allowance_factor')::numeric),
  installation_factor_pct = COALESCE(m.installation_factor_pct, (srd.raw->>'installation_factor_pct')::numeric)
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND (srd.key LIKE '2 Roll Bender:%' OR srd.key LIKE 'Plasma Cutting Machine:%');

-- Salvage value / supplies-cost-per-year (migration 574 columns, feed Step 6's
-- formula below) -- same JOIN backfill approach.
UPDATE mhr_records m
SET
  salvage_value_factor_pct = COALESCE(m.salvage_value_factor_pct, (srd.raw->>'salvage_value_factor_pct')::numeric),
  supplies_cost_per_year = COALESCE(m.supplies_cost_per_year, (srd.raw->>'supplies_cost_usd_yr')::numeric)
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND (srd.key LIKE '2 Roll Bender:%' OR srd.key LIKE 'Plasma Cutting Machine:%');

-- Step 5: Backfill wage_grade/operators/setup_time_hr from real source data
UPDATE mhr_records m
SET
  wage_grade = COALESCE(m.wage_grade, NULLIF(srd.raw->>'wage_grade_name', '')),
  operators = COALESCE(m.operators, (srd.raw->>'number_of_operators')::numeric),
  setup_time_hr = COALESCE(m.setup_time_hr, (srd.raw->>'setup_time_hr')::numeric)
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND (srd.key LIKE '2 Roll Bender:%' OR srd.key LIKE 'Plasma Cutting Machine:%');

-- Step 6: Backfill calculated_mhr_usd_hr / mhr_source (migration 580's exact UPDATE)
UPDATE mhr_records
SET
  legacy_imported_mhr_usd_hr = manual_mhr_value,
  calculated_mhr_usd_hr = ROUND(
    (
      machine_price_usd * (1 - CASE WHEN salvage_value_factor_pct > 1 THEN salvage_value_factor_pct / 100 ELSE salvage_value_factor_pct END) / machine_life_yr
      + machine_price_usd * CASE WHEN annual_maintenance_factor_pct > 1 THEN annual_maintenance_factor_pct / 100 ELSE annual_maintenance_factor_pct END
      + machine_price_usd * CASE WHEN installation_factor_pct > 1 THEN installation_factor_pct / 100 ELSE installation_factor_pct END / machine_life_yr
      + COALESCE(supplies_cost_per_year, 0)
    )
    /
    (
      6240 * CASE WHEN machine_uptime_pct > 1 THEN machine_uptime_pct / 100 ELSE machine_uptime_pct END * avg_utilization
    ),
    4
  ),
  mhr_source = 'calculated'
WHERE benchmark_source_key IS NOT NULL
  AND calculated_mhr_usd_hr IS NULL
  AND machine_price_usd IS NOT NULL AND machine_price_usd > 0
  AND machine_life_yr IS NOT NULL AND machine_life_yr > 0
  AND salvage_value_factor_pct IS NOT NULL
  AND annual_maintenance_factor_pct IS NOT NULL
  AND installation_factor_pct IS NOT NULL
  AND machine_uptime_pct IS NOT NULL AND machine_uptime_pct > 0
  AND avg_utilization IS NOT NULL AND avg_utilization > 0
  AND (benchmark_source_key LIKE '2 Roll Bender:%' OR benchmark_source_key LIKE 'Plasma Cutting Machine:%');

COMMIT;

-- Verification (run manually after):
-- SELECT machine_name, machine_class, process_route, operation, direct_overhead_rate,
--        indirect_overhead_rate, total_machine_hour_rate, calculated_mhr_usd_hr, wage_grade, operators
--   FROM mhr_records WHERE benchmark_source_key LIKE '2 Roll Bender:%' ORDER BY machine_name;
-- SELECT machine_name, machine_class, process_route, operation, direct_overhead_rate,
--        indirect_overhead_rate, total_machine_hour_rate, calculated_mhr_usd_hr, wage_grade, operators
--   FROM mhr_records WHERE benchmark_source_key LIKE 'Plasma Cutting Machine:%' ORDER BY machine_name;
-- SELECT count(*) FROM sm_reference_data WHERE category='machine' AND (key LIKE '2 Roll Bender:%' OR key LIKE 'Plasma Cutting Machine:%');
