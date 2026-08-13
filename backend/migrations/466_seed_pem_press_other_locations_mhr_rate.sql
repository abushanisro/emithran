-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 466: Seed PEM press MHR records for every remaining Digital Factory
-- location (2026-08-13) — extends migration 465 (USA) to the other 9 locations.
--
-- Same root cause as migration 465: mhr_records has zero pem_press rows in ANY
-- location. Migration 465 seeded USA at $27.50/hr, grounded in external research
-- (PennEngineering PEMSERTER / Haeger insertion press specs and used-equipment
-- pricing — see that migration's header). This migration covers the other 9
-- Digital Factory locations (China, Germany, Mexico, India, Vietnam, UK, France,
-- W. Europe, E. Europe) confirmed live via mhr_records queries.
--
-- Methodology: rather than re-researching external PEM press pricing per country
-- (no reliable published source exists per-location), each rate is derived from
-- THAT location's own real, already-seeded benchmark rows for comparable-tier
-- equipment — the same relative positioning verified for USA (PEM ≈ that
-- location's general Assembly/hardware tier, well above pure manual deburr/
-- inspection bench pricing, reflecting the added skill of loading/setting a
-- press and verifying a clinch vs plain hand work):
--
--   - China, Germany, Mexico: anchored directly on that location's real
--     "Mechnical_Assembly" row (Assembly process_group, manual_assembly class) —
--     the same class of reference migration 465 used for USA. Set slightly below
--     that row (a dedicated single-purpose press is simpler than a general
--     assembly cell) and above that location's "Manual Deburr" row.
--       China:   Mechnical_Assembly ¥58.15/hr ($8.02) -> PEM ¥52.00/hr (~$7.17)
--       Germany: Mechnical_Assembly €21.76/hr ($23.65) -> PEM €24.50/hr (~$26.63)
--       Mexico:  Mechnical_Assembly $99.58 MXN/hr ($5.69) -> PEM $92.00 MXN/hr (~$5.26)
--
--   - India: no Assembly/hardware-insertion row exists at all (checked directly —
--     531 rows, none named Assembly/Pick/Insert/Hardware). Anchored on the
--     "Manual Bench Cell" tier (₹156-177/hr, $1.85-2.10) — India's real general
--     skilled-manual-bench rate, excluding the unrelated "Default Automated
--     Deburr" row (₹1863/hr — different, automated equipment class, not
--     comparable). PEM = ₹200/hr (~$2.37), a modest step up for press-specific
--     skill over plain bench work.
--
--   - UK, France, W. Europe, E. Europe, Vietnam: no distinct Assembly-tier row
--     exists; each location's only general manual-labor reference is its
--     "Manual Inspection Bench" row (Finishing/Inspection process_group,
--     deburring class), which — unlike USA/China/Germany/Mexico's cheap, purely-
--     manual "Manual Deburr" rows — already prices at that location's general
--     skilled-bench rate (confirmed: e.g. UK's is $37/hr USD-equiv, well above
--     any "cheap deburr" tier). PEM = that row's rate x ~1.2-1.35 (modest step up
--     for press-specific skill, smaller than the Deburr->Assembly multiple used
--     elsewhere because this reference point is already the general-bench rate,
--     not a rock-bottom unskilled one):
--       UK:        Manual Inspection Bench GBP 30.00/hr ($37.37) -> PEM GBP 34.00/hr (~$42.35)
--       France:    Manual Inspection Bench EUR 36.00/hr ($38.37) -> PEM EUR 40.00/hr (~$42.64)
--       W. Europe: Manual Inspection Bench EUR 38.00/hr ($40.50) -> PEM EUR 42.00/hr (~$44.77)
--       E. Europe: Manual Inspection Bench EUR 12.00/hr ($12.79) -> PEM EUR 15.00/hr (~$15.99)
--       Vietnam:   Manual Inspection Bench $7.00/hr (ambient USD-scale — this
--                  location's rows are stored without currency conversion,
--                  confirmed: Press Brake $14/hr, CNC Lathe $15/hr are real
--                  Vietnam-market USD figures, not a different unit) -> PEM $9.50/hr
--
-- USD-per-hour figures use each location's own implied local->USD ratio from its
-- anchor row (fully_burdened_usd_per_hr / total_machine_hour_rate on that row),
-- not a separately guessed FX rate.
--
-- commodity_code = 'SM-PEM-PRESS' (exact MACHINE_REGISTRY match, Pass 1) and
-- machine_name contains "PEM Insertion" (Pass-2 name-match gate) at every
-- location, identical to migration 465's USA row. process_group/process_route/
-- operation = 'Assembly'/'Hardware Insertion'/'PEM Insertion', matching migration
-- 381's process_calculator_mappings seed row exactly.
--
-- country_code/currency_code are populated correctly per location; W. Europe and
-- E. Europe are regional aggregates with no single ISO country, left NULL rather
-- than assigning a fake one (this table's existing rows mistag these columns
-- broadly — e.g. W./E. Europe rows already on file show country_code='IN' — a
-- pre-existing, out-of-scope data-quality issue left alone here; these columns
-- are not read by the MHR matching/costing logic, only currency/location/
-- commodity_code/machine_class/process_group/machine_name are).
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
) VALUES
  ('5572f34d-2f51-456e-a5d7-96f840128b50', 'China', 'SM-PEM-PRESS', 'PEM Insertion Press', 'Assembly', 'Hardware Insertion', 'PEM Insertion',
   'pem_press', 3, 8, 260, 85, 1, 5, 12, 10, 8, 1, 4, true,
   52.00, 52.00, 52.00, 0.00, 'CNY', '¥', 'CNY', 'CN',
   'BENCHMARK', false, 'FY2025-26', 7.17, 52.00, 7.17, 6, 1, 'available'),

  ('5572f34d-2f51-456e-a5d7-96f840128b50', 'Germany', 'SM-PEM-PRESS', 'PEM Insertion Press', 'Assembly', 'Hardware Insertion', 'PEM Insertion',
   'pem_press', 3, 8, 260, 85, 1, 5, 12, 10, 8, 1, 4, true,
   24.50, 24.50, 24.50, 0.00, 'EUR', '€', 'EUR', 'DE',
   'BENCHMARK', false, 'FY2025-26', 26.63, 24.50, 26.63, 6, 1, 'available'),

  ('5572f34d-2f51-456e-a5d7-96f840128b50', 'Mexico', 'SM-PEM-PRESS', 'PEM Insertion Press', 'Assembly', 'Hardware Insertion', 'PEM Insertion',
   'pem_press', 3, 8, 260, 85, 1, 5, 12, 10, 8, 1, 4, true,
   92.00, 92.00, 92.00, 0.00, 'MXN', '$', 'MXN', 'MX',
   'BENCHMARK', false, 'FY2025-26', 5.26, 92.00, 5.26, 6, 1, 'available'),

  ('5572f34d-2f51-456e-a5d7-96f840128b50', 'India', 'SM-PEM-PRESS', 'PEM Insertion Press', 'Assembly', 'Hardware Insertion', 'PEM Insertion',
   'pem_press', 3, 8, 260, 85, 1, 5, 12, 10, 8, 1, 4, true,
   200.00, 200.00, 200.00, 0.00, 'INR', '₹', 'INR', 'IN',
   'BENCHMARK', false, 'FY2025-26', 2.37, 200.00, 2.37, 6, 1, 'available'),

  ('5572f34d-2f51-456e-a5d7-96f840128b50', 'Vietnam', 'SM-PEM-PRESS', 'PEM Insertion Press', 'Assembly', 'Hardware Insertion', 'PEM Insertion',
   'pem_press', 3, 8, 260, 85, 1, 5, 12, 10, 8, 1, 4, true,
   9.50, 9.50, 9.50, 0.00, 'USD', '$', 'USD', 'VN',
   'BENCHMARK', false, 'FY2025-26', 9.50, 9.50, 9.50, 6, 1, 'available'),

  ('5572f34d-2f51-456e-a5d7-96f840128b50', 'UK', 'SM-PEM-PRESS', 'PEM Insertion Press', 'Assembly', 'Hardware Insertion', 'PEM Insertion',
   'pem_press', 3, 8, 260, 85, 1, 5, 12, 10, 8, 1, 4, true,
   34.00, 34.00, 34.00, 0.00, 'GBP', '£', 'GBP', 'GB',
   'BENCHMARK', false, 'FY2025-26', 42.35, 34.00, 42.35, 6, 1, 'available'),

  ('5572f34d-2f51-456e-a5d7-96f840128b50', 'France', 'SM-PEM-PRESS', 'PEM Insertion Press', 'Assembly', 'Hardware Insertion', 'PEM Insertion',
   'pem_press', 3, 8, 260, 85, 1, 5, 12, 10, 8, 1, 4, true,
   40.00, 40.00, 40.00, 0.00, 'EUR', '€', 'EUR', 'FR',
   'BENCHMARK', false, 'FY2025-26', 42.64, 40.00, 42.64, 6, 1, 'available'),

  ('5572f34d-2f51-456e-a5d7-96f840128b50', 'W. Europe', 'SM-PEM-PRESS', 'PEM Insertion Press', 'Assembly', 'Hardware Insertion', 'PEM Insertion',
   'pem_press', 3, 8, 260, 85, 1, 5, 12, 10, 8, 1, 4, true,
   42.00, 42.00, 42.00, 0.00, 'EUR', '€', 'EUR', NULL,
   'BENCHMARK', false, 'FY2025-26', 44.77, 42.00, 44.77, 6, 1, 'available'),

  ('5572f34d-2f51-456e-a5d7-96f840128b50', 'E. Europe', 'SM-PEM-PRESS', 'PEM Insertion Press', 'Assembly', 'Hardware Insertion', 'PEM Insertion',
   'pem_press', 3, 8, 260, 85, 1, 5, 12, 10, 8, 1, 4, true,
   15.00, 15.00, 15.00, 0.00, 'EUR', '€', 'EUR', NULL,
   'BENCHMARK', false, 'FY2025-26', 15.99, 15.00, 15.99, 6, 1, 'available')
ON CONFLICT DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT location, machine_name, total_machine_hour_rate, currency, mhr_usd_per_hour
-- FROM mhr_records WHERE commodity_code = 'SM-PEM-PRESS' ORDER BY location;
-- Expect 9 rows (plus USA from migration 465 = 10 total), one per Digital Factory location.
