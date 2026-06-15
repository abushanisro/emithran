-- Migration 153: Seed India Labour Standard Rate (LSR) library
--
-- 25 labour bands for Indian manufacturing (FY2025-26, Tier-2 city benchmark).
-- Rates are INR/hr — fully loaded:
--   basic wages + PF + ESI + bonus + gratuity + canteen + uniform
--   at Pune / Coimbatore / Aurangabad benchmark.
--
-- Tier-1 (Mumbai, Bengaluru): add ~15–20%.
-- Tier-3 (smaller towns): subtract ~10–15%.
--
-- Uses labour_family + skill_level columns added in migration 152.
-- Run migration 152 before this.

INSERT INTO lsr_records
  (labour_type, labour_code, lhr, currency_code, country_code, location, labour_family, skill_level)
VALUES

-- ── UNSKILLED (skill_level = 1) ───────────────────────────────────────────
('Unskilled',      'LHR-IN-US-001',  72.00, 'INR', 'IN', 'India', 'general',           1),  -- material handler, helper
('Unskilled',      'LHR-IN-US-002',  80.00, 'INR', 'IN', 'India', 'general',           1),  -- packing, labelling, basic assembly helper

-- ── SEMI-SKILLED (skill_level = 2) ───────────────────────────────────────
('Semi-Skilled',   'LHR-IN-SS-001', 100.00, 'INR', 'IN', 'India', 'general',           2),  -- conventional machine operator (manual lathe / drill)
('Semi-Skilled',   'LHR-IN-SS-002', 115.00, 'INR', 'IN', 'India', 'sheet_metal',       2),  -- press operator (hydraulic / mechanical press)
('Semi-Skilled',   'LHR-IN-SS-003', 118.00, 'INR', 'IN', 'India', 'sheet_metal',       2),  -- sheet metal fabricator (guillotine, press brake)
('Semi-Skilled',   'LHR-IN-SS-004', 122.00, 'INR', 'IN', 'India', 'welding',           2),  -- MIG welder (structural, non-critical)
('Semi-Skilled',   'LHR-IN-SS-005', 110.00, 'INR', 'IN', 'India', 'injection_moulding',2),  -- injection moulding machine operator
('Semi-Skilled',   'LHR-IN-SS-006', 108.00, 'INR', 'IN', 'India', 'general',           2),  -- deburring / bench fitter

-- ── SKILLED (skill_level = 3) ─────────────────────────────────────────────
('Skilled',        'LHR-IN-SK-001', 148.00, 'INR', 'IN', 'India', 'cnc',               3),  -- CNC operator (operates to program, lathe / milling)
('Skilled',        'LHR-IN-SK-002', 155.00, 'INR', 'IN', 'India', 'cnc',               3),  -- CNC setter-operator (sets offsets, first-off approval)
('Skilled',        'LHR-IN-SK-003', 162.00, 'INR', 'IN', 'India', 'welding',           3),  -- TIG welder (SS, aluminium, precision joints)
('Skilled',        'LHR-IN-SK-004', 158.00, 'INR', 'IN', 'India', 'grinding',          3),  -- grinder (cylindrical / surface)
('Skilled',        'LHR-IN-SK-005', 152.00, 'INR', 'IN', 'India', 'sheet_metal',       3),  -- laser / turret punch CNC operator
('Skilled',        'LHR-IN-SK-006', 160.00, 'INR', 'IN', 'India', 'inspection',        3),  -- QC inspector (CMM / gauge-based)
('Skilled',        'LHR-IN-SK-007', 145.00, 'INR', 'IN', 'India', 'surface_treatment', 3),  -- surface treatment operator (anodizing / plating)
('Skilled',        'LHR-IN-SK-008', 150.00, 'INR', 'IN', 'India', 'edm',               3),  -- EDM operator (wire / die-sink)

-- ── HIGHLY SKILLED (skill_level = 4) ─────────────────────────────────────
('Highly Skilled', 'LHR-IN-HS-001', 200.00, 'INR', 'IN', 'India', 'cnc',               4),  -- CNC programmer (CAM, G-code, 3/4-axis)
('Highly Skilled', 'LHR-IN-HS-002', 220.00, 'INR', 'IN', 'India', 'cnc',               4),  -- 5-axis CNC programmer / operator
('Highly Skilled', 'LHR-IN-HS-003', 215.00, 'INR', 'IN', 'India', 'cnc',               4),  -- tool room machinist (jig-boring, die fitting)
('Highly Skilled', 'LHR-IN-HS-004', 210.00, 'INR', 'IN', 'India', 'inspection',        4),  -- CMM programmer / metrologist
('Highly Skilled', 'LHR-IN-HS-005', 205.00, 'INR', 'IN', 'India', 'welding',           4),  -- robotic welding programmer / technician
('Highly Skilled', 'LHR-IN-HS-006', 230.00, 'INR', 'IN', 'India', 'inspection',        4),  -- NDT technician (Level II UT/RT/MPT)
('Highly Skilled', 'LHR-IN-HS-007', 195.00, 'INR', 'IN', 'India', 'injection_moulding',4),  -- mould setter (injection moulding)

-- ── SUPERVISOR / ENGINEERING (skill_level = 5) ───────────────────────────
('Supervisor',     'LHR-IN-SV-001', 260.00, 'INR', 'IN', 'India', 'supervision',       5),  -- shop floor supervisor (shift-in-charge)
('Supervisor',     'LHR-IN-SV-002', 290.00, 'INR', 'IN', 'India', 'supervision',       5),  -- production engineer (process planning, scheduling)
('Supervisor',     'LHR-IN-SV-003', 310.00, 'INR', 'IN', 'India', 'supervision',       5);  -- quality engineer (SPC, PPAP, FMEA)
