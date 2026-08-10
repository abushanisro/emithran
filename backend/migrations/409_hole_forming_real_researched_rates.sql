-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 409: Hole Extrusion (Burring) — real, bottom-up researched rates (2026-08-05)
--
-- Supersedes migrations 405/407/408. Two real problems with the prior approach:
--
-- 1. BUG: migration 407 stored USD-denominated benchmark figures directly into
--    mhr_records' LOCAL-currency fields (fully_burdened_local_per_hr etc.) —
--    correct by coincidence for USA/Vietnam (both modeled as USD in this system,
--    see LOCATION_INFO in default-rates.ts) but wrong for every other location
--    (e.g. India showed ₹11/hr instead of a real ~₹900+/hr).
--
-- 2. MODEL: the $84/hr USA figure (migrations 345/361/405) was borrowed from the
--    CNC Turret Punch benchmark. Real research (see conversation — Murata/
--    Proleantech tooling guides, UniPunch/Atlas Mfg extrude-and-tap docs)
--    confirms hole-extrusion/burring is virtually always TOOLING mounted in an
--    existing punch press, not a distinct capital-machine category — so a full
--    turret punch's rate overstates it by ~2 orders of magnitude for the case
--    where a dedicated small standalone press IS needed (routes that can't form
--    inline, e.g. Fiber Laser / Waterjet cutting).
--
-- This migration replaces both: real small-press capital costs (per location,
-- cited below) run through this app's OWN real MHR formula
-- (lib/utils/mhrCalculations.ts::calculateMHR — depreciation/interest/insurance/
-- maintenance/electricity, same generic overhead-percentage defaults already
-- used throughout this codebase for benchmark rows: 6/20/10/8/1/6, 85% util,
-- 3 shifts x 8h x 260 days, 1.5kW motor per real small-press spec sheets),
-- stored in the CORRECT local currency this time.
--
-- Real citations (all fetched 2026-08-05):
--   USA:     $2,950  — used Whitney Jensen 10-ton C-frame punch press
--            (surplusrecord.com/machinery-equipment/punches)
--   China:   ¥18,500 — FTC105-10T 10-ton four-column hydraulic press
--            (fangtian2020.jdzj.com/supplyinfo-5-1105585.html)
--   India:   ₹2,87,500 — midpoint of real dedicated flanging-machine market
--            range ₹1,35,000–₹4,40,000 (accio.com/plp/flanging-machine)
--   Germany/France/W. Europe/E. Europe (EUR bucket, shared in this system's
--   LOCATION_INFO): €20,100 — Fresan FP10P, new, 10-ton C-frame eccentric press
--            (werktuigen.com/fresan-fp+10p+eccentric+press/wt-120-95828)
--   Mexico:  MX$40,000 — low end of real market range for 10-ton industrial
--            presses (multiple MX retailers); electricity MXN 2.19/kWh, real
--            2025 CFE industrial tariff (intratec.us electricity-price-mexico)
--   Electricity rates for USA/Germany/France/W.Europe/E.Europe/India/China
--   reuse the exact same real per-country figures already seeded in migration
--   365 for other machine classes — not new numbers.
--
-- UK and Vietnam are DELETED, not filled: repeated real searches (Fresan/
-- Exapro/Alibaba/general industrial marketplaces, English and native-market
-- queries) found no comparable industrial-tier small-press pricing for either
-- — only consumer DIY-tier tools (UK: £260-560) or a generic pan-Asia range
-- that isn't Vietnam-specific. An honest "no MHR record — enter manually" gap
-- is more accurate than a number with no real basis.
--
-- Machine capital costs above are a mix of used (USA) and new (Germany-bucket)
-- equipment — a real limitation of what was findable, disclosed rather than
-- hidden; not a like-for-like cross-location comparison.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 1. Clean up the superseded/buggy rows from 405/407/408 ─────────────────────
DELETE FROM mhr_benchmark_rates WHERE machine_name = 'Hole Flanging / Burring Station';
DELETE FROM mhr_records WHERE commodity_code = 'SM-BURR-FORM';

-- ── 2. Real, correctly-denominated mhr_benchmark_rates (USD/hr, per migration
--       345's own storage convention for this table) ───────────────────────────
INSERT INTO mhr_benchmark_rates (machine_name, process_group, location, mhr_usd, machine_ref) VALUES
('Hole Flanging / Burring Station', 'Sheet Metal', 'USA',       0.25, 'Real: Whitney Jensen 10-ton C-frame punch press ($2,950 used) run through calculateMHR()'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'China',     0.13, 'Real: FTC105-10T 10-ton press (¥18,500) run through calculateMHR() — CNY-native rate 0.92/hr'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'India',     0.28, 'Real: dedicated flanging-machine market midpoint (₹2,87,500) run through calculateMHR() — INR-native rate 23.52/hr'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'Germany',   1.26, 'Real: Fresan FP10P 10-ton press (€20,100 new) run through calculateMHR() — EUR-native rate 1.16/hr'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'France',    1.18, 'Real: Fresan FP10P (€20,100), France electricity rate — EUR-native rate 1.08/hr'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'W. Europe', 1.23, 'Real: Fresan FP10P (€20,100), W. Europe electricity rate — EUR-native rate 1.13/hr'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'E. Europe', 1.10, 'Real: Fresan FP10P (€20,100), E. Europe electricity rate — EUR-native rate 1.01/hr'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'Mexico',    0.29, 'Real: 10-ton press (MX$40,000), CFE industrial electricity MXN 2.19/kWh — MXN-native rate 4.99/hr')
ON CONFLICT (machine_name, process_group, location) DO NOTHING;

-- ── 3. Real, correctly-denominated mhr_records (LOCAL currency per location) ──
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
  VALUES
    (uid, 'USA',       'SM-BURR-FORM', 'Hole Flanging / Burring Station (10-ton press, used — Whitney Jensen ref.)',   'hole_forming', 'Sheet Metal', 2950,   0.25,  0.25,  0.25,  85, 'benchmark', 'available', 3, 8, 260, 0, 6, 20, 10, 8, 1, 0, 0, 6, 1.5, 0.085, 0, 0),
    (uid, 'China',     'SM-BURR-FORM', 'Hole Flanging / Burring Station (10-ton press, new — FTC105-10T ref.)',        'hole_forming', 'Sheet Metal', 18500,  0.92,  0.92,  0.92,  85, 'benchmark', 'available', 3, 8, 260, 0, 6, 20, 10, 8, 1, 0, 0, 6, 1.5, 0.09,  0, 0),
    (uid, 'India',     'SM-BURR-FORM', 'Hole Flanging / Burring Station (dedicated flanging machine, market midpoint)', 'hole_forming', 'Sheet Metal', 287500, 23.52, 23.52, 23.52, 85, 'benchmark', 'available', 3, 8, 260, 0, 6, 20, 10, 8, 1, 0, 0, 6, 1.5, 7.50,  0, 0),
    (uid, 'Germany',   'SM-BURR-FORM', 'Hole Flanging / Burring Station (10-ton press, new — Fresan FP10P ref.)',      'hole_forming', 'Sheet Metal', 20100,  1.16,  1.16,  1.16,  85, 'benchmark', 'available', 3, 8, 260, 0, 6, 20, 10, 8, 1, 0, 0, 6, 1.5, 0.20,  0, 0),
    (uid, 'France',    'SM-BURR-FORM', 'Hole Flanging / Burring Station (10-ton press, new — Fresan FP10P ref.)',      'hole_forming', 'Sheet Metal', 20100,  1.08,  1.08,  1.08,  85, 'benchmark', 'available', 3, 8, 260, 0, 6, 20, 10, 8, 1, 0, 0, 6, 1.5, 0.15,  0, 0),
    (uid, 'W. Europe', 'SM-BURR-FORM', 'Hole Flanging / Burring Station (10-ton press, new — Fresan FP10P ref.)',      'hole_forming', 'Sheet Metal', 20100,  1.13,  1.13,  1.13,  85, 'benchmark', 'available', 3, 8, 260, 0, 6, 20, 10, 8, 1, 0, 0, 6, 1.5, 0.18,  0, 0),
    (uid, 'E. Europe', 'SM-BURR-FORM', 'Hole Flanging / Burring Station (10-ton press, new — Fresan FP10P ref.)',      'hole_forming', 'Sheet Metal', 20100,  1.01,  1.01,  1.01,  85, 'benchmark', 'available', 3, 8, 260, 0, 6, 20, 10, 8, 1, 0, 0, 6, 1.5, 0.10,  0, 0),
    (uid, 'Mexico',    'SM-BURR-FORM', 'Hole Flanging / Burring Station (10-ton press, CFE industrial elec. rate)',    'hole_forming', 'Sheet Metal', 40000,  4.99,  4.99,  4.99,  85, 'benchmark', 'available', 3, 8, 260, 0, 6, 20, 10, 8, 1, 0, 0, 6, 1.5, 2.19,  0, 0);
  -- No ON CONFLICT clause: mhr_records has no unique constraint to target (only
  -- non-unique indexes on user_id/commodity_code), and step 1's DELETE already
  -- guarantees a clean slate for these rows on a fresh run of this migration.
END $$;

-- ── Verification ───────────────────────────────────────────────────────────────
-- SELECT location, machine_name, total_machine_hour_rate, landed_machine_cost
--   FROM mhr_records WHERE machine_class = 'hole_forming' ORDER BY location;
-- Expect: USA 0.25, China 0.92, India 23.52, Germany 1.16, France 1.08,
--   W. Europe 1.13, E. Europe 1.01, Mexico 4.99 — and NO rows for UK/Vietnam.
