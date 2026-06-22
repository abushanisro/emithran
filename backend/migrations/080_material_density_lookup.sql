-- Migration 080: Material Density Lookup Table
-- Purpose: Canonical read-only reference table for material densities.
--          Used by the frontend to compute weight = (volume_mm3 / 1e6) * density_g_cm3
--          and by the auto-fill service for weight estimation.
-- Units:   density_g_cm3 is in g/cm³  (= 1000× kg/m³)

CREATE TABLE IF NOT EXISTS material_density_lookup (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  material_category TEXT       NOT NULL CHECK (material_category IN ('FERROUS_NON_FERROUS', 'PLASTIC_RUBBER', 'OTHER')),
  material_name    TEXT        NOT NULL,
  material_grade   TEXT        NOT NULL,
  density_g_cm3    NUMERIC(8, 4) NOT NULL CHECK (density_g_cm3 > 0),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary lookup: exact or ILIKE match on grade
CREATE UNIQUE INDEX IF NOT EXISTS idx_material_density_grade
  ON material_density_lookup (LOWER(material_grade));

CREATE INDEX IF NOT EXISTS idx_material_density_category
  ON material_density_lookup (material_category);

CREATE INDEX IF NOT EXISTS idx_material_density_name
  ON material_density_lookup (LOWER(material_name));

-- Read-only reference data — all authenticated users can SELECT
ALTER TABLE material_density_lookup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read material density lookup"
  ON material_density_lookup FOR SELECT
  TO authenticated
  USING (true);

-- ─── SEED DATA ───────────────────────────────────────────────────────────────

INSERT INTO material_density_lookup
  (material_category, material_name, material_grade, density_g_cm3, notes)
VALUES

-- ── FERROUS / CARBON STEEL ───────────────────────────────────────────────────
('FERROUS_NON_FERROUS', 'Mild Steel',   'EN1A',  7.85, 'Free-cutting mild steel'),
('FERROUS_NON_FERROUS', 'Mild Steel',   'EN2',   7.85, '0.15% C mild steel'),
('FERROUS_NON_FERROUS', 'Mild Steel',   'EN3',   7.85, '0.15-0.25% C'),
('FERROUS_NON_FERROUS', 'Mild Steel',   'EN8',   7.85, '0.35-0.45% C medium carbon'),
('FERROUS_NON_FERROUS', 'Alloy Steel',  'EN9',   7.85, '0.55% C spring steel'),
('FERROUS_NON_FERROUS', 'Alloy Steel',  'EN19',  7.85, 'Cr-Mo alloy steel'),
('FERROUS_NON_FERROUS', 'Alloy Steel',  'EN24',  7.85, 'Ni-Cr-Mo high tensile'),
('FERROUS_NON_FERROUS', 'Alloy Steel',  'EN31',  7.81, 'High-C chromium bearing steel'),
('FERROUS_NON_FERROUS', 'Alloy Steel',  'EN36',  7.85, 'Case-hardening Ni-Cr steel'),
('FERROUS_NON_FERROUS', 'Alloy Steel',  'EN47',  7.86, 'Cr-V spring steel'),
('FERROUS_NON_FERROUS', 'Carbon Steel', 'C10',   7.85, '0.10% C'),
('FERROUS_NON_FERROUS', 'Carbon Steel', 'C20',   7.85, '0.20% C'),
('FERROUS_NON_FERROUS', 'Carbon Steel', 'C40',   7.85, '0.40% C'),
('FERROUS_NON_FERROUS', 'Carbon Steel', 'C45',   7.85, '0.45% C — most common'),
('FERROUS_NON_FERROUS', 'Carbon Steel', 'C55',   7.84, '0.55% C'),
('FERROUS_NON_FERROUS', 'Carbon Steel', 'C60',   7.84, '0.60% C'),

-- ── STAINLESS STEEL ──────────────────────────────────────────────────────────
('FERROUS_NON_FERROUS', 'Stainless Steel', 'SS304',   8.00, 'Austenitic 18-8'),
('FERROUS_NON_FERROUS', 'Stainless Steel', '304',     8.00, 'Austenitic 18-8'),
('FERROUS_NON_FERROUS', 'Stainless Steel', 'SS316',   8.00, 'Mo-bearing marine grade'),
('FERROUS_NON_FERROUS', 'Stainless Steel', '316',     8.00, 'Mo-bearing marine grade'),
('FERROUS_NON_FERROUS', 'Stainless Steel', 'SS316L',  7.99, 'Low-carbon weldable'),
('FERROUS_NON_FERROUS', 'Stainless Steel', '316L',    7.99, 'Low-carbon weldable'),
('FERROUS_NON_FERROUS', 'Stainless Steel', 'SS410',   7.74, 'Martensitic, hardenable'),
('FERROUS_NON_FERROUS', 'Stainless Steel', 'SS420',   7.74, 'Martensitic, higher C'),
('FERROUS_NON_FERROUS', 'Stainless Steel', 'SS430',   7.74, 'Ferritic, general purpose'),

-- ── TOOL STEEL ───────────────────────────────────────────────────────────────
('FERROUS_NON_FERROUS', 'Tool Steel', 'D2',  7.70, 'Cold-work high-Cr tool steel'),
('FERROUS_NON_FERROUS', 'Tool Steel', 'H11', 7.75, 'Hot-work die steel'),
('FERROUS_NON_FERROUS', 'Tool Steel', 'H13', 7.75, 'Hot-work die steel — most common'),
('FERROUS_NON_FERROUS', 'Tool Steel', 'M2',  8.16, 'High-speed steel'),
('FERROUS_NON_FERROUS', 'Tool Steel', 'P20', 7.85, 'Pre-hardened mould steel'),
('FERROUS_NON_FERROUS', 'Tool Steel', 'O1',  7.85, 'Oil-hardening tool steel'),

-- ── CAST IRON ────────────────────────────────────────────────────────────────
('FERROUS_NON_FERROUS', 'Cast Iron', 'Grey Cast Iron',  7.20, 'Flake graphite, good damping'),
('FERROUS_NON_FERROUS', 'Cast Iron', 'GCI',             7.20, 'Grey cast iron'),
('FERROUS_NON_FERROUS', 'Cast Iron', 'SG Iron',         7.10, 'Spheroidal graphite / ductile iron'),
('FERROUS_NON_FERROUS', 'Cast Iron', 'White Cast Iron', 7.60, 'Cementite matrix, hard & brittle'),
('FERROUS_NON_FERROUS', 'Cast Iron', 'Malleable Iron',  7.30, 'Heat-treated white cast iron'),

-- ── ALUMINIUM ────────────────────────────────────────────────────────────────
('FERROUS_NON_FERROUS', 'Aluminum', '1100',    2.71, 'Commercially pure, 99% Al'),
('FERROUS_NON_FERROUS', 'Aluminum', '2011',    2.83, 'Free-machining aerospace'),
('FERROUS_NON_FERROUS', 'Aluminum', '2024',    2.78, 'High-strength aerospace'),
('FERROUS_NON_FERROUS', 'Aluminum', '5052',    2.68, 'Marine / sheet metal'),
('FERROUS_NON_FERROUS', 'Aluminum', '6061',    2.70, 'General-purpose structural'),
('FERROUS_NON_FERROUS', 'Aluminum', '6061-T6', 2.70, 'Heat-treated, most common grade'),
('FERROUS_NON_FERROUS', 'Aluminum', '6063',    2.70, 'Extrusion alloy'),
('FERROUS_NON_FERROUS', 'Aluminum', '7075',    2.81, 'High-strength aerospace'),
('FERROUS_NON_FERROUS', 'Aluminum', 'ADC12',   2.74, 'Al-Si-Cu die-cast alloy'),
('FERROUS_NON_FERROUS', 'Aluminum', 'LM6',     2.65, 'Al-Si casting alloy'),
('FERROUS_NON_FERROUS', 'Aluminum', 'LM25',    2.68, 'Al-Si-Mg casting alloy'),

-- ── COPPER / BRASS / BRONZE ──────────────────────────────────────────────────
('FERROUS_NON_FERROUS', 'Copper',  'ETP Copper',       8.94, 'Electrolytic tough pitch'),
('FERROUS_NON_FERROUS', 'Copper',  'C11000',           8.94, 'Pure copper'),
('FERROUS_NON_FERROUS', 'Brass',   'CZ108',            8.50, '70/30 brass'),
('FERROUS_NON_FERROUS', 'Brass',   'CZ121',            8.50, 'Free-machining brass'),
('FERROUS_NON_FERROUS', 'Brass',   'C36000',           8.50, 'Free-cutting brass'),
('FERROUS_NON_FERROUS', 'Bronze',  'Phosphor Bronze',  8.80, 'Bearing & spring bronze'),
('FERROUS_NON_FERROUS', 'Bronze',  'Aluminium Bronze', 7.60, 'High-strength marine bronze'),

-- ── TITANIUM ─────────────────────────────────────────────────────────────────
('FERROUS_NON_FERROUS', 'Titanium', 'Grade 2',   4.51, 'Commercially pure Ti'),
('FERROUS_NON_FERROUS', 'Titanium', 'Grade 5',   4.43, 'Ti-6Al-4V aerospace standard'),
('FERROUS_NON_FERROUS', 'Titanium', 'Ti-6Al-4V', 4.43, 'Most common titanium alloy'),

-- ── ZINC / MAGNESIUM / NICKEL ────────────────────────────────────────────────
('FERROUS_NON_FERROUS', 'Zinc',      'Zamak 3',    6.60, 'Standard die-cast zinc alloy'),
('FERROUS_NON_FERROUS', 'Zinc',      'Zamak 5',    6.60, 'Higher copper die-cast zinc'),
('FERROUS_NON_FERROUS', 'Magnesium', 'AZ31B',      1.77, 'Wrought magnesium alloy'),
('FERROUS_NON_FERROUS', 'Magnesium', 'AZ91D',      1.81, 'Die-cast magnesium alloy'),
('FERROUS_NON_FERROUS', 'Nickel Alloy', 'Inconel 625', 8.44, 'High-temperature corrosion resistant'),
('FERROUS_NON_FERROUS', 'Nickel Alloy', 'Inconel 718', 8.19, 'Aerospace superalloy'),
('FERROUS_NON_FERROUS', 'Nickel Alloy', 'Monel 400',   8.80, 'Ni-Cu corrosion resistant'),

-- ── PLASTICS ─────────────────────────────────────────────────────────────────
('PLASTIC_RUBBER', 'ABS',           'ABS',           1.05, 'Acrylonitrile Butadiene Styrene'),
('PLASTIC_RUBBER', 'ABS',           'ABS GF20',      1.18, '20% glass-filled ABS'),
('PLASTIC_RUBBER', 'ABS',           'PC-ABS',        1.15, 'Polycarbonate-ABS blend'),
('PLASTIC_RUBBER', 'Nylon',         'PA6',           1.14, 'Nylon 6'),
('PLASTIC_RUBBER', 'Nylon',         'PA66',          1.14, 'Nylon 6/6'),
('PLASTIC_RUBBER', 'Nylon',         'PA6 GF30',      1.36, '30% glass-filled PA6'),
('PLASTIC_RUBBER', 'Nylon',         'PA66 GF30',     1.38, '30% glass-filled PA66'),
('PLASTIC_RUBBER', 'Polycarbonate', 'PC',            1.20, 'Polycarbonate'),
('PLASTIC_RUBBER', 'Polycarbonate', 'PC GF10',       1.27, '10% glass-filled PC'),
('PLASTIC_RUBBER', 'Polypropylene', 'PP',            0.91, 'Homopolymer'),
('PLASTIC_RUBBER', 'Polypropylene', 'PP Copolymer',  0.90, 'Impact copolymer'),
('PLASTIC_RUBBER', 'Polypropylene', 'PP GF20',       1.04, '20% glass-filled PP'),
('PLASTIC_RUBBER', 'POM',           'POM',           1.41, 'Acetal / Delrin copolymer'),
('PLASTIC_RUBBER', 'POM',           'POM-H',         1.42, 'Acetal homopolymer'),
('PLASTIC_RUBBER', 'PVC',           'PVC Rigid',     1.40, 'Hard PVC (UPVC)'),
('PLASTIC_RUBBER', 'PVC',           'PVC Flexible',  1.25, 'Plasticised PVC'),
('PLASTIC_RUBBER', 'Polyethylene',  'HDPE',          0.95, 'High-density polyethylene'),
('PLASTIC_RUBBER', 'Polyethylene',  'LDPE',          0.92, 'Low-density polyethylene'),
('PLASTIC_RUBBER', 'PMMA',          'PMMA',          1.18, 'Acrylic / Perspex'),
('PLASTIC_RUBBER', 'Polystyrene',   'PS',            1.05, 'General-purpose polystyrene'),
('PLASTIC_RUBBER', 'Polystyrene',   'HIPS',          1.04, 'High-impact polystyrene'),
('PLASTIC_RUBBER', 'PET',           'PET',           1.37, 'Polyethylene terephthalate'),
('PLASTIC_RUBBER', 'PET',           'PBT',           1.31, 'Polybutylene terephthalate'),
('PLASTIC_RUBBER', 'High Performance', 'PEEK',       1.32, 'Polyether ether ketone'),
('PLASTIC_RUBBER', 'High Performance', 'PTFE',       2.20, 'Teflon / polytetrafluoroethylene'),
('PLASTIC_RUBBER', 'High Performance', 'PPS',        1.35, 'Polyphenylene sulfide'),
('PLASTIC_RUBBER', 'High Performance', 'PSU',        1.24, 'Polysulfone'),

-- ── RUBBER / ELASTOMERS ──────────────────────────────────────────────────────
('PLASTIC_RUBBER', 'TPE/Rubber', 'TPE',      0.90, 'Thermoplastic elastomer (general)'),
('PLASTIC_RUBBER', 'TPE/Rubber', 'TPU',      1.20, 'Thermoplastic polyurethane'),
('PLASTIC_RUBBER', 'TPE/Rubber', 'Silicone', 1.20, 'General-purpose silicone rubber'),
('PLASTIC_RUBBER', 'TPE/Rubber', 'EPDM',     0.87, 'Ethylene propylene diene monomer'),
('PLASTIC_RUBBER', 'TPE/Rubber', 'NBR',      1.00, 'Nitrile / Buna-N rubber'),
('PLASTIC_RUBBER', 'TPE/Rubber', 'SBR',      0.94, 'Styrene-butadiene rubber')

ON CONFLICT DO NOTHING;



( on papper to mae  sql)
{ 
  creat e the sql  to update 
  if the x = to 
  y[]
}