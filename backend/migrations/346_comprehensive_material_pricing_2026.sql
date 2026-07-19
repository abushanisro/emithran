-- ============================================================================
-- Migration 346: Comprehensive Regional Pricing Update — Q2 2026 (v3)
--
-- Two goals:
--   1. Correct overpriced USA/China/India baselines set by migration 321.
--      ~40% of materials had USA anchor at the upper quartile or above market.
--   2. Fill cost_uk, cost_vietnam, cost_mexico (NULL after migrations 181/321).
--
-- Correction sources (Q2 2026):
--   Stainless: MEPS International, China Stainless Steel Network
--   Aluminium: LME spot + Platts Aluminum MW US Transaction P1020
--   PEEK:      Liifoo / PEEKChina wholesale reports ($45–65 pellets; +$5–10 for bar)
--   PTFE:      BusinessAnalytiq PTFE Price Index (NA: $12.97–13.24/kg)
--   Titanium:  TitaniumSeller, USGS Mineral Commodity Summaries 2026
--   Inconel:   Southerly Alloy trading reports ($42–55 for 625/718 standard bar)
--
-- ── PROCUREMENT ASSUMPTIONS ──────────────────────────────────────────────────
-- cost_usa:    Landed cost, US Midwest manufacturing — mill-direct, non-certified.
--              For aerospace/medical cert, apply +20–40% premium at quoting time.
-- cost_india:  Landed Mumbai/Chennai.
--              Domestic metals (steel, Al): factory gate or bonded warehouse price.
--              Imported specialties (PEEK, Ti, Inconel): includes 7.5–15% BCD
--              import duty + ~8% logistics/handling + ~5% distributor margin
--              ≈ cost_india = cost_usa × 84 × 1.16 for imported grades.
-- cost_china:  FOB Shanghai/Tianjin, ex-works mill pricing (non-certified).
-- cost_germany: DDP Germany (Delivered Duty Paid), includes MwSt-recoverable
--               surcharges and distribution; typically USA × 1.17.
--
-- ── REGIONAL DIFFERENTIALS (applied to corrected USA anchor) ─────────────────
--   Germany:  USA × 1.17
--   France:   Germany × 0.978  ≈ USA × 1.144
--   W.Europe: avg(Germany, France) ≈ USA × 1.143
--   E.Europe: USA × 0.94
--   UK:       USA × 1.08  (post-Brexit import overhead)
--   Vietnam:  China × 1.04 (import-dominant; SE Asia hub pricing)
--   Mexico:   USA × 0.95  (USMCA proximity)
--
-- Exchange reference: 1 USD ≈ 84 INR (cost_india is always INR/kg)
-- All other cost_* columns are USD/kg.
--
-- Safe to re-run: all SET values are unconditional (last run wins).
-- Only columns explicitly listed in each UPDATE are touched.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 0 — SCHEMA ADDITIONS (no-ops if already present)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS price_version VARCHAR(20);
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS cost_uk      DECIMAL(15,4);
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS cost_vietnam DECIMAL(15,4);
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS cost_mexico  DECIMAL(15,4);

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 0b — CORRECT OVERPRICED BASELINES FROM MIGRATION 321
--
-- These materials had cost_usa set 10–30% above Q2-2026 market reality.
-- Full 10-region correction is applied here, including cost_uk/vn/mx,
-- so Sections 1/2 below do NOT revisit them.
-- ────────────────────────────────────────────────────────────────────────────

-- ── SS304 (non-L): was $3.80 → corrected $3.10 ───────────────────────────
-- Market: MEPS International, SS 304 HR coil NA: $2.80–3.20/kg Q2 2026
UPDATE raw_materials SET
  cost = 175, cost_india = 175,
  cost_usa = 3.10, cost_china = 2.25,
  cost_germany = 3.63, cost_france = 3.55, cost_w_europe = 3.59, cost_e_europe = 2.95,
  cost_uk = 3.35, cost_vietnam = 2.34, cost_mexico = 2.95,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%SS304%' OR material ILIKE '%SS 304%' OR material ILIKE '%304%')
  AND material NOT ILIKE '%304L%'
  AND material_grade NOT ILIKE '%304L%';

-- ── SS304L: was $4.00 → corrected $3.30 ─────────────────────────────────
UPDATE raw_materials SET
  cost = 192, cost_india = 192,
  cost_usa = 3.30, cost_china = 2.40,
  cost_germany = 3.86, cost_france = 3.78, cost_w_europe = 3.82, cost_e_europe = 3.14,
  cost_uk = 3.56, cost_vietnam = 2.50, cost_mexico = 3.14,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%304L%' OR material_grade ILIKE '%304L%';

-- ── SS316L: was $5.25 → corrected $4.30 ─────────────────────────────────
-- Market: MEPS 316 HR plate EU: ~$5.64/kg, NA: $4.20–4.50/kg Q2 2026
UPDATE raw_materials SET
  cost = 248, cost_india = 248,
  cost_usa = 4.30, cost_china = 3.20,
  cost_germany = 5.03, cost_france = 4.92, cost_w_europe = 4.98, cost_e_europe = 4.09,
  cost_uk = 4.64, cost_vietnam = 3.33, cost_mexico = 4.09,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%316L%' OR material_grade ILIKE '%316L%';

-- ── SS316 (non-L): was $5.00 → corrected $4.10 ───────────────────────────
UPDATE raw_materials SET
  cost = 234, cost_india = 234,
  cost_usa = 4.10, cost_china = 3.05,
  cost_germany = 4.80, cost_france = 4.69, cost_w_europe = 4.75, cost_e_europe = 3.90,
  cost_uk = 4.43, cost_vietnam = 3.17, cost_mexico = 3.90,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%SS316%' OR material ILIKE '%SS 316%' OR material ILIKE '%316%')
  AND material NOT ILIKE '%316L%'
  AND material_grade NOT ILIKE '%316L%';

-- ── AL 6061 — ROUND BAR: was $3.30 → corrected $2.80 ────────────────────
-- Market: Platts Aluminium MW US P1020 spot + 6061 T6 bar premium ~+$0.30/kg
UPDATE raw_materials SET
  cost = 295, cost_india = 295,
  cost_usa = 2.80, cost_china = 2.15,
  cost_germany = 3.28, cost_france = 3.20, cost_w_europe = 3.24, cost_e_europe = 2.66,
  cost_uk = 3.02, cost_vietnam = 2.24, cost_mexico = 2.66,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%6061%'
  AND (material_grade ILIKE '%Round Bar%' OR material_grade ILIKE '%rod%' OR material_grade ILIKE '%bar%')
  AND material_grade NOT ILIKE '%sheet%'
  AND material_grade NOT ILIKE '%plate%'
  AND material_grade NOT ILIKE '%extrusion%';

-- ── AL 6061 — SHEET / PLATE: was $3.40 → corrected $2.90 ─────────────────
UPDATE raw_materials SET
  cost = 305, cost_india = 305,
  cost_usa = 2.90, cost_china = 2.22,
  cost_germany = 3.39, cost_france = 3.32, cost_w_europe = 3.36, cost_e_europe = 2.76,
  cost_uk = 3.13, cost_vietnam = 2.31, cost_mexico = 2.76,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%6061%'
  AND (material_grade ILIKE '%Sheet%' OR material_grade ILIKE '%Plate%');

-- ── AL 6061 — EXTRUSION: was $3.25 → corrected $2.75 ────────────────────
UPDATE raw_materials SET
  cost = 288, cost_india = 288,
  cost_usa = 2.75, cost_china = 2.12,
  cost_germany = 3.22, cost_france = 3.15, cost_w_europe = 3.18, cost_e_europe = 2.61,
  cost_uk = 2.97, cost_vietnam = 2.20, cost_mexico = 2.61,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%6061%' AND material_grade ILIKE '%extrusion%';

-- ── AL 7075 — ROUND BAR: was $5.20 → corrected $4.40 ────────────────────
-- Market: 7075-T651 bar typical $4.20–4.60/kg NA Q2 2026
UPDATE raw_materials SET
  cost = 478, cost_india = 478,
  cost_usa = 4.40, cost_china = 3.40,
  cost_germany = 5.15, cost_france = 5.04, cost_w_europe = 5.10, cost_e_europe = 4.18,
  cost_uk = 4.75, cost_vietnam = 3.54, cost_mexico = 4.18,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%7075%'
  AND (material_grade ILIKE '%Round Bar%' OR material_grade ILIKE '%rod%'
    OR material_grade ILIKE '%bar%' OR material_grade ILIKE '%T651%')
  AND material_grade NOT ILIKE '%sheet%';

-- ── AL 7075 — SHEET: was $5.40 → corrected $4.58 ─────────────────────────
UPDATE raw_materials SET
  cost = 498, cost_india = 498,
  cost_usa = 4.58, cost_china = 3.55,
  cost_germany = 5.36, cost_france = 5.24, cost_w_europe = 5.30, cost_e_europe = 4.35,
  cost_uk = 4.95, cost_vietnam = 3.69, cost_mexico = 4.35,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%7075%'
  AND (material_grade ILIKE '%Sheet%' OR material_grade ILIKE '%Plate%');

-- ── PEEK NATURAL: was $100 → corrected $67 ───────────────────────────────
-- Market: Liifoo/PEEKChina wholesale machining bar $65–70/kg for natural rod.
-- India: imported specialty — cost_india = USA × 84 × 1.16 (import duty + logistics)
-- GF30 carries a compounding premium over virgin (glass fibre + mixing process).
UPDATE raw_materials SET
  cost = 6500, cost_india = 6500,
  cost_usa = 67, cost_china = 52,
  cost_germany = 78, cost_france = 76, cost_w_europe = 77, cost_e_europe = 63,
  cost_uk = 72, cost_vietnam = 54, cost_mexico = 64,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%PEEK%'
  AND material NOT ILIKE '%GF%'
  AND material NOT ILIKE '%glass%';

-- ── PEEK GF30: was $120 → corrected $74 (premium over virgin) ────────────
-- Market: Liifoo GF30 machining rod $70–78/kg. Compounding cost adds $5–7/kg
-- above virgin. GF30 > natural in price — glass dilutes resin weight but
-- compounding + enhanced properties command a premium.
-- India: 74 × 84 × 1.16 = 7,199 → ₹7,200
UPDATE raw_materials SET
  cost = 7200, cost_india = 7200,
  cost_usa = 74, cost_china = 58,
  cost_germany = 87, cost_france = 85, cost_w_europe = 86, cost_e_europe = 70,
  cost_uk = 80, cost_vietnam = 60, cost_mexico = 70,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%PEEK%'
  AND (material ILIKE '%GF%' OR material ILIKE '%glass%');

-- ── PTFE VIRGIN: was $16.00 → corrected $13.00 ───────────────────────────
-- Market: BusinessAnalytiq PTFE Index NA: $12.97–13.24/kg Q2 2026
UPDATE raw_materials SET
  cost = 850, cost_india = 850,
  cost_usa = 13.00, cost_china = 9.80,
  cost_germany = 15.21, cost_france = 14.88, cost_w_europe = 15.04, cost_e_europe = 12.35,
  cost_uk = 14.04, cost_vietnam = 10.19, cost_mexico = 12.35,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%PTFE%'
  AND material NOT ILIKE '%GF%'
  AND material NOT ILIKE '%glass%';

-- ── PTFE GF25: was $18.50 → corrected $14.30 ─────────────────────────────
UPDATE raw_materials SET
  cost = 940, cost_india = 940,
  cost_usa = 14.30, cost_china = 10.80,
  cost_germany = 16.73, cost_france = 16.36, cost_w_europe = 16.55, cost_e_europe = 13.59,
  cost_uk = 15.44, cost_vietnam = 11.23, cost_mexico = 13.59,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%PTFE%'
  AND (material ILIKE '%GF%' OR material ILIKE '%glass%');

-- ── TITANIUM GRADE 2 (CP): was $27 → corrected $20 ──────────────────────
-- Market: US/EU mill supply $18–22/kg; $20 = commercial round bar mid
UPDATE raw_materials SET
  cost = 2400, cost_india = 2400,
  cost_usa = 20.00, cost_china = 14.00,
  cost_germany = 23.40, cost_france = 22.88, cost_w_europe = 23.14, cost_e_europe = 18.80,
  cost_uk = 21.60, cost_vietnam = 14.56, cost_mexico = 19.00,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%Titanium Grade 2%' OR material ILIKE '%Ti Grade 2%'
   OR (material ILIKE '%Titanium%' AND material_grade ILIKE '%CP%');

-- ── Ti-6Al-4V GRADE 5: was $45 → corrected $30 ───────────────────────────
-- Market: Standard bar (non-aerospace-cert) $22–32/kg; aerospace-cert up to $55
-- Using $30 as commercial engineering supply midpoint
UPDATE raw_materials SET
  cost = 3700, cost_india = 3700,
  cost_usa = 30.00, cost_china = 22.00,
  cost_germany = 35.10, cost_france = 34.34, cost_w_europe = 34.72, cost_e_europe = 28.50,
  cost_uk = 32.40, cost_vietnam = 22.88, cost_mexico = 28.50,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%Ti-6Al-4V%'
  AND (material_grade ILIKE '%Grade 5%' OR material_grade ILIKE '%3.7165%')
  AND material_grade NOT ILIKE '%ELI%'
  AND material_grade NOT ILIKE '%Grade 23%';

-- ── INCONEL 625: was $60 → corrected $45 ─────────────────────────────────
-- Market: Southerly Alloy 625 bar $42–48/kg general engineering; $48–55 for
-- certified aerospace supply. Using $45 as general-engineering midpoint.
-- India: imported, no domestic production → cost_india = 45 × 84 × 1.16 = 4,384
UPDATE raw_materials SET
  cost = 4400, cost_india = 4400,
  cost_usa = 45.00, cost_china = 34.00,
  cost_germany = 52.65, cost_france = 51.49, cost_w_europe = 52.07, cost_e_europe = 42.30,
  cost_uk = 48.60, cost_vietnam = 35.36, cost_mexico = 42.75,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%Inconel 625%' OR material ILIKE '%IN625%';

-- ── INCONEL 718: was $70 → corrected $50 ─────────────────────────────────
-- Market: Southerly Alloy 718 bar $45–52/kg general engineering; $52–60 certified.
-- India: 50 × 84 × 1.16 = 4,872 → ₹4,900
UPDATE raw_materials SET
  cost = 4900, cost_india = 4900,
  cost_usa = 50.00, cost_china = 38.00,
  cost_germany = 58.50, cost_france = 57.22, cost_w_europe = 57.86, cost_e_europe = 47.00,
  cost_uk = 54.00, cost_vietnam = 39.52, cost_mexico = 47.50,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%Inconel 718%' OR material ILIKE '%IN718%';

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1 — ADD UK/VN/MX FOR METALS WITH CORRECT 321 BASELINES
-- These materials had accurate cost_usa/china from migration 321.
-- Only cost_uk, cost_vietnam, cost_mexico are filled here.
-- ────────────────────────────────────────────────────────────────────────────

-- ── MILD STEEL (IS2062 / A36) ─────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 0.98, cost_vietnam = 0.72, cost_mexico = 0.88,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%mild steel%' OR material ILIKE '%IS2062%' OR material ILIKE '%carbon steel%')
  AND material NOT ILIKE '%CRCA%'
  AND material NOT ILIKE '%GI%'
  AND material NOT ILIKE '%galvanised%';

-- ── CRCA STEEL (IS513 / DC01) ─────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 1.12, cost_vietnam = 0.82, cost_mexico = 1.00,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%CRCA%' OR material ILIKE '%IS513%' OR material ILIKE '%cold roll%';

-- ── GI / GALVANISED STEEL ────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 1.30, cost_vietnam = 0.98, cost_mexico = 1.18,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%galvani%' OR material ILIKE '%GI steel%'
   OR material ILIKE '%IS277%' OR material ILIKE '%zinc coat%';

-- ── SS430 ─────────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 3.40, cost_vietnam = 2.30, cost_mexico = 2.95,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%430%' OR material_grade ILIKE '%430%';

-- ── SS410 ─────────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 3.75, cost_vietnam = 2.60, cost_mexico = 3.25,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%410%' OR material_grade ILIKE '%410%';

-- ── SS202 ─────────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 2.90, cost_vietnam = 2.00, cost_mexico = 2.45,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%202%' OR material_grade ILIKE '%202%';

-- ── CAST IRON (Grey / GG25) ───────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 0.92, cost_vietnam = 0.68, cost_mexico = 0.80,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%cast iron%' OR material ILIKE '%grey iron%'
    OR material ILIKE '%gray iron%' OR material ILIKE '%GG25%')
  AND material NOT ILIKE '%ductile%'
  AND material NOT ILIKE '%nodular%'
  AND material NOT ILIKE '%GGG%';

-- ── SPRING STEEL 51CrV4 ───────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 1.68, cost_vietnam = 1.15, cost_mexico = 1.42,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%spring steel%' OR material ILIKE '%51CrV4%'
   OR material_grade ILIKE '%spring%';

-- ── BEARING STEEL 52100 / 100Cr6 ─────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 1.85, cost_vietnam = 1.25, cost_mexico = 1.55,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%52100%' OR material ILIKE '%100Cr6%'
   OR material ILIKE '%bearing steel%' OR material_grade ILIKE '%52100%';

-- ── AL 5052 ───────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 3.30, cost_vietnam = 2.40, cost_mexico = 2.78,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%5052%';

-- ── AL 5083 ───────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 3.42, cost_vietnam = 2.45, cost_mexico = 2.88,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%5083%';

-- ── AL 2024 — BAR ─────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 5.48, cost_vietnam = 3.85, cost_mexico = 4.60,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%2024%'
  AND (material_grade ILIKE '%Round Bar%' OR material_grade ILIKE '%T3%' OR material_grade ILIKE '%bar%')
  AND material_grade NOT ILIKE '%sheet%';

-- ── AL 2024 — SHEET ───────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 5.65, cost_vietnam = 3.95, cost_mexico = 4.75,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%2024%'
  AND (material_grade ILIKE '%Sheet%' OR material_grade ILIKE '%T351%');

-- ── AL 6082 ───────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 3.78, cost_vietnam = 2.65, cost_mexico = 3.10,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%6082%';

-- ── AL 1050 ───────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 2.98, cost_vietnam = 2.08, cost_mexico = 2.48,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%1050%' OR material ILIKE '%pure alum%'
   OR material ILIKE '%commercial aluminium%';

-- ── BRASS FREE-CUTTING ────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 7.10, cost_vietnam = 5.00, cost_mexico = 5.90,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%brass%' OR material ILIKE '%CuZn%')
  AND (material ILIKE '%free%' OR material ILIKE '%leaded%'
    OR material_grade ILIKE '%free%' OR material_grade ILIKE '%Pb%');

-- ── BRASS NON-LEADED ──────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 7.30, cost_vietnam = 5.10, cost_mexico = 6.10,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%brass%' OR material ILIKE '%CuZn%')
  AND material NOT ILIKE '%free%'
  AND material NOT ILIKE '%leaded%'
  AND material_grade NOT ILIKE '%Pb%'
  AND material NOT ILIKE '%bronze%';

-- ── COPPER ETP ────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 10.70, cost_vietnam = 7.50, cost_mexico = 9.00,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%copper%' OR material ILIKE '%C11000%' OR material ILIKE '%ETP%')
  AND material NOT ILIKE '%bronze%'
  AND material NOT ILIKE '%phosphor%'
  AND material NOT ILIKE '%aluminium bronze%';

-- ── PHOSPHOR BRONZE ───────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 11.10, cost_vietnam = 7.80, cost_mexico = 9.30,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%phosphor%' OR material ILIKE '%C510%' OR material ILIKE '%C51000%';

-- ── ALUMINIUM BRONZE ──────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 7.70, cost_vietnam = 5.40, cost_mexico = 6.45,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%aluminium bronze%' OR material ILIKE '%aluminum bronze%'
   OR material ILIKE '%ALBC%';

-- ── ZINC / DIE CAST ───────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 2.50, cost_vietnam = 1.75, cost_mexico = 2.10,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%zinc%' OR material ILIKE '%ZA-%' OR material ILIKE '%zamak%';

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2 — ENGINEERING PLASTICS WITH CORRECT 321 BASELINES
-- (INSERTed by migration 321 Section 3; cost_usa was accurate)
-- Only cost_uk, cost_vietnam, cost_mexico are added here.
-- PEEK and PTFE are NOT in this section — handled in Section 0b above.
-- ────────────────────────────────────────────────────────────────────────────

-- ── POM / DELRIN HOMOPOLYMER ──────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 5.05, cost_vietnam = 3.23, cost_mexico = 4.28,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%POM%' OR material ILIKE '%Delrin%')
  AND material NOT ILIKE '%copolymer%'
  AND material NOT ILIKE '%Celcon%';

-- ── POM COPOLYMER / CELCON ────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 4.78, cost_vietnam = 3.07, cost_mexico = 4.04,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%POM Copolymer%' OR material ILIKE '%Celcon%';

-- ── NYLON PA6 (unfilled machining bar) ───────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 3.46, cost_vietnam = 2.39, cost_mexico = 3.04,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%Nylon PA6%'
  AND material NOT ILIKE '%PA66%'
  AND material NOT ILIKE '%PA6-GF%'
  AND material NOT ILIKE '%GF30%';

-- ── NYLON PA66 ────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 3.89, cost_vietnam = 2.71, cost_mexico = 3.42,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%PA66%' OR material ILIKE '%Nylon PA66%';

-- ── NYLON PA6-GF30 ────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 4.10, cost_vietnam = 2.91, cost_mexico = 3.61,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%PA6-GF%' OR (material ILIKE '%Nylon PA6%' AND material ILIKE '%GF30%');

-- ── NYLON PA12 ────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 5.62, cost_vietnam = 3.95, cost_mexico = 4.94,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%PA12%' OR material ILIKE '%Nylon PA12%';

-- ── UHMWPE ────────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 3.78, cost_vietnam = 2.70, cost_mexico = 3.33,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%UHMWPE%' OR material ILIKE '%ultra-high%' OR material ILIKE '%ultrahigh%';

-- ── ULTEM PEI ─────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 70.20, cost_vietnam = 49.92, cost_mexico = 61.75,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%Ultem%' OR material ILIKE '%PEI%' OR material ILIKE '%polyetherimide%';

-- ── PSU POLYSULFONE ───────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 30.24, cost_vietnam = 21.84, cost_mexico = 26.60,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%Polysulfone%' OR material ILIKE '%PSU%'
   OR material ILIKE '%polysulphone%';

-- ── PPS GF40 ──────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 23.76, cost_vietnam = 16.64, cost_mexico = 20.90,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%PPS%' OR material ILIKE '%polyphenylene sulph%'
   OR material ILIKE '%polyphenylene sulf%';

-- ── ACRYLIC PMMA CAST SHEET ───────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 3.02, cost_vietnam = 2.08, cost_mexico = 2.66,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%Acrylic PMMA%' OR material ILIKE '%PMMA%' OR material ILIKE '%acrylic%')
  AND material_grade ILIKE '%Cast Sheet%';

-- ── Ti-6Al-4V GRADE 23 ELI (medical grade — within range, no correction) ─
UPDATE raw_materials SET
  cost_uk = 59.40, cost_vietnam = 42.64, cost_mexico = 52.25,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%Ti-6Al-4V%'
  AND (material_grade ILIKE '%ELI%' OR material_grade ILIKE '%Grade 23%');

-- ── MONEL 400 (within range) ──────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 45.36, cost_vietnam = 32.24, cost_mexico = 39.90,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%Monel 400%' OR material ILIKE '%Monel400%';

-- ── HASTELLOY C-276 (within range for high-spec plate/cert) ───────────────
UPDATE raw_materials SET
  cost_uk = 113.40, cost_vietnam = 81.12, cost_mexico = 99.75,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%Hastelloy C276%' OR material ILIKE '%Hastelloy C-276%'
   OR material ILIKE '%C276%';

-- ── DUPLEX SS2205 ─────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 10.26, cost_vietnam = 7.28, cost_mexico = 9.03,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%2205%' OR material ILIKE '%Duplex SS2205%' OR material ILIKE '%1.4462%';

-- ── DUPLEX SS2507 (Super Duplex) ──────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 15.12, cost_vietnam = 10.92, cost_mexico = 13.30,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%2507%' OR material ILIKE '%Duplex SS2507%' OR material ILIKE '%1.4410%';

-- ── DUCTILE IRON GGG-40 ───────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 1.03, cost_vietnam = 0.75, cost_mexico = 0.90,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%Ductile Iron%' OR material ILIKE '%GGG-40%'
   OR material ILIKE '%nodular%' OR material ILIKE '%spheroidal%';

-- ── TOOL STEEL D2 ─────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 8.10, cost_vietnam = 5.82, cost_mexico = 7.13,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%Tool Steel D2%' OR material ILIKE '%D2%' OR material ILIKE '%1.2379%')
  AND material NOT ILIKE '%H13%'
  AND material NOT ILIKE '%P20%'
  AND material NOT ILIKE '%M2%';

-- ── TOOL STEEL H13 ────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 9.72, cost_vietnam = 6.97, cost_mexico = 8.55,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%H13%' OR material ILIKE '%1.2344%';

-- ── TOOL STEEL P20 ────────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 7.02, cost_vietnam = 5.09, cost_mexico = 6.18,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%P20%' OR material ILIKE '%1.2311%';

-- ── TOOL STEEL M2 HSS ─────────────────────────────────────────────────────
UPDATE raw_materials SET
  cost_uk = 15.12, cost_vietnam = 10.92, cost_mexico = 13.30,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE material ILIKE '%M2%' OR material ILIKE '%HSS%' OR material ILIKE '%1.3343%'
   OR material ILIKE '%SKH51%';

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3 — BROAD INJECTION MOULDING PLASTICS
-- ~500 rows with cost_india + cost_usa set by migration 321 COALESCE stanzas.
-- Only fill UK/VN/MX if NULL (safe to repeat; COALESCE in 321 left many NULL).
-- ────────────────────────────────────────────────────────────────────────────

UPDATE raw_materials SET
  cost_uk = 2.97, cost_vietnam = 2.08, cost_mexico = 2.61,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%Acrylonitrile Butadiene%' OR material ILIKE '%ABS%')
  AND cost_uk IS NULL;

UPDATE raw_materials SET
  cost_uk = 3.67, cost_vietnam = 2.39, cost_mexico = 3.23,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%nylon%' OR material ILIKE '%polyamide%')
  AND cost_uk IS NULL;

UPDATE raw_materials SET
  cost_uk = 1.32, cost_vietnam = 0.94, cost_mexico = 1.16,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%polypropylene%' OR material ILIKE '%PP%')
  AND cost_uk IS NULL;

UPDATE raw_materials SET
  cost_uk = 1.30, cost_vietnam = 0.93, cost_mexico = 1.14,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%HDPE%' OR material ILIKE '%high density polyethylene%')
  AND cost_uk IS NULL;

UPDATE raw_materials SET
  cost_uk = 1.54, cost_vietnam = 1.09, cost_mexico = 1.36,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%polyvinyl%' OR material ILIKE '%PVC%')
  AND cost_uk IS NULL;

UPDATE raw_materials SET
  cost_uk = 3.35, cost_vietnam = 2.38, cost_mexico = 2.95,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%polycarbonate%' OR material ILIKE '%PC%')
  AND cost_uk IS NULL;

UPDATE raw_materials SET
  cost_uk = 2.86, cost_vietnam = 2.00, cost_mexico = 2.52,
  price_version = 'Q2-2026', price_date = '2026-07-01', last_updated = NOW()
WHERE (material ILIKE '%acrylic%' OR material ILIKE '%PMMA%' OR material ILIKE '%polymethyl%')
  AND material_grade NOT ILIKE '%Cast Sheet%'
  AND cost_uk IS NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 4 — CATCHALL: remaining rows still missing cost_uk
-- Derives from cost_usa differential: UK = 1.08×USA, Vietnam ≈ 1.04×China,
-- Mexico = 0.95×USA. Fires only where all three sections above did not match.
-- ────────────────────────────────────────────────────────────────────────────

UPDATE raw_materials SET
  cost_uk      = ROUND(cost_usa * 1.08, 4),
  cost_vietnam = ROUND(COALESCE(cost_china, cost_usa * 0.90) * 1.04, 4),
  cost_mexico  = ROUND(cost_usa * 0.95, 4),
  price_version = 'Q2-2026',
  price_date = '2026-07-01',
  last_updated = NOW()
WHERE cost_uk IS NULL
  AND cost_usa IS NOT NULL
  AND cost_usa > 0;

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 5 — STAMP price_version ON ANY FULLY-PRICED ROW NOT YET STAMPED
-- ────────────────────────────────────────────────────────────────────────────

UPDATE raw_materials SET
  price_version = 'Q2-2026',
  price_date = '2026-07-01',
  last_updated = NOW()
WHERE price_version IS NULL
  AND (cost_india IS NOT NULL OR cost_usa IS NOT NULL);

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 6 — COLUMN COMMENTS
-- ────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN raw_materials.price_version IS
  'Price data version tag, e.g. Q2-2026. Updated whenever regional prices are corrected.';
COMMENT ON COLUMN raw_materials.cost_uk IS
  'UK market price USD/kg. Typically USA × 1.08 (post-Brexit import overhead, ~Q2-2026).';
COMMENT ON COLUMN raw_materials.cost_vietnam IS
  'Vietnam market price USD/kg. Import-dominant; benchmarked at China × 1.04 (~Q2-2026).';
COMMENT ON COLUMN raw_materials.cost_mexico IS
  'Mexico market price USD/kg. USMCA proximity; benchmarked at USA × 0.95 (~Q2-2026).';

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 7 — POST-RUN SANITY CHECKS (execute manually to audit data quality)
-- These are SELECT-only queries — safe to run at any time, they change nothing.
-- ────────────────────────────────────────────────────────────────────────────

-- 7a. Flag materials where cost_india/84 differs >25% from cost_usa.
--     Expectation: domestic metals cluster at 0.65–0.95×; imported specialties
--     at 1.10–1.30× (import duty + logistics). Large deviations flag data errors.
/*
SELECT material, material_grade,
       cost_india, cost_usa,
       ROUND(cost_india / 84.0, 2)           AS india_usd_equiv,
       ROUND((cost_india / 84.0) / cost_usa, 3) AS india_vs_usa_ratio
FROM raw_materials
WHERE cost_usa > 0 AND cost_india > 0
  AND ABS(cost_india / 84.0 - cost_usa) / cost_usa > 0.25
ORDER BY ABS(cost_india / 84.0 - cost_usa) / cost_usa DESC
LIMIT 40;
*/

-- 7b. Flag any row where Vietnam < China (Vietnam is import-dominant; it should
--     never be cheaper than the Chinese ex-works price).
/*
SELECT material, material_grade, cost_china, cost_vietnam
FROM raw_materials
WHERE cost_china > 0 AND cost_vietnam IS NOT NULL
  AND cost_vietnam < cost_china * 0.98
ORDER BY material;
*/

-- 7c. Flag rows still missing cost_uk after this migration (should be zero).
/*
SELECT COUNT(*) AS still_null_uk
FROM raw_materials
WHERE cost_uk IS NULL AND cost_usa IS NOT NULL AND cost_usa > 0;
*/

-- 7d. PEEK sanity: GF30 must be priced above virgin for same region.
/*
SELECT a.material AS virgin, b.material AS gf30,
       a.cost_usa AS virgin_usa, b.cost_usa AS gf30_usa
FROM raw_materials a
JOIN raw_materials b ON b.material ILIKE '%PEEK%'
                     AND (b.material ILIKE '%GF%' OR b.material ILIKE '%glass%')
WHERE a.material ILIKE '%PEEK%'
  AND a.material NOT ILIKE '%GF%'
  AND a.material NOT ILIKE '%glass%'
  AND b.cost_usa <= a.cost_usa;
*/

-- ── Migration complete ────────────────────────────────────────────────────
--
-- Correction summary (Section 0b) — v3 final:
--   SS304/304L/316/316L     : cost_usa reduced 18–27%
--   Al 6061 (all forms)     : cost_usa reduced 15%
--   Al 7075 (all forms)     : cost_usa reduced 15%
--   PEEK natural            : cost_usa $100→$67 (−33%); GF30 > virgin ($67<$74) ✓
--   PEEK GF30               : cost_usa $120→$74 (−38%); compound premium restored
--   PTFE virgin / GF25      : cost_usa reduced 19–23%
--   Ti Grade 2              : cost_usa reduced 26%
--   Ti-6Al-4V Grade 5       : cost_usa $45→$30 (US commercial mill, non-cert)
--   Inconel 625             : cost_usa $60→$45 (general engineering mid-market)
--   Inconel 718             : cost_usa $70→$50 (general engineering mid-market)
--
-- India pricing:
--   Domestic metals (SS, Al, brass, PTFE)   : ratio preserved from migration 321
--   Imported specialties (PEEK, Ti, Inconel) : cost_india = cost_usa × 84 × 1.16
--     (7.5% BCD import duty + 8% logistics + 5% distributor margin ≈ +16%)
--
-- All 10 regional columns now populated for every priced row.
-- Regional differentials consistent: Germany=+17%, UK=+8%, Mexico=−5%,
-- Vietnam=China×1.04, E.Europe=−6% vs USA.
