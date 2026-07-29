-- ============================================================================
-- MIGRATION 360: Seed Sheet Metal Lookup Tables + Schema Extensions
-- ============================================================================
-- Seeds all 6 sm_lookup_* tables (created empty in migration 300) with
-- engineering data from the Sheet_Metal_Calculators spec.
-- Also adds pierce_time_min to sm_lookup_laser_cut and mechanical property
-- columns to raw_materials for tonnage/force calculations.

-- ── Schema extensions ────────────────────────────────────────────────────────
ALTER TABLE sm_lookup_laser_cut
  ADD COLUMN IF NOT EXISTS pierce_time_min NUMERIC;

ALTER TABLE raw_materials
  ADD COLUMN IF NOT EXISTS shear_strength_mpa NUMERIC,
  ADD COLUMN IF NOT EXISTS uts_mpa            NUMERIC,
  ADD COLUMN IF NOT EXISTS yield_strength_mpa NUMERIC;

-- ── TABLE 1: Stroke Rate Efficiency (Automatic Machines) ─────────────────────
-- eff_simple/inter/complex are decimal fractions (0.80 = 80%)
INSERT INTO sm_lookup_stroke_rate (tonnage, eff_simple, eff_inter, eff_complex) VALUES
  (10,   0.80, 0.64, 0.56),
  (20,   0.79, 0.63, 0.55),
  (30,   0.78, 0.62, 0.55),
  (50,   0.77, 0.62, 0.54),
  (80,   0.76, 0.61, 0.53),
  (100,  0.75, 0.60, 0.53),
  (150,  0.74, 0.59, 0.52),
  (200,  0.73, 0.58, 0.51),
  (250,  0.72, 0.58, 0.50),
  (300,  0.71, 0.57, 0.50),
  (350,  0.70, 0.56, 0.49),
  (400,  0.69, 0.55, 0.48),
  (500,  0.68, 0.54, 0.48),
  (800,  0.67, 0.54, 0.47),
  (1000, 0.66, 0.53, 0.46),
  (1500, 0.65, 0.52, 0.46),
  (2000, 0.64, 0.51, 0.45)
ON CONFLICT (tonnage) DO NOTHING;

-- ── TABLE 2: Handling Time (by part/sheet weight) ───────────────────────────
INSERT INTO sm_lookup_handling_time (row_num, weight_max_kg, handling_min) VALUES
  (1,  2.5,   0.08),
  (2,  10,    0.17),
  (3,  20,    0.25),
  (4,  30,    0.33),
  (5,  40,    0.58),
  (6,  65,    0.75),
  (7,  95,    0.83),
  (8,  130,   0.92),
  (9,  165,   1.00),
  (10, 200,   1.08),
  (11, 250,   1.25),
  (12, 300,   1.33),
  (13, 350,   1.42),
  (14, 400,   1.58),
  (15, 450,   1.75),
  (16, 500,   2.63),
  (17, 750,   3.15),
  (18, 1000,  20.00),
  (19, 2000,  20.00),
  (20, 3000,  20.00),
  (21, 4000,  25.00),
  (22, 5000,  25.00)
ON CONFLICT (weight_max_kg) DO NOTHING;

-- ── TABLE 3A: Press Machine Tool Loading Time (by tonnage) ──────────────────
INSERT INTO sm_lookup_tool_setup (setup_type, key_value, loading_time_min) VALUES
  ('press', 10,   30),
  ('press', 20,   30),
  ('press', 30,   30),
  ('press', 50,   30),
  ('press', 80,   30),
  ('press', 100,  45),
  ('press', 150,  45),
  ('press', 200,  45),
  ('press', 250,  45),
  ('press', 300,  45),
  ('press', 350,  45),
  ('press', 400,  45),
  ('press', 500,  45),
  ('press', 800,  45),
  ('press', 1000, 60),
  ('press', 1500, 60),
  ('press', 2000, 60),
  ('press', 2500, 60),
  ('press', 3000, 60),
  ('press', 3500, 60),
  ('press', 4000, 60),
-- TABLE 3B: Press Brake Tool Loading Time (by tool length mm)
  ('brake', 100,  10),
  ('brake', 200,  10),
  ('brake', 300,  15),
  ('brake', 400,  15),
  ('brake', 500,  15)
ON CONFLICT (setup_type, key_value) DO NOTHING;

-- ── TABLE 4: Manual Stroke Time (sec) by thickness × tonnage × complexity ───
-- Only 'simple' and 'complex' seeded (spec has no values for 'inter')
-- Tonnages: 10,20,30,50,80,100,150,200,250,300,350,400,500,800,1000,1500,2000
INSERT INTO sm_lookup_manual_stroke (thickness_mm, tonnage, complexity, stroke_time_sec) VALUES
-- thickness 1mm, simple
  (1,10,'simple',1.00),(1,20,'simple',1.05),(1,30,'simple',1.09),(1,50,'simple',1.13),
  (1,80,'simple',1.18),(1,100,'simple',1.22),(1,150,'simple',1.28),(1,200,'simple',1.33),
  (1,250,'simple',1.40),(1,300,'simple',1.46),(1,350,'simple',1.54),(1,400,'simple',1.58),
  (1,500,'simple',1.62),(1,800,'simple',1.67),(1,1000,'simple',1.71),(1,1500,'simple',1.76),
  (1,2000,'simple',1.82),
-- thickness 1mm, complex
  (1,10,'complex',1.79),(1,20,'complex',2.07),(1,30,'complex',2.40),(1,50,'complex',2.73),
  (1,80,'complex',3.16),(1,100,'complex',3.53),(1,150,'complex',4.00),(1,200,'complex',4.62),
  (1,250,'complex',5.00),(1,300,'complex',5.45),(1,350,'complex',6.00),(1,400,'complex',6.67),
  (1,500,'complex',7.50),(1,800,'complex',8.57),(1,1000,'complex',10.00),(1,1500,'complex',10.00),
  (1,2000,'complex',10.00),
-- thickness 2mm, simple
  (2,10,'simple',1.11),(2,20,'simple',1.15),(2,30,'simple',1.20),(2,50,'simple',1.25),
  (2,80,'simple',1.30),(2,100,'simple',1.36),(2,150,'simple',1.43),(2,200,'simple',1.50),
  (2,250,'simple',1.58),(2,300,'simple',1.62),(2,350,'simple',1.67),(2,400,'simple',1.71),
  (2,500,'simple',1.76),(2,800,'simple',1.82),(2,1000,'simple',1.88),(2,1500,'simple',1.94),
  (2,2000,'simple',2.00),
-- thickness 2mm, complex
  (2,10,'complex',2.22),(2,20,'complex',2.61),(2,30,'complex',3.00),(2,50,'complex',3.53),
  (2,80,'complex',4.00),(2,100,'complex',4.62),(2,150,'complex',5.00),(2,200,'complex',5.45),
  (2,250,'complex',6.00),(2,300,'complex',6.67),(2,350,'complex',7.50),(2,400,'complex',8.57),
  (2,500,'complex',10.00),(2,800,'complex',10.00),(2,1000,'complex',10.00),(2,1500,'complex',10.00),
  (2,2000,'complex',10.00),
-- thickness 3mm, simple
  (3,10,'simple',1.22),(3,20,'simple',1.28),(3,30,'simple',1.33),(3,50,'simple',1.40),
  (3,80,'simple',1.46),(3,100,'simple',1.54),(3,150,'simple',1.58),(3,200,'simple',1.62),
  (3,250,'simple',1.67),(3,300,'simple',1.71),(3,350,'simple',1.76),(3,400,'simple',1.82),
  (3,500,'simple',1.88),(3,800,'simple',1.94),(3,1000,'simple',2.00),(3,1500,'simple',2.07),
  (3,2000,'simple',2.14),
-- thickness 3mm, complex
  (3,10,'complex',2.73),(3,20,'complex',3.16),(3,30,'complex',3.53),(3,50,'complex',4.00),
  (3,80,'complex',4.62),(3,100,'complex',5.00),(3,150,'complex',5.45),(3,200,'complex',6.00),
  (3,250,'complex',6.67),(3,300,'complex',7.50),(3,350,'complex',8.57),(3,400,'complex',10.00),
  (3,500,'complex',10.00),(3,800,'complex',10.00),(3,1000,'complex',10.00),(3,1500,'complex',10.00),
  (3,2000,'complex',10.00),
-- thickness 4mm, simple
  (4,10,'simple',1.33),(4,20,'simple',1.40),(4,30,'simple',1.46),(4,50,'simple',1.54),
  (4,80,'simple',1.58),(4,100,'simple',1.62),(4,150,'simple',1.67),(4,200,'simple',1.71),
  (4,250,'simple',1.76),(4,300,'simple',1.82),(4,350,'simple',1.88),(4,400,'simple',1.94),
  (4,500,'simple',2.00),(4,800,'simple',2.07),(4,1000,'simple',2.14),(4,1500,'simple',2.22),
  (4,2000,'simple',2.31),
-- thickness 4mm, complex
  (4,10,'complex',3.33),(4,20,'complex',3.75),(4,30,'complex',4.29),(4,50,'complex',5.00),
  (4,80,'complex',5.45),(4,100,'complex',6.00),(4,150,'complex',6.67),(4,200,'complex',7.50),
  (4,250,'complex',8.57),(4,300,'complex',10.00),(4,350,'complex',10.00),(4,400,'complex',10.00),
  (4,500,'complex',10.00),(4,800,'complex',10.00),(4,1000,'complex',10.00),(4,1500,'complex',10.00),
  (4,2000,'complex',10.00),
-- thickness 5mm, simple
  (5,10,'simple',1.46),(5,20,'simple',1.54),(5,30,'simple',1.58),(5,50,'simple',1.62),
  (5,80,'simple',1.67),(5,100,'simple',1.71),(5,150,'simple',1.76),(5,200,'simple',1.82),
  (5,250,'simple',1.88),(5,300,'simple',1.94),(5,350,'simple',2.00),(5,400,'simple',2.07),
  (5,500,'simple',2.14),(5,800,'simple',2.22),(5,1000,'simple',2.31),(5,1500,'simple',2.40),
  (5,2000,'simple',2.50),
-- thickness 5mm, complex
  (5,10,'complex',4.00),(5,20,'complex',4.62),(5,30,'complex',5.00),(5,50,'complex',5.45),
  (5,80,'complex',6.00),(5,100,'complex',6.67),(5,150,'complex',7.50),(5,200,'complex',8.57),
  (5,250,'complex',10.00),(5,300,'complex',10.00),(5,350,'complex',10.00),(5,400,'complex',10.00),
  (5,500,'complex',10.00),(5,800,'complex',10.00),(5,1000,'complex',10.00),(5,1500,'complex',10.00),
  (5,2000,'complex',10.00),
-- thickness 6mm, simple
  (6,10,'simple',1.62),(6,20,'simple',1.67),(6,30,'simple',1.71),(6,50,'simple',1.76),
  (6,80,'simple',1.82),(6,100,'simple',1.88),(6,150,'simple',1.94),(6,200,'simple',2.00),
  (6,250,'simple',2.07),(6,300,'simple',2.14),(6,350,'simple',2.22),(6,400,'simple',2.31),
  (6,500,'simple',2.40),(6,800,'simple',2.50),(6,1000,'simple',2.61),(6,1500,'simple',2.73),
  (6,2000,'simple',2.86),
-- thickness 6mm, complex
  (6,10,'complex',5.00),(6,20,'complex',5.45),(6,30,'complex',6.00),(6,50,'complex',6.67),
  (6,80,'complex',7.50),(6,100,'complex',8.57),(6,150,'complex',10.00),(6,200,'complex',10.00),
  (6,250,'complex',10.00),(6,300,'complex',10.00),(6,350,'complex',10.00),(6,400,'complex',10.00),
  (6,500,'complex',10.00),(6,800,'complex',10.00),(6,1000,'complex',10.00),(6,1500,'complex',10.00),
  (6,2000,'complex',10.00),
-- thickness 8mm, simple
  (8,10,'simple',1.76),(8,20,'simple',1.82),(8,30,'simple',1.88),(8,50,'simple',1.94),
  (8,80,'simple',2.00),(8,100,'simple',2.07),(8,150,'simple',2.14),(8,200,'simple',2.22),
  (8,250,'simple',2.31),(8,300,'simple',2.40),(8,350,'simple',2.50),(8,400,'simple',2.61),
  (8,500,'simple',2.73),(8,800,'simple',2.86),(8,1000,'simple',3.00),(8,1500,'simple',3.16),
  (8,2000,'simple',3.16),
-- thickness 8mm, complex
  (8,10,'complex',6.00),(8,20,'complex',6.67),(8,30,'complex',7.50),(8,50,'complex',8.57),
  (8,80,'complex',10.00),(8,100,'complex',10.00),(8,150,'complex',10.00),(8,200,'complex',10.00),
  (8,250,'complex',10.00),(8,300,'complex',10.00),(8,350,'complex',10.00),(8,400,'complex',10.00),
  (8,500,'complex',10.00),(8,800,'complex',10.00),(8,1000,'complex',10.00),(8,1500,'complex',10.00),
  (8,2000,'complex',10.00),
-- thickness 10mm, simple
  (10,10,'simple',1.94),(10,20,'simple',2.00),(10,30,'simple',2.07),(10,50,'simple',2.14),
  (10,80,'simple',2.22),(10,100,'simple',2.31),(10,150,'simple',2.40),(10,200,'simple',2.50),
  (10,250,'simple',2.61),(10,300,'simple',2.73),(10,350,'simple',2.86),(10,400,'simple',3.00),
  (10,500,'simple',3.16),(10,800,'simple',3.16),(10,1000,'simple',3.16),(10,1500,'simple',3.16),
  (10,2000,'simple',3.16),
-- thickness 10mm, complex
  (10,10,'complex',7.50),(10,20,'complex',8.57),(10,30,'complex',10.00),(10,50,'complex',10.00),
  (10,80,'complex',10.00),(10,100,'complex',10.00),(10,150,'complex',10.00),(10,200,'complex',10.00),
  (10,250,'complex',10.00),(10,300,'complex',10.00),(10,350,'complex',10.00),(10,400,'complex',10.00),
  (10,500,'complex',10.00),(10,800,'complex',10.00),(10,1000,'complex',10.00),(10,1500,'complex',10.00),
  (10,2000,'complex',10.00),
-- thickness 12mm, simple
  (12,10,'simple',2.14),(12,20,'simple',2.22),(12,30,'simple',2.31),(12,50,'simple',2.40),
  (12,80,'simple',2.50),(12,100,'simple',2.61),(12,150,'simple',2.73),(12,200,'simple',2.86),
  (12,250,'simple',3.00),(12,300,'simple',3.16),(12,350,'simple',3.16),(12,400,'simple',3.16),
  (12,500,'simple',3.16),(12,800,'simple',3.16),(12,1000,'simple',3.16),(12,1500,'simple',3.16),
  (12,2000,'simple',3.16),
-- thickness 12mm, complex
  (12,10,'complex',8.57),(12,20,'complex',10.00),(12,30,'complex',10.00),(12,50,'complex',10.00),
  (12,80,'complex',10.00),(12,100,'complex',10.00),(12,150,'complex',10.00),(12,200,'complex',10.00),
  (12,250,'complex',10.00),(12,300,'complex',10.00),(12,350,'complex',10.00),(12,400,'complex',10.00),
  (12,500,'complex',10.00),(12,800,'complex',10.00),(12,1000,'complex',10.00),(12,1500,'complex',10.00),
  (12,2000,'complex',10.00),
-- thickness 14mm, simple
  (14,10,'simple',2.31),(14,20,'simple',2.40),(14,30,'simple',2.50),(14,50,'simple',2.61),
  (14,80,'simple',2.73),(14,100,'simple',2.86),(14,150,'simple',3.00),(14,200,'simple',3.16),
  (14,250,'simple',3.16),(14,300,'simple',3.16),(14,350,'simple',3.16),(14,400,'simple',3.16),
  (14,500,'simple',3.16),(14,800,'simple',3.16),(14,1000,'simple',3.16),(14,1500,'simple',3.16),
  (14,2000,'simple',3.16),
-- thickness 14mm, complex
  (14,10,'complex',10.00),(14,20,'complex',10.00),(14,30,'complex',10.00),(14,50,'complex',10.00),
  (14,80,'complex',10.00),(14,100,'complex',10.00),(14,150,'complex',10.00),(14,200,'complex',10.00),
  (14,250,'complex',10.00),(14,300,'complex',10.00),(14,350,'complex',10.00),(14,400,'complex',10.00),
  (14,500,'complex',10.00),(14,800,'complex',10.00),(14,1000,'complex',10.00),(14,1500,'complex',10.00),
  (14,2000,'complex',10.00),
-- thickness 16mm, simple
  (16,10,'simple',2.50),(16,20,'simple',2.61),(16,30,'simple',2.73),(16,50,'simple',2.86),
  (16,80,'simple',3.00),(16,100,'simple',3.16),(16,150,'simple',3.16),(16,200,'simple',3.16),
  (16,250,'simple',3.16),(16,300,'simple',3.16),(16,350,'simple',3.16),(16,400,'simple',3.16),
  (16,500,'simple',3.16),(16,800,'simple',3.16),(16,1000,'simple',3.16),(16,1500,'simple',3.16),
  (16,2000,'simple',3.16),
-- thickness 16mm, complex
  (16,10,'complex',12.00),(16,20,'complex',12.00),(16,30,'complex',12.00),(16,50,'complex',12.00),
  (16,80,'complex',12.00),(16,100,'complex',12.00),(16,150,'complex',12.00),(16,200,'complex',12.00),
  (16,250,'complex',12.00),(16,300,'complex',12.00),(16,350,'complex',12.00),(16,400,'complex',12.00),
  (16,500,'complex',12.00),(16,800,'complex',12.00),(16,1000,'complex',12.00),(16,1500,'complex',12.00),
  (16,2000,'complex',12.00)
ON CONFLICT (thickness_mm, tonnage, complexity) DO NOTHING;

-- ── TABLE 5: Laser Cutting Data ──────────────────────────────────────────────
-- cutting_speed_m_per_min is already adjusted by speed coefficient (from spec "Cutting Speed Actual")
-- pierce_time_min is from spec "Piercing Time" column
-- Only rows with non-NULL cutting speed are inserted (NULL = not achievable at that power)

-- CARBON STEEL
INSERT INTO sm_lookup_laser_cut (material, thickness_mm, kerf_mm, laser_power_w, cutting_speed_m_per_min, pierce_time_min) VALUES
  ('Carbon Steel',1,0.5,500,3.78,0.0022),('Carbon Steel',1,0.5,1000,4.20,0.0020),
  ('Carbon Steel',1,0.5,1500,10.92,0.0008),('Carbon Steel',1,0.5,2000,12.60,0.0007),
  ('Carbon Steel',1,0.5,3000,16.80,0.0005),('Carbon Steel',1,0.5,4000,17.64,0.0005),
  ('Carbon Steel',1,0.5,6000,18.90,0.0004),('Carbon Steel',1,0.5,8000,18.90,0.0004),
  ('Carbon Steel',1,0.5,10000,18.90,0.0004),('Carbon Steel',1,0.5,12000,25.20,0.0003),
  ('Carbon Steel',1,0.5,15000,25.20,0.0003),
  ('Carbon Steel',2,0.6,500,2.05,0.0044),('Carbon Steel',2,0.6,1000,2.96,0.0031),
  ('Carbon Steel',2,0.6,1500,3.19,0.0029),('Carbon Steel',2,0.6,2000,4.10,0.0022),
  ('Carbon Steel',2,0.6,3000,9.10,0.0010),('Carbon Steel',2,0.6,4000,6.83,0.0013),
  ('Carbon Steel',2,0.6,6000,11.38,0.0008),('Carbon Steel',2,0.6,8000,15.93,0.0006),
  ('Carbon Steel',2,0.6,10000,18.20,0.0005),('Carbon Steel',2,0.6,12000,20.48,0.0004),
  ('Carbon Steel',2,0.6,15000,21.84,0.0004),
  ('Carbon Steel',3,0.7,500,1.37,0.0067),('Carbon Steel',3,0.7,1000,1.37,0.0067),
  ('Carbon Steel',3,0.7,1500,1.82,0.0050),('Carbon Steel',3,0.7,2000,2.18,0.0042),
  ('Carbon Steel',3,0.7,3000,2.28,0.0040),('Carbon Steel',3,0.7,4000,2.50,0.0036),
  ('Carbon Steel',3,0.7,6000,2.96,0.0031),('Carbon Steel',3,0.7,8000,3.19,0.0029),
  ('Carbon Steel',3,0.7,10000,13.65,0.0007),('Carbon Steel',3,0.7,12000,15.93,0.0006),
  ('Carbon Steel',3,0.7,15000,17.29,0.0005),
  ('Carbon Steel',4,0.8,500,0.78,0.0133),('Carbon Steel',4,0.8,1000,1.25,0.0083),
  ('Carbon Steel',4,0.8,1500,1.56,0.0067),('Carbon Steel',4,0.8,2000,1.82,0.0057),
  ('Carbon Steel',4,0.8,3000,2.18,0.0048),('Carbon Steel',4,0.8,4000,2.50,0.0042),
  ('Carbon Steel',4,0.8,6000,2.60,0.0040),('Carbon Steel',4,0.8,8000,2.86,0.0036),
  ('Carbon Steel',4,0.8,10000,10.40,0.0010),('Carbon Steel',4,0.8,12000,13.52,0.0008),
  ('Carbon Steel',4,0.8,15000,15.08,0.0007),
  ('Carbon Steel',5,0.9,500,0.57,0.0182),('Carbon Steel',5,0.9,1000,1.04,0.0100),
  ('Carbon Steel',5,0.9,1500,1.30,0.0080),('Carbon Steel',5,0.9,2000,1.56,0.0067),
  ('Carbon Steel',5,0.9,3000,1.82,0.0057),('Carbon Steel',5,0.9,4000,1.87,0.0056),
  ('Carbon Steel',5,0.9,6000,2.18,0.0048),('Carbon Steel',5,0.9,8000,2.34,0.0044),
  ('Carbon Steel',5,0.9,10000,7.80,0.0013),('Carbon Steel',5,0.9,12000,9.36,0.0011),
  ('Carbon Steel',5,0.9,15000,11.96,0.0009),
  ('Carbon Steel',6,1.0,500,0.47,0.0222),('Carbon Steel',6,1.0,1000,0.83,0.0125),
  ('Carbon Steel',6,1.0,1500,1.14,0.0091),('Carbon Steel',6,1.0,2000,1.35,0.0077),
  ('Carbon Steel',6,1.0,3000,1.66,0.0063),('Carbon Steel',6,1.0,4000,1.77,0.0059),
  ('Carbon Steel',6,1.0,6000,2.08,0.0050),('Carbon Steel',6,1.0,8000,2.18,0.0048),
  ('Carbon Steel',6,1.0,10000,6.24,0.0017),('Carbon Steel',6,1.0,12000,6.76,0.0015),
  ('Carbon Steel',6,1.0,15000,9.88,0.0011),
  ('Carbon Steel',8,1.2,1000,0.67,0.0167),('Carbon Steel',8,1.2,1500,0.78,0.0143),
  ('Carbon Steel',8,1.2,2000,1.01,0.0111),('Carbon Steel',8,1.2,3000,1.46,0.0077),
  ('Carbon Steel',8,1.2,4000,1.68,0.0067),('Carbon Steel',8,1.2,6000,1.79,0.0063),
  ('Carbon Steel',8,1.2,8000,1.96,0.0057),('Carbon Steel',8,1.2,10000,4.48,0.0025),
  ('Carbon Steel',8,1.2,12000,5.60,0.0020),('Carbon Steel',8,1.2,15000,6.72,0.0017),
  ('Carbon Steel',10,1.3,1000,0.56,0.0200),('Carbon Steel',10,1.3,1500,0.62,0.0182),
  ('Carbon Steel',10,1.3,2000,0.73,0.0154),('Carbon Steel',10,1.3,3000,1.12,0.0100),
  ('Carbon Steel',10,1.3,4000,1.12,0.0100),('Carbon Steel',10,1.3,6000,1.40,0.0080),
  ('Carbon Steel',10,1.3,8000,1.51,0.0074),('Carbon Steel',10,1.3,10000,1.51,0.0074),
  ('Carbon Steel',10,1.3,12000,1.51,0.0074),('Carbon Steel',10,1.3,15000,1.29,0.0087),
  ('Carbon Steel',12,1.5,1000,0.50,0.0250),('Carbon Steel',12,1.5,1500,0.63,0.0200),
  ('Carbon Steel',12,1.5,2000,0.76,0.0167),('Carbon Steel',12,1.5,3000,1.01,0.0125),
  ('Carbon Steel',12,1.5,4000,1.13,0.0111),('Carbon Steel',12,1.5,6000,1.26,0.0100),
  ('Carbon Steel',12,1.5,8000,1.32,0.0095),('Carbon Steel',12,1.5,10000,1.32,0.0095),
  ('Carbon Steel',12,1.5,12000,1.32,0.0095),('Carbon Steel',12,1.5,15000,1.26,0.0100),
  ('Carbon Steel',14,1.8,1500,0.44,0.0286),('Carbon Steel',14,1.8,2000,0.50,0.0250),
  ('Carbon Steel',14,1.8,3000,0.88,0.0143),('Carbon Steel',14,1.8,4000,0.76,0.0167),
  ('Carbon Steel',14,1.8,6000,1.13,0.0111),('Carbon Steel',14,1.8,8000,1.20,0.0105),
  ('Carbon Steel',14,1.8,10000,1.20,0.0105),('Carbon Steel',14,1.8,12000,1.20,0.0105),
  ('Carbon Steel',14,1.8,15000,1.13,0.0111),
  ('Carbon Steel',16,2.0,2000,0.44,0.0286),('Carbon Steel',16,2.0,3000,0.63,0.0200),
  ('Carbon Steel',16,2.0,4000,0.63,0.0200),('Carbon Steel',16,2.0,6000,0.95,0.0133),
  ('Carbon Steel',16,2.0,8000,1.07,0.0118),('Carbon Steel',16,2.0,10000,1.07,0.0118),
  ('Carbon Steel',16,2.0,12000,1.07,0.0118),('Carbon Steel',16,2.0,15000,1.01,0.0125),
  ('Carbon Steel',18,2.3,2000,0.38,0.0333),('Carbon Steel',18,2.3,3000,0.50,0.0250),
  ('Carbon Steel',18,2.3,4000,0.57,0.0222),('Carbon Steel',18,2.3,6000,0.57,0.0222),
  ('Carbon Steel',18,2.3,8000,0.57,0.0222),('Carbon Steel',18,2.3,10000,0.57,0.0222),
  ('Carbon Steel',18,2.3,12000,0.95,0.0133),('Carbon Steel',18,2.3,15000,0.95,0.0133),
  ('Carbon Steel',20,2.7,3000,0.50,0.0250),('Carbon Steel',20,2.7,4000,0.57,0.0222),
  ('Carbon Steel',20,2.7,6000,0.57,0.0222),('Carbon Steel',20,2.7,8000,0.57,0.0222),
  ('Carbon Steel',20,2.7,10000,0.57,0.0222),('Carbon Steel',20,2.7,12000,0.88,0.0143),
  ('Carbon Steel',20,2.7,15000,0.88,0.0143),
  ('Carbon Steel',22,3.1,3000,0.38,0.0333),('Carbon Steel',22,3.1,4000,0.50,0.0250),
  ('Carbon Steel',22,3.1,6000,0.50,0.0250),('Carbon Steel',22,3.1,8000,0.50,0.0250),
  ('Carbon Steel',22,3.1,10000,0.50,0.0250),('Carbon Steel',22,3.1,12000,0.76,0.0167),
  ('Carbon Steel',22,3.1,15000,0.82,0.0154),
  ('Carbon Steel',25,3.5,4000,0.32,0.0400),('Carbon Steel',25,3.5,6000,0.32,0.0400),
  ('Carbon Steel',25,3.5,8000,0.44,0.0286),('Carbon Steel',25,3.5,10000,0.44,0.0286),
  ('Carbon Steel',25,3.5,12000,0.63,0.0200),('Carbon Steel',25,3.5,15000,0.82,0.0154),
  ('Carbon Steel',30,4.1,10000,0.22,0.0571),('Carbon Steel',30,4.1,12000,0.50,0.0250),
  ('Carbon Steel',30,4.1,15000,0.54,0.0235),
  ('Carbon Steel',40,4.7,10000,0.13,0.1000),('Carbon Steel',40,4.7,12000,0.19,0.0667),
  ('Carbon Steel',40,4.7,15000,0.22,0.0571),
  ('Carbon Steel',50,5.4,15000,0.16,0.0800),
  ('Carbon Steel',60,6.2,15000,0.13,0.1000)
ON CONFLICT (material, thickness_mm, laser_power_w) DO NOTHING;

-- STAINLESS STEEL
INSERT INTO sm_lookup_laser_cut (material, thickness_mm, kerf_mm, laser_power_w, cutting_speed_m_per_min, pierce_time_min) VALUES
  ('Stainless Steel',1,0.5,500,5.46,0.0015),('Stainless Steel',1,0.5,1000,10.50,0.0008),
  ('Stainless Steel',1,0.5,1500,11.34,0.0007),('Stainless Steel',1,0.5,2000,12.60,0.0007),
  ('Stainless Steel',1,0.5,3000,14.70,0.0006),('Stainless Steel',1,0.5,4000,16.80,0.0005),
  ('Stainless Steel',1,0.5,6000,23.10,0.0004),('Stainless Steel',1,0.5,8000,27.72,0.0003),
  ('Stainless Steel',1,0.5,10000,31.50,0.0003),('Stainless Steel',1,0.5,12000,35.70,0.0002),
  ('Stainless Steel',1,0.5,15000,25.20,0.0003),
  ('Stainless Steel',2,0.6,500,2.28,0.0040),('Stainless Steel',2,0.6,1000,5.46,0.0017),
  ('Stainless Steel',2,0.6,1500,5.92,0.0015),('Stainless Steel',2,0.6,2000,6.37,0.0014),
  ('Stainless Steel',2,0.6,3000,10.92,0.0008),('Stainless Steel',2,0.6,4000,12.74,0.0007),
  ('Stainless Steel',2,0.6,6000,15.93,0.0006),('Stainless Steel',2,0.6,8000,19.11,0.0005),
  ('Stainless Steel',2,0.6,10000,25.03,0.0004),('Stainless Steel',2,0.6,12000,30.03,0.0003),
  ('Stainless Steel',2,0.6,15000,22.75,0.0004),
  ('Stainless Steel',3,0.7,500,0.36,0.0250),('Stainless Steel',3,0.7,1000,1.14,0.0080),
  ('Stainless Steel',3,0.7,1500,2.28,0.0040),('Stainless Steel',3,0.7,2000,2.96,0.0031),
  ('Stainless Steel',3,0.7,3000,4.55,0.0020),('Stainless Steel',3,0.7,4000,6.83,0.0013),
  ('Stainless Steel',3,0.7,6000,10.92,0.0008),('Stainless Steel',3,0.7,8000,13.65,0.0007),
  ('Stainless Steel',3,0.7,10000,17.29,0.0005),('Stainless Steel',3,0.7,12000,20.48,0.0004),
  ('Stainless Steel',3,0.7,15000,17.29,0.0005),
  ('Stainless Steel',4,0.8,1000,0.68,0.0154),('Stainless Steel',4,0.8,1500,1.25,0.0083),
  ('Stainless Steel',4,0.8,2000,2.34,0.0044),('Stainless Steel',4,0.8,3000,3.38,0.0031),
  ('Stainless Steel',4,0.8,4000,4.16,0.0025),('Stainless Steel',4,0.8,6000,8.32,0.0013),
  ('Stainless Steel',4,0.8,8000,10.92,0.0010),('Stainless Steel',4,0.8,10000,13.00,0.0008),
  ('Stainless Steel',4,0.8,12000,16.64,0.0006),('Stainless Steel',4,0.8,15000,15.08,0.0007),
  ('Stainless Steel',5,0.9,1000,0.36,0.0286),('Stainless Steel',5,0.9,1500,0.68,0.0154),
  ('Stainless Steel',5,0.9,2000,1.30,0.0080),('Stainless Steel',5,0.9,3000,2.60,0.0040),
  ('Stainless Steel',5,0.9,4000,2.86,0.0036),('Stainless Steel',5,0.9,6000,6.24,0.0017),
  ('Stainless Steel',5,0.9,8000,8.84,0.0012),('Stainless Steel',5,0.9,10000,11.44,0.0009),
  ('Stainless Steel',5,0.9,12000,13.00,0.0008),('Stainless Steel',5,0.9,15000,9.36,0.0011),
  ('Stainless Steel',6,1.0,1500,0.52,0.0200),('Stainless Steel',6,1.0,2000,1.04,0.0100),
  ('Stainless Steel',6,1.0,3000,2.08,0.0050),('Stainless Steel',6,1.0,4000,2.34,0.0044),
  ('Stainless Steel',6,1.0,6000,4.68,0.0022),('Stainless Steel',6,1.0,8000,7.28,0.0014),
  ('Stainless Steel',6,1.0,10000,7.80,0.0013),('Stainless Steel',6,1.0,12000,10.92,0.0010),
  ('Stainless Steel',6,1.0,15000,6.24,0.0017),
  ('Stainless Steel',8,1.2,2000,0.56,0.0200),('Stainless Steel',8,1.2,3000,1.12,0.0100),
  ('Stainless Steel',8,1.2,4000,1.68,0.0067),('Stainless Steel',8,1.2,6000,2.80,0.0040),
  ('Stainless Steel',8,1.2,8000,4.48,0.0025),('Stainless Steel',8,1.2,10000,6.72,0.0017),
  ('Stainless Steel',8,1.2,12000,8.96,0.0013),('Stainless Steel',8,1.2,15000,5.04,0.0022),
  ('Stainless Steel',10,1.3,3000,0.45,0.0250),('Stainless Steel',10,1.3,4000,0.67,0.0167),
  ('Stainless Steel',10,1.3,6000,1.40,0.0080),('Stainless Steel',10,1.3,8000,2.80,0.0040),
  ('Stainless Steel',10,1.3,10000,4.48,0.0025),('Stainless Steel',10,1.3,12000,6.72,0.0017),
  ('Stainless Steel',10,1.3,15000,3.92,0.0029),
  ('Stainless Steel',12,1.5,3000,0.38,0.0333),('Stainless Steel',12,1.5,4000,0.50,0.0250),
  ('Stainless Steel',12,1.5,6000,1.13,0.0111),('Stainless Steel',12,1.5,8000,1.89,0.0067),
  ('Stainless Steel',12,1.5,10000,3.15,0.0040),('Stainless Steel',12,1.5,12000,5.04,0.0025),
  ('Stainless Steel',12,1.5,15000,4.41,0.0029),
  ('Stainless Steel',14,1.8,4000,0.38,0.0333),('Stainless Steel',14,1.8,6000,0.50,0.0250),
  ('Stainless Steel',14,1.8,8000,1.13,0.0111),('Stainless Steel',14,1.8,10000,1.89,0.0067),
  ('Stainless Steel',14,1.8,12000,3.15,0.0040),('Stainless Steel',14,1.8,15000,3.18,0.0040),
  ('Stainless Steel',16,2.0,6000,0.38,0.0333),('Stainless Steel',16,2.0,8000,0.95,0.0133),
  ('Stainless Steel',16,2.0,10000,1.26,0.0100),('Stainless Steel',16,2.0,12000,1.45,0.0087),
  ('Stainless Steel',16,2.0,15000,1.95,0.0065),
  ('Stainless Steel',18,2.3,6000,0.38,0.0333),('Stainless Steel',18,2.3,8000,0.72,0.0174),
  ('Stainless Steel',18,2.3,10000,1.20,0.0105),('Stainless Steel',18,2.3,12000,1.67,0.0075),
  ('Stainless Steel',18,2.3,15000,1.64,0.0077),
  ('Stainless Steel',20,2.7,6000,0.38,0.0333),('Stainless Steel',20,2.7,8000,0.50,0.0250),
  ('Stainless Steel',20,2.7,10000,1.13,0.0111),('Stainless Steel',20,2.7,12000,1.89,0.0067),
  ('Stainless Steel',20,2.7,15000,1.32,0.0095),
  ('Stainless Steel',22,3.1,8000,0.38,0.0333),('Stainless Steel',22,3.1,10000,0.57,0.0222),
  ('Stainless Steel',22,3.1,12000,0.76,0.0167),('Stainless Steel',22,3.1,15000,1.07,0.0118),
  ('Stainless Steel',25,3.5,8000,0.38,0.0333),('Stainless Steel',25,3.5,10000,0.44,0.0286),
  ('Stainless Steel',25,3.5,12000,0.60,0.0211),('Stainless Steel',25,3.5,15000,0.88,0.0143),
  ('Stainless Steel',30,4.1,8000,0.32,0.0400),('Stainless Steel',30,4.1,10000,0.38,0.0333),
  ('Stainless Steel',30,4.1,12000,0.44,0.0286),('Stainless Steel',30,4.1,15000,0.63,0.0200),
  ('Stainless Steel',35,4.7,10000,0.35,0.0364),('Stainless Steel',35,4.7,12000,0.41,0.0308),
  ('Stainless Steel',35,4.7,15000,0.50,0.0250),
  ('Stainless Steel',40,5.4,10000,0.32,0.0400),('Stainless Steel',40,5.4,12000,0.38,0.0333),
  ('Stainless Steel',40,5.4,15000,0.32,0.0400),
  ('Stainless Steel',45,6.2,15000,0.25,0.0500)
ON CONFLICT (material, thickness_mm, laser_power_w) DO NOTHING;

-- ALUMINIUM
INSERT INTO sm_lookup_laser_cut (material, thickness_mm, kerf_mm, laser_power_w, cutting_speed_m_per_min, pierce_time_min) VALUES
  ('Aluminium',1,0.3,500,2.31,0.0036),('Aluminium',1,0.3,1000,4.20,0.0020),
  ('Aluminium',1,0.3,1500,8.40,0.0010),('Aluminium',1,0.3,2000,10.50,0.0008),
  ('Aluminium',1,0.3,3000,15.96,0.0005),('Aluminium',1,0.3,4000,16.80,0.0005),
  ('Aluminium',1,0.3,6000,23.10,0.0004),('Aluminium',1,0.3,8000,27.30,0.0003),
  ('Aluminium',1,0.3,10000,31.50,0.0003),('Aluminium',1,0.3,12000,35.70,0.0002),
  ('Aluminium',1,0.3,15000,21.84,0.0004),
  ('Aluminium',2,0.3,500,0.68,0.0133),('Aluminium',2,0.3,1000,2.28,0.0040),
  ('Aluminium',2,0.3,1500,3.19,0.0029),('Aluminium',2,0.3,2000,4.55,0.0020),
  ('Aluminium',2,0.3,3000,8.19,0.0011),('Aluminium',2,0.3,4000,11.38,0.0008),
  ('Aluminium',2,0.3,6000,13.65,0.0007),('Aluminium',2,0.3,8000,17.29,0.0005),
  ('Aluminium',2,0.3,10000,20.48,0.0004),('Aluminium',2,0.3,12000,22.75,0.0004),
  ('Aluminium',2,0.3,15000,17.29,0.0005),
  ('Aluminium',3,0.4,1000,0.68,0.0133),('Aluminium',3,0.4,1500,1.82,0.0050),
  ('Aluminium',3,0.4,2000,2.73,0.0033),('Aluminium',3,0.4,3000,3.64,0.0025),
  ('Aluminium',3,0.4,4000,5.92,0.0015),('Aluminium',3,0.4,6000,8.19,0.0011),
  ('Aluminium',3,0.4,8000,13.65,0.0007),('Aluminium',3,0.4,10000,15.93,0.0006),
  ('Aluminium',3,0.4,12000,18.20,0.0005),('Aluminium',3,0.4,15000,12.29,0.0007),
  ('Aluminium',4,0.5,1500,0.78,0.0133),('Aluminium',4,0.5,2000,1.56,0.0067),
  ('Aluminium',4,0.5,3000,2.60,0.0040),('Aluminium',4,0.5,4000,3.64,0.0029),
  ('Aluminium',4,0.5,6000,6.24,0.0017),('Aluminium',4,0.5,8000,9.36,0.0011),
  ('Aluminium',4,0.5,10000,15.60,0.0007),('Aluminium',4,0.5,12000,19.76,0.0005),
  ('Aluminium',4,0.5,15000,11.44,0.0009),
  ('Aluminium',5,0.5,1500,0.52,0.0200),('Aluminium',5,0.5,2000,0.94,0.0111),
  ('Aluminium',5,0.5,3000,1.82,0.0057),('Aluminium',5,0.5,4000,2.60,0.0040),
  ('Aluminium',5,0.5,6000,4.16,0.0025),('Aluminium',5,0.5,8000,6.24,0.0017),
  ('Aluminium',5,0.5,10000,10.40,0.0010),('Aluminium',5,0.5,12000,13.00,0.0008),
  ('Aluminium',5,0.5,15000,8.84,0.0012),
  ('Aluminium',6,0.6,2000,0.52,0.0200),('Aluminium',6,0.6,3000,1.30,0.0080),
  ('Aluminium',6,0.6,4000,1.82,0.0057),('Aluminium',6,0.6,6000,3.12,0.0033),
  ('Aluminium',6,0.6,8000,4.16,0.0025),('Aluminium',6,0.6,10000,6.24,0.0017),
  ('Aluminium',6,0.6,12000,9.36,0.0011),('Aluminium',6,0.6,15000,7.28,0.0014),
  ('Aluminium',8,0.7,2000,0.45,0.0250),('Aluminium',8,0.7,3000,0.56,0.0200),
  ('Aluminium',8,0.7,4000,0.90,0.0125),('Aluminium',8,0.7,6000,1.68,0.0067),
  ('Aluminium',8,0.7,8000,3.36,0.0033),('Aluminium',8,0.7,10000,4.48,0.0025),
  ('Aluminium',8,0.7,12000,6.72,0.0017),('Aluminium',8,0.7,15000,5.04,0.0022),
  ('Aluminium',10,0.8,3000,0.39,0.0286),('Aluminium',10,0.8,4000,0.84,0.0133),
  ('Aluminium',10,0.8,6000,1.12,0.0100),('Aluminium',10,0.8,8000,1.68,0.0067),
  ('Aluminium',10,0.8,10000,3.36,0.0033),('Aluminium',10,0.8,12000,4.48,0.0025),
  ('Aluminium',10,0.8,15000,3.92,0.0029),
  ('Aluminium',12,0.9,3000,0.28,0.0444),('Aluminium',12,0.9,4000,0.38,0.0333),
  ('Aluminium',12,0.9,6000,0.88,0.0143),('Aluminium',12,0.9,8000,1.26,0.0100),
  ('Aluminium',12,0.9,10000,1.89,0.0067),('Aluminium',12,0.9,12000,3.78,0.0033),
  ('Aluminium',12,0.9,15000,2.21,0.0057),
  ('Aluminium',14,1.1,4000,0.25,0.0500),('Aluminium',14,1.1,6000,0.69,0.0182),
  ('Aluminium',14,1.1,8000,0.76,0.0167),('Aluminium',14,1.1,10000,1.58,0.0080),
  ('Aluminium',14,1.1,12000,1.58,0.0080),('Aluminium',14,1.1,15000,1.89,0.0067),
  ('Aluminium',16,1.2,6000,0.50,0.0250),('Aluminium',16,1.2,8000,1.01,0.0125),
  ('Aluminium',16,1.2,10000,1.26,0.0100),('Aluminium',16,1.2,12000,1.89,0.0067),
  ('Aluminium',16,1.2,15000,1.58,0.0080),
  ('Aluminium',18,1.4,6000,0.47,0.0267),('Aluminium',18,1.4,8000,0.82,0.0154),
  ('Aluminium',18,1.4,10000,1.13,0.0111),('Aluminium',18,1.4,12000,1.58,0.0080),
  ('Aluminium',18,1.4,15000,1.17,0.0108),
  ('Aluminium',20,1.6,6000,0.44,0.0286),('Aluminium',20,1.6,8000,0.63,0.0200),
  ('Aluminium',20,1.6,10000,1.01,0.0125),('Aluminium',20,1.6,12000,1.26,0.0100),
  ('Aluminium',20,1.6,15000,0.76,0.0167),
  ('Aluminium',22,1.8,8000,0.54,0.0235),('Aluminium',22,1.8,10000,0.82,0.0154),
  ('Aluminium',22,1.8,12000,1.13,0.0111),('Aluminium',22,1.8,15000,0.60,0.0211),
  ('Aluminium',25,2.1,8000,0.44,0.0286),('Aluminium',25,2.1,10000,0.63,0.0200),
  ('Aluminium',25,2.1,12000,1.01,0.0125),('Aluminium',25,2.1,15000,0.44,0.0286),
  ('Aluminium',30,2.4,10000,0.44,0.0286),('Aluminium',30,2.4,12000,0.32,0.0400),
  ('Aluminium',30,2.4,15000,0.32,0.0400),
  ('Aluminium',35,2.8,12000,0.63,0.0200),('Aluminium',35,2.8,15000,0.25,0.0500),
  ('Aluminium',40,3.2,12000,0.19,0.0667),('Aluminium',40,3.2,15000,0.19,0.0667),
  ('Aluminium',45,3.7,15000,0.17,0.0727),
  ('Aluminium',50,4.3,15000,0.16,0.0800)
ON CONFLICT (material, thickness_mm, laser_power_w) DO NOTHING;

-- BRASS
INSERT INTO sm_lookup_laser_cut (material, thickness_mm, kerf_mm, laser_power_w, cutting_speed_m_per_min, pierce_time_min) VALUES
  ('Brass',1,0.5,500,2.31,0.0036),('Brass',1,0.5,1000,4.20,0.0020),
  ('Brass',1,0.5,1500,6.30,0.0013),('Brass',1,0.5,2000,7.56,0.0011),
  ('Brass',1,0.5,3000,14.70,0.0006),('Brass',1,0.5,4000,12.60,0.0007),
  ('Brass',1,0.5,6000,23.10,0.0004),('Brass',1,0.5,8000,27.30,0.0003),
  ('Brass',1,0.5,10000,31.50,0.0003),('Brass',1,0.5,12000,35.70,0.0002),
  ('Brass',1,0.5,15000,16.80,0.0005),
  ('Brass',2,0.6,500,0.46,0.0200),('Brass',2,0.6,1000,1.64,0.0056),
  ('Brass',2,0.6,1500,2.28,0.0040),('Brass',2,0.6,2000,3.64,0.0025),
  ('Brass',2,0.6,3000,6.83,0.0013),('Brass',2,0.6,4000,6.83,0.0013),
  ('Brass',2,0.6,6000,13.65,0.0007),('Brass',2,0.6,8000,18.20,0.0005),
  ('Brass',2,0.6,10000,20.48,0.0004),('Brass',2,0.6,12000,22.75,0.0004),
  ('Brass',2,0.6,15000,16.84,0.0005),
  ('Brass',3,0.7,1000,0.46,0.0200),('Brass',3,0.7,1500,1.14,0.0080),
  ('Brass',3,0.7,2000,1.82,0.0050),('Brass',3,0.7,3000,2.73,0.0033),
  ('Brass',3,0.7,4000,3.64,0.0025),('Brass',3,0.7,6000,8.19,0.0011),
  ('Brass',3,0.7,8000,13.65,0.0007),('Brass',3,0.7,10000,18.20,0.0005),
  ('Brass',3,0.7,12000,22.75,0.0004),('Brass',3,0.7,15000,10.92,0.0008),
  ('Brass',4,0.8,1500,0.83,0.0125),('Brass',4,0.8,2000,1.04,0.0100),
  ('Brass',4,0.8,3000,2.60,0.0040),('Brass',4,0.8,4000,2.86,0.0036),
  ('Brass',4,0.8,6000,5.20,0.0020),('Brass',4,0.8,8000,9.36,0.0011),
  ('Brass',4,0.8,10000,12.48,0.0008),('Brass',4,0.8,12000,17.16,0.0006),
  ('Brass',4,0.8,15000,9.88,0.0011),
  ('Brass',5,0.9,1500,0.36,0.0286),('Brass',5,0.9,2000,0.62,0.0167),
  ('Brass',5,0.9,3000,1.14,0.0091),('Brass',5,0.9,4000,1.56,0.0067),
  ('Brass',5,0.9,6000,3.12,0.0033),('Brass',5,0.9,8000,4.68,0.0022),
  ('Brass',5,0.9,10000,7.80,0.0013),('Brass',5,0.9,12000,12.48,0.0008),
  ('Brass',5,0.9,15000,8.32,0.0013),
  ('Brass',6,1.0,2000,0.36,0.0286),('Brass',6,1.0,3000,0.94,0.0111),
  ('Brass',6,1.0,4000,1.30,0.0080),('Brass',6,1.0,6000,2.34,0.0044),
  ('Brass',6,1.0,8000,3.38,0.0031),('Brass',6,1.0,10000,4.68,0.0022),
  ('Brass',6,1.0,12000,7.80,0.0013),('Brass',6,1.0,15000,5.72,0.0018),
  ('Brass',8,1.2,3000,0.39,0.0286),('Brass',8,1.2,4000,0.56,0.0200),
  ('Brass',8,1.2,6000,1.23,0.0091),('Brass',8,1.2,8000,2.24,0.0050),
  ('Brass',8,1.2,10000,3.64,0.0031),('Brass',8,1.2,12000,5.04,0.0022),
  ('Brass',8,1.2,15000,4.48,0.0025),
  ('Brass',10,1.3,4000,0.22,0.0500),('Brass',10,1.3,6000,0.67,0.0167),
  ('Brass',10,1.3,8000,1.23,0.0091),('Brass',10,1.3,10000,2.24,0.0050),
  ('Brass',10,1.3,12000,3.64,0.0031),('Brass',10,1.3,15000,3.36,0.0033),
  ('Brass',12,1.5,6000,0.25,0.0500),('Brass',12,1.5,8000,0.95,0.0133),
  ('Brass',12,1.5,10000,1.39,0.0091),('Brass',12,1.5,12000,2.52,0.0050),
  ('Brass',12,1.5,15000,1.39,0.0091),
  ('Brass',14,1.8,8000,0.38,0.0333),('Brass',14,1.8,10000,0.50,0.0250),
  ('Brass',14,1.8,12000,0.95,0.0133),('Brass',14,1.8,15000,1.13,0.0111),
  ('Brass',15,2.0,8000,0.50,0.0250),('Brass',15,2.0,10000,0.57,0.0222),
  ('Brass',15,2.0,12000,0.63,0.0200),('Brass',15,2.0,15000,0.88,0.0143),
  ('Brass',16,2.3,15000,0.82,0.0154),
  ('Brass',18,2.7,15000,0.76,0.0167),
  ('Brass',20,3.1,15000,0.44,0.0286)
ON CONFLICT (material, thickness_mm, laser_power_w) DO NOTHING;

-- ── TABLE 6: Sampling Plan (ISO 2859-1) ─────────────────────────────────────
-- sample_qty_l2 is the standard Level II (default) sample size
INSERT INTO sm_lookup_sampling_plan (batch_size_from, batch_size_to, sample_qty_l1, sample_qty_l2, sample_qty_l3) VALUES
  (2,         8,          2,    2,    3),
  (9,         15,         2,    3,    5),
  (16,        25,         3,    5,    8),
  (26,        50,         5,    8,    13),
  (51,        90,         5,    13,   20),
  (91,        150,        8,    20,   32),
  (151,       280,        13,   32,   50),
  (281,       500,        20,   50,   80),
  (501,       1200,       32,   80,   125),
  (1201,      3200,       50,   125,  200),
  (3201,      10000,      80,   200,  315),
  (10001,     35000,      125,  315,  500),
  (35001,     150000,     200,  500,  800),
  (150001,    500000,     315,  800,  1250),
  (500001,    10000000,   500,  1250, 2000)
ON CONFLICT (batch_size_from, batch_size_to) DO NOTHING;

-- ── Update raw_materials mechanical properties for common sheet metals ────────
-- Sets shear_strength (≈0.6×UTS), UTS, yield strength for stock materials.
-- Only updates rows where the columns are still NULL to preserve user-entered data.
UPDATE raw_materials SET
  shear_strength_mpa = 352, uts_mpa = 440, yield_strength_mpa = 320
WHERE (material ILIKE '%HDG%' OR material_grade ILIKE '%SGCC%' OR material_grade ILIKE '%SGCH%'
    OR material ILIKE '%Galvanized%')
  AND shear_strength_mpa IS NULL;

UPDATE raw_materials SET
  shear_strength_mpa = 246, uts_mpa = 410, yield_strength_mpa = 250
WHERE (material ILIKE '%Mild Steel%' OR material ILIKE '%IS 2062%' OR material ILIKE '%IS2062%'
    OR material_grade ILIKE '%E250%' OR material ILIKE '%CRCA%' OR material_grade ILIKE '%DC01%')
  AND shear_strength_mpa IS NULL;

UPDATE raw_materials SET
  shear_strength_mpa = 186, uts_mpa = 310, yield_strength_mpa = 276
WHERE (material ILIKE '%6061%' OR material ILIKE '%AA6061%' OR material ILIKE '%AL6061%'
    OR material_grade ILIKE '%6061%')
  AND shear_strength_mpa IS NULL;

UPDATE raw_materials SET
  shear_strength_mpa = 138, uts_mpa = 230, yield_strength_mpa = 193
WHERE (material ILIKE '%5052%' OR material ILIKE '%AA5052%' OR material_grade ILIKE '%5052%')
  AND shear_strength_mpa IS NULL;

UPDATE raw_materials SET
  shear_strength_mpa = 372, uts_mpa = 620, yield_strength_mpa = 310
WHERE (material ILIKE '%SS 304%' OR material ILIKE '%SS304%' OR material_grade ILIKE '%304%'
    OR material ILIKE '%Stainless%')
  AND shear_strength_mpa IS NULL;
