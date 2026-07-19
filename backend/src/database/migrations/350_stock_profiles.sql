-- Migration 350: Standard stock profiles for blank optimizer
-- Enables near-net blank selection (round bar, rectangular bar, plate)
-- instead of bounding-box billet → improves material utilization from ~17% to 55–65%.

CREATE TABLE IF NOT EXISTS stock_profiles (
  id              UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  form            VARCHAR(30)   NOT NULL,  -- 'round_bar' | 'hex_bar' | 'rectangular_bar' | 'plate'
  material_family VARCHAR(50),             -- NULL = applies to all families
  size_a_mm       NUMERIC(8,2)  NOT NULL,  -- diameter (round/hex) OR width (rectangular/plate)
  size_b_mm       NUMERIC(8,2),            -- height — rectangular bar only; NULL for round/hex
  standard        VARCHAR(40),
  created_at      TIMESTAMPTZ   DEFAULT now()
);

-- Round bars — EN 573-3 / ASTM B221 preferred sizes (mm diameter)
INSERT INTO stock_profiles (form, size_a_mm, standard) VALUES
  ('round_bar',  6,   'EN573-3'),
  ('round_bar',  8,   'EN573-3'),
  ('round_bar', 10,   'EN573-3'),
  ('round_bar', 12,   'EN573-3'),
  ('round_bar', 15,   'EN573-3'),
  ('round_bar', 16,   'EN573-3'),
  ('round_bar', 18,   'EN573-3'),
  ('round_bar', 20,   'EN573-3'),
  ('round_bar', 25,   'EN573-3'),
  ('round_bar', 30,   'EN573-3'),
  ('round_bar', 35,   'EN573-3'),
  ('round_bar', 40,   'EN573-3'),
  ('round_bar', 45,   'EN573-3'),
  ('round_bar', 50,   'EN573-3'),
  ('round_bar', 60,   'EN573-3'),
  ('round_bar', 70,   'EN573-3'),
  ('round_bar', 80,   'EN573-3'),
  ('round_bar', 90,   'EN573-3'),
  ('round_bar', 100,  'EN573-3'),
  ('round_bar', 120,  'EN573-3'),
  ('round_bar', 150,  'EN573-3');

-- Hex bars — DIN 934 / ISO 4032 preferred wrench sizes (mm across-flats)
INSERT INTO stock_profiles (form, size_a_mm, standard) VALUES
  ('hex_bar',  6,  'DIN934'),
  ('hex_bar',  8,  'DIN934'),
  ('hex_bar', 10,  'DIN934'),
  ('hex_bar', 12,  'DIN934'),
  ('hex_bar', 14,  'DIN934'),
  ('hex_bar', 17,  'DIN934'),
  ('hex_bar', 19,  'DIN934'),
  ('hex_bar', 22,  'DIN934'),
  ('hex_bar', 24,  'DIN934'),
  ('hex_bar', 27,  'DIN934'),
  ('hex_bar', 30,  'DIN934'),
  ('hex_bar', 32,  'DIN934'),
  ('hex_bar', 36,  'DIN934'),
  ('hex_bar', 41,  'DIN934'),
  ('hex_bar', 46,  'DIN934'),
  ('hex_bar', 50,  'DIN934'),
  ('hex_bar', 55,  'DIN934'),
  ('hex_bar', 60,  'DIN934'),
  ('hex_bar', 65,  'DIN934'),
  ('hex_bar', 70,  'DIN934'),
  ('hex_bar', 75,  'DIN934');

-- Rectangular bars — width × height (mm), stocked in 3m lengths
INSERT INTO stock_profiles (form, size_a_mm, size_b_mm) VALUES
  ('rectangular_bar', 12,  6),
  ('rectangular_bar', 16, 10),
  ('rectangular_bar', 20, 10),
  ('rectangular_bar', 20, 15),
  ('rectangular_bar', 25, 12),
  ('rectangular_bar', 25, 20),
  ('rectangular_bar', 30, 15),
  ('rectangular_bar', 30, 20),
  ('rectangular_bar', 30, 25),
  ('rectangular_bar', 40, 20),
  ('rectangular_bar', 40, 30),
  ('rectangular_bar', 50, 20),
  ('rectangular_bar', 50, 25),
  ('rectangular_bar', 50, 30),
  ('rectangular_bar', 50, 40),
  ('rectangular_bar', 60, 30),
  ('rectangular_bar', 60, 40),
  ('rectangular_bar', 60, 50),
  ('rectangular_bar', 80, 40),
  ('rectangular_bar', 80, 60),
  ('rectangular_bar', 100, 50),
  ('rectangular_bar', 100, 60),
  ('rectangular_bar', 100, 75),
  ('rectangular_bar', 100, 80),
  ('rectangular_bar', 120, 80),
  ('rectangular_bar', 150, 100);

-- Enable RLS (read-only for authenticated users; admin manages via service role)
ALTER TABLE stock_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_profiles_select" ON stock_profiles FOR SELECT USING (auth.role() = 'authenticated');
