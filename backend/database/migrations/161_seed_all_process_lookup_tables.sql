-- Migration 161: Seed lookup reference tables for ALL manufacturing processes
--
-- Covers: CNC Machining, Sheet Metal Bending, Laser Cutting, MIG/TIG/Spot Welding,
--         Die Casting, Heat Treatment, Powder Coating, Grinding, Assembly,
--         Quality Inspection, Anodizing, Thermoforming, Forging, Investment Casting,
--         Sand Casting, Drilling, Deep Drawing, Plating, Painting
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  proc_id   UUID;
  tbl_id    UUID;
BEGIN

-- ── CNC MACHINING / MILLING / TURNING ────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%CNC%Mach%','%CNC%Mill%','%CNC%Turn%','%Machining%'])
  LIMIT 5
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Cutting Speed Reference',
    'Recommended surface cutting speed (Vc) by material and tool type',
    '[{"name":"material","type":"text","label":"Work Material"},
      {"name":"hss_vc","type":"number","label":"HSS Vc (m/min)"},
      {"name":"carbide_vc","type":"number","label":"Carbide Vc (m/min)"},
      {"name":"ceramic_vc","type":"number","label":"Ceramic Vc (m/min)"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('material',m,'hss_vc',h,'carbide_vc',c,'ceramic_vc',cer),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Mild Steel (MS)',           25,  200, 500),
    ('Alloy Steel 4140',          18,  150, 400),
    ('Stainless Steel SS304',     12,  120, 300),
    ('Stainless Steel SS316',     10,  100, 280),
    ('Tool Steel (H13)',           8,   80, 200),
    ('Aluminium Alloys',          80,  600,   0),
    ('Copper / Brass',            60,  400,   0),
    ('Titanium Ti-6Al-4V',         5,   60, 150),
    ('Inconel 718',                3,   30,  80),
    ('Cast Iron (Grey)',          30,  200, 500),
    ('PEEK / Engineering Plastic',50,  200,   0)
  ) AS t(m,h,c,cer);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Feed Rate Reference',
    'Recommended feed per tooth (fz) and feed per rev (f) by operation',
    '[{"name":"operation","type":"text","label":"Operation"},
      {"name":"fz_mm","type":"number","label":"Feed/Tooth fz (mm)"},
      {"name":"f_mm_rev","type":"number","label":"Feed/Rev f (mm/rev)"},
      {"name":"depth_ap","type":"number","label":"Axial Depth ap (mm)"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('operation',op,'fz_mm',fz,'f_mm_rev',f,'depth_ap',ap),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Face Milling (Carbide)',   0.15, 0.30, 2.0),
    ('Shoulder Milling',         0.10, 0.20, 8.0),
    ('Slot Milling',             0.07, 0.14, 6.0),
    ('Pocket Milling',           0.08, 0.16, 5.0),
    ('Finish Turning',           0.00, 0.10, 0.3),
    ('Rough Turning',            0.00, 0.40, 3.0),
    ('Drilling (HSS)',           0.00, 0.20, 0.0),
    ('Drilling (Carbide)',       0.00, 0.30, 0.0),
    ('Reaming',                  0.00, 0.50, 0.0),
    ('Tapping M6',               0.00, 1.00, 0.0)
  ) AS t(op,fz,f,ap);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Surface Roughness Achievable',
    'Typical Ra (µm) values achievable by machining operation',
    '[{"name":"operation","type":"text","label":"Operation"},
      {"name":"ra_min","type":"number","label":"Ra Min (µm)"},
      {"name":"ra_max","type":"number","label":"Ra Max (µm)"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    3, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('operation',op,'ra_min',rmin,'ra_max',rmax,'note',n),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Rough Turning',         3.2, 25.0, 'Bulk removal'),
    ('Finish Turning',        0.8,  3.2, 'Good surface'),
    ('Fine Turning (CBN)',    0.2,  0.8, 'Mirror approach'),
    ('Rough Milling',         3.2, 12.5, 'Standard'),
    ('Finish Milling',        0.8,  3.2, 'Good surface'),
    ('Drilling',              1.6, 12.5, 'Hole quality'),
    ('Reaming',               0.4,  1.6, 'Precision holes'),
    ('Grinding (Cylindrical)',0.1,  0.4, 'Tight tolerance'),
    ('Surface Grinding',      0.05, 0.4, 'Flatness critical'),
    ('Honing',                0.05, 0.2, 'Bore finishing'),
    ('Lapping',               0.01, 0.1, 'Ultra-fine')
  ) AS t(op,rmin,rmax,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Dimensional Tolerance Guide',
    'Achievable tolerances by CNC operation (IT grade)',
    '[{"name":"operation","type":"text","label":"Operation"},
      {"name":"it_grade","type":"text","label":"IT Grade"},
      {"name":"tolerance_mm","type":"text","label":"Tolerance (mm)"},
      {"name":"remarks","type":"text","label":"Remarks"}]'::jsonb,
    4, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('operation',op,'it_grade',it,'tolerance_mm',tol,'remarks',r),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('CNC Turning (rough)',    'IT11-12', '±0.10 to ±0.20',  'Bulk stock removal'),
    ('CNC Turning (finish)',   'IT8-9',   '±0.025 to ±0.05', 'Standard finish'),
    ('CNC Turning (fine)',     'IT6-7',   '±0.010 to ±0.016','Precision part'),
    ('CNC Milling (rough)',    'IT11-12', '±0.10 to ±0.30',  'Bulk removal'),
    ('CNC Milling (finish)',   'IT8-9',   '±0.025 to ±0.05', 'Standard'),
    ('CNC Milling (fine)',     'IT6-7',   '±0.010 to ±0.020','Precision'),
    ('Drilling (HSS)',         'IT10-11', '±0.05 to ±0.10',  'Standard drill'),
    ('Reaming',                'IT6-7',   '±0.010 to ±0.018','Precision bore'),
    ('Grinding',               'IT5-6',   '±0.005 to ±0.010','High precision'),
    ('Honing / Lapping',       'IT4-5',   '±0.002 to ±0.005','Ultra precision')
  ) AS t(op,it,tol,r);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── SHEET METAL BENDING ───────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Bend%','%Sheet Metal%'])
  LIMIT 5
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'K-Factor Table',
    'Neutral axis K-factor by material type and bending condition',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"condition","type":"text","label":"Condition"},
      {"name":"k_factor","type":"number","label":"K-Factor"},
      {"name":"notes","type":"text","label":"Notes"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('material',m,'condition',cond,'k_factor',k,'notes',n),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Mild Steel',        'Air Bend',    0.44, 'Standard condition'),
    ('Mild Steel',        'Bottom Bend', 0.42, 'More accurate'),
    ('Stainless Steel',   'Air Bend',    0.50, 'Higher spring-back'),
    ('Stainless Steel',   'Bottom Bend', 0.46, 'Reduced spring-back'),
    ('Aluminium 5052',    'Air Bend',    0.41, 'Soft alloy'),
    ('Aluminium 6061-T6', 'Air Bend',    0.40, 'Hard alloy — crack risk'),
    ('Copper',            'Air Bend',    0.35, 'Very ductile'),
    ('Brass',             'Air Bend',    0.38, 'Moderate ductility'),
    ('Galvanised Steel',  'Air Bend',    0.44, 'Same as MS')
  ) AS t(m,cond,k,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Minimum Bend Radius (x Thickness)',
    'Minimum inside bend radius as multiple of material thickness',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"min_radius_t","type":"number","label":"Min Radius (x T)"},
      {"name":"recommended_t","type":"number","label":"Recommended (x T)"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('material',m,'min_radius_t',mn,'recommended_t',rec),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Mild Steel',          0.5, 1.0),
    ('High Strength Steel', 2.0, 3.0),
    ('Stainless Steel 304', 1.0, 1.5),
    ('Stainless Steel 316', 1.0, 2.0),
    ('Aluminium 1100',      0.0, 0.5),
    ('Aluminium 5052-H32',  0.5, 1.0),
    ('Aluminium 6061-T6',   3.0, 4.0),
    ('Copper (annealed)',   0.0, 0.5),
    ('Brass (half-hard)',   0.5, 1.0),
    ('Titanium CP',         2.5, 4.0)
  ) AS t(m,mn,rec);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Press Brake Tonnage (Air Bend)',
    'Required bending force per metre of bend length — Mild Steel basis',
    '[{"name":"thickness_mm","type":"number","label":"Thickness (mm)"},
      {"name":"die_opening_mm","type":"number","label":"Die Opening V (mm)"},
      {"name":"tonnage_per_m","type":"number","label":"Tonnage / metre (t/m)"},
      {"name":"material_factor","type":"text","label":"Material Factor"}]'::jsonb,
    3, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('thickness_mm',th,'die_opening_mm',die,'tonnage_per_m',ton,'material_factor',mf),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ( 0.8,  6,   4, 'SS x1.5  Al x0.5  Cu x0.7'),
    ( 1.0,  8,   6, 'SS x1.5  Al x0.5  Cu x0.7'),
    ( 1.5, 10,  10, 'SS x1.5  Al x0.5  Cu x0.7'),
    ( 2.0, 12,  16, 'SS x1.5  Al x0.5  Cu x0.7'),
    ( 2.5, 16,  20, 'SS x1.5  Al x0.5  Cu x0.7'),
    ( 3.0, 20,  24, 'SS x1.5  Al x0.5  Cu x0.7'),
    ( 4.0, 25,  32, 'SS x1.5  Al x0.5  Cu x0.7'),
    ( 5.0, 32,  42, 'SS x1.5  Al x0.5  Cu x0.7'),
    ( 6.0, 40,  55, 'SS x1.5  Al x0.5  Cu x0.7'),
    ( 8.0, 50,  80, 'SS x1.5  Al x0.5  Cu x0.7'),
    (10.0, 63, 110, 'SS x1.5  Al x0.5  Cu x0.7')
  ) AS t(th,die,ton,mf);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Spring-back Compensation Angles',
    'Typical spring-back (degrees) for 90 degree air bend by material',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"springback_deg","type":"number","label":"Spring-back (deg)"},
      {"name":"overbend_to","type":"number","label":"Overbend to (deg)"}]'::jsonb,
    4, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('material',m,'springback_deg',sb,'overbend_to',ob),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Mild Steel',           2, 88),
    ('High Strength Steel',  7, 83),
    ('Stainless Steel 304',  5, 85),
    ('Aluminium 5052',       3, 87),
    ('Aluminium 6061-T6',    8, 82),
    ('Copper',               1, 89),
    ('Titanium',            12, 78)
  ) AS t(m,sb,ob);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── LASER CUTTING ─────────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%Laser%Cut%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Laser Cutting Speed (Fiber)',
    'Recommended cutting speed (mm/min) for fiber laser by material and thickness',
    '[{"name":"thickness_mm","type":"number","label":"Thickness (mm)"},
      {"name":"ms_speed","type":"number","label":"Mild Steel (mm/min)"},
      {"name":"ss_speed","type":"number","label":"SS304 (mm/min)"},
      {"name":"al_speed","type":"number","label":"Aluminium (mm/min)"},
      {"name":"power_kw","type":"number","label":"Power (kW)"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('thickness_mm',th,'ms_speed',ms,'ss_speed',ss,'al_speed',al,'power_kw',pw),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ( 1.0, 10000, 7000, 8000,  2),
    ( 1.5,  8000, 5500, 6500,  2),
    ( 2.0,  6000, 4000, 5000,  3),
    ( 3.0,  4000, 2500, 3500,  3),
    ( 4.0,  3000, 1800, 2500,  4),
    ( 5.0,  2200, 1200, 1800,  4),
    ( 6.0,  1800,  900, 1400,  6),
    ( 8.0,  1200,  550,  900,  6),
    (10.0,   800,  350,  600,  8),
    (12.0,   600,  250,  400, 10),
    (15.0,   400,  150,  250, 12),
    (20.0,   250,    0,  150, 15)
  ) AS t(th,ms,ss,al,pw);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Assist Gas and Kerf Width',
    'Gas selection and kerf width by material and thickness',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"thickness_range","type":"text","label":"Thickness Range (mm)"},
      {"name":"gas_type","type":"text","label":"Assist Gas"},
      {"name":"pressure_bar","type":"number","label":"Pressure (bar)"},
      {"name":"kerf_mm","type":"number","label":"Kerf Width (mm)"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('material',m,'thickness_range',tr,'gas_type',g,'pressure_bar',p,'kerf_mm',k),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Mild Steel',      '1-6 mm',   'O2',  0.8, 0.20),
    ('Mild Steel',      '6-20 mm',  'O2',  0.5, 0.35),
    ('Stainless Steel', '1-4 mm',   'N2', 12.0, 0.15),
    ('Stainless Steel', '4-12 mm',  'N2',  8.0, 0.25),
    ('Aluminium',       '1-4 mm',   'N2', 15.0, 0.20),
    ('Aluminium',       '4-12 mm',  'N2', 10.0, 0.30),
    ('Copper',          '1-4 mm',   'N2', 16.0, 0.20),
    ('Brass',           '1-4 mm',   'N2', 12.0, 0.20)
  ) AS t(m,tr,g,p,k);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── MIG WELDING ───────────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%MIG%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'MIG Welding Parameters',
    'Recommended current, voltage, and wire speed by material thickness',
    '[{"name":"thickness_mm","type":"number","label":"Thickness (mm)"},
      {"name":"wire_dia_mm","type":"number","label":"Wire Dia (mm)"},
      {"name":"current_a","type":"number","label":"Current (A)"},
      {"name":"voltage_v","type":"number","label":"Voltage (V)"},
      {"name":"wire_speed_m_min","type":"number","label":"Wire Speed (m/min)"},
      {"name":"travel_speed_mm_min","type":"number","label":"Travel Speed (mm/min)"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('thickness_mm',th,'wire_dia_mm',wd,'current_a',ca,'voltage_v',vv,'wire_speed_m_min',ws,'travel_speed_mm_min',ts),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ( 1.5, 0.8,  80, 17, 4.5, 450),
    ( 2.0, 0.8, 110, 18, 5.5, 400),
    ( 3.0, 1.0, 140, 20, 6.5, 380),
    ( 4.0, 1.0, 170, 22, 7.5, 360),
    ( 5.0, 1.2, 200, 23, 8.5, 340),
    ( 6.0, 1.2, 230, 24, 9.5, 320),
    ( 8.0, 1.2, 270, 26,11.0, 290),
    (10.0, 1.6, 310, 28,12.0, 260),
    (12.0, 1.6, 350, 30,13.5, 240)
  ) AS t(th,wd,ca,vv,ws,ts);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Preheat Temperature Guide',
    'Minimum preheat temperature before welding by material',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"carbon_equivalent","type":"text","label":"Carbon Equivalent"},
      {"name":"preheat_temp_c","type":"number","label":"Preheat Temp (C)"},
      {"name":"interpass_max_c","type":"number","label":"Interpass Max (C)"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('material',m,'carbon_equivalent',ce,'preheat_temp_c',pt,'interpass_max_c',ip),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Mild Steel < 25mm',     'CE < 0.40',    0, 250),
    ('Mild Steel > 25mm',     'CE < 0.40',   50, 250),
    ('Medium Carbon Steel',   'CE 0.40-0.60',100, 250),
    ('High Carbon Steel',     'CE > 0.60',   200, 300),
    ('Low Alloy Steel 4140',  'CE ~0.65',    150, 250),
    ('Stainless Steel 304',   'Austenitic',    0, 150),
    ('Stainless Steel 316',   'Austenitic',    0, 150),
    ('Aluminium (all)',        'N/A',           0,   0),
    ('Chrome-Moly P91',       'CE ~1.87',    300, 400)
  ) AS t(m,ce,pt,ip);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── TIG WELDING ───────────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%TIG%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'TIG Welding Parameters',
    'DCEN parameters for TIG welding by material and thickness',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"thickness_mm","type":"number","label":"Thickness (mm)"},
      {"name":"current_a","type":"number","label":"Current (A)"},
      {"name":"tungsten_dia_mm","type":"number","label":"Tungsten Dia (mm)"},
      {"name":"filler_dia_mm","type":"number","label":"Filler Rod Dia (mm)"},
      {"name":"shielding_gas","type":"text","label":"Shielding Gas"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('material',m,'thickness_mm',th,'current_a',ca,'tungsten_dia_mm',td,'filler_dia_mm',fd,'shielding_gas',sg),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Stainless Steel', 1.0,  60, 1.6, 1.6, '100% Argon'),
    ('Stainless Steel', 2.0,  90, 2.4, 2.4, '100% Argon'),
    ('Stainless Steel', 3.0, 120, 2.4, 2.4, '100% Argon'),
    ('Stainless Steel', 5.0, 170, 3.2, 3.2, '100% Argon'),
    ('Aluminium',       1.5,  80, 2.4, 2.4, 'Argon AC'),
    ('Aluminium',       3.0, 140, 3.2, 3.2, 'Argon AC'),
    ('Aluminium',       6.0, 220, 4.0, 4.0, 'Argon AC'),
    ('Titanium',        1.5,  70, 1.6, 1.6, 'Argon + back purge'),
    ('Titanium',        3.0, 120, 2.4, 2.4, 'Argon + back purge'),
    ('Copper',          2.0, 180, 2.4, 2.4, '100% Argon')
  ) AS t(m,th,ca,td,fd,sg);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── SPOT WELDING ──────────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%Spot%Weld%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Spot Weld Parameters',
    'Electrode force, current, and weld time by sheet thickness (mild steel basis)',
    '[{"name":"sheet_thickness_mm","type":"number","label":"Sheet Thickness (mm)"},
      {"name":"electrode_force_kn","type":"number","label":"Electrode Force (kN)"},
      {"name":"weld_current_ka","type":"number","label":"Weld Current (kA)"},
      {"name":"weld_time_cycles","type":"number","label":"Weld Time (cycles 50Hz)"},
      {"name":"nugget_dia_mm","type":"number","label":"Nugget Dia (mm)"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('sheet_thickness_mm',th,'electrode_force_kn',ef,'weld_current_ka',wc,'weld_time_cycles',wt,'nugget_dia_mm',nd),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    (0.6, 1.5,  5.5,  6, 3.5),
    (0.8, 2.0,  6.5,  8, 4.0),
    (1.0, 2.5,  7.5, 10, 4.5),
    (1.2, 3.0,  8.5, 12, 5.0),
    (1.5, 3.8,  9.5, 14, 5.5),
    (2.0, 5.0, 11.0, 18, 6.5),
    (2.5, 6.5, 12.5, 22, 7.5),
    (3.0, 8.0, 14.0, 26, 8.5)
  ) AS t(th,ef,wc,wt,nd);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── DIE CASTING ───────────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%Die Cast%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Die Casting Alloy Properties',
    'Key properties of common die casting alloys',
    '[{"name":"alloy","type":"text","label":"Alloy"},
      {"name":"density_g_cc","type":"number","label":"Density (g/cc)"},
      {"name":"tensile_mpa","type":"number","label":"Tensile (MPa)"},
      {"name":"melt_range_c","type":"text","label":"Melt Range (C)"},
      {"name":"die_temp_c","type":"number","label":"Die Temp (C)"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('alloy',a,'density_g_cc',d,'tensile_mpa',t,'melt_range_c',mr,'die_temp_c',dt),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('ADC12 (A383)',    2.74, 310, '515-585', 200),
    ('A380',           2.71, 324, '540-595', 200),
    ('A360',           2.63, 317, '555-615', 200),
    ('Zamak 3',        6.60, 283, '381-387', 180),
    ('Zamak 5',        6.60, 331, '380-386', 180),
    ('Magnesium AZ91', 1.81, 230, '468-598', 250),
    ('Brass C85800',   8.50, 414, '900-980', 300),
    ('Aluminium LM24', 2.79, 280, '520-580', 200)
  ) AS t(a,d,t,mr,dt);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Cycle Time Estimation',
    'Estimated cycle time by casting weight and alloy type',
    '[{"name":"casting_weight_kg","type":"text","label":"Casting Weight (kg)"},
      {"name":"al_alloy_s","type":"number","label":"Al Alloy (sec)"},
      {"name":"zn_alloy_s","type":"number","label":"Zn Alloy (sec)"},
      {"name":"mg_alloy_s","type":"number","label":"Mg Alloy (sec)"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('casting_weight_kg',w,'al_alloy_s',al,'zn_alloy_s',zn,'mg_alloy_s',mg),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('< 0.1 kg',    20, 12,  18),
    ('0.1-0.5 kg',  35, 20,  30),
    ('0.5-1.0 kg',  50, 30,  45),
    ('1.0-2.0 kg',  70, 45,  60),
    ('2.0-5.0 kg', 100, 65,  90),
    ('5.0-10 kg',  150,  0, 130),
    ('> 10 kg',    220,  0,   0)
  ) AS t(w,al,zn,mg);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Draft Angle and Wall Thickness',
    'Recommended draft angles and minimum wall thickness for die casting',
    '[{"name":"feature","type":"text","label":"Feature"},
      {"name":"al_value","type":"text","label":"Aluminium"},
      {"name":"zn_value","type":"text","label":"Zinc"},
      {"name":"mg_value","type":"text","label":"Magnesium"}]'::jsonb,
    3, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('feature',f,'al_value',al,'zn_value',zn,'mg_value',mg),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('External Draft Angle',     '1-2 deg', '0.5-1 deg', '1-2 deg'),
    ('Internal Draft Angle',     '2-3 deg', '1-2 deg',   '2-3 deg'),
    ('Min Wall Thickness',       '1.5 mm',  '0.8 mm',    '1.3 mm'),
    ('Max Wall Thickness',       '12 mm',   '6 mm',      '10 mm'),
    ('Minimum Hole Dia',         '2.5 mm',  '1.5 mm',    '2.0 mm'),
    ('Corner Radius (external)', '0.5 mm',  '0.3 mm',    '0.5 mm'),
    ('Achievable Tolerance',     '+-0.1',   '+-0.05',    '+-0.1')
  ) AS t(f,al,zn,mg);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── HEAT TREATMENT ────────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%Heat Treat%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Heat Treatment Temperature and Time',
    'Temperature, soak time, and quench medium for common processes',
    '[{"name":"process","type":"text","label":"Process"},
      {"name":"material","type":"text","label":"Material"},
      {"name":"temp_c","type":"number","label":"Temp (C)"},
      {"name":"soak_time","type":"text","label":"Soak Time"},
      {"name":"quench_medium","type":"text","label":"Quench Medium"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('process',p,'material',m,'temp_c',t,'soak_time',s,'quench_medium',q),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Annealing',         'Mild Steel',       870, '30 min/25mm',   'Furnace cool'),
    ('Annealing',         'Stainless 304',   1050, '20 min/25mm',   'Water quench'),
    ('Normalising',       'Carbon Steel',     900, '20 min/25mm',   'Air cool'),
    ('Through Hardening', 'EN8 (0.4%C)',      820, '20 min/25mm',   'Oil quench'),
    ('Through Hardening', 'EN24 (4140)',       840, '25 min/25mm',  'Oil quench'),
    ('Through Hardening', 'H13 Tool Steel',  1020, '15 min/25mm',   'Air/oil quench'),
    ('Tempering (low)',   'Hardened Steel',   200, '60 min total',  'Air cool'),
    ('Tempering (high)',  'Hardened Steel',   600, '90 min total',  'Air cool'),
    ('Case Carburising',  'EN36 (8620)',      920, '1hr per 0.1mm', 'Oil + temper'),
    ('Nitriding',         'EN40B (Cr-Mo)',    520, '40 hr total',   'Air cool'),
    ('Solution Anneal',   'Al 6061',          529, '1 hr/25mm',     'Water quench'),
    ('Ageing T6',         'Al 6061',          177, '8 hr total',    'Air cool')
  ) AS t(p,m,t,s,q);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Hardness Achievable (HRC)',
    'Expected hardness after heat treatment by material and process',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"process","type":"text","label":"Process"},
      {"name":"hrc_min","type":"number","label":"HRC Min"},
      {"name":"hrc_max","type":"number","label":"HRC Max"},
      {"name":"core_hrc","type":"text","label":"Core Hardness"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('material',m,'process',p,'hrc_min',hmin,'hrc_max',hmax,'core_hrc',c),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('EN8 (0.4%C)',      'Through Harden + 200C temper', 52, 56, '42-48 HRC'),
    ('EN24 (4140)',       'Through Harden + 200C temper', 54, 58, '44-50 HRC'),
    ('EN31 (Bearing)',    'Through Harden + 150C temper', 60, 64, '60-64 HRC'),
    ('H13 Tool Steel',    'Through Harden + 580C temper', 44, 52, '44-52 HRC'),
    ('D2 Tool Steel',     'Through Harden + 200C temper', 58, 62, '58-62 HRC'),
    ('EN36 (8620)',       'Case Carburise + Harden',       58, 62, '28-34 HRC'),
    ('EN40B (Cr-Mo)',     'Gas Nitriding',                 65, 70, '28-34 HRC'),
    ('Stainless 17-4PH', 'H900 Condition',                40, 44, '40-44 HRC')
  ) AS t(m,p,hmin,hmax,c);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── POWDER COATING ────────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%Powder Coat%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Cure Schedule by Powder Type',
    'Oven cure temperature and time by powder chemistry',
    '[{"name":"powder_type","type":"text","label":"Powder Type"},
      {"name":"cure_temp_c","type":"number","label":"Cure Temp (C)"},
      {"name":"cure_time_min","type":"number","label":"Cure Time (min)"},
      {"name":"typical_application","type":"text","label":"Typical Application"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('powder_type',pt,'cure_temp_c',ct,'cure_time_min',tm,'typical_application',ta),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Polyester TGIC',         180, 20, 'General industrial, outdoor'),
    ('Polyester Non-TGIC',     190, 15, 'Food / medical equipment'),
    ('Epoxy',                  185, 20, 'Indoor, corrosion resistance'),
    ('Epoxy-Polyester Hybrid', 180, 20, 'Indoor general purpose'),
    ('Polyurethane',           180, 20, 'Chemical resistance, flexibility'),
    ('PVDF (Kynar)',            230, 15, 'Extreme UV / weather resistance'),
    ('Nylon 11',               220, 20, 'Impact, wear resistance'),
    ('Epoxy Fusion Bond',      240, 10, 'Pipeline corrosion protection')
  ) AS t(pt,ct,tm,ta);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Film Thickness and Coverage',
    'Typical film thickness and theoretical coverage rate by powder type',
    '[{"name":"powder_type","type":"text","label":"Powder Type"},
      {"name":"film_thickness_um","type":"text","label":"Film Thickness (um)"},
      {"name":"coverage_m2_per_kg","type":"number","label":"Coverage (m2/kg)"},
      {"name":"specific_gravity","type":"number","label":"Specific Gravity"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('powder_type',pt,'film_thickness_um',ft,'coverage_m2_per_kg',cov,'specific_gravity',sg),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Polyester TGIC',     '60-80 um',   16.0, 1.2),
    ('Epoxy',              '60-80 um',   14.5, 1.3),
    ('Epoxy-Polyester',    '60-80 um',   15.5, 1.2),
    ('Polyurethane',       '60-80 um',   15.0, 1.2),
    ('Metallic Effect',    '60-100 um',  13.0, 1.4),
    ('Heavy Coat (pipes)', '250-400 um',  4.5, 1.3),
    ('Functional Nylon',   '200-400 um',  3.8, 1.1)
  ) AS t(pt,ft,cov,sg);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── ANODIZING ─────────────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%Anodiz%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Anodize Type Comparison',
    'Anodize type specifications, thickness, and hardness',
    '[{"name":"type","type":"text","label":"Type"},
      {"name":"process","type":"text","label":"Process"},
      {"name":"thickness_um","type":"text","label":"Thickness (um)"},
      {"name":"hardness_hv","type":"text","label":"Hardness (HV)"},
      {"name":"application","type":"text","label":"Application"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('type',t,'process',p,'thickness_um',th,'hardness_hv',h,'application',a),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Type I',   'Chromic Acid',     '2-5 um',    '200-350 HV', 'Aerospace, fatigue-critical'),
    ('Type II',  'Sulphuric Acid',   '10-25 um',  '200-400 HV', 'Decorative, general industrial'),
    ('Type III', 'Hard Anodize',     '25-150 um', '400-600 HV', 'Wear / abrasion resistance'),
    ('Type II (MIL-A-8625)', 'Sulphuric', '10-25 um', '200-400 HV', 'Defence spec'),
    ('Type III (MIL-A-8625)','Hard coat', '25-75 um',  '400-600 HV', 'Defence hard coat'),
    ('Colour Type II', 'Dye added',  '10-25 um',  '200-400 HV', 'Decorative colour finish')
  ) AS t(t,p,th,h,a);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Anodize Process Parameters',
    'Tank conditions for each anodize type',
    '[{"name":"type","type":"text","label":"Type"},
      {"name":"electrolyte","type":"text","label":"Electrolyte"},
      {"name":"concentration_pct","type":"text","label":"Concentration (%)"},
      {"name":"temp_c","type":"text","label":"Temp (C)"},
      {"name":"current_density","type":"text","label":"Current Density (A/dm2)"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('type',t,'electrolyte',e,'concentration_pct',c,'temp_c',temp,'current_density',cd),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Type I',   'Chromic Acid',    '3-10%',  '35-45 C',    '0.3-0.5'),
    ('Type II',  'Sulphuric Acid',  '15-20%', '18-22 C',    '1.0-2.0'),
    ('Type III', 'Sulphuric Acid',  '15-20%', '-5 to +5 C', '3.0-5.0')
  ) AS t(t,e,c,temp,cd);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── GRINDING ─────────────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%Grind%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Grinding Wheel Selection',
    'Recommended wheel grade, grit, and bond by material and operation',
    '[{"name":"material","type":"text","label":"Work Material"},
      {"name":"operation","type":"text","label":"Operation"},
      {"name":"abrasive","type":"text","label":"Abrasive"},
      {"name":"grit_size","type":"text","label":"Grit Size"},
      {"name":"grade","type":"text","label":"Grade"},
      {"name":"bond","type":"text","label":"Bond"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('material',m,'operation',op,'abrasive',ab,'grit_size',gs,'grade',g,'bond',b),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Carbon Steel (soft)',    'Surface rough',    'A (Alox)',   '36-46',   'M-N', 'Vitrified'),
    ('Carbon Steel (soft)',    'Surface finish',   'A (Alox)',   '60-80',   'K-L', 'Vitrified'),
    ('Hardened Steel',         'Surface rough',    'A (Alox)',   '46-60',   'L-M', 'Vitrified'),
    ('Hardened Steel',         'Cylindrical',      'A (Alox)',   '46-60',   'K-L', 'Vitrified'),
    ('Stainless Steel',        'Surface',          'A (Alox)',   '60-80',   'J-K', 'Vitrified'),
    ('HSS Tool Steel',         'Tool room',        'CBN',        '100-150', 'K-M', 'Vitrified/Resin'),
    ('Carbide inserts',        'Tool sharpening',  'Diamond',    '100-180', '--',  'Resin'),
    ('Aluminium',              'Surface',          'SiC Green',  '46-60',   'H-J', 'Vitrified'),
    ('Ceramic / Glass',        'Surface',          'Diamond',    '120-200', '--',  'Resin/Metal')
  ) AS t(m,op,ab,gs,g,b);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Grinding Parameters',
    'Wheel speed, work speed, and feed rates for common operations',
    '[{"name":"operation","type":"text","label":"Operation"},
      {"name":"wheel_speed_m_s","type":"text","label":"Wheel Speed (m/s)"},
      {"name":"work_speed_m_min","type":"text","label":"Work Speed (m/min)"},
      {"name":"depth_mm","type":"text","label":"Depth of Cut (mm)"},
      {"name":"traverse_mm_rev","type":"text","label":"Traverse (mm/rev)"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('operation',op,'wheel_speed_m_s',ws,'work_speed_m_min',wsp,'depth_mm',d,'traverse_mm_rev',tr),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Surface Grinding (rough)',     '25-35', '10-20', '0.025-0.05',  '0.5-0.75B'),
    ('Surface Grinding (finish)',    '25-35', '5-15',  '0.005-0.015', '0.3-0.5B'),
    ('Cylindrical OD (rough)',       '30-35', '20-30', '0.025-0.05',  '0.5B/rev'),
    ('Cylindrical OD (finish)',      '30-35', '15-25', '0.005-0.015', '0.3B/rev'),
    ('Centreless (through-feed)',    '30-35', '20-40', '--',           '1-3 deg'),
    ('Internal Grinding',           '20-30', '15-25', '0.005-0.025', '0.25B/rev'),
    ('Tool and Cutter (CBN)',        '60-80', '10-20', '0.002-0.01',  '0.2B/rev')
  ) AS t(op,ws,wsp,d,tr);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── FORGING ───────────────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%Forg%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Forging Temperature Range',
    'Hot and warm forging temperature ranges by material',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"hot_forge_c","type":"text","label":"Hot Forge Temp (C)"},
      {"name":"warm_forge_c","type":"text","label":"Warm Forge Temp (C)"},
      {"name":"max_reduction_pct","type":"number","label":"Max Reduction (%)"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('material',m,'hot_forge_c',hf,'warm_forge_c',wf,'max_reduction_pct',mr),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Carbon Steel (MS)',       '1100-1250', '650-900', 80),
    ('Alloy Steel 4140',        '1100-1200', '700-950', 75),
    ('Stainless Steel 304',     '1100-1200', '--',       65),
    ('Stainless 17-4PH',        '1050-1175', '--',       65),
    ('Aluminium 6061',          '400-480',   '250-350', 70),
    ('Aluminium 7075',          '380-440',   '--',       60),
    ('Titanium Ti-6Al-4V',      '900-980',   '700-850', 50),
    ('Inconel 718',             '950-1050',  '--',       40),
    ('Copper',                  '750-900',   '400-600', 75),
    ('Brass 70/30',             '700-800',   '--',       70)
  ) AS t(m,hf,wf,mr);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Forging Draft Angles and Tolerances',
    'Standard draft angles, flash allowance, and achievable tolerances',
    '[{"name":"parameter","type":"text","label":"Parameter"},
      {"name":"value","type":"text","label":"Value"},
      {"name":"notes","type":"text","label":"Notes"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('parameter',p,'value',v,'notes',n),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('External Draft Angle',   '5-7 deg',       'Standard open dies'),
    ('Internal Draft Angle',   '7-10 deg',      'Pockets and recesses'),
    ('Parting Line Flash',     '1-3 mm',        'Trimmed after forging'),
    ('Tolerance on Length',    '+-1.5 mm',      'Forged dimension'),
    ('Tolerance on Width',     '+-1.0 mm',      'Forged dimension'),
    ('Tolerance on Thickness', '+-0.8 mm',      'Close tolerance die'),
    ('Surface Finish',         'Ra 3.2-12.5',   'As forged condition'),
    ('Minimum Web Thickness',  '4-6 mm',        'Depends on alloy'),
    ('Minimum Rib Thickness',  '3-5 mm',        'Depends on alloy'),
    ('Fillet Radius (min)',    '3 mm',          'Reduces die wear')
  ) AS t(p,v,n);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── INVESTMENT CASTING ────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%Investment Cast%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Investment Casting Tolerances',
    'Achievable dimensional tolerances and surface finish',
    '[{"name":"parameter","type":"text","label":"Parameter"},
      {"name":"standard","type":"text","label":"Standard"},
      {"name":"precision","type":"text","label":"Precision Grade"},
      {"name":"notes","type":"text","label":"Notes"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('parameter',p,'standard',s,'precision',pr,'notes',n),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Linear tolerance <= 25mm',   '+-0.25 mm',    '+-0.10 mm',   'CIOS standard'),
    ('Linear tolerance 25-50mm',   '+-0.38 mm',    '+-0.18 mm',   'Per 25mm increment'),
    ('Linear tolerance 50-100mm',  '+-0.50 mm',    '+-0.25 mm',   'Per 25mm increment'),
    ('Angular tolerance',          '+-0.5 deg',    '+-0.25 deg',  'On casting'),
    ('Surface finish as-cast',     'Ra 1.6-3.2',   'Ra 0.8-1.6',  'After cleaning'),
    ('Minimum wall thickness',     '1.5 mm',       '1.0 mm',      'Depends on alloy'),
    ('Minimum hole diameter',      '2.0 mm',       '1.5 mm',      'L/D ratio <= 5'),
    ('Draft angle (internal)',     '0-1 deg',      '0 deg',       'Near zero draft')
  ) AS t(p,s,pr,n);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── SAND CASTING ─────────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%Sand Cast%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Sand Casting Allowances and Tolerances',
    'Machining allowance, shrinkage, and draft angles',
    '[{"name":"parameter","type":"text","label":"Parameter"},
      {"name":"ferrous","type":"text","label":"Ferrous / Steel"},
      {"name":"al_alloy","type":"text","label":"Aluminium"},
      {"name":"notes","type":"text","label":"Notes"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('parameter',p,'ferrous',f,'al_alloy',a,'notes',n),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Machining allowance (faces)',      '3-5 mm',    '2-3 mm',    'Add to pattern'),
    ('Machining allowance (bores)',      '4-6 mm',    '3-5 mm',    'Per side'),
    ('Linear shrinkage allowance',       '1.0-2.0%',  '1.3%',      'Pattern oversize'),
    ('Draft angle (pattern)',            '1-3 deg',   '1-2 deg',   'For hand moulding'),
    ('Dimensional tolerance <= 100mm',  '+-2.0 mm',  '+-1.5 mm',  'As-cast'),
    ('Dimensional tolerance 100-300mm', '+-3.0 mm',  '+-2.5 mm',  'As-cast'),
    ('Surface finish as-cast',           'Ra 12.5-50','Ra 6.3-25', 'Sand texture'),
    ('Minimum wall thickness',           '6-8 mm',    '4-6 mm',    'For flow'),
    ('Porosity (normal)',                '<= 2% vol', '<= 2% vol', 'X-ray acceptance')
  ) AS t(p,f,a,n);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── THERMOFORMING ─────────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%Thermoform%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Thermoforming Temperature by Material',
    'Forming temperature range, mould temp, and max draw ratio by thermoplastic',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"forming_temp_c","type":"text","label":"Forming Temp (C)"},
      {"name":"mould_temp_c","type":"text","label":"Mould Temp (C)"},
      {"name":"max_draw_ratio","type":"number","label":"Max Draw Ratio"},
      {"name":"min_wall_mm","type":"number","label":"Min Wall (mm)"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('material',m,'forming_temp_c',ft,'mould_temp_c',mt,'max_draw_ratio',dr,'min_wall_mm',mw),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('ABS',            '145-175', '50-80',  3.0, 0.8),
    ('HIPS',           '140-165', '40-70',  3.0, 0.7),
    ('HDPE',           '150-180', '20-50',  4.0, 0.8),
    ('PETG',           '140-165', '40-70',  3.5, 0.7),
    ('PET (APET)',     '100-130', '10-30',  3.0, 0.5),
    ('Acrylic (PMMA)', '160-180', '50-80',  2.5, 1.0),
    ('Polycarbonate',  '175-200', '80-110', 2.5, 1.5),
    ('Polypropylene',  '155-185', '30-60',  3.5, 0.8),
    ('PVC (rigid)',    '130-160', '20-50',  2.5, 0.7),
    ('PETG (clear)',   '140-165', '20-50',  3.5, 0.6)
  ) AS t(m,ft,mt,dr,mw);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── MANUAL ASSEMBLY ───────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Manual%Assembl%','%Assembly%'])
  LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Standard Assembly Times (MTM)',
    'Methods-Time Measurement: standard times for common assembly motions',
    '[{"name":"motion","type":"text","label":"Motion / Operation"},
      {"name":"description","type":"text","label":"Description"},
      {"name":"time_sec","type":"number","label":"Std Time (sec)"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('motion',m,'description',d,'time_sec',t),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Reach (short)',      'Pick up part <= 30cm',          1.5),
    ('Reach (long)',       'Pick up part 30-80cm',          2.5),
    ('Grasp (simple)',     'Easy to grasp part',            0.5),
    ('Grasp (difficult)', 'Small or tangled part',          2.0),
    ('Move (short)',       'Place within 30cm',             1.5),
    ('Position (easy)',    'Loose fit, no alignment',       1.5),
    ('Position (medium)', 'Close fit, 1-axis align',        3.5),
    ('Position (close)',  'Press fit, multi-axis align',    6.0),
    ('Screw manual M6',   'Turn screwdriver 5 turns',       5.0),
    ('Screw power M6',    'Power gun, 3 sec tightening',    4.0),
    ('Snap fit (easy)',    '1 snap engagement',             2.0),
    ('Snap fit (hard)',    '3+ snap engagements',           5.0),
    ('Cable route 30cm',  'Route and clip harness',         8.0),
    ('Label apply',       'Peel and stick label',           4.0),
    ('Visual inspect',    'Check assembly, 6 features',     8.0)
  ) AS t(m,d,t);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Fastener Tightening Torque',
    'Recommended tightening torque (Nm) for standard metric fasteners',
    '[{"name":"thread_size","type":"text","label":"Thread Size"},
      {"name":"torque_8_8_nm","type":"number","label":"Grade 8.8 (Nm)"},
      {"name":"torque_10_9_nm","type":"number","label":"Grade 10.9 (Nm)"},
      {"name":"torque_12_9_nm","type":"number","label":"Grade 12.9 (Nm)"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('thread_size',ts,'torque_8_8_nm',t88,'torque_10_9_nm',t109,'torque_12_9_nm',t129),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('M4',    3,    4,    5),
    ('M5',    6,    9,   10),
    ('M6',   10,   15,   17),
    ('M8',   25,   35,   42),
    ('M10',  49,   69,   83),
    ('M12',  86,  120,  145),
    ('M14', 135,  190,  228),
    ('M16', 210,  295,  355),
    ('M20', 410,  580,  695),
    ('M24', 710, 1000, 1200)
  ) AS t(ts,t88,t109,t129);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── QUALITY INSPECTION ────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Qual%Inspect%','%Inspection%','%Quality%'])
  LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'AQL Sampling Plan (Normal Inspection)',
    'ISO 2859-1 accept/reject sample size by lot size and AQL level',
    '[{"name":"lot_size","type":"text","label":"Lot Size"},
      {"name":"sample_size","type":"number","label":"Sample Size"},
      {"name":"aql_1_0_ac","type":"number","label":"AQL 1.0 Ac"},
      {"name":"aql_2_5_ac","type":"number","label":"AQL 2.5 Ac"},
      {"name":"aql_4_0_ac","type":"number","label":"AQL 4.0 Ac"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('lot_size',ls,'sample_size',ss,'aql_1_0_ac',a10,'aql_2_5_ac',a25,'aql_4_0_ac',a40),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('2-8',        2,  0, 0, 0),
    ('9-15',       3,  0, 0, 0),
    ('16-25',      5,  0, 0, 1),
    ('26-50',      8,  0, 0, 1),
    ('51-90',     13,  0, 1, 2),
    ('91-150',    20,  0, 1, 3),
    ('151-280',   32,  1, 2, 5),
    ('281-500',   50,  1, 3, 7),
    ('501-1200',  80,  2, 5,10),
    ('1201-3200',125,  3, 7,14),
    ('3201-10000',200, 5,10,21),
    ('> 10000',  315,  7,14,21)
  ) AS t(ls,ss,a10,a25,a40);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Gauge and Measurement Selection',
    'Recommended measuring instrument by feature type and tolerance',
    '[{"name":"feature","type":"text","label":"Feature / Dimension"},
      {"name":"tolerance_range","type":"text","label":"Tolerance Range"},
      {"name":"instrument","type":"text","label":"Instrument"},
      {"name":"resolution","type":"text","label":"Resolution"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('feature',f,'tolerance_range',tr,'instrument',i,'resolution',r),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Linear dimension',    '+-0.5 mm',      'Vernier calliper',       '0.02 mm'),
    ('Linear dimension',    '+-0.1 mm',      'Digital calliper',       '0.01 mm'),
    ('Linear dimension',    '+-0.025 mm',    'Micrometer',             '0.001 mm'),
    ('Linear dimension',    '+-0.010 mm',    'Dial gauge / indicator', '0.001 mm'),
    ('Linear dimension',    '+-0.005 mm',    'CMM / air gauge',        '0.001 mm'),
    ('Bore diameter',       '+-0.05 mm',     'Bore gauge',             '0.01 mm'),
    ('Bore diameter',       '+-0.010 mm',    'Air gauge / CMM',        '0.001 mm'),
    ('Profile / contour',   '+-0.1 mm',      'Profile projector',      '0.01 mm'),
    ('GDT flatness',        '0.05 mm',       'CMM / surface plate',    '0.001 mm'),
    ('Thread GO/NOGO',      'ISO standard',  'Thread gauge set',       'Pass/Fail'),
    ('Surface roughness Ra','Ra 0.8-6.3',    'Profilometer (contact)', '0.01 um'),
    ('Hardness',            'HRC +-2',       'Rockwell hardness tester','1 HRC')
  ) AS t(f,tr,i,r);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── PLATING ───────────────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%Plat%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Plating Process Specifications',
    'Standard plating thickness, hardness, and corrosion resistance by process type',
    '[{"name":"plating_type","type":"text","label":"Plating Type"},
      {"name":"base_material","type":"text","label":"Base Material"},
      {"name":"thickness_um","type":"text","label":"Thickness (um)"},
      {"name":"hardness_hv","type":"text","label":"Hardness (HV)"},
      {"name":"salt_spray_hrs","type":"text","label":"Salt Spray (hrs)"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('plating_type',pt,'base_material',bm,'thickness_um',th,'hardness_hv',hv,'salt_spray_hrs',css),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Zinc (yellow passivate)',   'Steel',   '5-12 um',    '50-80 HV',    '96 hrs'),
    ('Zinc Nickel (12-15% Ni)',   'Steel',   '8-15 um',    '450-550 HV',  '480 hrs'),
    ('Nickel (electrolytic)',     'All',     '5-25 um',    '200-400 HV',  '200 hrs'),
    ('Hard Chrome',               'Steel',   '5-50 um',    '850-1050 HV', '200 hrs'),
    ('Decorative Chrome',         'Nickel',  '0.3-1 um',   '700-900 HV',  '200 hrs'),
    ('Tin Plating',               'Steel/Cu','5-15 um',    '10-20 HV',    '48 hrs'),
    ('Silver Plating',            'Cu/Brass','3-10 um',    '80-120 HV',   '24 hrs'),
    ('Gold Flash',                'Ni base', '0.1-0.5 um', '150-200 HV',  'Decorative'),
    ('Electroless Nickel (EN)',   'All',     '5-50 um',    '500-700 HV',  '500 hrs'),
    ('Black Oxide',               'Steel',   '1-2 um',     'Base metal',  '24 hrs + oil')
  ) AS t(pt,bm,th,hv,css);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── DRILLING ──────────────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%Drill%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Drilling Speed and Feed Reference',
    'Recommended cutting speed and feed per revolution for drilling',
    '[{"name":"material","type":"text","label":"Work Material"},
      {"name":"hss_vc_m_min","type":"number","label":"HSS Vc (m/min)"},
      {"name":"carbide_vc_m_min","type":"number","label":"Carbide Vc (m/min)"},
      {"name":"feed_mm_rev","type":"text","label":"Feed (mm/rev) for Dia 6-12"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('material',m,'hss_vc_m_min',hss,'carbide_vc_m_min',carb,'feed_mm_rev',f),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Mild Steel',            25,  80, '0.15-0.25'),
    ('Alloy Steel 4140',      18,  60, '0.10-0.20'),
    ('Stainless Steel 304',   12,  50, '0.08-0.15'),
    ('Tool Steel (annealed)', 10,  40, '0.05-0.12'),
    ('Cast Iron',             25,  80, '0.20-0.30'),
    ('Aluminium Alloys',      80, 200, '0.15-0.30'),
    ('Brass',                 50, 150, '0.15-0.30'),
    ('Copper',                40, 120, '0.10-0.20'),
    ('Titanium Ti-6Al-4V',     6,  25, '0.05-0.10'),
    ('PEEK / Plastics',       50, 150, '0.15-0.30')
  ) AS t(m,hss,carb,f);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Standard Drill and Tap Sizes',
    'Tapping drill diameter for common metric threads',
    '[{"name":"thread","type":"text","label":"Thread"},
      {"name":"pitch_mm","type":"number","label":"Pitch (mm)"},
      {"name":"tapping_drill_mm","type":"number","label":"Tapping Drill (mm)"},
      {"name":"clearance_drill_mm","type":"number","label":"Clearance Drill (mm)"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('thread',th,'pitch_mm',p,'tapping_drill_mm',td,'clearance_drill_mm',cd),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('M2',   0.40,  1.60,  2.4),
    ('M2.5', 0.45,  2.05,  2.9),
    ('M3',   0.50,  2.50,  3.4),
    ('M4',   0.70,  3.30,  4.5),
    ('M5',   0.80,  4.20,  5.5),
    ('M6',   1.00,  5.00,  6.6),
    ('M8',   1.25,  6.75,  9.0),
    ('M10',  1.50,  8.50, 11.0),
    ('M12',  1.75, 10.25, 13.5),
    ('M16',  2.00, 14.00, 17.5),
    ('M20',  2.50, 17.50, 22.0),
    ('M24',  3.00, 21.00, 26.0)
  ) AS t(th,p,td,cd);
  END IF;
  tbl_id := NULL;

END LOOP;

-- ── DEEP DRAWING ─────────────────────────────────────────────────────────────
FOR proc_id IN
  SELECT id FROM processes WHERE process_name ILIKE '%Deep Draw%' LIMIT 3
LOOP

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Draw Ratio and Redraw Guide',
    'Maximum limiting draw ratio (LDR) and redraw reduction per pass',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"max_ldr_1st","type":"number","label":"Max LDR 1st Draw"},
      {"name":"max_reduction_pct","type":"number","label":"Max Reduction / Pass (%)"},
      {"name":"lubrication","type":"text","label":"Recommended Lube"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('material',m,'max_ldr_1st',ldr,'max_reduction_pct',mr,'lubrication',l),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Deep Draw Steel (DQSK)',  2.2, 40, 'EP drawing compound'),
    ('Mild Steel',              2.0, 38, 'EP drawing compound'),
    ('Stainless Steel 304',     2.0, 35, 'Heavy EP + pigmented'),
    ('Aluminium 1100-O',        2.3, 45, 'Mineral oil'),
    ('Aluminium 3003',          2.2, 42, 'Mineral oil'),
    ('Copper (annealed)',       2.3, 45, 'Light mineral oil'),
    ('Brass 70/30',             2.2, 40, 'Soluble oil'),
    ('Titanium CP',             2.0, 30, 'Heavy chlorinated EP')
  ) AS t(m,ldr,mr,l);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id,
    'Blank Diameter Calculation Guide',
    'Blank diameter formulae for common drawn shell shapes',
    '[{"name":"shape","type":"text","label":"Shell Shape"},
      {"name":"formula","type":"text","label":"Blank Dia Formula"},
      {"name":"note","type":"text","label":"Notes"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING
  RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id, jsonb_build_object('shape',s,'formula',f,'note',n),
         ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Flat-bottomed cylinder (no flange)',   'D = sqrt(d2 + 4dh)',           'd=shell dia, h=depth'),
    ('Flat-bottomed cylinder (with flange)', 'D = sqrt(d2 + 4dh + 4df*df)', 'df=flange width'),
    ('Hemispherical cup',                    'D = 1.41 * d',                 'd=sphere dia'),
    ('Conical cup (shallow)',                'D = sqrt(d1^2 + d2^2 + 4d2h)','Stepped cone'),
    ('Rectangular box',                      'D = perimeter/pi + 2h',        'Approximate')
  ) AS t(s,f,n);
  END IF;
  tbl_id := NULL;

END LOOP;

RAISE NOTICE 'Migration 161 complete.';

END $$;

-- Summary: show which processes now have reference tables
SELECT
  p.process_name,
  COUNT(DISTINCT rt.id) AS ref_tables,
  COUNT(tr.id)          AS data_rows
FROM processes p
LEFT JOIN process_reference_tables rt ON rt.process_id = p.id
LEFT JOIN process_table_rows tr       ON tr.table_id = rt.id
GROUP BY p.process_name
HAVING COUNT(DISTINCT rt.id) > 0
ORDER BY p.process_name;
