-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 465: Seed a real PEM press MHR record for USA (2026-08-13)
--
-- Root cause confirmed live (read-only query against mhr_records): there is
-- ZERO row anywhere in the table — any location — with machine_class = 'pem_press',
-- commodity_code = 'SM-PEM-PRESS' (MACHINE_REGISTRY's exact code for this class,
-- default-rates.ts), or machine_name containing "PEM". This is a genuine data
-- gap, not a matching bug: resolveMHRRates (bom-items.service.ts) Pass 1 (exact
-- commodity_code) and Pass 2 (process_group/machine_class keyword fallback) both
-- correctly find nothing, so cost-engine.ts falls back to
-- `{ rate: 0, source: 'no_db_rate' }` and emits the "No PEM press MHR rate in DB
-- for USA" warning — the code is working as designed against an empty pool.
--
-- The two existing USA "Assembly" rows (Mechnical_Assembly $24.50/hr,
-- Pick_and_Place $28.32/hr) were checked as a possible Pass-2 process_group
-- match (pem_press's processGroupKeywords include 'Assembly') but correctly
-- excluded themselves: Pass 2 requires the machine_name to ALSO contain a
-- pem_press machineClassKeywords hit ('PEM Press' / 'PEM Insertion' / 'Fastener
-- Press' / 'Clinch Press') when only process_group matched, and neither name
-- qualifies. No silent, wrong reuse of those rows is possible — confirmed, not
-- assumed.
--
-- Rate research (2026-08-13): PEM/self-clinching-fastener insertion is done on
-- small pneumatic or hydraulic C-frame presses (PennEngineering PEMSERTER
-- Series 4/2000, Haeger 618/824 family) — 2-8 ton capacity, single operator,
-- shop-air or single-phase powered. PEMSERTER Series 4 (pneumatic, 6 ton) needs
-- shop air only; a comparable used Haeger HP6-B (6 ton, hydraulic, autofeed)
-- lists at $9,450 (surplusrecord.com, retrieved 2026-08-13). This is cheap,
-- low-capital bench equipment — the same tier as this dataset's other USA
-- manual/semi-automated Assembly-class rows (Mechnical_Assembly $24.50/hr,
-- Pick_and_Place $28.32/hr), NOT CNC-class capital equipment. Set at $27.50/hr:
-- within that existing $24.50-$28.32 USA Assembly-tier band (labor + overhead
-- dominated, consistent with real ~$9-15k capital cost), slightly above pure
-- manual assembly to reflect the added press-setup/fastener-load/clinch-
-- verification skill this operation requires over plain hand assembly.
-- Sources:
--   - PEMSERTER Series 4 pneumatic press spec — pemnet.com/haeger.com product pages
--   - Used HAEGER HP6-B 6-ton hydraulic insertion press, $9,450 — surplusrecord.com
--     (retrieved 2026-08-13)
--
-- commodity_code = 'SM-PEM-PRESS' hits MACHINE_REGISTRY['pem_press'].commodityCodes
-- exactly (Pass 1, the primary/most robust match path). machine_name contains
-- "PEM Insertion" so it also independently satisfies the Pass-2 name-match gate,
-- and process_group/process_route/operation mirror migration 381's
-- process_calculator_mappings row ('Assembly', 'Hardware Insertion',
-- 'PEM Insertion') for full traceability back to the calculator seed.
-- ════════════════════════════════════════════════════════════════════════════════

INSERT INTO mhr_records (
  user_id, location, commodity_code, machine_name, process_group, process_route, operation,
  machine_class, shifts_per_day, hours_per_shift, working_days_per_year,
  capacity_utilization_rate, landed_machine_cost, accessories_cost_percentage,
  installation_cost_percentage, payback_period_years, interest_rate_percentage,
  insurance_rate_percentage, maintenance_cost_percentage, is_manual_entry,
  manual_mhr_value, total_machine_hour_rate, total_fixed_cost_per_hour,
  total_variable_cost_per_hour, currency, currency_symbol, currency_code, country_code,
  source_type, is_global, data_version, mhr_usd_per_hour, fully_burdened_local_per_hr,
  fully_burdened_usd_per_hr, max_tonnage, operators, availability_status
) VALUES (
  '5572f34d-2f51-456e-a5d7-96f840128b50', -- same seed-account owner as this location's other BENCHMARK rows (Mechnical_Assembly, Pick_and_Place)
  'USA', 'SM-PEM-PRESS', 'PEM Insertion Press', 'Assembly', 'Hardware Insertion', 'PEM Insertion',
  'pem_press', 3, 8, 260,
  85, 12000, 5,
  12, 10, 8,
  1, 4, true,
  27.50, 27.50, 27.50,
  0.00, 'USD', '$', 'USD', 'US',
  'BENCHMARK', false, 'FY2025-26', 27.50, 27.50,
  27.50, 6, 1, 'available'
)
ON CONFLICT DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT id, location, machine_name, commodity_code, process_group, machine_class,
--        total_machine_hour_rate, currency
-- FROM mhr_records WHERE commodity_code = 'SM-PEM-PRESS' AND location = 'USA';
-- Expect one row, "PEM Insertion Press", $27.50/hr.
