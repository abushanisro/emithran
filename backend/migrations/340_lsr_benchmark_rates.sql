-- Migration 340: Seed lhr_benchmark_rates with 10-location × 4-process-group benchmark LHR data
-- ════════════════════════════════════════════════════════════════════════════════
-- The lhr_benchmark_rates table already exists (renamed from lsr_benchmark_rates by
-- migration 342). This migration only seeds the 40 benchmark rows.
-- Safe to re-run — uses ON CONFLICT (location, process_group) DO UPDATE.
--
-- lhr: local currency/hr
-- lhr_usd_effective: pre-converted to USD via INR-pivot (lhr × defaultInrRate / 83.5)
--   India (INR, rate=1):      usd = lhr / 83.5
--   USA/Vietnam (USD, r=83.5): usd = lhr (pass-through)
--   China (CNY, rate=11.52):  usd = lhr × 11.52 / 83.5
--   EUR locations (rate=90.8): usd = lhr × 90.8 / 83.5
--   UK (GBP, rate=107.0):     usd = lhr × 107.0 / 83.5
--   Mexico (MXN, rate=4.77):  usd = lhr × 4.77 / 83.5
-- ════════════════════════════════════════════════════════════════════════════════

INSERT INTO lhr_benchmark_rates
  (labour_code, labour_type, description, lhr, location, process_group, currency, currency_symbol, lhr_usd_effective)
VALUES
-- ── India (INR → USD = lhr / 83.5) ───────────────────────────────────────────
('BM-IN-SM',  'Sheet Metal Operator',    'Benchmark LHR — India Sheet Metal',    95.00,  'India', 'Sheet Metal',   'INR', '₹',   1.14),
('BM-IN-CNC', 'CNC Machinist',           'Benchmark LHR — India CNC Machining', 110.00,  'India', 'CNC Machining', 'INR', '₹',   1.32),
('BM-IN-QA',  'Quality Inspector',       'Benchmark LHR — India Quality',        80.00,  'India', 'Quality',       'INR', '₹',   0.96),
('BM-IN-PL',  'Plastics Operator',       'Benchmark LHR — India Plastics',       95.00,  'India', 'Plastics',      'INR', '₹',   1.14),

-- ── USA (USD pass-through) ────────────────────────────────────────────────────
('BM-US-SM',  'Sheet Metal Fabricator',  'Benchmark LHR — USA Sheet Metal',      23.00,  'USA',   'Sheet Metal',   'USD', '$',  23.00),
('BM-US-CNC', 'CNC Machinist',           'Benchmark LHR — USA CNC Machining',    26.00,  'USA',   'CNC Machining', 'USD', '$',  26.00),
('BM-US-QA',  'Quality Inspector',       'Benchmark LHR — USA Quality',          20.00,  'USA',   'Quality',       'USD', '$',  20.00),
('BM-US-PL',  'Plastics Operator',       'Benchmark LHR — USA Plastics',         22.00,  'USA',   'Plastics',      'USD', '$',  22.00),

-- ── China (CNY × 11.52 / 83.5) ───────────────────────────────────────────────
('BM-CN-SM',  'Sheet Metal Operator',    'Benchmark LHR — China Sheet Metal',    28.00,  'China', 'Sheet Metal',   'CNY', '¥',   3.86),
('BM-CN-CNC', 'CNC Machinist',           'Benchmark LHR — China CNC Machining',  32.00,  'China', 'CNC Machining', 'CNY', '¥',   4.41),
('BM-CN-QA',  'Quality Inspector',       'Benchmark LHR — China Quality',        24.00,  'China', 'Quality',       'CNY', '¥',   3.31),
('BM-CN-PL',  'Plastics Operator',       'Benchmark LHR — China Plastics',       28.00,  'China', 'Plastics',      'CNY', '¥',   3.86),

-- ── Germany (EUR × 90.8 / 83.5) ──────────────────────────────────────────────
('BM-DE-SM',  'Sheet Metal Operator',    'Benchmark LHR — Germany Sheet Metal',  32.00,  'Germany', 'Sheet Metal',   'EUR', '€',  34.80),
('BM-DE-CNC', 'CNC Machinist',           'Benchmark LHR — Germany CNC Machining',35.00,  'Germany', 'CNC Machining', 'EUR', '€',  38.04),
('BM-DE-QA',  'Quality Inspector',       'Benchmark LHR — Germany Quality',      28.00,  'Germany', 'Quality',       'EUR', '€',  30.44),
('BM-DE-PL',  'Plastics Operator',       'Benchmark LHR — Germany Plastics',     30.00,  'Germany', 'Plastics',      'EUR', '€',  32.62),

-- ── France (EUR × 90.8 / 83.5) ───────────────────────────────────────────────
('BM-FR-SM',  'Sheet Metal Operator',    'Benchmark LHR — France Sheet Metal',   27.00,  'France', 'Sheet Metal',   'EUR', '€',  29.35),
('BM-FR-CNC', 'CNC Machinist',           'Benchmark LHR — France CNC Machining', 30.00,  'France', 'CNC Machining', 'EUR', '€',  32.62),
('BM-FR-QA',  'Quality Inspector',       'Benchmark LHR — France Quality',       24.00,  'France', 'Quality',       'EUR', '€',  26.10),
('BM-FR-PL',  'Plastics Operator',       'Benchmark LHR — France Plastics',      26.00,  'France', 'Plastics',      'EUR', '€',  28.25),

-- ── W. Europe (EUR × 90.8 / 83.5) ────────────────────────────────────────────
('BM-WE-SM',  'Sheet Metal Operator',    'Benchmark LHR — W. Europe Sheet Metal',  29.00, 'W. Europe', 'Sheet Metal',   'EUR', '€', 31.52),
('BM-WE-CNC', 'CNC Machinist',           'Benchmark LHR — W. Europe CNC Machining',32.00, 'W. Europe', 'CNC Machining', 'EUR', '€', 34.80),
('BM-WE-QA',  'Quality Inspector',       'Benchmark LHR — W. Europe Quality',      26.00, 'W. Europe', 'Quality',       'EUR', '€', 28.25),
('BM-WE-PL',  'Plastics Operator',       'Benchmark LHR — W. Europe Plastics',     28.00, 'W. Europe', 'Plastics',      'EUR', '€', 30.44),

-- ── E. Europe (EUR × 90.8 / 83.5) ────────────────────────────────────────────
('BM-EE-SM',  'Sheet Metal Operator',    'Benchmark LHR — E. Europe Sheet Metal',  10.00, 'E. Europe', 'Sheet Metal',   'EUR', '€', 10.87),
('BM-EE-CNC', 'CNC Machinist',           'Benchmark LHR — E. Europe CNC Machining',12.00, 'E. Europe', 'CNC Machining', 'EUR', '€', 13.05),
('BM-EE-QA',  'Quality Inspector',       'Benchmark LHR — E. Europe Quality',       9.00, 'E. Europe', 'Quality',       'EUR', '€',  9.79),
('BM-EE-PL',  'Plastics Operator',       'Benchmark LHR — E. Europe Plastics',     10.00, 'E. Europe', 'Plastics',      'EUR', '€', 10.87),

-- ── UK (GBP × 107.0 / 83.5) ──────────────────────────────────────────────────
('BM-UK-SM',  'Sheet Metal Operator',    'Benchmark LHR — UK Sheet Metal',       22.00,  'UK', 'Sheet Metal',   'GBP', '£',  28.19),
('BM-UK-CNC', 'CNC Machinist',           'Benchmark LHR — UK CNC Machining',     26.00,  'UK', 'CNC Machining', 'GBP', '£',  33.32),
('BM-UK-QA',  'Quality Inspector',       'Benchmark LHR — UK Quality',           20.00,  'UK', 'Quality',       'GBP', '£',  25.63),
('BM-UK-PL',  'Plastics Operator',       'Benchmark LHR — UK Plastics',          22.00,  'UK', 'Plastics',      'GBP', '£',  28.19),

-- ── Vietnam (USD pass-through) ────────────────────────────────────────────────
('BM-VN-SM',  'Sheet Metal Operator',    'Benchmark LHR — Vietnam Sheet Metal',   3.00,  'Vietnam', 'Sheet Metal',   'USD', '$',   3.00),
('BM-VN-CNC', 'CNC Machinist',           'Benchmark LHR — Vietnam CNC Machining', 3.50,  'Vietnam', 'CNC Machining', 'USD', '$',   3.50),
('BM-VN-QA',  'Quality Inspector',       'Benchmark LHR — Vietnam Quality',       2.50,  'Vietnam', 'Quality',       'USD', '$',   2.50),
('BM-VN-PL',  'Plastics Operator',       'Benchmark LHR — Vietnam Plastics',      3.00,  'Vietnam', 'Plastics',      'USD', '$',   3.00),

-- ── Mexico (MXN × 4.77 / 83.5) ───────────────────────────────────────────────
('BM-MX-SM',  'Sheet Metal Operator',    'Benchmark LHR — Mexico Sheet Metal',  290.00,  'Mexico', 'Sheet Metal',   'MXN', 'MX$', 16.57),
('BM-MX-CNC', 'CNC Machinist',           'Benchmark LHR — Mexico CNC Machining',340.00,  'Mexico', 'CNC Machining', 'MXN', 'MX$', 19.42),
('BM-MX-QA',  'Quality Inspector',       'Benchmark LHR — Mexico Quality',      230.00,  'Mexico', 'Quality',       'MXN', 'MX$', 13.15),
('BM-MX-PL',  'Plastics Operator',       'Benchmark LHR — Mexico Plastics',     280.00,  'Mexico', 'Plastics',      'MXN', 'MX$', 15.99)

ON CONFLICT (location, process_group) DO UPDATE SET
  labour_code       = EXCLUDED.labour_code,
  labour_type       = EXCLUDED.labour_type,
  description       = EXCLUDED.description,
  lhr               = EXCLUDED.lhr,
  currency          = EXCLUDED.currency,
  currency_symbol   = EXCLUDED.currency_symbol,
  lhr_usd_effective = EXCLUDED.lhr_usd_effective,
  updated_at        = now();
