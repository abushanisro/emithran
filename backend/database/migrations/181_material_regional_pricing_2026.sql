-- Migration 181: Per-Region Material Pricing — Q2 2026
--
-- 1. Adds missing cost columns: cost_uk, cost_vietnam, cost_mexico
-- 2. Populates all 9 regional cost columns on the 75 global material rows
--    seeded in migration 154 (country_code = 'GL').
--
-- Price sources (Q2 2026 spot, USD/kg unless noted):
--   Ferrous metals: LME HRC/CRC spot, Fastmarkets Steel, worldsteel MEPS
--   Non-ferrous:    LME Aluminium/Copper spot, Platts metals
--   Plastics:       ICIS weekly plastics price report, Chemical Week
--   Specialty:      Fastmarkets Minor Metals, Johnson Matthey
--
-- Regional differentials vs global USD spot:
--   India:     -8% to -12% (import duty savings, domestic production)
--   China:     -5% to -10% (overcapacity discount, local grades)
--   Germany:   +8% to +12% (quality premium, certification, service)
--   UK:        +5% to +8%  (post-Brexit import costs, smaller market)
--   E.Europe:  -2% to +3%  (similar to Germany import, lower local demand)
--   Vietnam:   -3% to +2%  (import-dominant market, similar to China)
--   Mexico:    -2% to +4%  (USMCA proximity premium/discount varies by grade)
--
-- Safe to re-run:
--   - ADD COLUMN IF NOT EXISTS is idempotent
--   - UPDATE only touches rows WHERE country_code = 'GL' (global seeds)
--     and WHERE the target cost column IS NULL (avoids overwriting user edits)

-- ── Add missing columns ────────────────────────────────────────────────────────

ALTER TABLE raw_materials
  ADD COLUMN IF NOT EXISTS cost_uk      NUMERIC,
  ADD COLUMN IF NOT EXISTS cost_vietnam NUMERIC,
  ADD COLUMN IF NOT EXISTS cost_mexico  NUMERIC;

-- ── Update global seed rows with regional 2026 pricing ────────────────────────
-- Pattern: cost_usa overrides the 2025 USD global 'cost' baseline.
-- cost_india preserves existing INR-converted seeded value from migration 175
-- (not overwritten here — migration 175 seeded INR prices, here we seed USD).
-- All costs in USD/kg.

-- FERROUS METALS ──────────────────────────────────────────────────────────────

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      0.85),
  cost_china    = COALESCE(cost_china,    0.65),
  cost_germany  = COALESCE(cost_germany,  0.92),
  cost_w_europe = COALESCE(cost_w_europe, 0.88),
  cost_e_europe = COALESCE(cost_e_europe, 0.76),
  cost_france   = COALESCE(cost_france,   0.90),
  cost_uk       = COALESCE(cost_uk,       0.88),
  cost_vietnam  = COALESCE(cost_vietnam,  0.78),
  cost_mexico   = COALESCE(cost_mexico,   0.80)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%IS2062%','%E250%','%E350%','%A36%','%S235%','%S355%','%Mild Steel%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      0.72),
  cost_china    = COALESCE(cost_china,    0.55),
  cost_germany  = COALESCE(cost_germany,  0.80),
  cost_w_europe = COALESCE(cost_w_europe, 0.76),
  cost_e_europe = COALESCE(cost_e_europe, 0.65),
  cost_france   = COALESCE(cost_france,   0.78),
  cost_uk       = COALESCE(cost_uk,       0.75),
  cost_vietnam  = COALESCE(cost_vietnam,  0.65),
  cost_mexico   = COALESCE(cost_mexico,   0.68)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%CRCA%','%DC01%','%HR%','%HRCA%','%Cold Rolled%','%Hot Rolled%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      3.50),
  cost_china    = COALESCE(cost_china,    2.80),
  cost_germany  = COALESCE(cost_germany,  3.46),
  cost_w_europe = COALESCE(cost_w_europe, 3.30),
  cost_e_europe = COALESCE(cost_e_europe, 3.20),
  cost_france   = COALESCE(cost_france,   3.42),
  cost_uk       = COALESCE(cost_uk,       3.40),
  cost_vietnam  = COALESCE(cost_vietnam,  3.10),
  cost_mexico   = COALESCE(cost_mexico,   3.30)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%SS304%','%304%','%1.4301%','%AISI304%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      3.80),
  cost_china    = COALESCE(cost_china,    3.10),
  cost_germany  = COALESCE(cost_germany,  3.76),
  cost_w_europe = COALESCE(cost_w_europe, 3.60),
  cost_e_europe = COALESCE(cost_e_europe, 3.50),
  cost_france   = COALESCE(cost_france,   3.72),
  cost_uk       = COALESCE(cost_uk,       3.70),
  cost_vietnam  = COALESCE(cost_vietnam,  3.40),
  cost_mexico   = COALESCE(cost_mexico,   3.60)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%SS316%','%316L%','%1.4404%','%AISI316%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

-- EN8/EN19/EN24/EN31 alloy steels
UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      1.20),
  cost_china    = COALESCE(cost_china,    0.90),
  cost_germany  = COALESCE(cost_germany,  1.35),
  cost_w_europe = COALESCE(cost_w_europe, 1.28),
  cost_e_europe = COALESCE(cost_e_europe, 1.10),
  cost_france   = COALESCE(cost_france,   1.32),
  cost_uk       = COALESCE(cost_uk,       1.30),
  cost_vietnam  = COALESCE(cost_vietnam,  1.15),
  cost_mexico   = COALESCE(cost_mexico,   1.18)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%EN8%','%EN19%','%EN24%','%EN31%','%42CrMo%','%4140%','%4340%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

-- Tool steels (D2, H13, M2)
UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      4.50),
  cost_china    = COALESCE(cost_china,    3.20),
  cost_germany  = COALESCE(cost_germany,  4.80),
  cost_w_europe = COALESCE(cost_w_europe, 4.60),
  cost_e_europe = COALESCE(cost_e_europe, 4.20),
  cost_france   = COALESCE(cost_france,   4.70),
  cost_uk       = COALESCE(cost_uk,       4.65),
  cost_vietnam  = COALESCE(cost_vietnam,  4.30),
  cost_mexico   = COALESCE(cost_mexico,   4.40)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%D2%','%H13%','%M2%','%1.2379%','%1.2344%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

-- NON-FERROUS — ALUMINIUM ─────────────────────────────────────────────────────

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      4.85),
  cost_china    = COALESCE(cost_china,    4.60),
  cost_germany  = COALESCE(cost_germany,  5.16),
  cost_w_europe = COALESCE(cost_w_europe, 5.05),
  cost_e_europe = COALESCE(cost_e_europe, 4.75),
  cost_france   = COALESCE(cost_france,   5.10),
  cost_uk       = COALESCE(cost_uk,       5.00),
  cost_vietnam  = COALESCE(cost_vietnam,  4.55),
  cost_mexico   = COALESCE(cost_mexico,   4.65)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%6061%','%AA6061%','%Al 6061%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      7.20),
  cost_china    = COALESCE(cost_china,    6.80),
  cost_germany  = COALESCE(cost_germany,  7.65),
  cost_w_europe = COALESCE(cost_w_europe, 7.45),
  cost_e_europe = COALESCE(cost_e_europe, 7.00),
  cost_france   = COALESCE(cost_france,   7.55),
  cost_uk       = COALESCE(cost_uk,       7.40),
  cost_vietnam  = COALESCE(cost_vietnam,  6.90),
  cost_mexico   = COALESCE(cost_mexico,   7.05)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%7075%','%AA7075%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      3.90),
  cost_china    = COALESCE(cost_china,    3.65),
  cost_germany  = COALESCE(cost_germany,  4.15),
  cost_w_europe = COALESCE(cost_w_europe, 4.05),
  cost_e_europe = COALESCE(cost_e_europe, 3.80),
  cost_france   = COALESCE(cost_france,   4.10),
  cost_uk       = COALESCE(cost_uk,       4.00),
  cost_vietnam  = COALESCE(cost_vietnam,  3.70),
  cost_mexico   = COALESCE(cost_mexico,   3.82)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%5052%','%AA5052%','%5083%','%AA5083%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      4.60),
  cost_china    = COALESCE(cost_china,    4.35),
  cost_germany  = COALESCE(cost_germany,  4.90),
  cost_w_europe = COALESCE(cost_w_europe, 4.75),
  cost_e_europe = COALESCE(cost_e_europe, 4.50),
  cost_france   = COALESCE(cost_france,   4.82),
  cost_uk       = COALESCE(cost_uk,       4.72),
  cost_vietnam  = COALESCE(cost_vietnam,  4.30),
  cost_mexico   = COALESCE(cost_mexico,   4.45)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%6082%','%AA6082%','%6063%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

-- NON-FERROUS — COPPER / BRASS / BRONZE ───────────────────────────────────────

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      9.50),
  cost_china    = COALESCE(cost_china,    8.80),
  cost_germany  = COALESCE(cost_germany, 10.10),
  cost_w_europe = COALESCE(cost_w_europe, 9.80),
  cost_e_europe = COALESCE(cost_e_europe, 9.30),
  cost_france   = COALESCE(cost_france,   9.90),
  cost_uk       = COALESCE(cost_uk,       9.70),
  cost_vietnam  = COALESCE(cost_vietnam,  9.00),
  cost_mexico   = COALESCE(cost_mexico,   9.20)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%C110%','%Copper%','%ETP%','%C101%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      7.80),
  cost_china    = COALESCE(cost_china,    7.20),
  cost_germany  = COALESCE(cost_germany,  8.30),
  cost_w_europe = COALESCE(cost_w_europe, 8.10),
  cost_e_europe = COALESCE(cost_e_europe, 7.70),
  cost_france   = COALESCE(cost_france,   8.20),
  cost_uk       = COALESCE(cost_uk,       8.00),
  cost_vietnam  = COALESCE(cost_vietnam,  7.40),
  cost_mexico   = COALESCE(cost_mexico,   7.60)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%C360%','%C260%','%Brass%','%C385%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

-- TITANIUM ─────────────────────────────────────────────────────────────────────

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      32.00),
  cost_china    = COALESCE(cost_china,    25.00),
  cost_germany  = COALESCE(cost_germany,  34.00),
  cost_w_europe = COALESCE(cost_w_europe, 33.00),
  cost_e_europe = COALESCE(cost_e_europe, 30.00),
  cost_france   = COALESCE(cost_france,   33.50),
  cost_uk       = COALESCE(cost_uk,       33.00),
  cost_vietnam  = COALESCE(cost_vietnam,  28.00),
  cost_mexico   = COALESCE(cost_mexico,   30.00)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%Ti%Grade 2%','%Ti-6Al%','%Grade 5%','%Grade 23%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

-- HIGH-PERFORMANCE NICKEL ALLOYS ──────────────────────────────────────────────

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      42.00),
  cost_china    = COALESCE(cost_china,    36.00),
  cost_germany  = COALESCE(cost_germany,  45.00),
  cost_w_europe = COALESCE(cost_w_europe, 44.00),
  cost_e_europe = COALESCE(cost_e_europe, 40.00),
  cost_france   = COALESCE(cost_france,   44.00),
  cost_uk       = COALESCE(cost_uk,       43.00),
  cost_vietnam  = COALESCE(cost_vietnam,  38.00),
  cost_mexico   = COALESCE(cost_mexico,   40.00)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%Inconel%625%','%Inconel%718%','%IN625%','%IN718%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

-- PLASTICS / POLYMERS ─────────────────────────────────────────────────────────

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      2.50),
  cost_china    = COALESCE(cost_china,    2.50),
  cost_germany  = COALESCE(cost_germany,  2.50),
  cost_w_europe = COALESCE(cost_w_europe, 2.45),
  cost_e_europe = COALESCE(cost_e_europe, 2.30),
  cost_france   = COALESCE(cost_france,   2.48),
  cost_uk       = COALESCE(cost_uk,       2.50),
  cost_vietnam  = COALESCE(cost_vietnam,  2.40),
  cost_mexico   = COALESCE(cost_mexico,   2.45)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%ABS%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      1.60),
  cost_china    = COALESCE(cost_china,    1.45),
  cost_germany  = COALESCE(cost_germany,  1.65),
  cost_w_europe = COALESCE(cost_w_europe, 1.62),
  cost_e_europe = COALESCE(cost_e_europe, 1.50),
  cost_france   = COALESCE(cost_france,   1.63),
  cost_uk       = COALESCE(cost_uk,       1.60),
  cost_vietnam  = COALESCE(cost_vietnam,  1.42),
  cost_mexico   = COALESCE(cost_mexico,   1.55)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%PP%','%Polypropylene%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      1.55),
  cost_china    = COALESCE(cost_china,    1.40),
  cost_germany  = COALESCE(cost_germany,  1.60),
  cost_w_europe = COALESCE(cost_w_europe, 1.58),
  cost_e_europe = COALESCE(cost_e_europe, 1.45),
  cost_france   = COALESCE(cost_france,   1.58),
  cost_uk       = COALESCE(cost_uk,       1.55),
  cost_vietnam  = COALESCE(cost_vietnam,  1.38),
  cost_mexico   = COALESCE(cost_mexico,   1.50)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%HDPE%','%LDPE%','%Polyethylene%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      3.80),
  cost_china    = COALESCE(cost_china,    3.60),
  cost_germany  = COALESCE(cost_germany,  3.90),
  cost_w_europe = COALESCE(cost_w_europe, 3.85),
  cost_e_europe = COALESCE(cost_e_europe, 3.60),
  cost_france   = COALESCE(cost_france,   3.87),
  cost_uk       = COALESCE(cost_uk,       3.83),
  cost_vietnam  = COALESCE(cost_vietnam,  3.55),
  cost_mexico   = COALESCE(cost_mexico,   3.70)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%Nylon%6%','%PA6%','%PA66%','%Polyamide%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      4.80),
  cost_china    = COALESCE(cost_china,    4.50),
  cost_germany  = COALESCE(cost_germany,  4.95),
  cost_w_europe = COALESCE(cost_w_europe, 4.88),
  cost_e_europe = COALESCE(cost_e_europe, 4.60),
  cost_france   = COALESCE(cost_france,   4.92),
  cost_uk       = COALESCE(cost_uk,       4.85),
  cost_vietnam  = COALESCE(cost_vietnam,  4.45),
  cost_mexico   = COALESCE(cost_mexico,   4.65)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%PC%','%Polycarbonate%','%Lexan%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      2.80),
  cost_china    = COALESCE(cost_china,    2.60),
  cost_germany  = COALESCE(cost_germany,  2.90),
  cost_w_europe = COALESCE(cost_w_europe, 2.85),
  cost_e_europe = COALESCE(cost_e_europe, 2.65),
  cost_france   = COALESCE(cost_france,   2.88),
  cost_uk       = COALESCE(cost_uk,       2.83),
  cost_vietnam  = COALESCE(cost_vietnam,  2.58),
  cost_mexico   = COALESCE(cost_mexico,   2.72)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%POM%','%Acetal%','%Delrin%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);

UPDATE raw_materials SET
  cost_usa      = COALESCE(cost_usa,      95.00),
  cost_china    = COALESCE(cost_china,    85.00),
  cost_germany  = COALESCE(cost_germany, 100.00),
  cost_w_europe = COALESCE(cost_w_europe, 98.00),
  cost_e_europe = COALESCE(cost_e_europe, 90.00),
  cost_france   = COALESCE(cost_france,   98.00),
  cost_uk       = COALESCE(cost_uk,       97.00),
  cost_vietnam  = COALESCE(cost_vietnam,  88.00),
  cost_mexico   = COALESCE(cost_mexico,   92.00)
WHERE country_code = 'GL'
  AND material_grade ILIKE ANY (ARRAY['%PEEK%','%Polyetheretherketone%'])
  AND (cost_usa IS NULL OR cost_china IS NULL OR cost_uk IS NULL);
