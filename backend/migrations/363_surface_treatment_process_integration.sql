-- Migration 363: Surface Treatment + Consumable Tables (self-contained)
-- Absorbs migration 362 (CREATE TABLE) so this file runs cleanly even if
-- 362 was never deployed. Safe to re-run: all CREATE TABLE use IF NOT EXISTS
-- and all INSERTs use ON CONFLICT … DO UPDATE.
--
-- What this migration does:
--   1. Creates surface_treatment_rates and consumable_prices tables (if absent)
--   2. Adds process_operation column to surface_treatment_rates — canonical name
--      from process_calculator_mappings — so rate lookup goes via the process DB,
--      not hardcoded regex keys.
--   3. Seeds rates in USD for all locations and all process DB operation names.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Table definitions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS surface_treatment_rates (
  id                 BIGSERIAL PRIMARY KEY,
  treatment_type     TEXT          NOT NULL,
  label              TEXT          NOT NULL,
  location           TEXT          NOT NULL DEFAULT '__default__',
  rate_per_m2_usd    NUMERIC(10,4) NOT NULL,
  min_lot_charge_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  process_operation  VARCHAR(255),   -- canonical name from process_calculator_mappings
  notes              TEXT,
  created_at         TIMESTAMPTZ   DEFAULT now(),
  updated_at         TIMESTAMPTZ   DEFAULT now(),
  UNIQUE(treatment_type, location)
);

CREATE TABLE IF NOT EXISTS consumable_prices (
  id             BIGSERIAL PRIMARY KEY,
  consumable_type TEXT          NOT NULL,
  location        TEXT          NOT NULL DEFAULT '__default__',
  price_per_unit  NUMERIC(10,4) NOT NULL,
  unit            TEXT          NOT NULL DEFAULT 'kg',
  notes           TEXT,
  created_at      TIMESTAMPTZ   DEFAULT now(),
  updated_at      TIMESTAMPTZ   DEFAULT now(),
  UNIQUE(consumable_type, location)
);

-- Add process_operation column if the table pre-existed from migration 362
ALTER TABLE surface_treatment_rates
  ADD COLUMN IF NOT EXISTS process_operation VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_str_process_operation
  ON surface_treatment_rates(process_operation);

-- ── 2. Seed surface_treatment_rates ─────────────────────────────────────────
-- All rates in USD/m². Cost engine converts to local currency at query time.
-- treatment_type = internal key used by classifySurfaceTreatment() regex fallback.
-- process_operation = canonical name from process_calculator_mappings (primary lookup).

INSERT INTO surface_treatment_rates
  (treatment_type, label, location, rate_per_m2_usd, min_lot_charge_usd, process_operation, notes)
VALUES

-- ── Global defaults ────────────────────────────────────────────────────────
('anodize_type_ii',  'Anodize Type II',           '__default__',  3.10,  9.52, 'Anodizing Type II',   '260 INR/m² ÷ 84'),
('anodize_type_iii', 'Hardcoat Anodize Type III', '__default__',  8.33, 17.86, 'Type III Hardcoat',   '700 INR/m² ÷ 84'),
('zinc_plate',       'Zinc Plating',              '__default__',  1.79,  7.14, 'Zinc Plating',        '150 INR/m² ÷ 84'),
('powder_coat',      'Powder Coating',            '__default__',  2.62,  8.33, 'Powder Coating',      '220 INR/m² ÷ 84'),
('passivate',        'Passivation',               '__default__',  1.43,  5.95, 'Passivation',         '120 INR/m² ÷ 84'),
('__default__',      'Surface Treatment',         '__default__',  2.98,  9.52, NULL,                  '250 INR/m² ÷ 84 — blended fallback'),

-- ── India ──────────────────────────────────────────────────────────────────
('anodize_type_ii',  'Anodize Type II',           'India',  3.10,  9.52, 'Anodizing Type II',  '260 INR/m²; min 800 INR/lot'),
('anodize_type_iii', 'Hardcoat Anodize Type III', 'India',  8.33, 17.86, 'Type III Hardcoat',  '700 INR/m²; min 1500 INR/lot'),
('zinc_plate',       'Zinc Plating',              'India',  1.79,  7.14, 'Zinc Plating',       '150 INR/m²; min 600 INR/lot'),
('powder_coat',      'Powder Coating',            'India',  2.62,  8.33, 'Powder Coating',     '220 INR/m²; min 700 INR/lot'),
('passivate',        'Passivation',               'India',  1.43,  5.95, 'Passivation',        '120 INR/m²; min 500 INR/lot'),
('__default__',      'Surface Treatment',         'India',  2.98,  9.52, NULL,                 'Benchmark blended India rate'),

-- ── USA ────────────────────────────────────────────────────────────────────
('anodize_type_ii',  'Anodize Type II',           'USA',  12.00, 35.00, 'Anodizing Type II',  '2026 US job-shop benchmark'),
('anodize_type_iii', 'Hardcoat Anodize Type III', 'USA',  32.00, 85.00, 'Type III Hardcoat',  '2026 US job-shop benchmark'),
('zinc_plate',       'Zinc Plating',              'USA',   8.00, 25.00, 'Zinc Plating',       '2026 US job-shop benchmark'),
('powder_coat',      'Powder Coating',            'USA',  10.00, 30.00, 'Powder Coating',     '2026 US job-shop benchmark'),
('passivate',        'Passivation',               'USA',   6.00, 20.00, 'Passivation',        '2026 US job-shop benchmark'),
('__default__',      'Surface Treatment',         'USA',  11.00, 32.00, NULL,                 'Blended US benchmark'),

-- ── Germany ────────────────────────────────────────────────────────────────
('anodize_type_ii',  'Anodize Type II',           'Germany',  14.00, 40.00, 'Anodizing Type II',  '2026 DE benchmark'),
('anodize_type_iii', 'Hardcoat Anodize Type III', 'Germany',  36.00, 95.00, 'Type III Hardcoat',  '2026 DE benchmark'),
('zinc_plate',       'Zinc Plating',              'Germany',   9.50, 28.00, 'Zinc Plating',       '2026 DE benchmark'),
('powder_coat',      'Powder Coating',            'Germany',  12.00, 35.00, 'Powder Coating',     '2026 DE benchmark'),
('passivate',        'Passivation',               'Germany',   7.00, 22.00, 'Passivation',        '2026 DE benchmark'),
('__default__',      'Surface Treatment',         'Germany',  13.00, 38.00, NULL,                 'Blended DE benchmark'),

-- ── France ─────────────────────────────────────────────────────────────────
('anodize_type_ii',  'Anodize Type II',           'France',  13.00, 38.00, 'Anodizing Type II',  '2026 FR benchmark'),
('anodize_type_iii', 'Hardcoat Anodize Type III', 'France',  34.00, 90.00, 'Type III Hardcoat',  '2026 FR benchmark'),
('zinc_plate',       'Zinc Plating',              'France',   8.50, 26.00, 'Zinc Plating',       '2026 FR benchmark'),
('powder_coat',      'Powder Coating',            'France',  11.00, 32.00, 'Powder Coating',     '2026 FR benchmark'),
('passivate',        'Passivation',               'France',   6.50, 20.00, 'Passivation',        '2026 FR benchmark'),
('__default__',      'Surface Treatment',         'France',  12.00, 35.00, NULL,                 'Blended FR benchmark'),

-- ── W. Europe ──────────────────────────────────────────────────────────────
('anodize_type_ii',  'Anodize Type II',           'W. Europe',  13.50, 39.00, 'Anodizing Type II',  '2026 W.EU benchmark'),
('anodize_type_iii', 'Hardcoat Anodize Type III', 'W. Europe',  35.00, 92.00, 'Type III Hardcoat',  '2026 W.EU benchmark'),
('zinc_plate',       'Zinc Plating',              'W. Europe',   9.00, 27.00, 'Zinc Plating',       '2026 W.EU benchmark'),
('powder_coat',      'Powder Coating',            'W. Europe',  11.50, 33.00, 'Powder Coating',     '2026 W.EU benchmark'),
('passivate',        'Passivation',               'W. Europe',   6.80, 21.00, 'Passivation',        '2026 W.EU benchmark'),
('__default__',      'Surface Treatment',         'W. Europe',  12.50, 36.00, NULL,                 'Blended W.EU benchmark'),

-- ── China ──────────────────────────────────────────────────────────────────
('anodize_type_ii',  'Anodize Type II',           'China',  4.50, 12.00, 'Anodizing Type II',  '2026 CN benchmark'),
('anodize_type_iii', 'Hardcoat Anodize Type III', 'China', 11.00, 28.00, 'Type III Hardcoat',  '2026 CN benchmark'),
('zinc_plate',       'Zinc Plating',              'China',  2.80,  8.00, 'Zinc Plating',       '2026 CN benchmark'),
('powder_coat',      'Powder Coating',            'China',  3.50, 10.00, 'Powder Coating',     '2026 CN benchmark'),
('passivate',        'Passivation',               'China',  2.00,  6.00, 'Passivation',        '2026 CN benchmark'),
('__default__',      'Surface Treatment',         'China',  4.00, 11.00, NULL,                 'Blended CN benchmark'),

-- ── Mexico ─────────────────────────────────────────────────────────────────
('anodize_type_ii',  'Anodize Type II',           'Mexico',  5.50, 14.00, 'Anodizing Type II',  '2026 MX benchmark'),
('anodize_type_iii', 'Hardcoat Anodize Type III', 'Mexico', 14.00, 35.00, 'Type III Hardcoat',  '2026 MX benchmark'),
('zinc_plate',       'Zinc Plating',              'Mexico',  3.50,  9.00, 'Zinc Plating',       '2026 MX benchmark'),
('powder_coat',      'Powder Coating',            'Mexico',  4.50, 12.00, 'Powder Coating',     '2026 MX benchmark'),
('passivate',        'Passivation',               'Mexico',  2.50,  7.00, 'Passivation',        '2026 MX benchmark'),
('__default__',      'Surface Treatment',         'Mexico',  5.00, 12.00, NULL,                 'Blended MX benchmark'),

-- ── Additional process DB operations at __default__ ───────────────────────
-- treatment_type = canonical operation name (process_operation = same value)
-- so both lookup paths resolve to the same row.
('Anodizing Type I',      'Anodize Type I (Chromic)',    '__default__',  6.00, 30.00, 'Anodizing Type I',      'Chromic acid anodize'),
('Anodizing Type II',     'Anodize Type II (Sulfuric)',  '__default__',  8.00, 35.00, 'Anodizing Type II',     'Duplicate row keyed by canonical name for direct process_operation lookup'),
('Anodizing Type III',    'Hard Anodize Type III',       '__default__', 14.00, 55.00, 'Anodizing Type III',    'Hardcoat — wear resistance up to 70µm'),
('Type III Hardcoat',     'Type III Hardcoat',           '__default__', 14.00, 55.00, 'Type III Hardcoat',     'Alias — direct process_operation lookup'),
('Anodise',               'Anodise (generic)',           '__default__',  8.00, 35.00, 'Anodise',               'Alias for Type II when type not specified'),
('Hard Anodising',        'Hard Anodising',              '__default__', 14.00, 55.00, 'Hard Anodising',        'Hard anodise alias'),
('Powder Coat',           'Powder Coat (Sheet Metal)',   '__default__', 10.00, 40.00, 'Powder Coat',           'SM process route name'),
('Powder Coating',        'Powder Coating',              '__default__', 10.00, 40.00, 'Powder Coating',        'Post Processing route name — same rate'),
('Paint',                 'Paint',                       '__default__',  5.00, 25.00, 'Paint',                 'Generic liquid paint'),
('ED Coating',            'ED Coat / E-Coat',            '__default__', 12.00, 50.00, 'ED Coating',            'Electrodeposition primer'),
('Zinc Plating',          'Zinc Plating',                '__default__',  7.00, 22.00, 'Zinc Plating',          'Direct canonical name lookup'),
('Zinc Nickel plating',   'Zinc-Nickel Plating',         '__default__', 16.00, 55.00, 'Zinc Nickel plating',   'High-corrosion alloy plate'),
('Nickel Chrome Plating', 'Nickel + Chrome Plating',     '__default__', 22.00, 70.00, 'Nickel Chrome Plating', 'Duplex Ni/Cr plate'),
('Hard Chrome plating',   'Hard Chrome Plating',         '__default__', 28.00, 80.00, 'Hard Chrome plating',   'Functional hard chrome'),
('Nickel Plating',        'Nickel Plating',              '__default__', 12.00, 40.00, 'Nickel Plating',        ''),
('Chrome Plating',        'Chrome Plating',              '__default__', 18.00, 60.00, 'Chrome Plating',        ''),
('Electroless Nickel',    'Electroless Nickel (EN)',      '__default__', 14.00, 45.00, 'Electroless Nickel',    'Autocatalytic Ni'),
('Tin Plating',           'Tin Plating',                 '__default__',  9.00, 35.00, 'Tin Plating',           'RoHS-compliant Sn'),
('Passivation',           'Passivation',                 '__default__',  6.00, 20.00, 'Passivation',           'Direct canonical name lookup'),
('Black Oxide',           'Black Oxide / Blackening',    '__default__',  3.50, 15.00, 'Black Oxide',           ''),
('Blackning',             'Blackening',                  '__default__',  3.50, 15.00, 'Blackning',             'Process DB spelling'),
('PVD Coating',           'PVD Coating',                 '__default__', 30.00, 90.00, 'PVD Coating',           'Physical vapour deposition'),
('CVD Coating',           'CVD Coating',                 '__default__', 35.00,100.00, 'CVD Coating',           'Chemical vapour deposition'),
('Phosphating',           'Phosphating',                 '__default__',  2.50, 12.00, 'Phosphating',           'Zinc phosphate pre-treatment'),
('Degrease',              'Degreasing',                  '__default__',  1.00,  8.00, 'Degrease',              'Alkaline degrease')

ON CONFLICT (treatment_type, location) DO UPDATE SET
  label              = EXCLUDED.label,
  rate_per_m2_usd    = EXCLUDED.rate_per_m2_usd,
  min_lot_charge_usd = EXCLUDED.min_lot_charge_usd,
  process_operation  = EXCLUDED.process_operation,
  notes              = EXCLUDED.notes,
  updated_at         = now();

-- ── 3. Backfill process_operation for any rows added by migration 362 ────────
UPDATE surface_treatment_rates SET process_operation = 'Anodizing Type II'  WHERE treatment_type = 'anodize_type_ii'  AND process_operation IS NULL;
UPDATE surface_treatment_rates SET process_operation = 'Type III Hardcoat'  WHERE treatment_type = 'anodize_type_iii' AND process_operation IS NULL;
UPDATE surface_treatment_rates SET process_operation = 'Powder Coating'     WHERE treatment_type = 'powder_coat'      AND process_operation IS NULL;
UPDATE surface_treatment_rates SET process_operation = 'Zinc Plating'       WHERE treatment_type = 'zinc_plate'       AND process_operation IS NULL;
UPDATE surface_treatment_rates SET process_operation = 'Passivation'        WHERE treatment_type = 'passivate'        AND process_operation IS NULL;

-- ── 4. Seed consumable_prices (garnet abrasive) ──────────────────────────────

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
