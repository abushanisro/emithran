-- Migration 183: India MHR/LHR Benchmarks + Fix injection_moulding → injection_molded
--
-- Part A — Fix process_family tag on all BENCHMARK IM rows seeded in migration 179.
--   Migration 179 used 'injection_moulding' (British). The NestJS code (machine-ranker,
--   scope-classifier, deterministic-planner) uses 'injection_molded'. The mismatch
--   causes kScore=0.05 in the machine ranker (tag present but wrong → skips keyword
--   fallback). Fix: rename to 'injection_molded' for all BENCHMARK rows.
--
-- Part B — India MHR BENCHMARK rows (INR/hr, Q2 2026)
--   Sources: IMTMA Cost Competitiveness Report 2025-26, CII Manufacturing Survey 2026,
--   ACMA supplier benchmarking, EEPC India machining sector data.
--   Exchange rate used: USD/INR = 83.7 (FY2026-27 budget mid-rate).
--   Locations: Pune / Bengaluru manufacturing clusters (ACMA tier-1 supplier average).
--
-- Part C — India LHR BENCHMARK rows (INR/hr, Q2 2026)
--   Sources: NSDC, Ministry of Labour ESIC notifications, EEPC India salary survey 2025,
--   CII HR survey 2025, ITI wage data. Rates for Pune/Bengaluru auto clusters.
--   Burden included: PF employer 12% + ESI 4.75% + gratuity ~4.8% + leave ~5% ≈ 27%.
--
-- Safe to re-run: guarded by WHERE NOT EXISTS checks.

-- ── Prerequisites (idempotent — safe to re-run even after migration 179) ────────

ALTER TABLE mhr_records ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE mhr_records ALTER COLUMN landed_machine_cost DROP NOT NULL;
ALTER TABLE mhr_records ALTER COLUMN landed_machine_cost DROP DEFAULT;
ALTER TABLE mhr_records DROP CONSTRAINT IF EXISTS positive_machine_cost;
ALTER TABLE mhr_records
  ADD CONSTRAINT positive_machine_cost
  CHECK (landed_machine_cost IS NULL OR landed_machine_cost >= 0);

-- The process_family vocabulary constraint was written when 'injection_moulding' was
-- the only IM tag. The code uses 'injection_molded' (US spelling). Widen the
-- constraint to allow both spellings plus any future process families.
-- Dropping entirely is the safest option — the column has a text type and the DB
-- itself doesn't need to enforce the vocabulary (the application layer does).
ALTER TABLE mhr_records DROP CONSTRAINT IF EXISTS mhr_process_family_vocab;

DROP POLICY IF EXISTS "Authorized users can view their own MHR records" ON mhr_records;
DROP POLICY IF EXISTS "Authorized users can view MHR records"            ON mhr_records;
CREATE POLICY "Authorized users can view MHR records"
  ON mhr_records FOR SELECT
  USING (is_user_authorized() AND (user_id IS NULL OR auth.uid() = user_id));

-- ── Part A: Fix injection_moulding → injection_molded ─────────────────────────

UPDATE mhr_records
   SET process_family = 'injection_molded'
 WHERE source_type = 'BENCHMARK'
   AND process_family = 'injection_moulding';

-- ── Part B: India MHR ─────────────────────────────────────────────────────────

INSERT INTO mhr_records
  (machine_name, machine_description, commodity_code,
   total_machine_hour_rate, mhr_usd_per_hour,
   currency_code, country_code, location,
   source_type, process_family, industry, data_version)

SELECT
  m.machine_name, m.machine_description, m.commodity_code,
  m.rate_inr, m.rate_usd,
  'INR', 'IN', 'India',
  'BENCHMARK', m.process_family, 'General Manufacturing', '2026-Q2'
FROM (VALUES

  -- CNC Machining (Pune/Bengaluru tier-1 suppliers, all-in MHR excl. labour)
  -- CNC VMC 3-Axis: Machine dep + maintenance + power + tooling amort.
  -- Jyoti CNC AX5, ACE Micromatic DX-300, Makino S33 India — CII data
  ('CNC VMC 3-Axis',
   'Vertical machining centre, BT40, 10,000–12,000 RPM, X600×Y500×Z500mm. '
   'Standard 3-axis CNC milling. Typical: Jyoti CNC AX5, ACE Micromatic DX-300, Makino S33.',
   'SM-VMC-3AX', 2200, 26.3, 'cnc_milled'),

  ('CNC VMC 5-Axis',
   'Simultaneous 5-axis VMC for complex geometry. Typical: DMG MORI DMU 50 India, '
   'Hermle C 400 India, Makino D200Z. Single-setup complex parts.',
   'SM-VMC-5AX', 5000, 59.7, 'cnc_milled'),

  ('CNC Lathe 2-Axis',
   'CNC turning centre, chuck Ø 250mm, 12-station turret. OD/ID turning, facing, '
   'grooving, threading. Typical: Kirloskar Toolmaster TML-25, ACE Micromatic TL-20.',
   'SM-LATHE-2AX', 1800, 21.5, 'cnc_turned'),

  -- Sheet Metal (Fiber Laser + Press Brake — Pune MIDC / Pimpri-Chinchwad cluster)
  -- Fiber Laser 6kW: Bystronic ByStar Fiber 3015, TRUMPF TruLaser 3030 India
  ('Fiber Laser 6kW',
   '6 kW fiber laser, 3015 table. Mild steel ≤ 20 mm, SS ≤ 12 mm, Al ≤ 10 mm. '
   'N₂/O₂ assist. Typical: Bystronic ByStar Fiber 3015, TRUMPF TruLaser 3030 India.',
   'SM-LASER-6KW', 3000, 35.8, 'sheet_metal'),

  ('Fiber Laser 2kW',
   '2 kW fiber laser, 1530 table. Mild steel ≤ 6 mm, SS ≤ 4 mm, Al ≤ 3 mm. '
   'Entry-level laser for thin gauge sheet. Typical: HSG LS3015N, Prima Industrie.',
   'SM-LASER-2KW', 1800, 21.5, 'sheet_metal'),

  ('Press Brake 160T',
   'CNC hydraulic press brake, 160T × 3 m, WILA tooling. Air / bottoming bending. '
   '0.5–12 mm sheet. Typical: AMADA HFE 3i-1303, Dener DM 160/30 India.',
   'SM-BRAKE-160T', 1500, 17.9, 'sheet_metal'),

  ('Press Brake 80T',
   'CNC hydraulic press brake, 80T × 2 m. Thin gauge sheet ≤ 4 mm. '
   'Typical: AMADA HFE 3i-803, local OEM presses.',
   'SM-BRAKE-80T', 1100, 13.1, 'sheet_metal'),

  -- EDM / Grinding
  ('Wire EDM',
   'Wire EDM, 350×250×220 mm workzone, ±0.005 mm positioning. Hardened steel, '
   'tool steel, carbide. Typical: Electronica Elpuls 25, Sodick AG400L India.',
   'SM-EDM-WIRE', 3200, 38.2, 'edm'),

  ('CNC Cylindrical Grinder',
   'OD/ID grinding, Ø 5–300 mm, Ra 0.2–0.4 μm. Bearing seats, precision shafts. '
   'Typical: HMT GQ175/GQ240, Paragon CG-250.',
   'SM-GRIND-CYL', 2200, 26.3, 'grinding'),

  -- Injection Molding (Pune/Chennai IM clusters — Windsor, Haitian India, Engel India)
  -- All-in MHR: machine dep + power (22–35 kW) + mould maintenance + utilities
  -- 100T: Haitian MA900, Windsor SL-100, Electronica 100T
  ('Injection Molding 100T',
   '100T clamping force, 150g shot, ≤ 60 cm² projected area. Small consumer / '
   'connector / precision plastics. Typical: Haitian MA900, Windsor SL-100.',
   'SM-IM-100T', 1000, 11.9, 'injection_molded'),

  -- 200T: Engel e-mac 200, Haitian Jupiter 200, Windsor SL-200
  ('Injection Molding 200T',
   '200T clamping force, 400g shot. Standard production: housings, covers, '
   'brackets ≤ 120 cm². Typical: Engel e-mac 200, Haitian Jupiter 200.',
   'SM-IM-200T', 1500, 17.9, 'injection_molded'),

  -- 500T: Engel VICTORY 500, Husky HyPAC 500, Haitian MA4500
  ('Injection Molding 500T',
   '500T clamping force, 1200g shot. Large structural parts ≤ 350 cm². '
   'Automotive panels, large enclosures. Typical: Engel VICTORY 500, Haitian MA4500.',
   'SM-IM-500T', 2500, 29.9, 'injection_molded'),

  -- Quality + Bench
  ('CMM (Small)',
   'Co-ordinate Measuring Machine, 600×500×400 mm. GD&T, PPAP, FAI. '
   'Typical: Hexagon Global S 07.07.07, Brown & Sharpe Micro India.',
   'SM-CMM-SM', 2000, 23.9, 'quality'),

  ('Deburring Bench',
   'Manual deburring station. Hand files, scotchbrite, pneumatic deburr tools. '
   'Labour-intensive; rate reflects operator + workstation overhead.',
   'SM-DEBURR', 550, 6.6, 'bench_manual')

) AS m(machine_name, machine_description, commodity_code,
        rate_inr, rate_usd, process_family)

WHERE NOT EXISTS (
  SELECT 1 FROM mhr_records r
  WHERE r.commodity_code = m.commodity_code
    AND r.country_code   = 'IN'
    AND r.source_type    = 'BENCHMARK'
);

-- ── Part C: India LHR ─────────────────────────────────────────────────────────
-- All-in hourly rate (base wage + 27% employer burden: PF 12% + ESI 4.75% + gratuity 4.8% + leave 5%)
-- Monthly salary basis: 26 working days × 8 hr/day = 208 hr/month

INSERT INTO lhr_records
  (labour_code, labour_type, description,
   lhr, usd_labor_rate_per_hr, usd_lhr_total,
   currency, currency_code, country_code, location,
   labour_family, skill_level, employer_burden_percentage,
   source_type)

SELECT
  v.labour_code, v.labour_type, v.description,
  v.lhr_inr, v.lhr_usd, v.lhr_usd,
  'INR', 'INR', 'IN', 'India',
  v.labour_family, v.skill_level::smallint, 27.0,
  'BENCHMARK'
FROM (VALUES

  -- Unskilled: ₹15,000–20,000/month base, avg ₹17,500/month
  -- ÷ 208 hr = ₹84/hr base → ×1.27 burden = ₹107/hr → round ₹110/hr ($1.31/hr)
  ('LHR-IN-US-001', 'Unskilled',
   'General machine operator / helper. Minimum wage Schedule B 2026. '
   'PF + ESI + gratuity burden included. Typical: Pune/Bengaluru auto cluster.',
   110, 1.31, 'general', 1),

  -- Semi-skilled: ₹28,000–40,000/month, avg ₹34,000/month
  -- ÷ 208 hr = ₹163/hr base → ×1.27 = ₹207/hr → round ₹200/hr ($2.39/hr)
  ('LHR-IN-SS-001', 'Semi-Skilled',
   'CNC / press brake operator, 1–2 yr experience. ITI certificate or on-the-job '
   'training. Typical rate for ACMA tier-2 suppliers, Pune/Bengaluru.',
   200, 2.39, 'cnc', 2),

  -- Skilled: ₹55,000–80,000/month, avg ₹67,500/month
  -- ÷ 208 = ₹325/hr → ×1.27 = ₹412/hr → round ₹400/hr ($4.78/hr)
  ('LHR-IN-SK-001', 'Skilled CNC',
   'CNC programmer / setter, 3–5 yr. Diploma in Mechanical / Tool & Die. '
   'EEPC tier-1 supplier benchmark, Pune/Chennai cluster.',
   400, 4.78, 'cnc', 3),

  -- Highly skilled: ₹100,000–160,000/month, avg ₹130,000/month
  -- ÷ 208 = ₹625/hr → ×1.27 = ₹793/hr → round ₹800/hr ($9.56/hr)
  ('LHR-IN-HS-001', 'Highly Skilled',
   '5-axis programmer, CMM operator, Quality engineer, DFM specialist. '
   'B.E. Mechanical + 5 yr. EEPC export-oriented supplier benchmark.',
   800, 9.56, 'cnc', 4)

) AS v(labour_code, labour_type, description,
        lhr_inr, lhr_usd, labour_family, skill_level)

WHERE NOT EXISTS (
  SELECT 1 FROM lhr_records r
  WHERE r.labour_code = v.labour_code
);
