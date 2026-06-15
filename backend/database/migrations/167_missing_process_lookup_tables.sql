-- Migration 167: Lookup tables for processes not covered by migration 161
--
-- Adds engineering reference tables for:
--   Injection Moulding, Compression Moulding, Thermoforming,
--   Laser Cutting, Plasma Cutting, Waterjet Cutting,
--   MIG Welding, TIG Welding, Spot Welding,
--   Heat Treatment, Powder Coating, Anodizing,
--   Forging, Die Casting, Investment Casting, Drilling/EDM
--
-- Safe to re-run: uses ON CONFLICT (process_id, table_name) DO NOTHING
-- Relies on the unique constraint added by migration 166.
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════════════════
-- INJECTION MOULDING
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Injection%Mould%','%Injection%Molding%','%Injection%Mold%'])
  LIMIT 10
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Process Parameters by Material',
    'Melt temperature, mould temperature, injection pressure, and cycle time by polymer',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"melt_temp_c","type":"text","label":"Melt Temp (°C)"},
      {"name":"mould_temp_c","type":"text","label":"Mould Temp (°C)"},
      {"name":"inj_pressure_mpa","type":"text","label":"Inj Pressure (MPa)"},
      {"name":"cooling_s","type":"number","label":"Cooling Time (s)"},
      {"name":"shrinkage_pct","type":"text","label":"Shrinkage (%)"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'melt_temp_c',mt,'mould_temp_c',mdt,'inj_pressure_mpa',ip,'cooling_s',cs,'shrinkage_pct',sh),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('ABS',                '210–250', '25–70',  '70–140',  15, '0.4–0.7%'),
    ('PP Homopolymer',     '200–250', '20–60',  '70–120',  20, '1.5–2.0%'),
    ('PP Copolymer',       '200–250', '20–60',  '70–120',  22, '1.2–1.8%'),
    ('HDPE',               '200–260', '20–60',  '70–105',  25, '1.5–3.0%'),
    ('PA6 (Nylon 6)',      '220–260', '60–80',  '70–140',  20, '0.8–1.5%'),
    ('PA66 (Nylon 66)',    '260–290', '60–90',  '70–140',  18, '0.8–1.5%'),
    ('POM (Acetal)',       '185–220', '60–90',  '90–140',  15, '1.8–2.5%'),
    ('PC (Polycarbonate)', '280–320', '80–100', '90–140',  20, '0.5–0.7%'),
    ('PC/ABS Blend',       '240–270', '60–80',  '70–120',  18, '0.5–0.7%'),
    ('PBT',                '230–270', '60–80',  '70–105',  15, '1.5–2.0%'),
    ('PEEK',               '360–400', '160–200','100–160', 12, '0.4–1.0%'),
    ('TPU',                '190–230', '30–60',  '60–105',  20, '0.5–2.0%'),
    ('TPE/TPV',            '180–220', '30–50',  '60–105',  25, '1.5–2.5%'),
    ('PMMA (Acrylic)',     '230–270', '50–80',  '70–140',  18, '0.3–0.6%'),
    ('PVC (Rigid)',        '170–200', '30–50',  '70–120',  20, '0.2–0.5%')
  ) AS t(m,mt,mdt,ip,cs,sh);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Wall Thickness Design Guide',
    'Minimum, recommended, and maximum wall thickness by material for uniform fill and sink avoidance',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"min_mm","type":"number","label":"Min Wall (mm)"},
      {"name":"rec_mm","type":"text","label":"Recommended (mm)"},
      {"name":"max_mm","type":"number","label":"Max Wall (mm)"},
      {"name":"note","type":"text","label":"DFM Note"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'min_mm',mn,'rec_mm',rc,'max_mm',mx,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('ABS',         0.8, '1.5–3.0', 6.0, 'Sink risk >3 mm'),
    ('PP',          0.8, '1.5–3.0', 5.0, 'Living hinges: 0.3–0.5 mm'),
    ('HDPE',        1.0, '2.0–3.5', 6.0, 'High shrink — uniform wall critical'),
    ('PA6/PA66',    0.8, '1.5–3.0', 5.0, 'Moisture: dry before moulding'),
    ('POM',         0.8, '1.5–3.5', 5.0, 'Flash risk at parting line'),
    ('PC',          1.0, '2.5–4.0', 9.0, 'High flow resistance — keep uniform'),
    ('PC/ABS',      1.0, '2.0–3.5', 8.0, 'Good balance of flow and strength'),
    ('PEEK',        1.0, '2.0–4.0', 8.0, 'High cost — minimise volume'),
    ('TPU',         0.5, '1.5–3.0', 6.0, 'Soft parts: undercuts OK'),
    ('PMMA',        0.8, '2.0–4.0', 6.0, 'Optical grade: avoid stress marks')
  ) AS t(m,mn,rc,mx,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Draft Angle & DFM Guide',
    'Draft angle requirements, rib design ratios, and boss design rules for injection-moulded parts',
    '[{"name":"feature","type":"text","label":"Feature"},
      {"name":"min_draft","type":"text","label":"Min Draft Angle"},
      {"name":"rec_draft","type":"text","label":"Recommended"},
      {"name":"rule","type":"text","label":"Design Rule"},
      {"name":"impact","type":"text","label":"Cost Impact if Violated"}]'::jsonb,
    3, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('feature',f,'min_draft',mn,'rec_draft',rc,'rule',r,'impact',imp),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Outer wall (smooth)',   '0.5°', '1°–2°',  'Per 25 mm depth', 'Drag marks, tool polish required'),
    ('Outer wall (textured)', '3°',   '5°',     '+ 1° per 0.025 mm texture depth', 'Part ejection failure'),
    ('Rib thickness',         NULL,   '60% wall', 'T_rib = 0.6 × T_wall', 'Sink mark on opposite face'),
    ('Rib height',            NULL,   '≤ 3× wall', 'H_rib ≤ 3 × T_wall', 'Fill difficulty, short shot'),
    ('Boss outer diameter',   NULL,   '2× hole dia', 'D_boss = 2 × D_insert', 'Sink on surface, cracking'),
    ('Boss wall to outer wall gap', NULL, '2× wall', 'Avoid merging boss to wall', 'Sink and warp'),
    ('Corner internal radius',NULL,   '0.5× wall', 'R_inside = 0.5 × T_wall', 'Stress concentration, crack'),
    ('Undercut depth',        NULL,   'Avoid', 'Use side-core or lifter', 'Very high tooling cost'),
    ('Snap-fit cantilever',   NULL,   'L/T ≥ 10', 'Beam length to thickness ratio', 'Fatigue failure in service'),
    ('Hole depth (blind)',     NULL,   '≤ 2× dia', 'D_hole ≤ 2 × Ø for blind holes', 'Pin deflection, dimensional error')
  ) AS t(f,mn,rc,r,imp);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Gate Type Selection Guide',
    'Gate selection by part geometry, material, and appearance requirements',
    '[{"name":"gate_type","type":"text","label":"Gate Type"},
      {"name":"best_for","type":"text","label":"Best For"},
      {"name":"part_weight_g","type":"text","label":"Part Weight (g)"},
      {"name":"witness_mark","type":"text","label":"Witness Mark"},
      {"name":"auto_degate","type":"text","label":"Auto De-gate"}]'::jsonb,
    4, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('gate_type',g,'best_for',b,'part_weight_g',pw,'witness_mark',wm,'auto_degate',ad),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Sprue Gate',      'Simple parts, single cavity', '> 100 g', 'Large, requires trimming', 'No'),
    ('Edge Gate',       'Flat parts, multi-cavity',    'Any',     'Small edge mark',          'No'),
    ('Submarine Gate',  'Hidden gate requirement',     '< 200 g', 'Minimal, sub-surface',     'Yes'),
    ('Pin-point Gate',  'Small to medium precision',   '< 100 g', 'Very small pinpoint',      'Yes'),
    ('Fan Gate',        'Flat/wide parts, low stress', '50–500 g','Wide thin mark',           'No'),
    ('Film/Diaphragm',  'Circular/disc parts',         'Any',     'Circular witness',         'No'),
    ('Hot Tip Gate',    'No runner waste, multi-cav',  'Any',     'Vestige only',             'Yes'),
    ('Valve Gate',      'High cosmetic requirement',   'Any',     'Near zero',                'Yes')
  ) AS t(g,b,pw,wm,ad);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- COMPRESSION MOULDING
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Compression%Mould%','%Compression%Mold%'])
  LIMIT 5
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Process Parameters by Material',
    'Moulding temperature, pressure, and cure time for compression moulding',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"temp_c","type":"text","label":"Mould Temp (°C)"},
      {"name":"pressure_mpa","type":"text","label":"Pressure (MPa)"},
      {"name":"cure_time_min","type":"text","label":"Cure Time (min)"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'temp_c',tc,'pressure_mpa',pr,'cure_time_min',ct,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('SMC (Sheet Moulding Compound)',  '140–160', '5–10',  '1–3',   'Glass-filled polyester'),
    ('BMC (Bulk Moulding Compound)',   '140–160', '7–14',  '1–2',   'Short glass fibre'),
    ('Natural Rubber',                 '140–180', '10–20', '5–15',  'Sulphur cure system'),
    ('EPDM',                           '160–180', '10–20', '3–8',   'Peroxide or sulphur cure'),
    ('Silicone Rubber',                '150–200', '10–20', '2–10',  'Platinum or peroxide cure'),
    ('Phenolic (Bakelite)',             '150–175', '10–30', '2–5',   'Thermoset, no remelting'),
    ('Urea Formaldehyde',              '140–165', '14–35', '1–3',   'Electrical fittings')
  ) AS t(m,tc,pr,ct,n);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- THERMOFORMING
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Thermoform%'])
  LIMIT 5
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Forming Temperature by Material',
    'Sheet heating temperature and forming window for common thermoforming materials',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"forming_temp_c","type":"text","label":"Forming Temp (°C)"},
      {"name":"min_thickness_mm","type":"number","label":"Min Sheet (mm)"},
      {"name":"draw_ratio","type":"text","label":"Max Draw Ratio"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'forming_temp_c',ft,'min_thickness_mm',mt,'draw_ratio',dr,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('ABS',      '130–160', 1.5, '3:1',  'Most widely thermoformed'),
    ('HIPS',     '120–155', 1.0, '3:1',  'Food packaging, low cost'),
    ('PET',      '80–100',  0.5, '2.5:1','CPET for oven trays up to 220°C'),
    ('PP',       '150–175', 1.5, '2:1',  'Living hinges, chemical resistance'),
    ('HDPE',     '150–175', 2.0, '2:1',  'High shrink — post-form fixturing needed'),
    ('PC',       '175–195', 1.5, '2:1',  'High temp parts, optical clarity'),
    ('PMMA',     '150–180', 2.0, '2.5:1','Signage, aircraft glazing'),
    ('PVC (Rigid)','140–165',0.3,'3:1',  'Blister packaging'),
    ('TPU',      '160–190', 1.5, '2:1',  'Flexible formed parts')
  ) AS t(m,ft,mt,dr,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Wall Thinning & Draw Ratio Guide',
    'Expected wall thinning at corners and base for different draw ratios',
    '[{"name":"draw_ratio","type":"text","label":"Draw Ratio (H:W)"},
      {"name":"sidewall_thinning","type":"text","label":"Sidewall Thinning"},
      {"name":"corner_thinning","type":"text","label":"Corner Thinning"},
      {"name":"base_thickness","type":"text","label":"Base Thickness"},
      {"name":"application","type":"text","label":"Typical Application"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('draw_ratio',dr,'sidewall_thinning',sw,'corner_thinning',ct,'base_thickness',bt,'application',a),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('0.5:1 (shallow)', '5–10%',  '15–20%', '95–100% nominal', 'Trays, lids'),
    ('1:1 (medium)',    '15–25%', '30–40%', '90–95% nominal',  'Cups, containers'),
    ('1.5:1',           '25–35%', '40–55%', '80–90% nominal',  'Deep bowls'),
    ('2:1',             '35–50%', '55–70%', '65–80% nominal',  'Buckets, deep parts'),
    ('3:1 (deep)',      '50–65%', '70–85%', '50–65% nominal',  'Pressure formed with plug assist')
  ) AS t(dr,sw,ct,bt,a);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- LASER CUTTING (Fibre, CO2, Plasma, Waterjet — all cutting processes)
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Laser%Cut%','%Plasma%Cut%','%Waterjet%','%Water%jet%','%Shear%'])
  LIMIT 10
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Cutting Speed Reference',
    'Typical cutting speeds (mm/min) by material and thickness for fibre laser, CO2 laser, and plasma',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"thickness_mm","type":"number","label":"Thickness (mm)"},
      {"name":"fibre_laser_mpm","type":"number","label":"Fibre Laser (mm/min)"},
      {"name":"co2_laser_mpm","type":"number","label":"CO₂ Laser (mm/min)"},
      {"name":"plasma_mpm","type":"number","label":"Plasma (mm/min)"},
      {"name":"assist_gas","type":"text","label":"Assist Gas (Fibre)"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'thickness_mm',th,'fibre_laser_mpm',fl,'co2_laser_mpm',cl,'plasma_mpm',pl,'assist_gas',ag),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Mild Steel (MS)',   1,  7000, 5000, 8000, 'O₂'),
    ('Mild Steel (MS)',   3,  4000, 3000, 6000, 'O₂'),
    ('Mild Steel (MS)',   6,  2200, 1800, 4000, 'O₂'),
    ('Mild Steel (MS)',  10,  1200, 1000, 3000, 'O₂'),
    ('Mild Steel (MS)',  20,   500,  400, 2000, 'O₂'),
    ('Stainless SS304',   1,  5000, 3000, 4000, 'N₂'),
    ('Stainless SS304',   3,  2500, 1500, 3000, 'N₂'),
    ('Stainless SS304',   6,  1200,  800, 2000, 'N₂'),
    ('Stainless SS304',  10,   600,  350, 1200, 'N₂'),
    ('Aluminium',         1,  8000, 4000, 3000, 'N₂'),
    ('Aluminium',         3,  4000, 2000, 2000, 'N₂'),
    ('Aluminium',         6,  2000,  900, 1500, 'N₂'),
    ('Aluminium',        10,   900,  400,  800, 'N₂'),
    ('Copper',            1,  2000,  500,    0, 'N₂'),
    ('Copper',            3,  1000,  200,    0, 'N₂'),
    ('Brass',             1,  4000, 1500,    0, 'N₂'),
    ('Brass',             3,  2000,  700,    0, 'N₂')
  ) AS t(m,th,fl,cl,pl,ag);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Kerf Width & Tolerance Guide',
    'Typical kerf width and positional tolerance by process type',
    '[{"name":"process","type":"text","label":"Process"},
      {"name":"kerf_mm","type":"text","label":"Kerf Width (mm)"},
      {"name":"positional_tol","type":"text","label":"Positional Tol (mm)"},
      {"name":"edge_quality","type":"text","label":"Edge Quality"},
      {"name":"max_thickness_mm","type":"number","label":"Practical Max (mm)"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('process',p,'kerf_mm',k,'positional_tol',pt,'edge_quality',eq,'max_thickness_mm',mt),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Fibre Laser (2 kW)',  '0.1–0.2',  '±0.05',  'Excellent — bright edge, low HAZ', 20),
    ('Fibre Laser (6 kW)',  '0.1–0.3',  '±0.05',  'Excellent',                         30),
    ('CO₂ Laser',           '0.2–0.4',  '±0.10',  'Good — slight HAZ',                 25),
    ('Plasma (HD)',          '0.8–2.0',  '±0.30',  'Good — dross on underside',         50),
    ('Plasma (Standard)',    '1.5–4.0',  '±0.50',  'Fair — requires dressing',          80),
    ('Waterjet (abrasive)',  '0.8–1.2',  '±0.10',  'Excellent — no HAZ, any material', 200),
    ('Mechanical Shear',    '0 (share)', '±0.30',  'Good for straight cuts only',       20)
  ) AS t(p,k,pt,eq,mt);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Minimum Feature Size Guide',
    'Minimum hole diameter, slot width, and web between features by sheet thickness',
    '[{"name":"feature","type":"text","label":"Feature"},
      {"name":"fibre_laser","type":"text","label":"Fibre Laser Min"},
      {"name":"plasma","type":"text","label":"Plasma Min"},
      {"name":"waterjet","type":"text","label":"Waterjet Min"},
      {"name":"rule","type":"text","label":"Rule of Thumb"}]'::jsonb,
    3, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('feature',f,'fibre_laser',fl,'plasma',pl,'waterjet',wj,'rule',r),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Hole diameter',    '= thickness', '2.5× thickness', '1.5× thickness', 'Min Ø ≥ T for structural integrity'),
    ('Slot width',       '= thickness', '3× thickness',   '2× thickness',   'Narrower = kerf closure risk'),
    ('Web between holes','2× thickness','4× thickness',   '3× thickness',   'Web collapse if too thin'),
    ('Flange/notch width','2× thickness','5× thickness',  '3× thickness',   'Corner distortion risk'),
    ('Radius (internal)','0.5× thickness','2× thickness', '0.5 mm min',     'Sharp corners add time and wear')
  ) AS t(f,fl,pl,wj,r);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- MIG WELDING
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%MIG%','%GMAW%','%MAG%Weld%'])
  LIMIT 5
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Welding Parameters by Thickness',
    'Wire diameter, current, voltage, wire feed speed, and travel speed by material and thickness',
    '[{"name":"material","type":"text","label":"Base Material"},
      {"name":"thickness_mm","type":"number","label":"Thickness (mm)"},
      {"name":"wire_dia_mm","type":"text","label":"Wire Dia (mm)"},
      {"name":"current_a","type":"text","label":"Current (A)"},
      {"name":"voltage_v","type":"text","label":"Voltage (V)"},
      {"name":"wfs_m_min","type":"text","label":"Wire Feed (m/min)"},
      {"name":"travel_mm_min","type":"text","label":"Travel (mm/min)"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'thickness_mm',th,'wire_dia_mm',wd,'current_a',ca,'voltage_v',vv,'wfs_m_min',wfs,'travel_mm_min',tr),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Mild Steel',     1.5, '0.6',  '50–80',   '16–18', '3–5',   '500–700'),
    ('Mild Steel',     3,   '0.8',  '100–130', '18–20', '5–7',   '400–550'),
    ('Mild Steel',     6,   '0.8',  '130–180', '20–22', '6–8',   '300–450'),
    ('Mild Steel',    10,   '1.0',  '180–220', '22–24', '7–9',   '250–350'),
    ('Mild Steel',    20,   '1.2',  '220–280', '24–28', '8–12',  '150–250'),
    ('Stainless SS',   1.5, '0.6',  '50–75',   '15–17', '3–5',   '500–700'),
    ('Stainless SS',   3,   '0.8',  '90–120',  '17–19', '5–7',   '350–500'),
    ('Stainless SS',   6,   '1.0',  '140–170', '19–21', '6–8',   '280–400'),
    ('Aluminium',      2,   '1.0',  '80–120',  '17–19', '5–8',   '600–900'),
    ('Aluminium',      4,   '1.2',  '140–180', '20–23', '8–12',  '450–650'),
    ('Aluminium',      6,   '1.2',  '170–220', '22–25', '10–14', '350–500')
  ) AS t(m,th,wd,ca,vv,wfs,tr);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Shielding Gas Selection',
    'Shielding gas selection by base material and required weld quality',
    '[{"name":"material","type":"text","label":"Base Material"},
      {"name":"gas_mix","type":"text","label":"Gas / Mix"},
      {"name":"composition","type":"text","label":"Composition"},
      {"name":"application","type":"text","label":"Best For"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'gas_mix',g,'composition',c,'application',a,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Mild/Low Alloy Steel','C25',         'Ar 75% + CO₂ 25%', 'General fabrication',         'Most common; good bead shape'),
    ('Mild Steel',          'C100',        'CO₂ 100%',          'Structural, deep penetration','Higher spatter, lower cost'),
    ('Mild Steel',          'C8 (Stargon)','Ar 92% + CO₂ 8%',  'High quality finish',         'Low spatter, smooth bead'),
    ('Stainless Steel',     'TriMix',      'Ar 90%+He 7.5%+CO₂ 2.5%','Austenitic SS welding','Low oxidation, good colour'),
    ('Stainless Steel',     'Ar+2%CO₂',   'Ar 98% + CO₂ 2%',  'Thin SS sheets',              'Avoids black oxide'),
    ('Aluminium',           'Pure Argon',  'Ar 100%',           'All Al alloys',               'Spray transfer mode'),
    ('Aluminium',           'Ar+He',       'Ar 75% + He 25%',  'Thick Al, high deposition',   'Better penetration'),
    ('Copper',              'Pure Argon',  'Ar 100%',           'Copper brazing',              'High preheat needed')
  ) AS t(m,g,c,a,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Weld Joint Design Guide',
    'Recommended joint preparation and weld symbol by thickness and application',
    '[{"name":"joint_type","type":"text","label":"Joint Type"},
      {"name":"thickness_range","type":"text","label":"Thickness Range"},
      {"name":"preparation","type":"text","label":"Joint Prep"},
      {"name":"weld_size","type":"text","label":"Weld Size"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    3, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('joint_type',jt,'thickness_range',tr,'preparation',pr,'weld_size',ws,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Butt Joint (Square)',   '< 3 mm',    'No prep, full pen',    't = thickness',  'Single pass'),
    ('Butt Joint (V-groove)', '3–12 mm',   '60–70° included angle','Full penetration','Root gap 2–3 mm'),
    ('Butt Joint (Double-V)', '> 12 mm',   '60° each side',        'Full penetration','Reduces distortion vs single V'),
    ('Fillet Joint (equal)',  'Any',        'No prep',              'a = 0.7 × t_min','a = throat size'),
    ('Fillet Joint (min)',    'Structural', 'No prep',              'a ≥ 3 mm minimum','Per IS/AWS structural code'),
    ('T-Joint (partial pen)', '< 6 mm',    'No prep',              'a = 0.5 × t',    'Light loads'),
    ('T-Joint (full pen)',    '> 6 mm',    'Bevel one side',       'Full penetration','High-load joints'),
    ('Lap Joint',             '< 6 mm',    'No prep',              'a = t_thinner',   'Overlap min 3× thicker plate')
  ) AS t(jt,tr,pr,ws,n);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- TIG WELDING
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%TIG%','%GTAW%'])
  LIMIT 5
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'TIG Welding Parameters',
    'Tungsten size, current type, and amperage by material and thickness',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"thickness_mm","type":"number","label":"Thickness (mm)"},
      {"name":"tungsten_mm","type":"text","label":"Tungsten Dia (mm)"},
      {"name":"current_type","type":"text","label":"Current Type"},
      {"name":"amps","type":"text","label":"Amperage (A)"},
      {"name":"filler","type":"text","label":"Filler Wire"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'thickness_mm',th,'tungsten_mm',tw,'current_type',ct,'amps',a,'filler',f),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Mild Steel',      1.5, '1.6', 'DCEN', '50–90',   'ER70S-6'),
    ('Mild Steel',      3,   '2.4', 'DCEN', '90–140',  'ER70S-6'),
    ('Mild Steel',      6,   '3.2', 'DCEN', '140–200', 'ER70S-6'),
    ('Stainless SS304', 1.5, '1.6', 'DCEN', '50–80',   'ER308L'),
    ('Stainless SS304', 3,   '2.4', 'DCEN', '80–130',  'ER308L'),
    ('Stainless SS316', 3,   '2.4', 'DCEN', '80–130',  'ER316L'),
    ('Aluminium 6061',  2,   '2.4', 'AC',   '80–120',  'ER4043'),
    ('Aluminium 6061',  4,   '3.2', 'AC',   '120–180', 'ER4043'),
    ('Aluminium 5083',  4,   '3.2', 'AC',   '120–180', 'ER5356'),
    ('Titanium Ti-6Al-4V', 1.5,'1.6','DCEN','50–80',   'ERTi-5'),
    ('Inconel 625',     3,   '2.4', 'DCEN', '80–120',  'ERNiCrMo-3'),
    ('Copper',          3,   '3.2', 'DCEN', '120–180', 'ERCu')
  ) AS t(m,th,tw,ct,a,f);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- SPOT WELDING / RESISTANCE WELDING
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Spot%Weld%','%Seam%Weld%','%Resistance%Weld%'])
  LIMIT 5
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Spot Weld Parameters',
    'Electrode force, weld current, weld time, and minimum nugget diameter by sheet thickness',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"stack_mm","type":"text","label":"Stack Thickness (mm)"},
      {"name":"electrode_force_kn","type":"text","label":"Electrode Force (kN)"},
      {"name":"weld_current_ka","type":"text","label":"Weld Current (kA)"},
      {"name":"weld_time_cycles","type":"text","label":"Weld Time (cycles)"},
      {"name":"nugget_dia_mm","type":"text","label":"Min Nugget Ø (mm)"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'stack_mm',st,'electrode_force_kn',ef,'weld_current_ka',wc,'weld_time_cycles',wt,'nugget_dia_mm',nd),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Low Carbon Steel',  '0.5+0.5', '1.5–2.0', '6–8',   '6–8',   '4–5'),
    ('Low Carbon Steel',  '1.0+1.0', '2.5–3.0', '8–10',  '8–10',  '5–6'),
    ('Low Carbon Steel',  '1.5+1.5', '3.5–4.5', '10–12', '10–12', '6–7'),
    ('Low Carbon Steel',  '2.0+2.0', '4.5–5.5', '12–14', '12–16', '7–8'),
    ('Galvanised Steel',  '1.0+1.0', '3.0–3.5', '9–11',  '10–12', '5–6'),
    ('Stainless SS304',   '1.0+1.0', '2.0–2.5', '5–7',   '6–8',   '5–6'),
    ('Aluminium 6061',    '1.0+1.0', '2.5–3.5', '20–25', '2–4',   '5–6'),
    ('Aluminium 6061',    '2.0+2.0', '4.0–5.0', '28–35', '3–5',   '7–8')
  ) AS t(m,st,ef,wc,wt,nd);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- HEAT TREATMENT
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Heat%Treat%','%Harden%','%Anneal%','%Temper%','%Normaliz%'])
  LIMIT 10
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Through Hardening Parameters by Grade',
    'Austenitise, quench, and temper temperatures for common steel grades with expected hardness',
    '[{"name":"steel_grade","type":"text","label":"Steel Grade"},
      {"name":"austenitise_c","type":"text","label":"Austenitise (°C)"},
      {"name":"quench_medium","type":"text","label":"Quench Medium"},
      {"name":"temper_c","type":"text","label":"Temper Range (°C)"},
      {"name":"hardness_hrc","type":"text","label":"Hardness (HRC)"},
      {"name":"application","type":"text","label":"Typical Application"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('steel_grade',sg,'austenitise_c',ac,'quench_medium',qm,'temper_c',tc,'hardness_hrc',h,'application',a),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('EN8 (AISI 1040)',    '820–850', 'Water/Oil', '150–600', '22–55', 'Shafts, keys'),
    ('EN19 (AISI 4140)',   '840–860', 'Oil',       '200–600', '25–55', 'Gears, axles, crankshafts'),
    ('EN24 (AISI 4340)',   '830–860', 'Oil',       '200–600', '30–57', 'High-strength fasteners, gears'),
    ('EN31 (AISI 52100)',  '840–860', 'Oil',       '150–200', '60–64', 'Bearings, races'),
    ('D2 (1.2379)',        '980–1020','Air',        '150–560', '55–62', 'Cold work tooling, dies'),
    ('H13 (1.2344)',       '1000–1050','Air/Vacuum','530–620', '44–52', 'Hot work tooling, die casting dies'),
    ('M2 HSS (1.3343)',    '1200–1250','Oil/Air',   '540–560', '62–65', 'Cutting tools, drills'),
    ('420 Stainless',      '980–1050','Air',        '250–300', '48–54', 'Surgical instruments, knives'),
    ('17-4PH (H900)',      '480°C age','Air',       '480',     '38–43', 'Aerospace structural parts')
  ) AS t(sg,ac,qm,tc,h,a);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Case Hardening Reference',
    'Process parameters and achievable case depth for surface hardening methods',
    '[{"name":"process","type":"text","label":"Process"},
      {"name":"temp_c","type":"text","label":"Process Temp (°C)"},
      {"name":"case_depth_mm","type":"text","label":"Case Depth (mm)"},
      {"name":"surface_hardness","type":"text","label":"Surface Hardness"},
      {"name":"suitable_materials","type":"text","label":"Suitable Materials"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('process',pr,'temp_c',tc,'case_depth_mm',cd,'surface_hardness',sh,'suitable_materials',sm,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Gas Carburising',        '900–950', '0.5–2.5', '58–65 HRC', 'Low C steels EN36, SAE 8620', 'Quench after carburising'),
    ('Vacuum Carburising',     '900–1050','0.5–3.0', '58–65 HRC', 'Low C alloy steels',           'No grain boundary oxidation'),
    ('Gas Nitriding',          '500–550', '0.1–0.6', '700–1200 HV','Nitriding steels EN40B/38CrMoAl','No quench — distortion minimal'),
    ('Plasma (Ion) Nitriding', '400–560', '0.1–0.8', '700–1200 HV','Most steels + SS + Ti',        'Compound layer optional'),
    ('Induction Hardening',    '850–950', '1.0–6.0', '55–62 HRC', 'Medium C: EN8, EN19, EN24',    'Local hardening — shaft journals, gear teeth'),
    ('Flame Hardening',        '870–950', '1.5–6.0', '50–60 HRC', 'Medium C steels',               'Portable, large parts'),
    ('Carbonitriding',         '750–870', '0.1–0.75','55–62 HRC', 'Low C steels, mild steel',      'Combined C + N — thin case'),
    ('Boriding',               '700–900', '0.025–0.1','1400–2000 HV','Low/medium C steels',       'Extreme wear resistance')
  ) AS t(pr,tc,cd,sh,sm,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Annealing & Normalising Reference',
    'Softening heat treatment temperatures and expected outcome by steel category',
    '[{"name":"process","type":"text","label":"Process"},
      {"name":"steel_category","type":"text","label":"Steel Category"},
      {"name":"temp_c","type":"text","label":"Temperature (°C)"},
      {"name":"cooling","type":"text","label":"Cooling Method"},
      {"name":"hardness_result","type":"text","label":"Result Hardness"},
      {"name":"purpose","type":"text","label":"Purpose"}]'::jsonb,
    3, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('process',pr,'steel_category',sc,'temp_c',tc,'cooling',co,'hardness_result',hr,'purpose',pu),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Full Anneal',        'Hypoeutectoid (<0.77%C)', '800–870', 'Furnace (slow)', '100–150 HB', 'Max softness, machineability'),
    ('Full Anneal',        'Hypereutectoid (>0.77%C)','740–760', 'Furnace (slow)', '180–200 HB', 'Spheroidise carbides'),
    ('Process Anneal',     'Low Carbon Sheet',         '550–650', 'Air',            '80–120 HB',  'Restore formability after cold work'),
    ('Normalise',          'Low Carbon',               '870–920', 'Still air',      '120–180 HB', 'Refine grain, uniform structure'),
    ('Normalise',          'Medium Carbon',            '840–880', 'Still air',      '150–220 HB', 'Relieve casting/forging stresses'),
    ('Stress Relieve',     'All steels',               '550–650', 'Slow cool',      'No change',  'Remove residual stress w/o microstructure change'),
    ('Solution Anneal',    'Austenitic SS',            '1050–1100','Water quench',   '150–180 HB', 'Dissolve carbides, restore corrosion resistance')
  ) AS t(pr,sc,tc,co,hr,pu);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- POWDER COATING
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Powder%Coat%','%Powder%Paint%'])
  LIMIT 5
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Powder Type & Cure Schedule',
    'Curing temperature and time by powder chemistry; key performance properties',
    '[{"name":"powder_type","type":"text","label":"Powder Type"},
      {"name":"cure_temp_c","type":"text","label":"Cure Temp (°C)"},
      {"name":"cure_time_min","type":"text","label":"Cure Time (min)"},
      {"name":"film_thickness_um","type":"text","label":"Film Thickness (µm)"},
      {"name":"key_properties","type":"text","label":"Key Properties"},
      {"name":"typical_use","type":"text","label":"Typical Application"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('powder_type',pt,'cure_temp_c',ct,'cure_time_min',ctm,'film_thickness_um',ft,'key_properties',kp,'typical_use',tu),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Polyester (PE)',           '180–200', '10–20', '60–120',  'UV resistance, outdoor durability',    'Architectural, garden furniture'),
    ('Polyester-TGIC',           '180–200', '10–20', '60–120',  'Superior UV, colour retention',         'Outdoor structures, fencing'),
    ('Epoxy',                    '160–200', '15–20', '40–100',  'Excellent adhesion, chemical resist.',  'Primers, internal components, machinery'),
    ('Epoxy-Polyester (Hybrid)', '160–180', '15–20', '50–120',  'Balanced indoor performance, low cost', 'Domestic appliances, shelving'),
    ('Polyurethane (PU)',         '180–200', '15–20', '50–100',  'Good flex, chemical resist., gloss',    'Automotive underbody, tough surfaces'),
    ('PVDF / Fluoropolymer',      '230–260', '20–30', '25–75',   'Extreme UV, 20+ year weathering',      'Architectural cladding, facades'),
    ('Nylon (PA12)',              '200–220', '15–25', '150–500', 'Impact resist., food-safe option',      'Valve bodies, machine guards'),
    ('Acrylic',                  '170–190', '15–20', '50–100',  'High gloss, good colour clarity',       'Chrome effect, decorative')
  ) AS t(pt,ct,ctm,ft,kp,tu);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Pretreatment Selection Guide',
    'Surface pretreatment process selection by substrate and corrosion requirement',
    '[{"name":"substrate","type":"text","label":"Substrate"},
      {"name":"pretreatment","type":"text","label":"Pretreatment"},
      {"name":"process","type":"text","label":"Process Steps"},
      {"name":"corrosion_class","type":"text","label":"Salt Spray (hrs)"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('substrate',s,'pretreatment',pr,'process',p,'corrosion_class',cc,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Mild Steel (MS)',     'Iron Phosphate',     'Degrease → Iron Phosphate (5-stage)',   '240–500 hrs',   'Standard indoor parts'),
    ('Mild Steel (MS)',     'Zinc Phosphate',     'Degrease → Zinc Phosphate (7-stage)',   '500–1000 hrs',  'Outdoor/automotive parts'),
    ('Mild Steel (MS)',     'Zinc Phosphate + E-coat', '7-stage + cathodic E-coat',       '> 1000 hrs',    'Automotive body panels'),
    ('Galvanised Steel',    'Chromate conversion','Degrease → Chromate (3-stage)',         '500–750 hrs',   'Sweep blast first if heavy zinc'),
    ('Aluminium',           'Chromate (Alodine)', 'Degrease → Chromate (MIL-DTL-5541)',   '500–750 hrs',   'Aerospace grade, RoHS issue'),
    ('Aluminium',           'Titanium/Zirconium', 'Degrease → Ti/Zr thin film',            '240–500 hrs',   'RoHS compliant alternative'),
    ('Stainless Steel',     'Abrasive blast only','Grit blast Sa 2.5',                     '240–500 hrs',   'No chemical needed; blast profile critical'),
    ('Cast Iron',           'Shot blast + PO₃',  'Shot blast → Iron Phosphate',           '240–500 hrs',   'Fill porosity with primer if needed')
  ) AS t(s,pr,p,cc,n);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- ANODIZING
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Anodiz%','%Anodis%'])
  LIMIT 5
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Anodising Type Comparison',
    'Anodising process types: film thickness, hardness, and application comparison',
    '[{"name":"type","type":"text","label":"Anodising Type"},
      {"name":"electrolyte","type":"text","label":"Electrolyte"},
      {"name":"film_thickness_um","type":"text","label":"Film Thickness (µm)"},
      {"name":"hardness_hv","type":"text","label":"Hardness (HV)"},
      {"name":"key_properties","type":"text","label":"Key Properties"},
      {"name":"application","type":"text","label":"Application"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('type',t,'electrolyte',e,'film_thickness_um',ft,'hardness_hv',hv,'key_properties',kp,'application',a),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Type I — Chromic Acid',      'Chromic acid (Cr₂O₃)',    '0.5–2.5',   '200–300', 'Thin, fatigue-neutral, corrosion resist.', 'Aerospace, fatigue-critical parts'),
    ('Type II — Sulphuric Acid',   'Sulphuric acid (H₂SO₄)', '5–25',      '200–400', 'Good corrosion resistance, dyeable',       'General industrial, consumer, decorative'),
    ('Type III — Hard Anodise',    'Sulphuric acid (cold)',   '25–100',    '400–700', 'Very hard, wear resistant, dimensional change', 'Hydraulic pistons, moulds, military'),
    ('Type II — Black Anodise',    'Sulphuric + dye',         '5–25',      '200–400', 'Decorative, low reflectivity',             'Optical, electronic enclosures'),
    ('Tartaric-Sulphuric (TSA)',    'H₂SO₄ + Tartaric acid', '4–7',        '200–300', 'RoHS replacement for Type I',              'Aerospace (AMS 2488 equiv.)'),
    ('Phosphoric Acid Anodise',    'Phosphoric acid',         '3–8',        '100–200', 'Adhesive bonding primer',                  'Honeycomb structures, bonded joints'),
    ('Micro-arc Oxidation (MAO)',   'Alkaline electrolyte',   '10–100',    '1000+',   'Ceramic-like, extreme hardness',           'Aerospace, biomedical, high-wear')
  ) AS t(t,e,ft,hv,kp,a);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Dimensional Allowance Guide',
    'Dimensional growth due to anodise film — allowance for tight-tolerance features',
    '[{"name":"anodise_type","type":"text","label":"Anodising Type"},
      {"name":"film_thickness_um","type":"text","label":"Film Thickness (µm)"},
      {"name":"growth_per_side_um","type":"text","label":"Growth / Side (µm)"},
      {"name":"tolerance_impact","type":"text","label":"Tolerance Impact"},
      {"name":"note","type":"text","label":"Design Note"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('anodise_type',at,'film_thickness_um',ft,'growth_per_side_um',gps,'tolerance_impact',ti,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Type I (Chromic)',  '0.5–2.5', '0.25–1.25', '< 0.005 mm total', 'Negligible — no pre-comp needed for H7/h6'),
    ('Type II (Sulphuric)','5–25',   '2.5–12.5',  '0.005–0.025 mm',   'Allow +0.012 on diameter for Type II'),
    ('Type II (Black)',    '5–25',   '2.5–12.5',  '0.005–0.025 mm',   'Same as Type II standard'),
    ('Type III (Hard)',    '25–75',  '12.5–37.5', '0.025–0.075 mm',   'Machine bore/shaft UNDERSIZE by film thickness'),
    ('Type III (50 µm)',   '50',     '25',         '0.05 mm per side', 'Typical: pre-anodise diameter - 0.05 mm on radius')
  ) AS t(at,ft,gps,ti,n);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- FORGING
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Forg%'])
  LIMIT 5
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Forging Temperature by Material',
    'Heating temperature range, forging window, and typical flash allowance by alloy',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"heat_temp_c","type":"text","label":"Heating Temp (°C)"},
      {"name":"forging_window_c","type":"text","label":"Forging Window (°C)"},
      {"name":"flash_allowance_pct","type":"text","label":"Flash Allowance (%)"},
      {"name":"press_tons_cm2","type":"text","label":"Press (tonnes/cm²)"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'heat_temp_c',ht,'forging_window_c',fw,'flash_allowance_pct',fa,'press_tons_cm2',pr,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Carbon Steel (0.2–0.4%C)',  '1200–1300', '800–1200', '5–10%', '3–5',   'Normalise after forging'),
    ('Alloy Steel (4140/4340)',   '1100–1250', '750–1100', '5–10%', '5–8',   'Control cooling rate'),
    ('Stainless SS304/316',       '1050–1200', '900–1050', '8–12%', '8–12',  'Avoid sensitisation zone 650–850°C'),
    ('Aluminium 6061',            '400–480',   '350–480',  '3–8%',  '2–4',   'Narrow window — precise temp control'),
    ('Aluminium 7075',            '370–450',   '330–450',  '3–8%',  '3–5',   'Quench quickly after forging'),
    ('Titanium Ti-6Al-4V',        '900–960',   '750–950',  '5–10%', '10–15', 'Keep below beta transus (995°C)'),
    ('Copper/Brass',              '750–900',   '650–850',  '5–8%',  '3–5',   'Hot shortness risk if S present'),
    ('Inconel 718',               '980–1065',  '900–1040', '8–12%', '15–20', 'Strict temp control — narrow window'),
    ('Magnesium AZ31',            '300–430',   '250–400',  '5–10%', '1–2',   'Fire risk — special precautions')
  ) AS t(m,ht,fw,fa,pr,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Draft Angle & Tolerance Guide',
    'Forging DFM rules: draft angles, flash line location, and dimensional tolerances',
    '[{"name":"parameter","type":"text","label":"Parameter"},
      {"name":"value","type":"text","label":"Typical Value"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('parameter',p,'value',v,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Outer draft (steel)',         '5°–7°',         'Reduces to 3° with ejectors'),
    ('Inner draft (pockets)',        '7°–10°',        'Deeper pockets need more draft'),
    ('Outer draft (Al/Mg)',          '3°–5°',         'Less springback than steel'),
    ('Fillet radius (external)',     '3–6 mm min',    'Sharp corners = die wear, cracking'),
    ('Fillet radius (internal)',     '5–10 mm min',   'Larger fillet = better die fill'),
    ('Parting line flash thickness', '2–4 mm',        'After trimming, 0.5–1 mm remains'),
    ('Dimensional tolerance',        '±0.5–2.0 mm',   'Improves to ±0.2 with precision forging'),
    ('Surface finish (as-forged)',   'Ra 6.3–25 µm',  'Requires machining for precision surfaces'),
    ('Min web thickness',            '4–6 mm',        'Thinner = incomplete fill'),
    ('Min rib height to width ratio','≤ 4:1',          'Taller ribs — underfill risk')
  ) AS t(p,v,n);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- DIE CASTING
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Die%Cast%','%HPDC%'])
  LIMIT 5
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Process Parameters by Alloy',
    'Die temperature, injection parameters, and cycle time for common die casting alloys',
    '[{"name":"alloy","type":"text","label":"Alloy"},
      {"name":"melt_temp_c","type":"text","label":"Melt Temp (°C)"},
      {"name":"die_temp_c","type":"text","label":"Die Temp (°C)"},
      {"name":"injection_speed_ms","type":"text","label":"Injection Speed (m/s)"},
      {"name":"intensifier_mpa","type":"text","label":"Intensifier Pressure (MPa)"},
      {"name":"cycle_time_s","type":"text","label":"Cycle Time (s)"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('alloy',a,'melt_temp_c',mt,'die_temp_c',dt,'injection_speed_ms',is_,'intensifier_mpa',ip,'cycle_time_s',ct),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Aluminium ADC12 (A380)', '640–680', '150–200', '30–50', '50–80',  '20–60'),
    ('Aluminium A360',          '620–660', '150–200', '30–50', '50–80',  '20–60'),
    ('Zinc ZA-8',               '400–430', '150–200', '20–40', '30–60',  '10–30'),
    ('Zinc Zamak 3',            '400–430', '150–200', '20–40', '30–60',  '10–30'),
    ('Zinc Zamak 5',            '400–430', '150–200', '20–40', '30–60',  '10–30'),
    ('Magnesium AZ91D',         '620–680', '180–220', '40–60', '50–100', '15–45'),
    ('Copper (semi-solid)',      '900–940', '300–400', '10–20', '80–120', '30–60')
  ) AS t(a,mt,dt,is_,ip,ct);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'DFM Guide for Die Casting',
    'Design rules for draft angles, wall thickness, and feature constraints',
    '[{"name":"parameter","type":"text","label":"Parameter"},
      {"name":"al_alloy","type":"text","label":"Aluminium"},
      {"name":"zn_alloy","type":"text","label":"Zinc"},
      {"name":"mg_alloy","type":"text","label":"Magnesium"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('parameter',p,'al_alloy',al,'zn_alloy',zn,'mg_alloy',mg,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Min wall thickness',  '1.0 mm', '0.5 mm', '1.0 mm', 'Thinner = porosity, cold shut risk'),
    ('Recommended wall',    '2.5 mm', '1.5 mm', '2.0 mm', 'Uniform wall = less distortion'),
    ('Draft angle (outer)', '1°–2°',  '0.5°–1°','1°–2°',  'Zn allows less draft due to low shrinkage'),
    ('Draft angle (inner)', '2°–3°',  '1°–2°',  '2°–3°',  'Cores require more draft'),
    ('Min fillet radius',   '1.5 mm', '0.5 mm', '1.5 mm', 'Sharp corners → die wash, heat checking'),
    ('Max core pull depth', '5× dia', '6× dia', '5× dia', 'Deeper = core deflection, porosity'),
    ('Min rib height:width','≤ 4:1',  '≤ 5:1',  '≤ 4:1',  'Tall thin ribs → trapped air'),
    ('Porosity class (as-cast)','P3', 'P4',     'P3',     'Improve with vacuum assist to P2/P1'),
    ('Dimensional tolerance','±0.1 mm/25 mm','±0.05 mm/25 mm','±0.1 mm/25 mm','Across parting line +0.1 mm additional')
  ) AS t(p,al,zn,mg,n);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- DRILLING (standalone — operations not covered under CNC Machining)
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Drill%','%Tapping%','%Boring%','%Reaming%','%Gun%Drill%'])
  AND process_name NOT ILIKE '%CNC%'
  LIMIT 10
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Drill Speed & Feed Reference',
    'Cutting speed and feed rate by material and drill type for hole-making operations',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"drill_type","type":"text","label":"Drill Type"},
      {"name":"speed_rpm_12mm","type":"text","label":"Speed for Ø12 (RPM)"},
      {"name":"feed_mm_rev","type":"text","label":"Feed (mm/rev)"},
      {"name":"coolant","type":"text","label":"Coolant"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'drill_type',dt,'speed_rpm_12mm',sr,'feed_mm_rev',f,'coolant',c),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Mild Steel',       'HSS',     '400–600',   '0.15–0.25', 'Soluble oil'),
    ('Mild Steel',       'Carbide', '1500–2500', '0.20–0.35', 'Flood'),
    ('Alloy Steel',      'HSS',     '200–400',   '0.10–0.20', 'Soluble oil'),
    ('Alloy Steel',      'Carbide', '1000–1800', '0.15–0.30', 'Flood'),
    ('Stainless SS304',  'HSS',     '100–200',   '0.08–0.15', 'Soluble oil — continuous feed'),
    ('Stainless SS304',  'Carbide', '500–900',   '0.12–0.20', 'Flood'),
    ('Aluminium',        'HSS',     '1500–3000', '0.20–0.40', 'Flood or dry'),
    ('Aluminium',        'Carbide', '4000–8000', '0.25–0.50', 'Flood or MQL'),
    ('Cast Iron',        'HSS',     '400–700',   '0.15–0.25', 'Dry or compressed air'),
    ('Titanium',         'Carbide', '200–400',   '0.05–0.12', 'Flood — continuous, no pecking')
  ) AS t(m,dt,sr,f,c);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  new_tables INTEGER;
  new_rows   INTEGER;
BEGIN
  SELECT COUNT(*) INTO new_tables
  FROM process_reference_tables rt
  JOIN processes p ON p.id = rt.process_id
  WHERE p.process_name ILIKE ANY(ARRAY[
    '%Injection%Mould%','%Injection%Mold%','%Compression%Mould%','%Compression%Mold%',
    '%Thermoform%','%Laser%Cut%','%Plasma%Cut%','%Waterjet%',
    '%MIG%','%TIG%','%Spot%Weld%','%Seam%Weld%',
    '%Heat%Treat%','%Harden%','%Anneal%','%Temper%',
    '%Powder%Coat%','%Anodiz%','%Anodis%',
    '%Forg%','%Die%Cast%','%Drill%'
  ]);

  SELECT COUNT(*) INTO new_rows
  FROM process_table_rows tr
  JOIN process_reference_tables rt ON rt.id = tr.table_id
  JOIN processes p ON p.id = rt.process_id
  WHERE p.process_name ILIKE ANY(ARRAY[
    '%Injection%Mould%','%Injection%Mold%','%Compression%Mould%','%Compression%Mold%',
    '%Thermoform%','%Laser%Cut%','%Plasma%Cut%','%Waterjet%',
    '%MIG%','%TIG%','%Spot%Weld%','%Seam%Weld%',
    '%Heat%Treat%','%Harden%','%Anneal%','%Temper%',
    '%Powder%Coat%','%Anodiz%','%Anodis%',
    '%Forg%','%Die%Cast%','%Drill%'
  ]);

  RAISE NOTICE '=== Migration 167 ===';
  RAISE NOTICE 'New reference tables created:  %', new_tables;
  RAISE NOTICE 'New reference rows seeded:     %', new_rows;
  RAISE NOTICE '====================';
END $$;
