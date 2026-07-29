-- Migration 362: Create surface_treatment_rates and consumable_prices tables.
-- Replaces SURFACE_TREATMENT_RATES and LOCATION_ABRASIVE_PRICE_PER_KG hardcodes
-- in default-rates.ts. All rates stored in USD; the cost engine converts to
-- local currency at query time using the exchange_rates table.
--
-- Safe to re-run: ON CONFLICT DO UPDATE.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── Surface treatment rates ───────────────────────────────────────────────────
-- treatment_type values match what classifySurfaceTreatment() returns:
--   anodize_type_ii, anodize_type_iii, zinc_plate, powder_coat, passivate, __default__
-- location = '__default__' row is the fallback when no location-specific row exists.

CREATE TABLE IF NOT EXISTS surface_treatment_rates (
  id               BIGSERIAL PRIMARY KEY,
  treatment_type   TEXT        NOT NULL,
  label            TEXT        NOT NULL,
  location         TEXT        NOT NULL DEFAULT '__default__',
  rate_per_m2_usd  NUMERIC(10,4) NOT NULL,
  min_lot_charge_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(treatment_type, location)
);

-- ── Consumable prices ─────────────────────────────────────────────────────────
-- consumable_type = 'garnet_abrasive' | 'cutting_fluid' | etc.
-- All prices in USD per unit.

CREATE TABLE IF NOT EXISTS consumable_prices (
  id               BIGSERIAL PRIMARY KEY,
  consumable_type  TEXT        NOT NULL,
  location         TEXT        NOT NULL DEFAULT '__default__',
  price_per_unit   NUMERIC(10,4) NOT NULL,
  unit             TEXT        NOT NULL DEFAULT 'kg',
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(consumable_type, location)
);

-- ════════════════════════════════════════════════════════════════════════════════
-- SEED: Surface Treatment Rates
-- Source: 2026 job-shop benchmarks. Rate per m² of treated surface.
-- Rates derived from: India 260 INR/m² ÷ 84 = $3.10, then market-adjusted by location.
-- ════════════════════════════════════════════════════════════════════════════════

INSERT INTO surface_treatment_rates (treatment_type, label, location, rate_per_m2_usd, min_lot_charge_usd, notes) VALUES

-- ── Global defaults (used when no location-specific row exists) ───────────────
('anodize_type_ii',  'Anodize Type II',           '__default__', 3.10,  9.52, '260 INR/m² ÷ 84'),
('anodize_type_iii', 'Hardcoat Anodize Type III', '__default__', 8.33, 17.86, '700 INR/m² ÷ 84'),
('zinc_plate',       'Zinc Plating',              '__default__', 1.79,  7.14, '150 INR/m² ÷ 84'),
('powder_coat',      'Powder Coating',            '__default__', 2.62,  8.33, '220 INR/m² ÷ 84'),
('passivate',        'Passivation',               '__default__', 1.43,  5.95, '120 INR/m² ÷ 84'),
('__default__',      'Surface Treatment',         '__default__', 2.98,  9.52, '250 INR/m² ÷ 84'),

-- ── India ─────────────────────────────────────────────────────────────────────
('anodize_type_ii',  'Anodize Type II',           'India', 3.10,  9.52, '260 INR/m²; min 800 INR/lot'),
('anodize_type_iii', 'Hardcoat Anodize Type III', 'India', 8.33, 17.86, '700 INR/m²; min 1500 INR/lot'),
('zinc_plate',       'Zinc Plating',              'India', 1.79,  7.14, '150 INR/m²; min 600 INR/lot'),
('powder_coat',      'Powder Coating',            'India', 2.62,  8.33, '220 INR/m²; min 700 INR/lot'),
('passivate',        'Passivation',               'India', 1.43,  5.95, '120 INR/m²; min 500 INR/lot'),
('__default__',      'Surface Treatment',         'India', 2.98,  9.52, 'Benchmark blended India rate'),

-- ── USA ──────────────────────────────────────────────────────────────────────
('anodize_type_ii',  'Anodize Type II',           'USA',  12.00, 35.00, '2026 US job-shop benchmark'),
('anodize_type_iii', 'Hardcoat Anodize Type III', 'USA',  32.00, 85.00, '2026 US job-shop benchmark'),
('zinc_plate',       'Zinc Plating',              'USA',   8.00, 25.00, '2026 US job-shop benchmark'),
('powder_coat',      'Powder Coating',            'USA',  10.00, 30.00, '2026 US job-shop benchmark'),
('passivate',        'Passivation',               'USA',   6.00, 20.00, '2026 US job-shop benchmark'),
('__default__',      'Surface Treatment',         'USA',  11.00, 32.00, 'Blended US benchmark'),

-- ── Germany ──────────────────────────────────────────────────────────────────
('anodize_type_ii',  'Anodize Type II',           'Germany',  14.00, 40.00, '2026 DE job-shop benchmark'),
('anodize_type_iii', 'Hardcoat Anodize Type III', 'Germany',  36.00, 95.00, '2026 DE job-shop benchmark'),
('zinc_plate',       'Zinc Plating',              'Germany',   9.50, 28.00, '2026 DE job-shop benchmark'),
('powder_coat',      'Powder Coating',            'Germany',  12.00, 35.00, '2026 DE job-shop benchmark'),
('passivate',        'Passivation',               'Germany',   7.00, 22.00, '2026 DE job-shop benchmark'),
('__default__',      'Surface Treatment',         'Germany',  13.00, 38.00, 'Blended DE benchmark'),

-- ── China ─────────────────────────────────────────────────────────────────────
('anodize_type_ii',  'Anodize Type II',           'China',  4.50, 12.00, '2026 CN job-shop benchmark'),
('anodize_type_iii', 'Hardcoat Anodize Type III', 'China', 11.00, 28.00, '2026 CN job-shop benchmark'),
('zinc_plate',       'Zinc Plating',              'China',  2.80,  8.00, '2026 CN job-shop benchmark'),
('powder_coat',      'Powder Coating',            'China',  3.50, 10.00, '2026 CN job-shop benchmark'),
('passivate',        'Passivation',               'China',  2.00,  6.00, '2026 CN job-shop benchmark'),
('__default__',      'Surface Treatment',         'China',  4.00, 11.00, 'Blended CN benchmark'),

-- ── Mexico ───────────────────────────────────────────────────────────────────
('anodize_type_ii',  'Anodize Type II',           'Mexico',  5.50, 14.00, '2026 MX job-shop benchmark'),
('anodize_type_iii', 'Hardcoat Anodize Type III', 'Mexico', 14.00, 35.00, '2026 MX job-shop benchmark'),
('zinc_plate',       'Zinc Plating',              'Mexico',  3.50,  9.00, '2026 MX job-shop benchmark'),
('powder_coat',      'Powder Coating',            'Mexico',  4.50, 12.00, '2026 MX job-shop benchmark'),
('passivate',        'Passivation',               'Mexico',  2.50,  7.00, '2026 MX job-shop benchmark'),
('__default__',      'Surface Treatment',         'Mexico',  5.00, 12.00, 'Blended MX benchmark')

ON CONFLICT (treatment_type, location) DO UPDATE SET
  label              = EXCLUDED.label,
  rate_per_m2_usd    = EXCLUDED.rate_per_m2_usd,
  min_lot_charge_usd = EXCLUDED.min_lot_charge_usd,
  notes              = EXCLUDED.notes,
  updated_at         = now();


-- ════════════════════════════════════════════════════════════════════════════════
-- SEED: Consumable Prices — Garnet Abrasive (80-mesh alluvial, delivered)
-- Source: 2026 job-shop quotes + import tariff schedules.
-- ════════════════════════════════════════════════════════════════════════════════

INSERT INTO consumable_prices (consumable_type, location, price_per_unit, unit, notes) VALUES

('garnet_abrasive', '__default__', 0.55, 'kg', 'USD default; imported garnet'),
('garnet_abrasive', 'India',       0.48, 'kg', '40 INR/kg ÷ 84 — domestic garnet (major producer)'),
('garnet_abrasive', 'USA',         0.55, 'kg', 'Imported garnet + logistics'),
('garnet_abrasive', 'China',       0.55, 'kg', '4.0 CNY/kg ÷ 7.24'),
('garnet_abrasive', 'Germany',     0.71, 'kg', '0.65 EUR/kg at EUR/USD=1.087'),
('garnet_abrasive', 'France',      0.67, 'kg', '0.62 EUR/kg at EUR/USD=1.087'),
('garnet_abrasive', 'W. Europe',   0.68, 'kg', '0.63 EUR/kg at EUR/USD=1.087'),
('garnet_abrasive', 'E. Europe',   0.54, 'kg', '0.50 EUR/kg at EUR/USD=1.087'),
('garnet_abrasive', 'UK',          0.73, 'kg', '0.58 GBP/kg at GBP/USD=1.26'),
('garnet_abrasive', 'Mexico',      0.57, 'kg', '10 MXN/kg ÷ 17.50'),
('garnet_abrasive', 'Vietnam',     0.55, 'kg', 'USD rate — local sourcing TBD'),
('garnet_abrasive', 'Other',       0.55, 'kg', 'USD default')

ON CONFLICT (consumable_type, location) DO UPDATE SET
  price_per_unit = EXCLUDED.price_per_unit,
  unit           = EXCLUDED.unit,
  notes          = EXCLUDED.notes,
  updated_at     = now();
