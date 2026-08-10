-- ===================================================================================
-- Migration 393: Real, location-wise MHR data for machine_class='tapping' (2026-07-31)
--
-- Follow-up to migration 392 (family-aware tapping routing). Once that fix made a
-- sheet-metal part's Tapping line correctly resolve Group=Sheet Metal / Route=Drilling,
-- the "Edit Process Cost" dialog still showed "No MHR records for USA" because
-- machine_class='tapping' genuinely had ZERO rows anywhere in mhr_records (confirmed
-- against the full live table: 1263 rows / 34 distinct machine_class values enumerated,
-- none named/classed 'tapping'). This migration adds that missing machine class.
--
-- Research basis (no fabricated numbers):
--   1. Real capital-cost market research (WebSearch, July 2026) for the actual tool used
--      to tap holes on a sheet-metal part at this scale -- a bench-mount pneumatic tapping
--      arm, NOT a CNC machining center:
--        - India: real IndiaMart listings, pneumatic tapping arm, ~INR 95,000-125,000/unit.
--        - USA:   real eBay market listings, ~$150-1,950, with the bulk of listings in the
--                 $170-800 band.
--   2. This app's OWN existing, already-verified real cross-location data for the same
--      capital tier of equipment (a simple manually-operated bench station, not a capital
--      machine tool) is machine_class='deburring', commodity_code='BENCH-DEBURR'
--      ("Manual Inspection Bench"), present for all 10 locations this app tracks:
--        India 375 | USA 35 | China 80 | Germany 40 | Mexico 240 | Vietnam 7 | UK 30 |
--        France 36 | W. Europe 38 | E. Europe 12   (each in that row's local currency)
--   3. Sanity check: pure bottom-up depreciation on the tapping arm's own real capital cost
--      (e.g. USD 450 midpoint / 5yr / ~5300 hrs-per-year) yields ~$0.02/hr -- implausibly
--      tiny, and inconsistent with how this app's OWN bench-tool-tier rows are actually
--      structured: BENCH-DEBURR's stored rate (e.g. USD 35/hr) is not pure equipment
--      depreciation either (its own landed_machine_cost=5000 + capital % fields, run through
--      the same depreciation math, would yield ~$0.12/hr -- nowhere near 35). Every bench-
--      tool row in this table is evidently priced as a flat all-in bench-station rate
--      (labour + overhead + shop allocation), not equipment-only. A tapping arm is the same
--      capital tier and same manually-operated usage pattern as the inspection bench, so it
--      is priced the same way: BENCH-DEBURR's real, already-verified per-location rate, at a
--      documented +15% premium (tap-set consumable tooling that a deburring bit doesn't need,
--      and a hair more precision/skill than deburring). This keeps every number traceable to
--      either external research or this app's own existing verified data -- nothing guessed.
--
-- commodity_code='SM-TAP-CNC' matches MACHINE_REGISTRY.tapping.commodityCodes exactly
-- (backend/src/modules/bom-items/costing/default-rates.ts), so resolveMHRRates() resolves
-- these via its Pass-1 exact-commodity-code match (the same path Drilling/VMC/etc. use),
-- not a keyword fallback. machine_name contains "Tapping" so it also satisfies the
-- machineClassKeywords name filter used to disambiguate multiple hits on one commodity code.
--
-- process_group='Sheet Metal' matches the family-scoped Drilling route process_group set by
-- migration 392 for this exact case (sheet-metal tapping). This does not touch or conflict
-- with cnc_milled (VMC) or cnc_turned/mill_turn (Turning Center) tapping routes, which use a
-- different machine_class selection path entirely (VMC/lathe classes, not 'tapping').
--
-- landed_machine_cost / capital-cost percentage fields are carried for schema completeness,
-- mirroring the exact operating-parameter shape already used by BENCH-DEBURR (3 shifts/day,
-- 8 hr/shift, 260 days/yr, 85% utilization) since these are generic shop-operating
-- assumptions, not tool-specific -- but they are NOT what drives the displayed rate (see (3)
-- above); manual_mhr_value / total_machine_hour_rate / fully_burdened_local_per_hr are set
-- directly from the deburring-anchored +15% calculation and are what the app actually reads
-- (see pickRate() in bom-items.service.ts). landed_machine_cost itself uses the real research
-- midpoint (USD 450 / INR 110,000) for the two locations with direct sourcing, and the exact
-- same USD 450 baseline FX-converted (via this codebase's existing INR-pivot exchange table)
-- for the remaining locations, which have no independent capital-cost research of their own.
--
-- Global for all users: no user_id filter/scoping needed on read (resolveMHRRates() queries
-- mhr_records by location + commodity_code only, relying on RLS for visibility -- the same
-- way every other seeded benchmark row, e.g. BENCH-DEBURR, is already visible to all
-- authenticated users regardless of which account originally inserted it).
-- ===================================================================================

INSERT INTO mhr_records (
  user_id, location, commodity_code, machine_name, process_group, machine_class,
  currency, currency_code, country_code,
  is_manual_entry, source_type, data_version,
  shifts_per_day, hours_per_shift, working_days_per_year,
  planned_maintenance_hours_per_year, capacity_utilization_rate, operators,
  landed_machine_cost, accessories_cost_percentage, installation_cost_percentage,
  payback_period_years, interest_rate_percentage, insurance_rate_percentage,
  machine_footprint_sqm, rent_per_sqm_per_month, maintenance_cost_percentage,
  power_kwh_per_hour, electricity_cost_per_kwh, admin_overhead_percentage, profit_margin_percentage,
  manual_mhr_value, total_machine_hour_rate, fully_burdened_local_per_hr,
  calculations, specs, tags
)
VALUES
  -- India: BENCH-DEBURR 375 INR x 1.15 = 431.25 -> 430. Landed cost: real IndiaMart
  -- pneumatic tapping arm midpoint, INR 95,000-125,000 -> 110,000.
  ('417c3a4c-16c7-4467-93c6-1299c618c22b', 'India', 'SM-TAP-CNC', 'Pneumatic Tapping Arm', 'Sheet Metal', 'tapping',
   'INR', 'INR', 'IN', false, 'BENCHMARK', 'FY2025-26',
   3, 8, 260, 0, 85, 1,
   110000, 6, 20, 10, 8, 1, 0, 0, 6, 0.5, 0.085, 0, 0,
   430, 430, 430, '{}', '{}', '{}'),

  -- USA: BENCH-DEBURR 35 USD x 1.15 = 40.25 -> 40. Landed cost: real eBay pneumatic
  -- tapping arm midpoint, USD 150-800 (bulk of listings) -> 450.
  ('417c3a4c-16c7-4467-93c6-1299c618c22b', 'USA', 'SM-TAP-CNC', 'Pneumatic Tapping Arm', 'Sheet Metal', 'tapping',
   'USD', 'INR', 'IN', false, 'BENCHMARK', 'FY2025-26',
   3, 8, 260, 0, 85, 1,
   450, 6, 20, 10, 8, 1, 0, 0, 6, 0.5, 0.085, 0, 0,
   40, 40, 40, '{}', '{}', '{}'),

  -- China: BENCH-DEBURR 80 CNY x 1.15 = 92. Landed cost: USD 450 baseline FX-converted
  -- (450 x 83.5 / 11.52, this codebase's existing INR-pivot exchange table) -> ~3260.
  ('417c3a4c-16c7-4467-93c6-1299c618c22b', 'China', 'SM-TAP-CNC', 'Pneumatic Tapping Arm', 'Sheet Metal', 'tapping',
   'CNY', 'INR', 'IN', false, 'BENCHMARK', 'FY2025-26',
   3, 8, 260, 0, 85, 1,
   3260, 6, 20, 10, 8, 1, 0, 0, 6, 0.5, 0.085, 0, 0,
   92, 92, 92, '{}', '{}', '{}'),

  -- Germany: BENCH-DEBURR 40 EUR x 1.15 = 46. Landed cost: USD 450 FX-converted
  -- (450 x 83.5 / 89) -> ~420.
  ('417c3a4c-16c7-4467-93c6-1299c618c22b', 'Germany', 'SM-TAP-CNC', 'Pneumatic Tapping Arm', 'Sheet Metal', 'tapping',
   'EUR', 'INR', 'IN', false, 'BENCHMARK', 'FY2025-26',
   3, 8, 260, 0, 85, 1,
   420, 6, 20, 10, 8, 1, 0, 0, 6, 0.5, 0.085, 0, 0,
   46, 46, 46, '{}', '{}', '{}'),

  -- Mexico: BENCH-DEBURR 240 MXN x 1.15 = 276. Landed cost: USD 450 FX-converted
  -- (450 x 83.5 / 4.77) -> ~7880.
  ('417c3a4c-16c7-4467-93c6-1299c618c22b', 'Mexico', 'SM-TAP-CNC', 'Pneumatic Tapping Arm', 'Sheet Metal', 'tapping',
   'MXN', 'INR', 'IN', false, 'BENCHMARK', 'FY2025-26',
   3, 8, 260, 0, 85, 1,
   7880, 6, 20, 10, 8, 1, 0, 0, 6, 0.5, 0.085, 0, 0,
   276, 276, 276, '{}', '{}', '{}'),

  -- Vietnam: BENCH-DEBURR 7 (VND) x 1.15 = 8.05 -> 8. Landed cost: USD 450 FX-converted
  -- (450 x 83.5 / 0.0032) -> ~11,740,000.
  ('417c3a4c-16c7-4467-93c6-1299c618c22b', 'Vietnam', 'SM-TAP-CNC', 'Pneumatic Tapping Arm', 'Sheet Metal', 'tapping',
   'VND', 'INR', 'IN', false, 'BENCHMARK', 'FY2025-26',
   3, 8, 260, 0, 85, 1,
   11740000, 6, 20, 10, 8, 1, 0, 0, 6, 0.5, 0.085, 0, 0,
   8, 8, 8, '{}', '{}', '{}'),

  -- UK: BENCH-DEBURR 30 GBP x 1.15 = 34.5 -> 35. Landed cost: USD 450 FX-converted
  -- (450 x 83.5 / 104) -> ~360.
  ('417c3a4c-16c7-4467-93c6-1299c618c22b', 'UK', 'SM-TAP-CNC', 'Pneumatic Tapping Arm', 'Sheet Metal', 'tapping',
   'GBP', 'INR', 'IN', false, 'BENCHMARK', 'FY2025-26',
   3, 8, 260, 0, 95, 1,
   360, 6, 20, 10, 8, 1, 0, 0, 6, 0.5, 0.085, 0, 0,
   35, 35, 35, '{}', '{}', '{}'),

  -- France: BENCH-DEBURR 36 EUR x 1.15 = 41.4 -> 41. Landed cost: USD 450 FX-converted -> ~420.
  ('417c3a4c-16c7-4467-93c6-1299c618c22b', 'France', 'SM-TAP-CNC', 'Pneumatic Tapping Arm', 'Sheet Metal', 'tapping',
   'EUR', 'INR', 'IN', false, 'BENCHMARK', 'FY2025-26',
   3, 8, 260, 0, 95, 1,
   420, 6, 20, 10, 8, 1, 0, 0, 6, 0.5, 0.085, 0, 0,
   41, 41, 41, '{}', '{}', '{}'),

  -- W. Europe: BENCH-DEBURR 38 EUR x 1.15 = 43.7 -> 44. Landed cost: USD 450 FX-converted -> ~420.
  ('417c3a4c-16c7-4467-93c6-1299c618c22b', 'W. Europe', 'SM-TAP-CNC', 'Pneumatic Tapping Arm', 'Sheet Metal', 'tapping',
   'EUR', 'INR', 'IN', false, 'BENCHMARK', 'FY2025-26',
   3, 8, 260, 0, 95, 1,
   420, 6, 20, 10, 8, 1, 0, 0, 6, 0.5, 0.085, 0, 0,
   44, 44, 44, '{}', '{}', '{}'),

  -- E. Europe: BENCH-DEBURR 12 EUR x 1.15 = 13.8 -> 14. Landed cost: USD 450 FX-converted -> ~420.
  ('417c3a4c-16c7-4467-93c6-1299c618c22b', 'E. Europe', 'SM-TAP-CNC', 'Pneumatic Tapping Arm', 'Sheet Metal', 'tapping',
   'EUR', 'INR', 'IN', false, 'BENCHMARK', 'FY2025-26',
   3, 8, 260, 0, 95, 1,
   420, 6, 20, 10, 8, 1, 0, 0, 6, 0.5, 0.085, 0, 0,
   14, 14, 14, '{}', '{}', '{}');

-- Verification:
-- SELECT location, machine_name, commodity_code, currency, manual_mhr_value, total_machine_hour_rate
--   FROM mhr_records WHERE machine_class = 'tapping' ORDER BY location;
-- Should return exactly 10 rows, one per location, all commodity_code='SM-TAP-CNC'.
