-- Migration 170: Seed global (is_global = true) process reference tables
--
-- Architecture: reference tables are seeded into is_global=true processes only.
-- The API falls back to these global tables when a user's own process has none,
-- so every user with "Grinding", "Thermoforming", etc. sees the same shared data.
--
-- Creates global template processes if they don't already exist, then seeds tables.
-- Safe to re-run: ON CONFLICT (process_id, table_name) DO NOTHING throughout.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Helper: ensure a global template process exists for a given name ──────────
-- Returns the id (existing or newly created).
CREATE OR REPLACE FUNCTION _ensure_global_process(p_name TEXT) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM processes
  WHERE process_name = p_name AND is_global = TRUE
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO processes (process_name, is_global, process_category)
    VALUES (p_name, TRUE, p_name)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ══════════════════════════════════════════════════════════════════════════════
-- GEAR CUTTING
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
  proc_id := _ensure_global_process('Gear Cutting');

  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Gear Process Selection Guide',
    'Selecting the right gear cutting process by gear type, module, accuracy, and volume',
    '[{"name":"gear_type","type":"text","label":"Gear Type"},
      {"name":"process","type":"text","label":"Recommended Process"},
      {"name":"module_range","type":"text","label":"Module Range"},
      {"name":"accuracy_din","type":"text","label":"Accuracy (DIN)"},
      {"name":"volume","type":"text","label":"Volume"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('gear_type',g,'process',p,'module_range',m,'accuracy_din',a,'volume',v,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Spur / Helical (external)',    'Gear Hobbing',          '0.3–20',  'DIN 6–9',  'Medium–High', 'Fastest cycle; most common'),
    ('Spur / Helical (external)',    'Gear Shaping',          '0.3–10',  'DIN 6–8',  'Low–Med',     'Shoulder gears, cluster gears'),
    ('Internal spur',                'Gear Shaping',          '0.5–8',   'DIN 6–8',  'Any',         'Only practical process for internal'),
    ('Bevel gear (straight)',        'Bevel Gear Planer',     '1–10',    'DIN 7–9',  'Low–Med',     'Gleason / Coniflex process'),
    ('Bevel gear (spiral)',          'Face Milling / Hobbing','1–10',    'DIN 6–8',  'Med–High',    'Gleason spiral bevel; Klingelnberg'),
    ('Worm gear',                    'Gear Hobbing',          '1–12',    'DIN 6–8',  'Med–High',    'Single / multi-start hobs'),
    ('High accuracy spur / helical', 'Gear Grinding',         '0.5–12',  'DIN 3–6',  'Med–High',    'Profile or generating grinding; post-hob'),
    ('Prototype / low volume',       'CNC Gear Milling',      'Any',     'DIN 8–10', 'Very Low',    'Form milling cutter; slow'),
    ('Plastic / powder metal',       'Gear Moulding / Sintering','0.5–4','DIN 8–10', 'High',        'No machining; net shape')
  ) AS t(g,p,m,a,v,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Hobbing Cutting Parameters',
    'Gear hobbing: cutting speed, feed, and depth by module and material',
    '[{"name":"material","type":"text","label":"Work Material"},
      {"name":"module_m","type":"text","label":"Module (m)"},
      {"name":"vc_m_min","type":"text","label":"Vc (m/min)"},
      {"name":"fa_mm_rev","type":"text","label":"Axial Feed (mm/rev)"},
      {"name":"hob_material","type":"text","label":"Hob Material"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'module_m',mo,'vc_m_min',vc,'fa_mm_rev',fa,'hob_material',hm,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Low carbon steel (≤0.3%C)',  '1–3',   '80–120',  '2–3',   'HSS-E / TiN coated', 'Coolant: soluble oil'),
    ('Low carbon steel (≤0.3%C)',  '4–8',   '60–90',   '2.5–4', 'HSS-E / TiN coated', 'Coolant: soluble oil'),
    ('Alloy steel (0.3–0.5%C)',    '1–3',   '60–90',   '1.5–2', 'HSS-E-PM / TiAlN',   'Coolant or dry with coated hob'),
    ('Alloy steel (0.3–0.5%C)',    '4–8',   '40–70',   '2–3',   'HSS-E-PM / TiAlN',   'Dry hobbing preferred'),
    ('Case hardening steel',       '1–3',   '70–100',  '1.5–2', 'HSS-PM / TiN',        'Pre-harden ≤30 HRC'),
    ('Stainless (austenitic)',      '1–4',   '40–60',   '1–2',   'HSS-PM / TiAlN',     'Low speed; heavy coolant'),
    ('Aluminium alloys',           '1–8',   '200–400', '3–5',   'HSS or carbide',      'Dry or MQL'),
    ('Brass / bronze',             '1–6',   '150–250', '2–4',   'HSS',                 'Usually dry')
  ) AS t(m,mo,vc,fa,hm,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Gear Accuracy Grades (DIN / ISO / AGMA)',
    'Gear tolerance grades, achievable accuracy by process, and application mapping',
    '[{"name":"grade","type":"text","label":"Grade"},
      {"name":"pitch_error_um","type":"text","label":"Pitch Error (µm)"},
      {"name":"profile_error_um","type":"text","label":"Profile Error (µm)"},
      {"name":"process","type":"text","label":"Typical Process"},
      {"name":"application","type":"text","label":"Application"}]'::jsonb,
    3, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('grade',g,'pitch_error_um',pe,'profile_error_um',prof,'process',p,'application',a),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('DIN 3–4 / AGMA 13–14', '< 3',   '< 3',   'Gear grinding (generating)',         'Turbines, precision instruments'),
    ('DIN 5–6 / AGMA 11–12', '3–8',   '4–10',  'Gear grinding (profile)',            'Aerospace, high-speed gearboxes'),
    ('DIN 6–7 / AGMA 10–11', '8–20',  '10–20', 'Hobbing + shaving or honing',        'Automotive transmissions'),
    ('DIN 7–8 / AGMA 9–10',  '20–45', '20–45', 'Precision hobbing / shaping',        'Industrial gearboxes, reducers'),
    ('DIN 8–9 / AGMA 7–8',   '45–90', '45–90', 'Standard hobbing / shaping',         'General machinery, pumps'),
    ('DIN 10–11 / AGMA 5–6', '90–200','90–200','CNC milling / powder metal',         'Low-load, low-speed applications'),
    ('DIN 12 / AGMA 3–4',    '>200',  '>200',  'Cast / moulded gears',               'Toys, light duty, low speed')
  ) AS t(g,pe,prof,p,a);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Gear Cutting Defects & Corrective Actions',
    'Common gear cutting defects, root causes, and corrective actions',
    '[{"name":"defect","type":"text","label":"Defect"},
      {"name":"root_cause","type":"text","label":"Root Cause"},
      {"name":"corrective_action","type":"text","label":"Corrective Action"}]'::jsonb,
    4, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('defect',d,'root_cause',rc,'corrective_action',ca),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Pitch error (spacing error)', 'Hob arbor runout, worn hob, differential backlash', 'Check hob runout; replace hob; tighten arbor; inspect differential'),
    ('Profile error',               'Incorrect hob profile, worn flanks, wrong pressure angle', 'Re-grind or replace hob; verify hob specification'),
    ('Lead / helix error',          'Differential gear ratio wrong, machine alignment', 'Verify differential setting; check swivel angle for helical'),
    ('Surface roughness (chatter)', 'Hob too worn, feed too coarse, machine vibration', 'Replace hob; reduce axial feed; balance hob arbor'),
    ('Burrs on tooth tips',         'Dull hob, no chamfering pass, soft material', 'Add chamfering cutter; use sharp hob; deburr post-cut'),
    ('Case depth variation (post-heat)','Uneven pre-machining stock, inconsistent carburising', 'Maintain uniform stock allowance before case hardening'),
    ('Tooth undercutting',          'Module too large for tooth number, wrong cutter', 'Use correct module hob; increase tooth count; use profile shift')
  ) AS t(d,rc,ca);
  END IF;
  tbl_id := NULL;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- PACKING
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
  proc_id := _ensure_global_process('Packing');

  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Packaging Material Selection Guide',
    'Inner and outer packaging material selection by part type, weight, and protection requirement',
    '[{"name":"material","type":"text","label":"Packaging Material"},
      {"name":"protection","type":"text","label":"Protection Type"},
      {"name":"max_part_weight_kg","type":"text","label":"Max Part Weight (kg)"},
      {"name":"typical_use","type":"text","label":"Typical Use"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'protection',p,'max_part_weight_kg',w,'typical_use',u,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Single-wall corrugated (B/C flute)', 'Impact, crush',              '5',    'Light parts, consumer goods',       'Max stacking: 3 high'),
    ('Double-wall corrugated (BC flute)',   'Impact, crush, moisture',    '15',   'Medium machinery parts',            'Max stacking: 4 high'),
    ('Triple-wall corrugated',             'Heavy impact, crush',         '40',   'Heavy machined parts',              'Near-wooden-crate alternative'),
    ('Wooden crate / pallet box',          'Heavy impact, forklift loads','500+', 'Large castings, assemblies',        'ISPM-15 heat treatment required for export'),
    ('Foam-in-place (polyurethane)',        'Vibration, all-round cushion','50',   'Precision parts, instruments',      'Custom formed around part; no movement'),
    ('PE foam sheet / rolls',              'Scratch, light impact',       '20',   'Finished surfaces, optical parts',  'Anti-static grades for electronic parts'),
    ('Bubble wrap (small cell)',           'Light impact, scratch',        '5',    'Light machined parts, castings',    'Wrap individual parts'),
    ('Bubble wrap (large cell)',           'Medium impact',                '20',   'Medium parts',                      'Layer between stacked parts'),
    ('VCI poly bag (corrosion inhibitor)', 'Corrosion prevention',        'Any',  'Steel/iron parts, machined surfaces','Required for overseas shipping of bare metal'),
    ('Desiccant silica gel',              'Moisture control',             'N/A',  'All metal parts',                   '1 unit per 0.03 m³ enclosed space'),
    ('Expanded polystyrene (EPS)',         'Impact, vibration',           '30',   'Fragile assemblies, electronics',   'Custom moulded; recyclability concern'),
    ('Moulded pulp tray',                 'Light impact, presentation',   '5',    'Consumer electronics, small parts', 'Eco-friendly; limited moisture resistance')
  ) AS t(m,p,w,u,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Carton & Pallet Specification Standards',
    'Standard carton sizes, pallet dimensions, stacking limits, and weight guidelines',
    '[{"name":"parameter","type":"text","label":"Parameter"},
      {"name":"standard_value","type":"text","label":"Standard Value"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('parameter',p,'standard_value',v,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Standard euro pallet (EN 13698-1)', '1200 × 800 mm',     'Most common in Europe; 1200 × 1000 also used'),
    ('US standard pallet (GMA)',          '1219 × 1016 mm',    '48" × 40"; dominant in North America'),
    ('Max pallet height (road transport)','1200 mm',            'Including pallet; verify with freight forwarder'),
    ('Max gross pallet weight (road)',    '1000 kg (EU) / 1360 kg (US)', 'Check customer / carrier limits'),
    ('Carton overhang on pallet',         '≤ 50 mm per side',  'Excessive overhang risks crush in transit'),
    ('Stretch wrap turns (pallet wrap)',  '≥ 3 top, 4–6 body', 'Minimum 150% overlap per layer'),
    ('Single-wall carton max gross weight','15 kg',             'ISO 4180 / ASTM D4169'),
    ('Double-wall carton max gross weight','25 kg',             'BCT ≥ 4× gross weight for stacking'),
    ('Box compression test (BCT) factor','BCT ≥ 4× gross wt', 'For 3-tier stacking; reduce factor for ambient storage'),
    ('Drop test height (fragile goods)',  '0.6–1.0 m',          'ASTM D5276 / ISTA 1A; class by gross weight')
  ) AS t(p,v,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Shipping Mark & Label Requirements',
    'Mandatory and optional marking for domestic and export shipments',
    '[{"name":"mark_type","type":"text","label":"Mark / Label"},
      {"name":"content","type":"text","label":"Required Content"},
      {"name":"standard","type":"text","label":"Standard / Regulation"},
      {"name":"mandatory","type":"text","label":"Mandatory?"}]'::jsonb,
    3, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('mark_type',m,'content',c,'standard',s,'mandatory',mand),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Shipper mark',          'Consignee name, address, PO/order no., item no., carton no.', 'Customer specific',      'Yes'),
    ('Country of origin',     '"Made in [Country]" — must match HS code origin rules',      'Customs / WTO rules',    'Yes (export)'),
    ('Gross / net weight',    'Gross and net weight in kg; tare weight',                     'ISO 780 / carrier req.', 'Yes'),
    ('Package dimensions',    'L × W × H in mm or cm on each carton',                        'Carrier requirement',    'Yes'),
    ('Fragile label',         'FRAGILE / HANDLE WITH CARE — ISO 780 glass symbol',          'ISO 780',                'If applicable'),
    ('This way up (arrows)',  'Two vertical arrows; "THIS SIDE UP"',                         'ISO 780',                'If applicable'),
    ('Max stack weight',      '"MAX WEIGHT xx kg" or stacking arrows',                       'ISO 780',                'If stacked'),
    ('Hazardous goods label', 'UN number, hazard class diamond, emergency contact',          'IATA / IMDG / ADR',      'Hazmat only'),
    ('Barcode / QR code',     'Part number, serial/batch, scan for traceability',            'GS1 / customer spec.',   'Customer specific'),
    ('ISPM-15 mark (wood)',   'IPPC mark: HT or MB treatment, country code, producer code', 'ISPM-15 (FAO)',          'All wood packaging for export')
  ) AS t(m,c,s,mand);
  END IF;
  tbl_id := NULL;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- TESTING
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
  proc_id := _ensure_global_process('Testing');

  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Test Method Selection Guide',
    'Selecting the right test method by what is being verified and material type',
    '[{"name":"test_objective","type":"text","label":"Test Objective"},
      {"name":"method","type":"text","label":"Test Method"},
      {"name":"destructive","type":"text","label":"Destructive?"},
      {"name":"applicable_to","type":"text","label":"Applicable To"},
      {"name":"standard","type":"text","label":"Key Standard"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('test_objective',o,'method',m,'destructive',d,'applicable_to',a,'standard',s),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Tensile strength / elongation',   'Tensile test',               'Yes', 'All metals, plastics, composites', 'ISO 6892-1 / ASTM E8'),
    ('Hardness',                        'Vickers / Rockwell / Brinell','No', 'Metals',                           'ISO 6507 / ISO 6508 / ISO 6506'),
    ('Impact toughness',                'Charpy / Izod impact',       'Yes', 'Metals, plastics',                 'ISO 148-1 / ASTM E23'),
    ('Fatigue strength',                'Fatigue / S-N curve',        'Yes', 'Metals, composites',               'ISO 1099 / ASTM E466'),
    ('Surface / sub-surface cracks',    'Magnetic particle (MT)',      'No',  'Ferrous metals',                   'ISO 9934 / ASTM E709'),
    ('Surface / near-surface cracks',   'Dye penetrant (PT)',          'No',  'All metals, ceramics',             'ISO 3452 / ASTM E165'),
    ('Internal defects (voids, cracks)','Ultrasonic testing (UT)',     'No',  'Metals, castings, welds',          'ISO 10863 / ASTM E317'),
    ('Internal defects (dense parts)',  'Radiography / X-ray (RT)',    'No',  'Castings, welds, assemblies',      'ISO 17636 / ASTM E94'),
    ('Dimensional accuracy',            'CMM / optical profilometry',  'No',  'All parts',                        'ISO 10360 / ASME Y14.5'),
    ('Weld integrity',                  'Visual + UT + RT',            'No',  'Welded assemblies',                'ISO 3834 / AWS D1.1'),
    ('Coating adhesion',                'Cross-cut adhesion test',     'Yes', 'Painted, coated parts',            'ISO 2409 / ASTM D3359'),
    ('Corrosion resistance',            'Salt spray test',             'No',  'Coated / plated parts',            'ISO 9227 / ASTM B117'),
    ('Leak / pressure integrity',       'Hydrostatic / pneumatic test','No',  'Pressure vessels, manifolds',      'PED 2014/68/EU / ASME Sec. VIII')
  ) AS t(o,m,d,a,s);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Mechanical Test Acceptance Criteria',
    'Typical minimum mechanical property requirements by material class',
    '[{"name":"material","type":"text","label":"Material / Grade"},
      {"name":"uts_mpa","type":"text","label":"UTS (MPa) min"},
      {"name":"ys_mpa","type":"text","label":"Yield (MPa) min"},
      {"name":"elongation_pct","type":"text","label":"Elongation (%) min"},
      {"name":"hardness","type":"text","label":"Hardness"},
      {"name":"standard","type":"text","label":"Standard"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'uts_mpa',u,'ys_mpa',y,'elongation_pct',e,'hardness',h,'standard',s),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('AISI 1020 (mild steel)',        '380',  '210', '25', '≤ 143 HB',        'ASTM A108'),
    ('AISI 4140 (Q&T)',               '1000', '850', '12', '28–34 HRC',       'ASTM A434 Gr. BD'),
    ('304 Stainless steel (annealed)','515',  '205', '40', '≤ 201 HB',        'ASTM A240'),
    ('Al 6061-T6',                    '310',  '276', '10', '60 HRB',          'ASTM B209'),
    ('Al 7075-T6',                    '503',  '434', '11', '87 HRB',          'ASTM B209'),
    ('Ti-6Al-4V (Grade 5)',           '950',  '880', '10', '30–36 HRC',       'ASTM B265 Gr.5'),
    ('Inconel 718',                   '1240', '1034','12', '40 HRC max',      'AMS 5596'),
    ('EN-GJL-250 (Grey CI)',          '250',  'N/A', 'N/A','180–230 HB',      'ISO 185'),
    ('PA6 (Nylon 6)',                 '70',   '55',  '50', '80 Shore D',      'ISO 527'),
    ('PC (Polycarbonate)',            '60',   '55',  '100','75 Shore D',      'ISO 527')
  ) AS t(m,u,y,e,h,s);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'NDT Method Quick Reference',
    'Non-destructive testing methods — capabilities, limitations, and typical cost',
    '[{"name":"method","type":"text","label":"NDT Method"},
      {"name":"detects","type":"text","label":"Detects"},
      {"name":"depth","type":"text","label":"Depth Capability"},
      {"name":"materials","type":"text","label":"Materials"},
      {"name":"relative_cost","type":"text","label":"Relative Cost"},
      {"name":"limitation","type":"text","label":"Key Limitation"}]'::jsonb,
    3, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('method',m,'detects',d,'depth',dep,'materials',mat,'relative_cost',c,'limitation',l),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Visual (VT)',               'Surface defects, geometry',       'Surface only',   'All',                    'Very Low',   'Human / borescope; obvious defects only'),
    ('Dye Penetrant (PT)',        'Surface-breaking cracks',         'Surface only',   'Non-porous all materials','Low',        'Surface prep critical; no subsurface'),
    ('Magnetic Particle (MT)',    'Surface & near-surface cracks',   '0–3 mm depth',   'Ferrous metals only',    'Low',        'Only works on ferromagnetic materials'),
    ('Ultrasonic (UT)',           'Internal voids, laminations',     'Full thickness', 'Metals, composites',     'Medium',     'Needs coupling medium; rough surfaces difficult'),
    ('Phased Array UT (PAUT)',    'Complex internal defects',        'Full thickness', 'Metals, composites',     'Med–High',   'Higher cost; skilled operator needed'),
    ('Radiography (RT / X-ray)', 'Internal voids, inclusions',      'Full thickness', 'Metals, castings, welds','High',       'Radiation safety; flat geometry preferred'),
    ('CT Scanning (industrial)',  '3D internal geometry, porosity',  'Full volume',    'Any material',           'Very High',  'Part size limitations; slow throughput'),
    ('Eddy Current (ET)',         'Surface & near-surface flaws',    '0–6 mm',         'Conductive metals',      'Med',        'Only conductive materials; geometry sensitive'),
    ('Thermography (IRT)',        'Delaminations, subsurface voids', '0–10 mm',        'Composites, coatings',   'Med',        'Thermal contrast needed; emissivity varies')
  ) AS t(m,d,dep,mat,c,l);
  END IF;
  tbl_id := NULL;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- TURNING CENTER
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
  proc_id := _ensure_global_process('Turning Center');

  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Turning Operations Reference',
    'Lathe / turning centre operations — tool type, purpose, and key parameters',
    '[{"name":"operation","type":"text","label":"Operation"},
      {"name":"tool_type","type":"text","label":"Tool Type"},
      {"name":"depth_of_cut","type":"text","label":"Depth of Cut (mm)"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('operation',o,'tool_type',t,'depth_of_cut',d,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('OD Roughing',          'CNMG / SNMG negative insert, 80° holder', '2–6 mm',    'Max MRR; use high feed grades'),
    ('OD Semi-finishing',    'CNMG / WNMG positive insert',             '0.5–2 mm',  'Prepare surface for finishing'),
    ('OD Finishing',         'VCMT / DCMT positive insert, 35° holder', '0.1–0.5 mm','Small nose radius for Ra; use wiper insert'),
    ('Facing',               'CNMG / SNMG, face turning holder',        '0.5–3 mm',  'Feed from OD to centre or reverse'),
    ('ID Boring (rough)',     'Boring bar, CCMT/DCMT insert',           '1–4 mm',     'Min bar diameter = 0.75× bore; L/D < 4:1'),
    ('ID Boring (finish)',    'Fine boring bar, small DCMT insert',      '0.1–0.5 mm','Chatter risk: increase speed, reduce overhang'),
    ('Grooving / parting',    'Grooving insert (narrow, neutral)',        '= groove width','Reduce feed at depth; use coolant through tool'),
    ('Threading (OD)',        'Threading insert 60° or 55°',             '0.05–0.3 mm','Multiple passes (5–8); spring pass last'),
    ('Threading (ID)',        'Internal threading bar',                   '0.05–0.2 mm','L/D limit critical; use rigid boring bar'),
    ('Knurling',             'Knurling tool (bump or form)',              'N/A',        'Control radial force; blind knurls need relief'),
    ('Taper turning',        'Standard OD tool, compound slide offset',  'As required','Offset method or taper attachment for long tapers')
  ) AS t(o,t,d,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Cutting Speed & Feed by Material',
    'Starting cutting parameters for turning by work material — adjust for insert grade and setup',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"vc_m_min","type":"text","label":"Vc (m/min)"},
      {"name":"fn_mm_rev","type":"text","label":"fn (mm/rev)"},
      {"name":"ap_mm","type":"text","label":"ap (mm)"},
      {"name":"insert_grade","type":"text","label":"Insert Material"},
      {"name":"coolant","type":"text","label":"Coolant"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'vc_m_min',vc,'fn_mm_rev',fn,'ap_mm',ap,'insert_grade',ig,'coolant',c),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Low carbon steel (≤0.3%C)',      '200–350', '0.2–0.4', '1–4',    'Coated carbide (CVD)', 'Flood'),
    ('Medium carbon steel (0.3–0.6%C)','150–250', '0.2–0.4', '1–3',    'Coated carbide (CVD)', 'Flood'),
    ('Alloy steel (≤40 HRC)',          '100–200', '0.1–0.3', '1–3',    'PVD TiAlN carbide',    'Flood'),
    ('Hardened steel (45–65 HRC)',     '80–200',  '0.05–0.2','0.1–0.5','PCBN (CBN)',            'Dry or MQL'),
    ('Stainless 304/316',              '80–180',  '0.1–0.3', '1–3',    'PVD TiAlN carbide',    'Flood'),
    ('Stainless 17-4 PH',             '60–120',  '0.1–0.2', '0.5–2',  'PVD TiAlN carbide',    'Flood'),
    ('Grey cast iron',                 '100–250', '0.2–0.5', '1–5',    'Coated carbide / CBN', 'Dry / MQL'),
    ('Aluminium (6xxx / 7xxx)',        '500–2000','0.2–0.5', '1–5',    'PCD or uncoated K10',  'MQL or dry'),
    ('Titanium alloys (Ti-6Al-4V)',    '40–80',   '0.1–0.2', '0.5–2',  'PVD TiAlN carbide',    'High-pressure coolant'),
    ('Inconel 718 / superalloys',      '25–60',   '0.05–0.15','0.3–1.5','Ceramic or CBN',       'High-pressure coolant'),
    ('Copper / brass',                 '150–400', '0.1–0.4', '1–4',    'Uncoated K-grade',     'Flood or dry'),
    ('Engineering plastics (PA, PE)',  '200–500', '0.1–0.4', '0.5–3',  'Polished uncoated K',  'Dry / air blast')
  ) AS t(m,vc,fn,ap,ig,c);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Insert Grade Selection Guide',
    'ISO insert grade families and their turning applications',
    '[{"name":"iso_grade","type":"text","label":"ISO Grade Family"},
      {"name":"coating","type":"text","label":"Coating"},
      {"name":"best_for","type":"text","label":"Best For"},
      {"name":"avoid","type":"text","label":"Avoid"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    3, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('iso_grade',ig,'coating',c,'best_for',bf,'avoid',av,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('P01–P10', 'CVD TiCN/Al₂O₃',    'Finishing steel, alloy steel',       'Interrupted cuts, cast iron',       'High speed, light cut'),
    ('P20–P40', 'CVD TiCN/Al₂O₃',    'General steel turning, semi-roughing','Hardened >40 HRC',                'Most versatile steel grade'),
    ('M10–M25', 'PVD TiAlN',          'Stainless steel, duplex',            'Dry cutting stainless',             'Maintain speed; minimise dwell'),
    ('K05–K20', 'Uncoated / CVD',     'Cast iron, non-ferrous, hardened',   'Steels (edge build-up)',            'Straight WC sharp edge for Al'),
    ('N05–N20', 'PCD / uncoated K',   'Aluminium, copper, plastics',        'Steel, iron',                       'PCD for best finish on Al'),
    ('S05–S20', 'PVD TiAlN / AlCrN',  'Titanium, Inconel, superalloys',     'High speed (heat build-up)',        'High-pressure coolant essential'),
    ('H01–H15', 'PVD TiAlN or PCBN',  'Hardened steel 45–65 HRC',          'Interrupted hardened cuts',         'Hard turning replaces grinding for Ra 0.4–0.8')
  ) AS t(ig,c,bf,av,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Turning Defects & Corrective Actions',
    'Common turning defects, root causes, and corrective actions',
    '[{"name":"defect","type":"text","label":"Defect"},
      {"name":"root_cause","type":"text","label":"Root Cause"},
      {"name":"corrective_action","type":"text","label":"Corrective Action"}]'::jsonb,
    4, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('defect',d,'root_cause',rc,'corrective_action',ca),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Chatter / vibration marks',    'Long overhang, tool worn, speed at resonance',      'Shorten overhang; increase speed 20%; use anti-vibration boring bar'),
    ('Built-up edge (BUE)',          'Low cutting speed, wrong grade, no coolant',         'Increase Vc; switch to PVD coated or PCD; apply coolant'),
    ('Poor surface finish',          'Worn insert, large nose radius, high feed',          'Replace insert; reduce fn; use wiper insert'),
    ('Taper on OD',                  'Tailstock not aligned, worn ways, deflection',       'Realign tailstock; reduce depth of cut; use steady rest'),
    ('Dimensional drift',            'Thermal growth, tool wear, machine backlash',        'Allow warm-up; monitor tool wear; use in-process gauging'),
    ('Insert fracture',              'Interrupted cut, wrong grade, excessive depth',      'Use tougher grade; reduce ap; apply chamfer on insert'),
    ('Work-hardening (stainless/Ni)','Low speed, dwelling, rubbing without cutting',       'Increase Vc and fn; avoid dwell; continuous feed'),
    ('Burr on shoulder',             'Worn insert, no chamfer on part, feed too high',     'Add entry/exit chamfer; reduce feed at shoulder; use sharp insert'),
    ('Chipping on edge',             'Interrupted cut, hard inclusions, wrong grade',      'Use tougher P/M grade; reduce Vc 20%; check material cert.')
  ) AS t(d,rc,ca);
  END IF;
  tbl_id := NULL;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- THERMOFORMING — re-seed to ensure global template exists
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
  proc_id := _ensure_global_process('Thermoforming');

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
    ('ABS',          '130–160', 1.5, '3:1',  'Most widely thermoformed'),
    ('HIPS',         '120–155', 1.0, '3:1',  'Food packaging, low cost'),
    ('PET',          '80–100',  0.5, '2.5:1','CPET for oven trays up to 220°C'),
    ('PP',           '150–175', 1.5, '2:1',  'Living hinges, chemical resistance'),
    ('HDPE',         '150–175', 2.0, '2:1',  'High shrink — post-form fixturing needed'),
    ('PC',           '175–195', 1.5, '2:1',  'High temp parts, optical clarity'),
    ('PMMA',         '150–180', 2.0, '2.5:1','Signage, aircraft glazing'),
    ('PVC (Rigid)',  '140–165', 0.3, '3:1',  'Blister packaging'),
    ('TPU',          '160–190', 1.5, '2:1',  'Flexible formed parts')
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
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- GRINDING — re-seed global template (matches migration 168 content)
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
  proc_id := _ensure_global_process('Grinding');

  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Grinding Process Comparison',
    'Overview of grinding process types — application, achievable Ra, tolerance, and relative cost',
    '[{"name":"process_type","type":"text","label":"Process Type"},
      {"name":"application","type":"text","label":"Primary Application"},
      {"name":"workpiece_geometry","type":"text","label":"Workpiece Geometry"},
      {"name":"ra_achievable_um","type":"text","label":"Achievable Ra (µm)"},
      {"name":"it_grade","type":"text","label":"IT Grade"},
      {"name":"relative_cost","type":"text","label":"Relative Cost"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('process_type',pt,'application',a,'workpiece_geometry',wg,'ra_achievable_um',ra,'it_grade',it,'relative_cost',rc),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Cylindrical (External OD)', 'Shafts, pins, journals',          'Round OD',          '0.1–0.8',  'IT5–6',  'Medium'),
    ('Cylindrical (Internal ID)', 'Bores, bushings, liners',         'Round ID',          '0.1–0.8',  'IT5–6',  'Medium–High'),
    ('Centerless (Throughfeed)',   'Long round bars, rods, pins',     'Round, no centres', '0.2–1.6',  'IT5–6',  'Low (high volume)'),
    ('Surface (Reciprocating)',    'Flat surfaces, tool steel',       'Flat / prismatic',  '0.1–0.8',  'IT5–6',  'Medium'),
    ('Gear (Profile)',             'Spur & helical gears',            'Involute profile',  '0.4–0.8',  'DIN 5–6','High'),
    ('Creep Feed',                 'Turbine blades, broach profiles', 'Complex profile',   '0.4–1.6',  'IT6–7',  'High'),
    ('Thread Grinding',            'Precision lead screws, taps',     'Helical thread',    '0.1–0.4',  'IT4–5',  'Very High'),
    ('Honing',                     'Engine cylinder bores',           'Bore (finish)',      '0.05–0.2', 'IT4–5',  'High')
  ) AS t(pt,a,wg,ra,it,rc);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Abrasive & Wheel Selection Guide',
    'Abrasive type selection by work material and grinding operation',
    '[{"name":"abrasive","type":"text","label":"Abrasive"},
      {"name":"grade_symbol","type":"text","label":"Symbol"},
      {"name":"hardness_hv","type":"text","label":"Hardness (HV)"},
      {"name":"best_for","type":"text","label":"Best For"},
      {"name":"avoid","type":"text","label":"Avoid"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('abrasive',a,'grade_symbol',gs,'hardness_hv',hv,'best_for',bf,'avoid',av),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Aluminium Oxide (White)',  'Al₂O₃ (WA)', '2000', 'Steel, HSS, general purpose',      'Aluminium, copper, plastics'),
    ('Silicon Carbide (Green)', 'SiC (GC)',    '2500', 'Cast iron, aluminium, non-ferrous', 'Steel (too aggressive)'),
    ('CBN',                     'CBN (B)',     '4500', 'Hardened steel, Inconel, HSS',      'Aluminium, copper, cast iron'),
    ('Diamond (Synthetic)',     'D',           '8000', 'Carbide, ceramics, glass, PCD',     'Steel (reacts chemically)'),
    ('Ceramic Alumina',         'SG/Cubitron', '2200', 'Aerospace alloys, Ti, stainless',   'Soft, gummy materials')
  ) AS t(a,gs,hv,bf,av);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Grinding Defects & Corrective Actions',
    'Common grinding defects, root causes, and corrective actions',
    '[{"name":"defect","type":"text","label":"Defect"},
      {"name":"root_cause","type":"text","label":"Root Cause"},
      {"name":"corrective_action","type":"text","label":"Corrective Action"}]'::jsonb,
    3, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('defect',d,'root_cause',rc,'corrective_action',ca),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Burning / thermal damage', 'Wheel too hard, speed too high, insufficient coolant', 'Reduce speed, softer wheel grade, increase coolant flow'),
    ('Chatter marks',            'Wheel imbalance, spindle vibration',                   'Balance wheel, reduce depth of cut, check spindle bearings'),
    ('Glazing (wheel loading)',  'Wheel too hard for material',                          'Dress more frequently; use softer grade; CBN for hard steel'),
    ('Feed lines',               'Feed rate too high relative to wheel width',           'Reduce table feed; increase overlap ratio to 3–5'),
    ('Dimensional scatter',      'Thermal growth, worn dress',                           'Allow warm-up; re-dress; use post-process gauging')
  ) AS t(d,rc,ca);
  END IF;
  tbl_id := NULL;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- TRIMMING / DEGATING — re-seed global template
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
  proc_id := _ensure_global_process('Trimming / Degating');

  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Degating Method Selection',
    'Gate removal method by material, gate type, and cosmetic requirement',
    '[{"name":"method","type":"text","label":"Degating Method"},
      {"name":"suitable_materials","type":"text","label":"Suitable Materials"},
      {"name":"gate_types","type":"text","label":"Gate Types"},
      {"name":"cycle_time_s","type":"text","label":"Cycle Time (s/part)"},
      {"name":"surface_quality","type":"text","label":"Surface Quality"},
      {"name":"automation","type":"text","label":"Automation Level"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('method',m,'suitable_materials',sm,'gate_types',gt,'cycle_time_s',ct,'surface_quality',sq,'automation',au),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Manual trimming (knife)',  'All thermoplastics',         'All gate types',      '5–30',   'Good',       'Manual'),
    ('Pneumatic clippers',       'All thermoplastics',         'Edge/sub gate',       '1–5',    'Good',       'Semi-auto'),
    ('Hydraulic press degating', 'All thermoplastics',         'Cold runner full shot','2–5',   'Good',       'Semi-auto / Auto'),
    ('Robotic degating',         'All materials',              'Any',                 '1–5',    'Excellent',  'Fully auto'),
    ('Cryogenic deflashing',     'Rubber, silicone, thermosets','Flash / parting line','60–300','Excellent',  'Batch auto'),
    ('Laser trim',               'Thin film, precision parts', 'Film gate, flash',    '5–20',   'Excellent',  'Fully auto')
  ) AS t(m,sm,gt,ct,sq,au);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Edge Break & Chamfer Standards',
    'Industry standard edge conditions and specification callout conventions',
    '[{"name":"standard","type":"text","label":"Standard"},
      {"name":"edge_condition","type":"text","label":"Edge Condition"},
      {"name":"break_size_mm","type":"text","label":"Break Size (mm)"},
      {"name":"application","type":"text","label":"Application"},
      {"name":"inspection","type":"text","label":"Inspection Method"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('standard',s,'edge_condition',ec,'break_size_mm',bs,'application',a,'inspection',ins),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('ISO 13715 / ASME Y14.5', '"Break sharp edges"', '0.1–0.4',  'General machined parts', 'Visual / touch'),
    ('ISO 13715',              'Chamfer e.g. C0.5',   '0.5 × 45°','Assembly clearance',     'Go/no-go gauge'),
    ('MIL-SPEC / Aerospace',   '"No burr" (0.05 max)','< 0.05',   'Aerospace manifolds',    'Tactile probe'),
    ('Medical (ISO 13485)',    'As drawn',             'As drawn',  'Implants, instruments',  'SEM or profilometer')
  ) AS t(s,ec,bs,a,ins);
  END IF;
  tbl_id := NULL;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- REACTION FOAM MOLDING — re-seed global template
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
  proc_id := _ensure_global_process('Reaction Foam Molding');

  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'RIM / RRIM Process Parameters',
    'Reaction injection moulding parameters by polyurethane system type',
    '[{"name":"system","type":"text","label":"PU System"},
      {"name":"mix_ratio","type":"text","label":"Mix Ratio (A:B)"},
      {"name":"mould_temp_c","type":"text","label":"Mould Temp (°C)"},
      {"name":"demould_time_min","type":"text","label":"Demould Time (min)"},
      {"name":"density_kg_m3","type":"text","label":"Density (kg/m³)"},
      {"name":"application","type":"text","label":"Application"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('system',s,'mix_ratio',mr,'mould_temp_c',mt,'demould_time_min',dt,'density_kg_m3',d,'application',a),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Flexible foam (MDI-polyol)',   '100:50',  '40–60', '3–8',  '30–80',    'Seating, cushioning'),
    ('Semi-rigid foam (RRIM)',       '100:60',  '50–70', '2–5',  '100–600',  'Automotive fascias, bumpers'),
    ('Rigid foam (PU structural)',   '100:110', '55–75', '3–8',  '100–400',  'Panels, enclosures'),
    ('Elastomeric (solid, no foam)', '100:90',  '50–70', '3–10', '1100–1200','Seals, wheels, rollers')
  ) AS t(s,mr,mt,dt,d,a);
  END IF;
  tbl_id := NULL;
END $$;

-- ── Clean up helper function ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS _ensure_global_process(TEXT);

-- ── Verification ──────────────────────────────────────────────────────────────
DO $$
DECLARE counts RECORD;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE p.process_name = 'Gear Cutting'          AND p.is_global) AS gear_cutting,
    COUNT(*) FILTER (WHERE p.process_name = 'Packing'               AND p.is_global) AS packing,
    COUNT(*) FILTER (WHERE p.process_name = 'Testing'               AND p.is_global) AS testing,
    COUNT(*) FILTER (WHERE p.process_name = 'Turning Center'        AND p.is_global) AS turning_center,
    COUNT(*) FILTER (WHERE p.process_name = 'Thermoforming'         AND p.is_global) AS thermoforming,
    COUNT(*) FILTER (WHERE p.process_name = 'Grinding'              AND p.is_global) AS grinding,
    COUNT(*) FILTER (WHERE p.process_name = 'Trimming / Degating'   AND p.is_global) AS trim_degate,
    COUNT(*) FILTER (WHERE p.process_name = 'Reaction Foam Molding' AND p.is_global) AS reaction_foam
  INTO counts
  FROM process_reference_tables prt
  JOIN processes p ON p.id = prt.process_id;

  RAISE NOTICE '=== Migration 170 — global reference table counts ===';
  RAISE NOTICE 'Gear Cutting:           %', counts.gear_cutting;
  RAISE NOTICE 'Packing:                %', counts.packing;
  RAISE NOTICE 'Testing:                %', counts.testing;
  RAISE NOTICE 'Turning Center:         %', counts.turning_center;
  RAISE NOTICE 'Thermoforming:          %', counts.thermoforming;
  RAISE NOTICE 'Grinding:               %', counts.grinding;
  RAISE NOTICE 'Trimming / Degating:    %', counts.trim_degate;
  RAISE NOTICE 'Reaction Foam Molding:  %', counts.reaction_foam;
  RAISE NOTICE '=====================================================';
END $$;
