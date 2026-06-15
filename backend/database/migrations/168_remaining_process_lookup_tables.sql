-- Migration 168: Lookup tables for remaining user processes with 0 reference tables
--
-- Targets exact process names found in the diagnostic query (is_global = false):
--   "Grinding"              — generic grinding overview (separate from Cylindrical/Surface/Gear)
--   "Structural foam molding" — structural foam / gas-assist moulding parameters
--   "Trimming / Degating"   — deburring, degating, and edge finishing guide
--
-- Safe to re-run: ON CONFLICT (process_id, table_name) DO NOTHING throughout.
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════════════════
-- GRINDING (generic process — overview tables applicable to all grinding types)
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name = 'Grinding'   -- exact match to avoid touching Cylindrical/Surface/Gear Grinding
  LIMIT 5
LOOP
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
    ('Cylindrical (External OD)', 'Shafts, pins, journals',         'Round OD',           '0.1–0.8',  'IT5–6',  'Medium'),
    ('Cylindrical (Internal ID)', 'Bores, bushings, liners',        'Round ID',           '0.1–0.8',  'IT5–6',  'Medium–High'),
    ('Centerless (Throughfeed)',   'Long round bars, rods, pins',    'Round, no centres',  '0.2–1.6',  'IT5–6',  'Low (high volume)'),
    ('Centerless (Infeed)',        'Tapers, formed profiles',        'Complex round',      '0.2–1.6',  'IT5–7',  'Low–Medium'),
    ('Surface (Reciprocating)',    'Flat surfaces, tool steel',      'Flat / prismatic',   '0.1–0.8',  'IT5–6',  'Medium'),
    ('Surface (Rotary)',           'Large flat faces, disc parts',   'Flat circular',      '0.2–1.6',  'IT6–7',  'Medium'),
    ('Gear (Profile)',             'External/internal spur & helical gears','Involute profile','0.4–0.8','DIN 5–6','High'),
    ('Gear (Generating / Worm)',   'High-accuracy gears, worm gears','Involute profile',   '0.2–0.4',  'DIN 4–5','Very High'),
    ('Creep Feed',                 'Turbine blades, broach profiles', 'Complex profile',   '0.4–1.6',  'IT6–7',  'High'),
    ('Thread Grinding',            'Precision lead screws, taps',    'Helical thread',     '0.1–0.4',  'IT4–5',  'Very High'),
    ('Jig Grinding',               'Precision holes, fixtures',      'Bore + face combo',  '0.05–0.4', 'IT4–5',  'Very High'),
    ('Honing',                     'Engine cylinder bores',          'Bore (finish)',       '0.05–0.2', 'IT4–5',  'High'),
    ('Superfinishing / Lapping',   'Bearing races, gauge blocks',    'Flat / round',       '0.01–0.1', 'IT3–4',  'Very High')
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
    ('Aluminium Oxide (White)',     'Al₂O₃ (WA)', '2000',    'Steel, HSS, general purpose',        'Aluminium, copper, plastics'),
    ('Aluminium Oxide (Brown)',     'Al₂O₃ (A)',  '2000',    'Structural steel, rough grinding',    'High-alloy, hardened steel'),
    ('Silicon Carbide (Green)',     'SiC (GC)',   '2500',    'Cast iron, aluminium, non-ferrous',   'Steel (too aggressive)'),
    ('Silicon Carbide (Black)',     'SiC (C)',    '2400',    'Cast iron, non-metallic, rubber',     'Hard steels'),
    ('CBN (Cubic Boron Nitride)',   'CBN (B)',    '4500',    'Hardened steel, Inconel, HSS tools',  'Aluminium, copper, cast iron'),
    ('Diamond (Synthetic)',         'D',          '8000',    'Carbide, ceramics, glass, PCD',       'Steel (reacts chemically)'),
    ('Ceramic Alumina',             'SG / Cubitron', '2200', 'Aerospace alloys, Ti, stainless',    'Soft, gummy materials'),
    ('Zirconia Alumina',            'ZA',         '2100',    'Stainless steel, heavy stock removal','Fine finish grinding')
  ) AS t(a,gs,hv,bf,av);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Coolant Selection Guide',
    'Grinding coolant type by material and operation — flow rate and concentration guidance',
    '[{"name":"coolant_type","type":"text","label":"Coolant Type"},
      {"name":"concentration_pct","type":"text","label":"Concentration (%)"},
      {"name":"flow_l_min","type":"text","label":"Flow Rate (L/min)"},
      {"name":"best_for","type":"text","label":"Best For"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    3, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('coolant_type',ct,'concentration_pct',c,'flow_l_min',fl,'best_for',bf,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Soluble oil (emulsion)',  '3–5%',   '20–60',   'General steel grinding',           'Most common; good lubrication'),
    ('Semi-synthetic',          '3–8%',   '20–60',   'Stainless, alloy steel',           'Better bio-stability than soluble'),
    ('Synthetic (chemical)',    '3–8%',   '30–80',   'Hard materials, CBN wheels',       'Highest cooling, low lubricity'),
    ('Neat cutting oil',        '100%',   '5–20',    'Thread grinding, gear grinding',   'Best surface finish, fire risk'),
    ('Dry / MQL',               'N/A',    'N/A',     'Cast iron, ceramics',              'CI generates abrasive paste — avoid flood'),
    ('High-pressure (HPC)',     '3–5%',   '80–200',  'Titanium, Inconel, deep cuts',     'Break chip, improve wheel life')
  ) AS t(ct,c,fl,bf,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Grinding Defects & Corrective Actions',
    'Common grinding defects, root causes, and corrective actions',
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
    ('Burning / thermal damage',  'Wheel too hard, speed too high, insufficient coolant', 'Reduce speed, use softer wheel grade, increase coolant flow, add sparkout passes'),
    ('Chatter marks',             'Wheel imbalance, spindle vibration, workpiece resonance', 'Balance wheel, reduce depth of cut, check spindle bearings, reduce work speed'),
    ('Spiral / helix marks',      'Wheel face not parallel to travel, taper on wheel', 'Re-dress wheel square; check wheel mount runout'),
    ('Feed lines',                'Feed rate too high relative to wheel width', 'Reduce table feed; increase overlap ratio Ud to 3–5'),
    ('Surface roughness too high','Grain too coarse, wheel too soft, dress too coarse', 'Use finer grain, harder grade, finer dress feed'),
    ('Workpiece taper',           'Centres not aligned, headstock tilt, deflection', 'Align centres; reduce infeed; use steady rest for long parts'),
    ('Glazing (wheel loading)',   'Wheel too hard for material, incorrect abrasive', 'Dress more frequently; use softer grade; CBN for hard steel'),
    ('Workpiece burn (white layer)','Aggressive infeed, poor coolant delivery', 'Reduce infeed 50%; direct coolant at grinding zone; check nozzle position'),
    ('Dimensional scatter',       'Thermal growth during grinding, worn dress', 'Allow warm-up; re-dress; use post-process gauging')
  ) AS t(d,rc,ca);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- STRUCTURAL FOAM MOULDING
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Structural%foam%','%Structural%Foam%Mold%','%Gas%Assist%'])
  LIMIT 5
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Structural Foam Process Parameters',
    'Process parameters and achievable properties for structural foam moulding by material',
    '[{"name":"material","type":"text","label":"Material"},
      {"name":"melt_temp_c","type":"text","label":"Melt Temp (°C)"},
      {"name":"mould_temp_c","type":"text","label":"Mould Temp (°C)"},
      {"name":"foaming_agent","type":"text","label":"Blowing Agent"},
      {"name":"density_reduction_pct","type":"text","label":"Density Reduction (%)"},
      {"name":"skin_thickness_mm","type":"text","label":"Solid Skin (mm)"}]'::jsonb,
    1, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('material',m,'melt_temp_c',mt,'mould_temp_c',mdt,'foaming_agent',fa,'density_reduction_pct',dr,'skin_thickness_mm',st),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('HDPE',           '200–240', '30–60',  'Chemical (azodicarbonamide)', '10–30%', '1.5–3.0'),
    ('PP Homopolymer',  '210–250', '30–60',  'Chemical (azodicarbonamide)', '10–25%', '1.5–3.0'),
    ('ABS',            '220–260', '40–70',  'Chemical or N₂ physical',    '10–20%', '2.0–3.5'),
    ('PC/ABS',         '240–270', '50–80',  'N₂ physical blowing',        '10–20%', '2.0–4.0'),
    ('PPO/Noryl',      '250–290', '60–90',  'Chemical or N₂',             '15–30%', '2.0–4.0'),
    ('Nylon PA6',      '230–270', '60–90',  'Chemical (endothermic)',      '10–20%', '2.0–3.5')
  ) AS t(m,mt,mdt,fa,dr,st);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Design Guidelines for Structural Foam',
    'Wall thickness, rib design, and surface quality considerations for structural foam parts',
    '[{"name":"parameter","type":"text","label":"Parameter"},
      {"name":"value","type":"text","label":"Guideline Value"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('parameter',p,'value',v,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Nominal wall thickness',          '4–12 mm',           'Thicker walls vs injection moulding — foam fills thick sections'),
    ('Solid skin thickness',            '1.5–4 mm',          'Determined by mould temp and fill speed'),
    ('Max wall-to-rib ratio',           '1:1 allowed',       'Unlike IM — thick ribs OK due to foamed core'),
    ('Draft angle (outer)',             '0.5°–1° min',       'Less springback than IM — lower draft acceptable'),
    ('Dimensional tolerance',           '±0.5–1.5 mm',       'Lower precision than IM due to foaming expansion'),
    ('Surface finish (as-moulded)',     'Ra 3.2–12.5 µm',    'Swirl marks typical — paint or texture required for cosmetic'),
    ('Weight reduction vs solid IM',    '10–30%',            'Density reduction; stiffness-to-weight ratio improves'),
    ('Minimum hole/core diameter',      '8 mm min',          'Smaller features may not foam uniformly'),
    ('Cycle time vs injection moulding','20–50% longer',     'Thicker walls + foaming time; multi-shot process possible'),
    ('Tooling cost vs IM',              '20–40% lower',      'Lower injection pressure — lower-cost aluminium tooling feasible')
  ) AS t(p,v,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Structural Foam vs Injection Moulding',
    'Process comparison: when to choose structural foam over standard injection moulding',
    '[{"name":"criterion","type":"text","label":"Selection Criterion"},
      {"name":"structural_foam","type":"text","label":"Structural Foam"},
      {"name":"injection_moulding","type":"text","label":"Injection Moulding"},
      {"name":"winner","type":"text","label":"Preferred"}]'::jsonb,
    3, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('criterion',c,'structural_foam',sf,'injection_moulding',im,'winner',w),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Part weight',             '10–30% lighter',            'Fully solid',                'Structural foam'),
    ('Wall thickness range',    '4–25 mm practical',         '0.8–6 mm',                  'Structural foam for thick walls'),
    ('Dimensional accuracy',    '±0.5–1.5 mm',              '±0.05–0.3 mm',              'Injection moulding'),
    ('Surface cosmetics',       'Swirl marks — paint needed','Class A finish possible',    'Injection moulding'),
    ('Tooling cost',            '20–40% lower',              'Higher (higher pressure)',   'Structural foam'),
    ('Injection pressure',      '500–1500 psi',              '5,000–30,000 psi',          'Structural foam'),
    ('Part size',               'Very large parts viable',   'Limited by clamp tonnage',  'Structural foam for large parts'),
    ('Structural stiffness',    'High (foam core + solid skin)','Solid — highest stiffness','Injection moulding (same thickness)'),
    ('Production volume',       '500–50,000 pa typical',     '10,000+ pa typical',        'Application dependent')
  ) AS t(c,sf,im,w);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- TRIMMING / DEGATING
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Trimming%','%Degating%','%Degate%','%Deburr%'])
  LIMIT 10
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Degating Method Selection',
    'Gate removal method selection by material, gate type, and cosmetic requirement',
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
    ('Manual break-off',          'Brittle materials (PS, PC, PA)', 'Sub/edge/sprue gate',  '2–10',   'Poor — requires trimming',  'Manual'),
    ('Manual trimming (knife)',    'All thermoplastics',             'All gate types',       '5–30',   'Good — clean cut',          'Manual'),
    ('Pneumatic clippers',         'All thermoplastics',             'Edge/sub gate',        '1–5',    'Good',                      'Semi-auto'),
    ('Hydraulic press degating',   'All thermoplastics, thermosets', 'Cold runner full shot','2–5',    'Good — repeatable',         'Semi-auto / Auto'),
    ('Robotic degating',           'All materials',                  'Any',                  '1–5',    'Excellent — consistent',    'Fully auto'),
    ('Ultrasonic degating',        'Brittle: PS, ABS, PC',           'Any',                  '1–3',    'Excellent',                 'Auto'),
    ('Cryogenic deflashing',       'Rubber, silicone, thermosets',   'Flash / parting line', '60–300', 'Excellent — clean break',   'Batch auto'),
    ('Milling / CNC trim',         'Structural parts, thick gates',  'Sprue, fan gate',      '10–60',  'Excellent',                 'CNC auto'),
    ('Laser trim',                 'Thin film, precision parts',     'Film gate, flash',     '5–20',   'Excellent — no contact',    'Fully auto')
  ) AS t(m,sm,gt,ct,sq,au);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Deburring Method Guide',
    'Deburring method selection by material, burr type, and feature complexity',
    '[{"name":"method","type":"text","label":"Method"},
      {"name":"burr_types","type":"text","label":"Burr Types"},
      {"name":"materials","type":"text","label":"Materials"},
      {"name":"ra_improvement","type":"text","label":"Ra Improvement"},
      {"name":"throughput","type":"text","label":"Throughput"},
      {"name":"note","type":"text","label":"Note"}]'::jsonb,
    2, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('method',m,'burr_types',bt,'materials',mat,'ra_improvement',ra,'throughput',tp,'note',n),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('Manual filing/scraping',      'All types',            'All metals',              'Limited',        'Low',   'Labour intensive; skilled operator needed'),
    ('Hand-held pneumatic tools',   'Milled, turned burrs', 'All metals',              'Good',           'Low',   'Flexible; edge break'),
    ('Tumble/barrel finishing',     'Large volume small parts','Steel, Al, brass',     'Good Ra 0.4–1.6','High',  'Batch process; 20 min – 4 hr'),
    ('Vibratory finishing',         'Rollover & Poisson burrs','All metals, plastics', 'Good Ra 0.2–0.8','High',  'Gentler than tumble; complex parts OK'),
    ('Electrochemical (ECM)',       'Internal burrs',       'Conductive metals',       'Excellent',      'Med',   'Removes internal cross-hole burrs; no contact'),
    ('Thermal energy (TEM)',        'Internal complex burrs','Steel, SS, Al, Cu alloys','Excellent',     'Med',   'Gas explosion removes all burrs simultaneously'),
    ('Abrasive flow (AFM)',         'Internal passages',    'All metals',              'Excellent',      'Low',   'Hones and deburrs internal channels'),
    ('Waterjet / high-pressure',    'Light burrs, flash',   'Metals, plastics',        'Good',           'Med',   'Clean, no tooling contact; part washing included'),
    ('Robotic brushing',            'External machined',    'Steel, Al, stainless',    'Good',           'High',  'Consistent edge break; force-controlled'),
    ('Cryogenic blast',             'Polymer flash/burrs',  'Rubber, plastics only',   'Excellent',      'Med',   'Batch freeze + blast; no dimensional change')
  ) AS t(m,bt,mat,ra,tp,n);
  END IF;
  tbl_id := NULL;

  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'Edge Break & Chamfer Standards',
    'Industry standard edge conditions, break sizes, and specification callout conventions',
    '[{"name":"standard","type":"text","label":"Standard / Specification"},
      {"name":"edge_condition","type":"text","label":"Edge Condition"},
      {"name":"break_size_mm","type":"text","label":"Break Size (mm)"},
      {"name":"application","type":"text","label":"Application"},
      {"name":"inspection","type":"text","label":"Inspection Method"}]'::jsonb,
    3, true)
  ON CONFLICT (process_id, table_name) DO NOTHING RETURNING id INTO tbl_id;

  IF tbl_id IS NOT NULL THEN
  INSERT INTO process_table_rows (table_id, row_data, row_order)
  SELECT tbl_id,
    jsonb_build_object('standard',s,'edge_condition',ec,'break_size_mm',bs,'application',a,'inspection',ins),
    ROW_NUMBER() OVER ()
  FROM (VALUES
    ('ISO 13715 / ASME Y14.5', '"Break sharp edges"',      '0.1–0.4',    'General machined parts, handling safety', 'Visual / touch'),
    ('ISO 13715',              'Chamfer e.g. C0.5',         '0.5 × 45°', 'Assembly clearance, sealing faces',      'Go/no-go gauge or CMM'),
    ('ISO 13715',              'Radius e.g. R0.3',          '0.3 R',     'Fatigue-critical features',              'Profile gauge or CMM'),
    ('MIL-SPEC / Aerospace',   '"No burr" (0.05 mm max)',   '< 0.05',    'Aerospace, hydraulic manifolds',         'Tactile probe, backlit inspection'),
    ('Automotive (VDA)',        'E4 edge class',             '0.1–0.5',   'Automotive body and powertrain',         'Edge break tester / CMM'),
    ('Medical (ISO 13485)',     'Radius or chamfer specified','As drawn',  'Surgical instruments, implants',         'SEM or profilometer'),
    ('No callout (standard)',   'Break sharp edges 0.2–0.5', '0.2–0.5',  'General commercial parts',               'Visual')
  ) AS t(s,ec,bs,a,ins);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- REACTION FOAM MOULDING (if it exists)
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE proc_id UUID; tbl_id UUID;
BEGIN
FOR proc_id IN
  SELECT id FROM processes
  WHERE process_name ILIKE ANY(ARRAY['%Reaction%Foam%','%RIM%','%RRIM%','%Polyurethane%Foam%'])
  LIMIT 5
LOOP
  tbl_id := NULL;
  INSERT INTO process_reference_tables
    (process_id, table_name, table_description, column_definitions, display_order, is_editable)
  VALUES (proc_id, 'RIM / RRIM Process Parameters',
    'Reaction injection moulding process parameters by polyurethane system type',
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
    ('Flexible foam (MDI-polyol)',     '100:50', '40–60',  '3–8',  '30–80',   'Seating, cushioning'),
    ('Semi-rigid foam (RRIM)',         '100:60', '50–70',  '2–5',  '100–600', 'Automotive fascias, bumpers'),
    ('Rigid foam (PU structural)',     '100:110','55–75',  '3–8',  '100–400', 'Panels, enclosures, large housings'),
    ('Elastomeric (solid, no foam)',   '100:90', '50–70',  '3–10', '1100–1200','Seals, wheels, rollers'),
    ('Glass-reinforced (RRIM, 20%)',   '100:70', '55–70',  '2–4',  '800–1100','Structural automotive, Class A panels')
  ) AS t(s,mr,mt,dt,d,a);
  END IF;
  tbl_id := NULL;

END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE grinding_tables INTEGER; foam_tables INTEGER; trim_tables INTEGER;
BEGIN
  SELECT COUNT(*) INTO grinding_tables
  FROM process_reference_tables rt JOIN processes p ON p.id = rt.process_id
  WHERE p.process_name = 'Grinding';

  SELECT COUNT(*) INTO foam_tables
  FROM process_reference_tables rt JOIN processes p ON p.id = rt.process_id
  WHERE p.process_name ILIKE '%Structural%foam%' OR p.process_name ILIKE '%Reaction%Foam%';

  SELECT COUNT(*) INTO trim_tables
  FROM process_reference_tables rt JOIN processes p ON p.id = rt.process_id
  WHERE p.process_name ILIKE '%Trimming%' OR p.process_name ILIKE '%Degating%';

  RAISE NOTICE '=== Migration 168 ===';
  RAISE NOTICE 'Grinding tables:              %', grinding_tables;
  RAISE NOTICE 'Structural/Reaction Foam:     %', foam_tables;
  RAISE NOTICE 'Trimming/Degating tables:     %', trim_tables;
  RAISE NOTICE '====================';
END $$;
