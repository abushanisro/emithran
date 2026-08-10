-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 407: Hole Extrusion (Burring) — real, selectable mhr_records row (2026-08-05)
--
-- Migration 405 added a mhr_benchmark_rates row for 'hole_forming', which the
-- LIVE cost engine (resolveMHRRates()) already falls back to correctly. But
-- the "Edit Process Cost" dialog's MHR dropdown reads mhr_records directly —
-- a real per-machine catalog, not benchmarks — so it showed "No MHR records
-- for USA. Enter rate manually." This migration adds an actual mhr_records
-- row per location so the dropdown has something real to select.
--
-- Same non-fabrication standard as before: the $/hr rate per location is the
-- same real, already-cited Turret Punch benchmark figure (migrations
-- 345/361/405) — not a new number. landed_machine_cost/power_kwh_per_hour
-- cite migration 345's own real research comment for the reference machine
-- ("Amada EM-3612 / Trumpf TruPunch — Purchase: ~$350K landed; 10yr; 25kW avg"),
-- applied uniformly rather than fabricating a per-country cost breakdown I
-- have no real source for — disclosed simplification, not hidden. Overhead/
-- insurance/installation/etc. percentages reuse this codebase's own existing
-- generic benchmark-row defaults (see migration 365's waterjet/lathe examples),
-- not new invented figures. capability_source='benchmark' so this is visibly
-- distinguishable from a shop's own verified machine entry, and a real
-- shop-added hole-forming machine (via HR Rates) would still be preferred over
-- this row wherever resolveMHRRates()'s "real DB row" tier applies.
--
-- user_id is the hardcoded real owner ('5572f34d-2f51-456e-a5d7-96f840128b50'),
-- NOT looked up by email — migrations 394/397 already found that mhr_records'
-- strict per-user RLS makes an email-lookup convenient but risky: it inserts
-- under whatever that email currently resolves to, which was wrong twice before
-- (waterjet/tapping) and had to be corrected in a follow-up migration each time.
-- Using the confirmed-correct id directly avoids repeating that mistake here.
-- ════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  uid uuid := '5572f34d-2f51-456e-a5d7-96f840128b50';
BEGIN
  INSERT INTO mhr_records (
    user_id, location, commodity_code, machine_name, machine_class, process_group,
    landed_machine_cost, manual_mhr_value, fully_burdened_local_per_hr, total_machine_hour_rate,
    capacity_utilization_rate,
    capability_source, availability_status,
    shifts_per_day, hours_per_shift, working_days_per_year, planned_maintenance_hours_per_year,
    accessories_cost_percentage, installation_cost_percentage, payback_period_years,
    interest_rate_percentage, insurance_rate_percentage, machine_footprint_sqm,
    rent_per_sqm_per_month, maintenance_cost_percentage, power_kwh_per_hour,
    electricity_cost_per_kwh, admin_overhead_percentage, profit_margin_percentage
  )
  SELECT
    uid,
    -- 'SM-BURR-FORM': a placeholder commodity_code (NOT NULL column) — not
    -- registered in any MACHINE_REGISTRY class's commodityCodes list, so it
    -- can't collide with Pass 1's exact-code matching for another class; this
    -- row resolves into 'hole_forming' via Pass 2's name/process_group keyword
    -- match instead (see MACHINE_REGISTRY['hole_forming'] in default-rates.ts).
    v.location, 'SM-BURR-FORM', 'Hole Flanging / Burring Station (benchmark — turret punch proxy)', 'hole_forming', 'Sheet Metal',
    350000, v.local_mhr, v.local_mhr, v.local_mhr,
    85,
    'benchmark', 'available',
    3, 8, 260, 0,
    6, 20, 10, 8, 1, 0, 0, 6,
    25, v.elec_kwh, 0, 0
  FROM (VALUES
    -- elec_kwh reuses the exact same real per-country electricity rates already
    -- seeded for cnc_lathe_live/cnc_mill_turn in migration 365 — not new figures.
    ('USA',       84.00, 0.085),
    ('UK',        73.00, 0.15),
    ('Germany',   88.00, 0.20),
    ('France',    78.00, 0.15),
    ('W. Europe', 80.00, 0.18),
    ('E. Europe', 38.00, 0.10),
    ('China',     20.00, 0.09),
    ('India',     11.00, 7.50),
    ('Vietnam',   16.00, 0.085),
    ('Mexico',    30.00, 0.079)
  ) AS v(location, local_mhr, elec_kwh)
  WHERE NOT EXISTS (
    SELECT 1 FROM mhr_records r
    WHERE r.user_id = uid AND r.location = v.location AND r.machine_class = 'hole_forming'
  );
END $$;

-- ── Verification ───────────────────────────────────────────────────────────────
-- SELECT location, machine_name, total_machine_hour_rate, capability_source
--   FROM mhr_records WHERE machine_class = 'hole_forming' ORDER BY location;
