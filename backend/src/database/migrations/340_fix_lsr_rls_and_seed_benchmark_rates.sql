-- Migration 340: Create global LSR benchmark rates table
-- ════════════════════════════════════════════════════════════════════════════════
--
-- ── PROBLEM ───────────────────────────────────────────────────────────────────
-- lsr_records is user-scoped (user_id FK, RLS enforces owner isolation).
-- The applyRoute engine needs benchmark labour rates for every location without
-- requiring each user to manually import their own LSR data first.
-- Seeding lsr_records with a hardcoded user_id is fragile and breaks multi-tenant.
--
-- ── DESIGN DECISION ───────────────────────────────────────────────────────────
-- Separate table: lsr_benchmark_rates
--   - No user_id column → truly global, not owned by any user
--   - Managed exclusively by migrations (service_role writes only)
--   - Authenticated users can SELECT; no INSERT/UPDATE/DELETE via app layer
--   - Users keep lsr_records for their own imported / overridden rates
--   - applyRoute checks lsr_benchmark_rates for labour rate lookup
--
-- ── PRINCIPAL ENGINEER RATIONALE ──────────────────────────────────────────────
-- Pattern: same as processes, process_calculator_mappings, mhr_records seed data.
-- Reference data (benchmark labour rates) is shared infrastructure.
-- Private data (user-imported rates, cost overrides) stays in lsr_records.
-- This separation avoids RLS workarounds, admin-client bypass, and hardcoded emails.
--
-- ── PROCESS GROUPS ────────────────────────────────────────────────────────────
-- Values MUST match deriveProcessGroupFromMachineClass() output exactly:
--   'Sheet Metal' | 'Plastics' | 'CNC Machining' | 'Quality'
--
-- ── EXCHANGE RATES (FY2026 budget mid-market) ─────────────────────────────────
-- 1 EUR = 1.09 USD | 1 GBP = 1.27 USD | 1 CNY = 0.141 USD
-- 1 INR = 0.0119 USD (84 INR/USD) | 1 MXN = 0.0571 USD
-- USD and Vietnam (export-zone USD-pegged) stored at 1:1
--
-- ── DATA SOURCES ─────────────────────────────────────────────────────────────
-- USA     : BLS OES 2025 (SOC 51-2099, 51-9199, 51-4041, 51-9061)
-- India   : CMIE India Manufacturing Wages 2026
-- Germany : Eurostat LCS Germany 2025
-- France  : Eurostat LCS France 2025
-- W.Europe: Eurostat LCS Benelux/Nordic blend 2025
-- E.Europe: Eurostat LCS Poland/Czech blend 2025
-- UK      : ONS ASHE 2025
-- China   : MOHRSS China Wages 2025
-- Vietnam : ILO Vietnam Manufacturing Wages 2025
-- Mexico  : IMSS Mexico / Tetakawi Benchmark Guide 2025–2026
--
-- ── IDEMPOTENCY ───────────────────────────────────────────────────────────────
-- ON CONFLICT ON CONSTRAINT uq_lsr_benchmark_location_group DO UPDATE
-- Safe to re-run; rates refresh without duplicates.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 1. Create table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lsr_benchmark_rates (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  labour_code      TEXT        NOT NULL,          -- e.g. LSR-USA-SM
  labour_type      TEXT        NOT NULL,          -- e.g. 'Sheet Metal Fabricator'
  description      TEXT,
  lhr              NUMERIC     NOT NULL,          -- direct operator wage, local currency/hr
  location         TEXT        NOT NULL,          -- matches location column in mhr_records
  process_group    TEXT        NOT NULL,          -- must match deriveProcessGroupFromMachineClass()
  currency         TEXT        NOT NULL DEFAULT 'USD',
  currency_symbol  TEXT,
  lhr_usd_effective NUMERIC    NOT NULL,          -- USD equivalent at FY2026 mid-market
  reference        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_lsr_benchmark_location_group UNIQUE (location, process_group),
  CONSTRAINT uq_lsr_benchmark_code           UNIQUE (labour_code)
);

-- ── 2. RLS: authenticated users read, service_role manages writes ──────────────

ALTER TABLE lsr_benchmark_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lsr_benchmark_read_authenticated" ON lsr_benchmark_rates;
CREATE POLICY "lsr_benchmark_read_authenticated"
  ON lsr_benchmark_rates
  FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT / UPDATE / DELETE policies for authenticated role.
-- Writes happen only via migrations (service_role bypasses RLS).

-- ── 3. Seed 40 benchmark rows (10 locations × 4 process groups) ───────────────

INSERT INTO lsr_benchmark_rates
  (labour_code, labour_type, description, lhr, location, process_group, currency, currency_symbol, lhr_usd_effective, reference)
VALUES
  -- ── USA (USD) ───────────────────────────────────────────────────────────────
  ('LSR-USA-SM' , 'Sheet Metal Fabricator'  , 'Laser cutting, press brake, forming'       ,  23.00, 'USA'      , 'Sheet Metal'  , 'USD', '$'  ,  23.00, 'BLS OES 51-2099 2025'),
  ('LSR-USA-PL' , 'Plastics Operator'       , 'Injection molding, packing, cooling'       ,  22.00, 'USA'      , 'Plastics'     , 'USD', '$'  ,  22.00, 'BLS OES 51-9199 2025'),
  ('LSR-USA-CNC', 'CNC Machinist'           , '3/4/5-axis VMC, CNC lathe, mill-turn'      ,  26.00, 'USA'      , 'CNC Machining', 'USD', '$'  ,  26.00, 'BLS OES 51-4041 2025'),
  ('LSR-USA-QA' , 'Quality Inspector'       , 'CMM, dimensional inspection, visual'       ,  20.00, 'USA'      , 'Quality'      , 'USD', '$'  ,  20.00, 'BLS OES 51-9061 2025'),

  -- ── India (INR — 1 INR = 0.0119 USD @ 84 INR/USD) ──────────────────────────
  ('LSR-IND-SM' , 'Sheet Metal Operator'    , 'Laser, press brake, forming'               ,  95.00, 'India'    , 'Sheet Metal'  , 'INR', '₹'  ,   1.13, 'CMIE India Manufacturing Wages 2026'),
  ('LSR-IND-PL' , 'Plastics Operator'       , 'Injection molding'                         ,  85.00, 'India'    , 'Plastics'     , 'INR', '₹'  ,   1.01, 'CMIE India Manufacturing Wages 2026'),
  ('LSR-IND-CNC', 'CNC Machinist'           , 'VMC, CNC lathe'                            , 110.00, 'India'    , 'CNC Machining', 'INR', '₹'  ,   1.31, 'CMIE India Manufacturing Wages 2026'),
  ('LSR-IND-QA' , 'Quality Inspector'       , 'CMM, dimensional inspection'               ,  80.00, 'India'    , 'Quality'      , 'INR', '₹'  ,   0.95, 'CMIE India Manufacturing Wages 2026'),

  -- ── Germany (EUR — 1 EUR = 1.09 USD) ────────────────────────────────────────
  ('LSR-DEU-SM' , 'Metallbauer'             , 'Laser, press brake, sheet metal'           ,  32.00, 'Germany'  , 'Sheet Metal'  , 'EUR', '€'  ,  34.88, 'Eurostat LCS Germany 2025'),
  ('LSR-DEU-PL' , 'Kunststoffverarbeiter'   , 'Injection molding'                         ,  30.00, 'Germany'  , 'Plastics'     , 'EUR', '€'  ,  32.70, 'Eurostat LCS Germany 2025'),
  ('LSR-DEU-CNC', 'CNC-Fachkraft'           , 'VMC, 5-axis, turning'                      ,  35.00, 'Germany'  , 'CNC Machining', 'EUR', '€'  ,  38.15, 'Eurostat LCS Germany 2025'),
  ('LSR-DEU-QA' , 'Qualitätsprüfer'         , 'CMM, metrology, inspection'                ,  28.00, 'Germany'  , 'Quality'      , 'EUR', '€'  ,  30.52, 'Eurostat LCS Germany 2025'),

  -- ── France (EUR — 1 EUR = 1.09 USD) ─────────────────────────────────────────
  ('LSR-FRA-SM' , 'Opérateur tôlerie'       , 'Laser, presse plieuse'                     ,  27.00, 'France'   , 'Sheet Metal'  , 'EUR', '€'  ,  29.43, 'Eurostat LCS France 2025'),
  ('LSR-FRA-PL' , 'Opérateur plasturgie'    , 'Injection'                                 ,  26.00, 'France'   , 'Plastics'     , 'EUR', '€'  ,  28.34, 'Eurostat LCS France 2025'),
  ('LSR-FRA-CNC', 'Technicien CN'           , 'VMC, tournage CNC'                         ,  30.00, 'France'   , 'CNC Machining', 'EUR', '€'  ,  32.70, 'Eurostat LCS France 2025'),
  ('LSR-FRA-QA' , 'Contrôleur qualité'      , 'CMM, contrôle dimensionnel'                ,  24.00, 'France'   , 'Quality'      , 'EUR', '€'  ,  26.16, 'Eurostat LCS France 2025'),

  -- ── W. Europe (EUR — Benelux/Nordic blend) ───────────────────────────────────
  ('LSR-WEU-SM' , 'Sheet Metal Fabricator'  , 'Laser, press brake (W. Europe blend)'      ,  29.00, 'W. Europe', 'Sheet Metal'  , 'EUR', '€'  ,  31.61, 'Eurostat LCS W. Europe blend 2025'),
  ('LSR-WEU-PL' , 'Plastics Operator'       , 'Injection molding'                         ,  28.00, 'W. Europe', 'Plastics'     , 'EUR', '€'  ,  30.52, 'Eurostat LCS W. Europe blend 2025'),
  ('LSR-WEU-CNC', 'CNC Machinist'           , 'VMC, turning'                              ,  32.00, 'W. Europe', 'CNC Machining', 'EUR', '€'  ,  34.88, 'Eurostat LCS W. Europe blend 2025'),
  ('LSR-WEU-QA' , 'Quality Inspector'       , 'CMM, inspection'                           ,  26.00, 'W. Europe', 'Quality'      , 'EUR', '€'  ,  28.34, 'Eurostat LCS W. Europe blend 2025'),

  -- ── E. Europe (EUR — Poland/Czech blend) ─────────────────────────────────────
  ('LSR-EEU-SM' , 'Sheet Metal Worker'      , 'Laser, press brake (E. Europe blend)'      ,  10.00, 'E. Europe', 'Sheet Metal'  , 'EUR', '€'  ,  10.90, 'Eurostat LCS E. Europe 2025'),
  ('LSR-EEU-PL' , 'Plastics Operator'       , 'Injection molding'                         ,  10.00, 'E. Europe', 'Plastics'     , 'EUR', '€'  ,  10.90, 'Eurostat LCS E. Europe 2025'),
  ('LSR-EEU-CNC', 'CNC Machinist'           , 'VMC, turning'                              ,  12.00, 'E. Europe', 'CNC Machining', 'EUR', '€'  ,  13.08, 'Eurostat LCS E. Europe 2025'),
  ('LSR-EEU-QA' , 'Quality Inspector'       , 'CMM, inspection'                           ,   9.00, 'E. Europe', 'Quality'      , 'EUR', '€'  ,   9.81, 'Eurostat LCS E. Europe 2025'),

  -- ── UK (GBP — 1 GBP = 1.27 USD) ─────────────────────────────────────────────
  ('LSR-GBR-SM' , 'Sheet Metal Worker'      , 'Laser, press brake'                        ,  22.00, 'UK'       , 'Sheet Metal'  , 'GBP', '£'  ,  27.94, 'ONS ASHE 2025'),
  ('LSR-GBR-PL' , 'Plastics Operative'      , 'Injection molding'                         ,  22.00, 'UK'       , 'Plastics'     , 'GBP', '£'  ,  27.94, 'ONS ASHE 2025'),
  ('LSR-GBR-CNC', 'CNC Machinist'           , 'VMC, turning'                              ,  26.00, 'UK'       , 'CNC Machining', 'GBP', '£'  ,  33.02, 'ONS ASHE 2025'),
  ('LSR-GBR-QA' , 'Quality Inspector'       , 'CMM, inspection'                           ,  20.00, 'UK'       , 'Quality'      , 'GBP', '£'  ,  25.40, 'ONS ASHE 2025'),

  -- ── China (CNY — 1 CNY = 0.141 USD) ──────────────────────────────────────────
  ('LSR-CHN-SM' , 'Sheet Metal Worker'      , 'Laser, press brake'                        ,  28.00, 'China'    , 'Sheet Metal'  , 'CNY', '¥'  ,   3.94, 'MOHRSS China Wages 2025'),
  ('LSR-CHN-PL' , 'Plastics Operator'       , 'Injection molding'                         ,  26.00, 'China'    , 'Plastics'     , 'CNY', '¥'  ,   3.66, 'MOHRSS China Wages 2025'),
  ('LSR-CHN-CNC', 'CNC Machinist'           , 'VMC, turning'                              ,  32.00, 'China'    , 'CNC Machining', 'CNY', '¥'  ,   4.51, 'MOHRSS China Wages 2025'),
  ('LSR-CHN-QA' , 'Quality Inspector'       , 'CMM, inspection'                           ,  24.00, 'China'    , 'Quality'      , 'CNY', '¥'  ,   3.38, 'MOHRSS China Wages 2025'),

  -- ── Vietnam (USD — export-zone wages quoted in USD) ──────────────────────────
  ('LSR-VNM-SM' , 'Sheet Metal Worker'      , 'Laser, press brake'                        ,   3.00, 'Vietnam'  , 'Sheet Metal'  , 'USD', '$'  ,   3.00, 'ILO Vietnam Manufacturing Wages 2025'),
  ('LSR-VNM-PL' , 'Plastics Operator'       , 'Injection molding'                         ,   3.00, 'Vietnam'  , 'Plastics'     , 'USD', '$'  ,   3.00, 'ILO Vietnam Manufacturing Wages 2025'),
  ('LSR-VNM-CNC', 'CNC Machinist'           , 'VMC, turning'                              ,   3.50, 'Vietnam'  , 'CNC Machining', 'USD', '$'  ,   3.50, 'ILO Vietnam Manufacturing Wages 2025'),
  ('LSR-VNM-QA' , 'Quality Inspector'       , 'CMM, inspection'                           ,   2.50, 'Vietnam'  , 'Quality'      , 'USD', '$'  ,   2.50, 'ILO Vietnam Manufacturing Wages 2025'),

  -- ── Mexico (MXN — 1 MXN = 0.0571 USD; Monterrey/NL industrial zone) ─────────
  ('LSR-MEX-SM' , 'Operador metalmecánico'  , 'Laser, prensa dobladora'                   , 290.00, 'Mexico'   , 'Sheet Metal'  , 'MXN', 'MX$',  16.57, 'IMSS Mexico 2025 / Tetakawi Benchmark 2025-2026'),
  ('LSR-MEX-PL' , 'Operador plásticos'      , 'Inyección de plástico'                     , 280.00, 'Mexico'   , 'Plastics'     , 'MXN', 'MX$',  16.00, 'IMSS Mexico 2025 / Tetakawi Benchmark 2025-2026'),
  ('LSR-MEX-CNC', 'Maquinista CNC'          , 'VMC, torno CNC'                            , 340.00, 'Mexico'   , 'CNC Machining', 'MXN', 'MX$',  19.43, 'IMSS Mexico 2025 / Tetakawi Benchmark 2025-2026'),
  ('LSR-MEX-QA' , 'Inspector de calidad'    , 'CMM, inspección dimensional'               , 230.00, 'Mexico'   , 'Quality'      , 'MXN', 'MX$',  13.14, 'IMSS Mexico 2025 / Tetakawi Benchmark 2025-2026')

ON CONFLICT ON CONSTRAINT uq_lsr_benchmark_location_group DO UPDATE SET
  lhr               = EXCLUDED.lhr,
  lhr_usd_effective = EXCLUDED.lhr_usd_effective,
  currency          = EXCLUDED.currency,
  currency_symbol   = EXCLUDED.currency_symbol,
  labour_type       = EXCLUDED.labour_type,
  description       = EXCLUDED.description,
  reference         = EXCLUDED.reference,
  updated_at        = now();
