-- Migration 180: Global Labour Hour Rate (LHR) Benchmarks — 9 Locations × 4 Skill Tiers
--
-- Seeds LHR benchmarks for all non-India manufacturing locations.
-- Replaces the hardcoded LOCATION_LHR_DEFAULTS object in default-rates.ts.
--
-- Sources (2026):
--   USA:      BLS Occupational Employment and Wage Statistics (OES), May 2025
--   China:    MOLSS/CEIC wage index, PRD/YRD composite, 2025
--   Germany:  Eurostat Labour Costs Survey 2025, IG Metall collective agreement
--   France:   INSEE labour costs 2025, UIMM collective agreement
--   W.Europe: Eurostat composite (NL/BE/AT/CH)
--   E.Europe: Eurostat composite (PL/CZ/RO/HU); PLN/CZK/RON converted to EUR
--   UK:       ONS Annual Survey of Hours and Earnings 2025, EEF survey
--   Vietnam:  GSO Vietnam wage survey 2025, VSM member data
--   Mexico:   INEGI ENOE Q4 2025, CANACINTRA metal-mechanic benchmark
--
-- All rates stored in local currency. USD effective rates pre-computed.
-- skill_level: 1=unskilled, 2=semi-skilled, 3=skilled, 4=highly_skilled
--
-- Safe to re-run: guarded by WHERE NOT EXISTS on (labour_code).

-- ── Prerequisites ─────────────────────────────────────────────────────────────

-- 1. Allow benchmark rows (no owner).
ALTER TABLE lhr_records ALTER COLUMN user_id DROP NOT NULL;

-- 2. Add columns needed by migration 180 and the retrieval service.
--    These are all new — the original lsr/lhr table only had India-centric fields.
ALTER TABLE lhr_records
  ADD COLUMN IF NOT EXISTS country_code            VARCHAR(5),    -- ISO: US, DE, CN, etc.
  ADD COLUMN IF NOT EXISTS labour_family           VARCHAR(50),   -- general | cnc | quality
  ADD COLUMN IF NOT EXISTS skill_level             SMALLINT,      -- 1=unskilled … 4=highly_skilled
  ADD COLUMN IF NOT EXISTS source_type             VARCHAR(30),   -- BENCHMARK | USER
  ADD COLUMN IF NOT EXISTS currency_code           VARCHAR(5);    -- USD, EUR, GBP, CNY, VND, MXN

-- 3. Widen SELECT policy so benchmark rows (user_id IS NULL) are readable.
DROP POLICY IF EXISTS "Users can view their own LHR records"      ON lhr_records;
DROP POLICY IF EXISTS "Authorized users can view LHR records"     ON lhr_records;
CREATE POLICY "Authorized users can view LHR records"
  ON lhr_records FOR SELECT
  USING (is_user_authorized() AND (user_id IS NULL OR auth.uid() = user_id));

-- ── Seed ──────────────────────────────────────────────────────────────────────

INSERT INTO lhr_records
  (labour_code, labour_type, description,
   lhr, usd_labor_rate_per_hr, usd_lhr_total,
   currency, currency_code, country_code, location,
   labour_family, skill_level, employer_burden_percentage,
   source_type)

SELECT
  v.labour_code, v.labour_type, v.description,
  v.lhr_local, v.lhr_usd, v.lhr_usd,
  v.currency, v.currency, v.country_code, v.location,
  v.labour_family, v.skill_level::smallint, v.burden_pct,
  'BENCHMARK'
FROM (VALUES

  -- ── USA (USD) ──────────────────────────────────────────────────────────────
  -- Employer burden ~30% on top of base wage (FICA, FUTA, health, 401k)
  ('LHR-US-US-001','Unskilled',        'General operator, machine tending. US fed/state minimum wage compliance. Burden: FICA 7.65% + benefits.',                20.00, 20.00, 'USD','US','USA','general',      1, 30.0),
  ('LHR-US-SS-001','Semi-Skilled',     'Machine operator, basic CNC / press brake operation. 1–2yr trade school or on-the-job training.',                       25.00, 25.00, 'USD','US','USA','cnc',          2, 30.0),
  ('LHR-US-SK-001','Skilled CNC',      'CNC programmer/setter, 3–5yr experience. Precision machining, setup, first-off inspection.',                            32.00, 32.00, 'USD','US','USA','cnc',          3, 32.0),
  ('LHR-US-HS-001','Highly Skilled',   '5-axis programmer, toolroom machinist, quality engineer. 8+ yr experience. NIMS certification.',                        55.00, 55.00, 'USD','US','USA','cnc',          4, 35.0),

  -- ── China (CNY) — PRD/YRD composite ────────────────────────────────────────
  -- Employer burden ~30% (social insurance: pension 20%, medical 10%, housing fund 5%, etc.)
  ('LHR-CN-US-001','Unskilled',        'General factory worker. PRD/YRD minimum wage 2026. Social insurance included in burden.',                                  24,  3.31,'CNY','CN','China','general',     1, 30.0),
  ('LHR-CN-SS-001','Semi-Skilled',     'CNC operator, stamping operator. 1–2yr experience, vocational school.',                                                    34,  4.69,'CNY','CN','China','cnc',         2, 30.0),
  ('LHR-CN-SK-001','Skilled CNC',      'CNC programmer/setter, QC inspector. 3–5yr, polytechnic diploma.',                                                         58,  8.00,'CNY','CN','China','cnc',         3, 30.0),
  ('LHR-CN-HS-001','Highly Skilled',   '5-axis programmer, quality engineer, mold designer. 8+ yr.',                                                              100, 13.80,'CNY','CN','China','cnc',         4, 30.0),

  -- ── Germany (EUR) ─────────────────────────────────────────────────────────
  -- Employer burden ~21% (Rentenversicherung + Krankenversicherung + Pflegeversicherung + Unfallversicherung)
  ('LHR-DE-US-001','Unskilled',        'General Helfer. Minimum wage (Mindestlohn) 2026: €12.82/hr + employer burden.',                                            18, 19.19,'EUR','DE','Germany','general',   1, 21.0),
  ('LHR-DE-SS-001','Semi-Skilled',     'Maschinenführer. CNC/press brake operator. IG Metall EG 5–6 collective agreement.',                                        25, 26.65,'EUR','DE','Germany','cnc',      2, 21.0),
  ('LHR-DE-SK-001','Skilled CNC',      'Facharbeiter. Zerspanungsmechaniker/Werkzeugmechaniker apprenticeship + 3yr. IG Metall EG 7–9.',                           37, 39.44,'EUR','DE','Germany','cnc',      3, 21.0),
  ('LHR-DE-HS-001','Highly Skilled',   'Meister/Techniker. 5-axis programmer, CMM operator, Qualitätsfachkraft. IG Metall EG 10–12.',                             59, 62.89,'EUR','DE','Germany','cnc',      4, 21.0),

  -- ── France (EUR) ──────────────────────────────────────────────────────────
  -- Employer burden ~43% (charges patronales: cotisations sociales)
  ('LHR-FR-US-001','Unskilled',        'Opérateur polyvalent. SMIC 2026: €11.88/hr × 1.43 burden ratio.',                                                         17, 18.12,'EUR','FR','France','general',   1, 43.0),
  ('LHR-FR-SS-001','Semi-Skilled',     'Conducteur de machines. UIMM classification N2 / Coeff 170–200.',                                                          21, 22.39,'EUR','FR','France','cnc',      2, 43.0),
  ('LHR-FR-SK-001','Skilled CNC',      'Technicien usineur. UIMM N3 / Coeff 215–270. CAP/BEP + 3yr experience.',                                                  33, 35.18,'EUR','FR','France','cnc',      3, 43.0),
  ('LHR-FR-HS-001','Highly Skilled',   'Technicien supérieur / Ingénieur méthodes. UIMM TAM TC. BTS/IUT + 5yr.',                                                   53, 56.51,'EUR','FR','France','cnc',      4, 43.0),

  -- ── W. Europe (EUR) — NL/BE/AT/CH composite ───────────────────────────────
  ('LHR-XW-US-001','Unskilled',        'General factory operator. W. European composite (NL, BE, AT, CH weighted by volume). High burden typical.',                 15, 15.99,'EUR','XW','W. Europe','general',1, 35.0),
  ('LHR-XW-SS-001','Semi-Skilled',     'Machine operator. W. European composite.',                                                                                  20, 21.32,'EUR','XW','W. Europe','cnc',   2, 35.0),
  ('LHR-XW-SK-001','Skilled CNC',      'CNC programmer/setter. W. European composite.',                                                                             30, 31.98,'EUR','XW','W. Europe','cnc',   3, 35.0),
  ('LHR-XW-HS-001','Highly Skilled',   '5-axis programmer, CMM operator. W. European composite.',                                                                   48, 51.17,'EUR','XW','W. Europe','cnc',   4, 35.0),

  -- ── E. Europe (EUR) — PL/CZ/RO/HU composite ─────────────────────────────
  ('LHR-XE-US-001','Unskilled',        'General factory operator. E. European composite (PL/CZ/RO/HU). Rates converted to EUR at 2026 average FX.',                  6,  6.40,'EUR','XE','E. Europe','general',1, 25.0),
  ('LHR-XE-SS-001','Semi-Skilled',     'Machine operator. E. European composite.',                                                                                    9,  9.59,'EUR','XE','E. Europe','cnc',   2, 25.0),
  ('LHR-XE-SK-001','Skilled CNC',      'CNC programmer/setter. E. European composite.',                                                                              15, 15.99,'EUR','XE','E. Europe','cnc',   3, 25.0),
  ('LHR-XE-HS-001','Highly Skilled',   '5-axis programmer, quality engineer. E. European composite.',                                                               25, 26.65,'EUR','XE','E. Europe','cnc',   4, 25.0),

  -- ── UK (GBP) ──────────────────────────────────────────────────────────────
  -- Employer burden ~13.8% (employer NI contributions above £9,100 pa)
  ('LHR-GB-US-001','Unskilled',        'General factory operative. UK National Living Wage 2026: £11.44/hr. Employer NI ~13.8% above threshold.',                  13,  16.20,'GBP','GB','UK','general',    1, 15.0),
  ('LHR-GB-SS-001','Semi-Skilled',     'CNC operative, press brake operator. Semi-skilled tier. EEF benchmark.',                                                    17,  21.19,'GBP','GB','UK','cnc',        2, 15.0),
  ('LHR-GB-SK-001','Skilled CNC',      'CNC programmer/setter. Skilled engineering tier. EEF + ONS ASHE data.',                                                     26,  32.41,'GBP','GB','UK','cnc',        3, 15.0),
  ('LHR-GB-HS-001','Highly Skilled',   '5-axis programmer, CMM operator, QA engineer. EEF Reg 6 tier.',                                                            42,  52.34,'GBP','GB','UK','cnc',        4, 15.0),

  -- ── Vietnam (VND) — HCMC/Hanoi average ────────────────────────────────────
  -- Employer burden ~22% (BHXH 17.5%, BHYT 3%, BHTN 1%)
  ('LHR-VN-US-001','Unskilled',        'Công nhân phổ thông. Regional minimum wage Zone I (HCMC) 2026: 4,960,000 VND/month ÷ 208hr.',                           23846,  0.91,'VND','VN','Vietnam','general', 1, 22.0),
  ('LHR-VN-SS-001','Semi-Skilled',     'Công nhân lành nghề. Vận hành máy CNC / máy dập. 1–2yr vocational.',                                                    33654,  1.29,'VND','VN','Vietnam','cnc',    2, 22.0),
  ('LHR-VN-SK-001','Skilled CNC',      'Kỹ thuật viên CNC. Programmer/setter, 3–5yr. TCN/CĐN certificate.',                                                      52885,  2.02,'VND','VN','Vietnam','cnc',    3, 22.0),
  ('LHR-VN-HS-001','Highly Skilled',   'Kỹ sư cơ khí. 5-axis programmer, quality engineer, mould designer. Đại học + 5yr.',                                     98077,  3.76,'VND','VN','Vietnam','cnc',    4, 22.0),

  -- ── Mexico (MXN) — Monterrey / Bajío ─────────────────────────────────────
  -- Employer burden ~27% (IMSS: 20.4%, INFONAVIT 5%, SAR 2%)
  ('LHR-MX-US-001','Unskilled',        'Operario general. SMG 2026: $248.93 MXN/day ÷ 9hr shift.',                                                                  96,   5.49,'MXN','MX','Mexico','general', 1, 27.0),
  ('LHR-MX-SS-001','Semi-Skilled',     'Operador CNC / prensa. Semi-skilled tier. CANACINTRA benchmark.',                                                           136,   7.77,'MXN','MX','Mexico','cnc',    2, 27.0),
  ('LHR-MX-SK-001','Skilled CNC',      'Programador CNC / técnico de calidad. 3–5yr. CANACINTRA Bajío survey.',                                                    218,  12.47,'MXN','MX','Mexico','cnc',    3, 27.0),
  ('LHR-MX-HS-001','Highly Skilled',   'Ingeniero de manufactura. 5-axis, CMM, DFM. Universidad + 5yr.',                                                           385,  22.02,'MXN','MX','Mexico','cnc',    4, 27.0)

) AS v(labour_code, labour_type, description,
        lhr_local, lhr_usd,
        currency, country_code, location,
        labour_family, skill_level, burden_pct)

WHERE NOT EXISTS (
  SELECT 1 FROM lhr_records r
  WHERE r.labour_code = v.labour_code
);
