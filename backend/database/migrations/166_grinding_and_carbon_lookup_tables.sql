-- Migration 166: Grinding Lookup Tables + Carbon Footprint Reference Tables
--
-- Fixes two gaps visible in the UI:
--
--   1. Grinding processes (Cylindrical, Centerless, Surface, Gear) show
--      "No tables yet" because migration 161 may not have matched their
--      exact names. This migration uses broader ILIKE patterns and also
--      inserts the processes if they are missing entirely.
--
--   2. sustainability_factors (migration 163) has no UI entry point.
--      This migration seeds a "Carbon Footprint" reference table for
--      every major process so CO2 data appears directly in the existing
--      process lookup table UI — no backend or frontend changes required.
--
-- Safe to re-run: unique constraint on (process_id, table_name) prevents
-- duplicate tables; ON CONFLICT DO NOTHING prevents duplicate rows.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Idempotency guard ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_proc_ref_table_name'
      AND conrelid = 'process_reference_tables'::regclass
  ) THEN
    ALTER TABLE process_reference_tables
      ADD CONSTRAINT uq_proc_ref_table_name UNIQUE (process_id, table_name);
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1: ENSURE GRINDING PROCESSES EXIST
-- ══════════════════════════════════════════════════════════════════════════════
-- Insert only if the process doesn't already exist (matched by name).
-- Adjust process_category / process_group column names if your schema differs.

DO $$
BEGIN
  -- Cylindrical Grinding
  IF NOT EXISTS (SELECT 1 FROM processes WHERE process_name ILIKE '%Cylindrical%Grind%') THEN
    INSERT INTO processes (process_name, is_global)
    VALUES ('Cylindrical Grinding', TRUE);
  ELSE
    UPDATE processes SET is_global = TRUE
    WHERE process_name ILIKE '%Cylindrical%Grind%';
  END IF;

  -- Centerless Grinding
  IF NOT EXISTS (SELECT 1 FROM processes WHERE process_name ILIKE '%Centerless%Grind%') THEN
    INSERT INTO processes (process_name, is_global)
    VALUES ('Centerless Grinding', TRUE);
  ELSE
    UPDATE processes SET is_global = TRUE
    WHERE process_name ILIKE '%Centerless%Grind%';
  END IF;

  -- Surface Grinding
  IF NOT EXISTS (SELECT 1 FROM processes WHERE process_name ILIKE '%Surface%Grind%') THEN
    INSERT INTO processes (process_name, is_global)
    VALUES ('Surface Grinding', TRUE);
  ELSE
    UPDATE processes SET is_global = TRUE
    WHERE process_name ILIKE '%Surface%Grind%';
  END IF;

  -- Gear Grinding
  IF NOT EXISTS (SELECT 1 FROM processes WHERE process_name ILIKE '%Gear%Grind%') THEN
    INSERT INTO processes (process_name, is_global)
    VALUES ('Gear Grinding', TRUE);
  ELSE
    UPDATE processes SET is_global = TRUE
    WHERE process_name ILIKE '%Gear%Grind%';
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2: CYLINDRICAL GRINDING LOOKUP TABLES
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  proc_id UUID;
  tbl_id  UUID;
BEGIN
  FOR proc_id IN
    SELECT id FROM processes
    WHERE process_name ILIKE ANY(ARRAY['%Cylindrical%Grind%','%External%Grind%','%OD Grind%'])
    LIMIT 5
  LOOP

    -- Table 1: Grinding Wheel Parameters
    INSERT INTO process_reference_tables
      (process_id, table_name, table_description, column_definitions, display_order, is_editable)
    VALUES (proc_id,
      'Grinding Wheel Selection',
      'Wheel specification guide by work material — abrasive, grain size, hardness grade, bond',
      '[{"name":"work_material","type":"text","label":"Work Material"},
        {"name":"abrasive","type":"text","label":"Abrasive Type"},
        {"name":"grain_size","type":"text","label":"Grain Size (FEPA)"},
        {"name":"hardness","type":"text","label":"Hardness Grade"},
        {"name":"bond","type":"text","label":"Bond Type"},
        {"name":"structure","type":"text","label":"Structure No."}]'::jsonb,
      1, true)
    ON CONFLICT (process_id, table_name) DO NOTHING
    RETURNING id INTO tbl_id;

    IF tbl_id IS NOT NULL THEN
      INSERT INTO process_table_rows (table_id, row_data, row_order)
      SELECT tbl_id,
        jsonb_build_object('work_material',m,'abrasive',a,'grain_size',g,'hardness',h,'bond',b,'structure',s),
        ROW_NUMBER() OVER ()
      FROM (VALUES
        ('Mild Steel (annealed)',          'Al₂O₃ (White)',  '46',  'K', 'Vitrified (V)', '6'),
        ('Alloy Steel (hardened 50+ HRC)', 'Al₂O₃ (White)',  '46',  'H', 'Vitrified (V)', '5'),
        ('Alloy Steel (hardened 50+ HRC)', 'CBN (B)',        '46',  'H', 'Vitrified (V)', '5'),
        ('Stainless Steel SS304',          'Al₂O₃ (White)',  '60',  'J', 'Vitrified (V)', '6'),
        ('Titanium Ti-6Al-4V',             'CBN (B)',        '46',  'G', 'Vitrified (V)', '5'),
        ('Cast Iron (Grey)',               'SiC (Green)',    '46',  'K', 'Vitrified (V)', '6'),
        ('Aluminium Alloys',               'SiC (Green)',    '60',  'J', 'Resinoid (B)',  '7'),
        ('Cemented Carbide',               'Diamond (D)',    '46',  'N', 'Resinoid (B)',  '5'),
        ('Tool Steel (annealed)',          'Al₂O₃ (Pink)',   '46',  'K', 'Vitrified (V)', '6'),
        ('Tool Steel (hardened D2/H13)',   'CBN (B)',        '80',  'H', 'Vitrified (V)', '4'),
        ('Inconel 718',                    'CBN (B)',        '46',  'G', 'Vitrified (V)', '5'),
        ('Copper / Brass',                 'Al₂O₃ (White)',  '80',  'J', 'Resinoid (B)',  '7')
      ) AS t(m,a,g,h,b,s);
    END IF;

    -- Reset tbl_id
    tbl_id := NULL;

    -- Table 2: Grinding Parameters
    INSERT INTO process_reference_tables
      (process_id, table_name, table_description, column_definitions, display_order, is_editable)
    VALUES (proc_id,
      'Cylindrical Grinding Parameters',
      'Recommended wheel speed, work speed, infeed, and sparkout by operation type',
      '[{"name":"operation","type":"text","label":"Operation"},
        {"name":"wheel_speed_ms","type":"number","label":"Wheel Speed (m/s)"},
        {"name":"work_speed_rpm","type":"number","label":"Work Speed (RPM)"},
        {"name":"infeed_mm_pass","type":"number","label":"Infeed (mm/pass)"},
        {"name":"sparkout_passes","type":"number","label":"Spark-out Passes"},
        {"name":"coolant","type":"text","label":"Coolant"}]'::jsonb,
      2, true)
    ON CONFLICT (process_id, table_name) DO NOTHING
    RETURNING id INTO tbl_id;

    IF tbl_id IS NOT NULL THEN
      INSERT INTO process_table_rows (table_id, row_data, row_order)
      SELECT tbl_id,
        jsonb_build_object('operation',op,'wheel_speed_ms',ws,'work_speed_rpm',wr,'infeed_mm_pass',inf,'sparkout_passes',sp,'coolant',c),
        ROW_NUMBER() OVER ()
      FROM (VALUES
        ('Rough OD Grind (steel)',          30, 200, 0.025, 2, 'Flood (soluble oil)'),
        ('Finish OD Grind (steel)',         35, 150, 0.005, 4, 'Flood (soluble oil)'),
        ('Fine OD Grind (hardened steel)',  45, 100, 0.002, 6, 'Flood (synthetic)'),
        ('CBN Rough Grind (hardened)',      80, 250, 0.010, 3, 'Flood (synthetic)'),
        ('CBN Finish Grind (hardened)',     80, 180, 0.003, 6, 'Flood (synthetic)'),
        ('Rough OD Grind (SS)',             25, 180, 0.020, 3, 'Flood (synthetic) — avoid chlorinated'),
        ('Finish OD Grind (Al)',            25, 300, 0.005, 2, 'Flood (soluble oil); check wheel loading'),
        ('ID Grinding (bore)',             25, 600, 0.005, 4, 'Flood — high coolant pressure for bore chip flush')
      ) AS t(op,ws,wr,inf,sp,c);
    END IF;

    tbl_id := NULL;

    -- Table 3: Surface Finish & Tolerance Achievable
    INSERT INTO process_reference_tables
      (process_id, table_name, table_description, column_definitions, display_order, is_editable)
    VALUES (proc_id,
      'Surface Finish & Tolerance Guide',
      'Achievable Ra and IT grade by cylindrical grinding operation',
      '[{"name":"operation","type":"text","label":"Operation"},
        {"name":"ra_min","type":"number","label":"Ra Min (µm)"},
        {"name":"ra_max","type":"number","label":"Ra Max (µm)"},
        {"name":"it_grade","type":"text","label":"IT Grade"},
        {"name":"roundness_mm","type":"number","label":"Roundness (mm)"},
        {"name":"note","type":"text","label":"Note"}]'::jsonb,
      3, true)
    ON CONFLICT (process_id, table_name) DO NOTHING
    RETURNING id INTO tbl_id;

    IF tbl_id IS NOT NULL THEN
      INSERT INTO process_table_rows (table_id, row_data, row_order)
      SELECT tbl_id,
        jsonb_build_object('operation',op,'ra_min',rmin,'ra_max',rmax,'it_grade',it,'roundness_mm',rnd,'note',n),
        ROW_NUMBER() OVER ()
      FROM (VALUES
        ('Rough Cylindrical Grind',   0.8,  3.2, 'IT9-10',   0.010, 'Stock removal; pre-finish op'),
        ('Finish Cylindrical Grind',  0.4,  0.8, 'IT7-8',    0.005, 'Standard precision shaft'),
        ('Fine Cylindrical Grind',    0.1,  0.4, 'IT5-6',    0.002, 'Bearing journals, sealing surfaces'),
        ('Ultra-fine (CBN)',          0.05, 0.1, 'IT4-5',    0.001, 'Gauge pins, precision spindles'),
        ('ID Grinding (bore)',        0.2,  0.8, 'IT6-7',    0.003, 'Bearing housings, bushings'),
        ('Taper Grinding',            0.4,  1.6, 'IT7-8',    0.005, 'Morse taper, toolholder tapers')
      ) AS t(op,rmin,rmax,it,rnd,n);
    END IF;

    tbl_id := NULL;

    -- Table 4: Dressing Parameters
    INSERT INTO process_reference_tables
      (process_id, table_name, table_description, column_definitions, display_order, is_editable)
    VALUES (proc_id,
      'Wheel Dressing Parameters',
      'Dressing feed, overlap ratio and interval by operation type',
      '[{"name":"operation","type":"text","label":"Operation"},
        {"name":"dress_depth_mm","type":"number","label":"Dress Depth (mm)"},
        {"name":"dress_feed_mmrev","type":"number","label":"Dress Feed (mm/rev)"},
        {"name":"overlap_ratio","type":"number","label":"Overlap Ratio Ud"},
        {"name":"dress_interval_parts","type":"number","label":"Dress Interval (parts)"},
        {"name":"dresser_type","type":"text","label":"Dresser Type"}]'::jsonb,
      4, true)
    ON CONFLICT (process_id, table_name) DO NOTHING
    RETURNING id INTO tbl_id;

    IF tbl_id IS NOT NULL THEN
      INSERT INTO process_table_rows (table_id, row_data, row_order)
      SELECT tbl_id,
        jsonb_build_object('operation',op,'dress_depth_mm',dd,'dress_feed_mmrev',df,'overlap_ratio',ud,'dress_interval_parts',di,'dresser_type',dt),
        ROW_NUMBER() OVER ()
      FROM (VALUES
        ('Rough grinding',      0.025, 0.40, 2, 20,  'Single-point diamond'),
        ('Finish grinding',     0.010, 0.20, 4, 50,  'Single-point diamond'),
        ('Fine / mirror',       0.005, 0.08, 8, 100, 'CVD diamond roll or blade'),
        ('CBN wheel (V-bond)',  0.010, 0.15, 4, 500, 'Rotary diamond roll'),
        ('Alumina rough',       0.025, 0.30, 3, 15,  'Single-point or cluster')
      ) AS t(op,dd,df,ud,di,dt);
    END IF;

    tbl_id := NULL;

  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3: CENTERLESS GRINDING LOOKUP TABLES
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  proc_id UUID;
  tbl_id  UUID;
BEGIN
  FOR proc_id IN
    SELECT id FROM processes WHERE process_name ILIKE '%Centerless%' LIMIT 5
  LOOP

    INSERT INTO process_reference_tables
      (process_id, table_name, table_description, column_definitions, display_order, is_editable)
    VALUES (proc_id,
      'Throughfeed Rate Reference',
      'Throughfeed speed and regulating wheel angle by diameter and material',
      '[{"name":"workpiece_dia_mm","type":"text","label":"Workpiece Ø (mm)"},
        {"name":"material","type":"text","label":"Material"},
        {"name":"reg_wheel_angle_deg","type":"number","label":"Reg. Wheel Angle (°)"},
        {"name":"throughfeed_m_min","type":"number","label":"Throughfeed (m/min)"},
        {"name":"stock_removal_mm","type":"number","label":"Stock Removal (mm dia)"},
        {"name":"note","type":"text","label":"Note"}]'::jsonb,
      1, true)
    ON CONFLICT (process_id, table_name) DO NOTHING
    RETURNING id INTO tbl_id;

    IF tbl_id IS NOT NULL THEN
      INSERT INTO process_table_rows (table_id, row_data, row_order)
      SELECT tbl_id,
        jsonb_build_object('workpiece_dia_mm',d,'material',m,'reg_wheel_angle_deg',a,'throughfeed_m_min',tf,'stock_removal_mm',sr,'note',n),
        ROW_NUMBER() OVER ()
      FROM (VALUES
        ('3-10',   'Steel (soft)',         2.5, 1.50, 0.20, 'High throughfeed; light stock'),
        ('3-10',   'Steel (hardened)',     2.0, 0.80, 0.10, 'Reduce angle for hardened'),
        ('10-25',  'Steel (soft)',         3.0, 0.90, 0.30, NULL),
        ('10-25',  'Steel (hardened)',     2.5, 0.50, 0.15, NULL),
        ('25-50',  'Steel (soft)',         3.5, 0.60, 0.40, NULL),
        ('25-50',  'Stainless Steel',      2.5, 0.30, 0.20, 'Lower feed; work-hardening risk'),
        ('5-20',   'Aluminium',            4.0, 1.80, 0.25, 'Higher angle; light cuts'),
        ('3-15',   'Carbide rods',         1.5, 0.20, 0.05, 'Diamond wheel; very low stock removal')
      ) AS t(d,m,a,tf,sr,n);
    END IF;

    tbl_id := NULL;

    INSERT INTO process_reference_tables
      (process_id, table_name, table_description, column_definitions, display_order, is_editable)
    VALUES (proc_id,
      'Centerless Grinding Tolerances',
      'Diameter and roundness tolerances achievable by operation type',
      '[{"name":"operation","type":"text","label":"Operation"},
        {"name":"diameter_tolerance_mm","type":"text","label":"Diameter Tolerance (mm)"},
        {"name":"roundness_mm","type":"number","label":"Roundness (mm)"},
        {"name":"ra_um","type":"text","label":"Ra (µm)"},
        {"name":"typical_application","type":"text","label":"Typical Application"}]'::jsonb,
      2, true)
    ON CONFLICT (process_id, table_name) DO NOTHING
    RETURNING id INTO tbl_id;

    IF tbl_id IS NOT NULL THEN
      INSERT INTO process_table_rows (table_id, row_data, row_order)
      SELECT tbl_id,
        jsonb_build_object('operation',op,'diameter_tolerance_mm',dt,'roundness_mm',rnd,'ra_um',ra,'typical_application',app),
        ROW_NUMBER() OVER ()
      FROM (VALUES
        ('Rough throughfeed',       '±0.025',  0.008, '0.4-0.8',  'Bar stock sizing, fasteners'),
        ('Finish throughfeed',      '±0.008',  0.003, '0.2-0.4',  'Precision shafts, pins'),
        ('Fine throughfeed (CBN)',  '±0.003',  0.001, '0.05-0.2', 'Bearing needles, gauge pins'),
        ('Infeed (plunge)',         '±0.005',  0.002, '0.1-0.4',  'Stepped/profiled components'),
        ('Fine infeed (CBN)',       '±0.002',  0.001, '0.05-0.1', 'Precision hydraulic spools')
      ) AS t(op,dt,rnd,ra,app);
    END IF;

    tbl_id := NULL;

  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 4: SURFACE GRINDING LOOKUP TABLES
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  proc_id UUID;
  tbl_id  UUID;
BEGIN
  FOR proc_id IN
    SELECT id FROM processes WHERE process_name ILIKE '%Surface%Grind%' LIMIT 5
  LOOP

    INSERT INTO process_reference_tables
      (process_id, table_name, table_description, column_definitions, display_order, is_editable)
    VALUES (proc_id,
      'Surface Grinding Parameters',
      'Table speed, crossfeed, and depth of cut by material and operation',
      '[{"name":"material","type":"text","label":"Work Material"},
        {"name":"operation","type":"text","label":"Operation"},
        {"name":"wheel_speed_ms","type":"number","label":"Wheel Speed (m/s)"},
        {"name":"table_speed_m_min","type":"number","label":"Table Speed (m/min)"},
        {"name":"crossfeed_mm_pass","type":"number","label":"Crossfeed (mm/pass)"},
        {"name":"depth_cut_mm","type":"number","label":"Depth of Cut (mm)"}]'::jsonb,
      1, true)
    ON CONFLICT (process_id, table_name) DO NOTHING
    RETURNING id INTO tbl_id;

    IF tbl_id IS NOT NULL THEN
      INSERT INTO process_table_rows (table_id, row_data, row_order)
      SELECT tbl_id,
        jsonb_build_object('material',m,'operation',op,'wheel_speed_ms',ws,'table_speed_m_min',ts,'crossfeed_mm_pass',cf,'depth_cut_mm',dc),
        ROW_NUMBER() OVER ()
      FROM (VALUES
        ('Mild Steel',        'Rough',           30, 15, 0.5,  0.025),
        ('Mild Steel',        'Finish',          35, 10, 0.3,  0.005),
        ('Hardened Steel',    'Rough',           30, 12, 0.4,  0.015),
        ('Hardened Steel',    'Finish (Al₂O₃)', 35,  8, 0.2,  0.005),
        ('Hardened Steel',    'Finish (CBN)',    80, 15, 0.5,  0.003),
        ('Stainless Steel',   'Rough',           25, 10, 0.3,  0.020),
        ('Stainless Steel',   'Finish',          30,  8, 0.2,  0.005),
        ('Tool Steel (D2)',   'Finish (CBN)',    80, 12, 0.4,  0.003),
        ('Aluminium',         'Finish (SiC)',    25, 20, 0.5,  0.010),
        ('Cast Iron',         'Rough',           25, 18, 0.6,  0.025),
        ('Cast Iron',         'Finish',          30, 12, 0.4,  0.008)
      ) AS t(m,op,ws,ts,cf,dc);
    END IF;

    tbl_id := NULL;

    INSERT INTO process_reference_tables
      (process_id, table_name, table_description, column_definitions, display_order, is_editable)
    VALUES (proc_id,
      'Surface Finish & Flatness Guide',
      'Achievable Ra and flatness by surface grinding operation',
      '[{"name":"operation","type":"text","label":"Operation"},
        {"name":"ra_min","type":"number","label":"Ra Min (µm)"},
        {"name":"ra_max","type":"number","label":"Ra Max (µm)"},
        {"name":"flatness_mm_per_300mm","type":"number","label":"Flatness (mm/300mm)"},
        {"name":"parallelism_mm","type":"number","label":"Parallelism (mm)"},
        {"name":"note","type":"text","label":"Note"}]'::jsonb,
      2, true)
    ON CONFLICT (process_id, table_name) DO NOTHING
    RETURNING id INTO tbl_id;

    IF tbl_id IS NOT NULL THEN
      INSERT INTO process_table_rows (table_id, row_data, row_order)
      SELECT tbl_id,
        jsonb_build_object('operation',op,'ra_min',rmin,'ra_max',rmax,'flatness_mm_per_300mm',fl,'parallelism_mm',par,'note',n),
        ROW_NUMBER() OVER ()
      FROM (VALUES
        ('Rough Surface Grind',          1.6,  3.2, 0.020, 0.015, 'Stock removal only'),
        ('Finish Surface Grind (Al₂O₃)', 0.4,  0.8, 0.008, 0.006, 'Standard toolroom quality'),
        ('Fine Surface Grind (Al₂O₃)',   0.1,  0.4, 0.004, 0.003, 'Die plates, precision fixtures'),
        ('Ultra-fine (CBN/Diamond)',      0.025,0.1, 0.002, 0.001, 'Gauge blocks, lapping plates'),
        ('Creep-feed Grinding',          0.8,  3.2, 0.010, 0.008, 'Formed profiles; turbine slots')
      ) AS t(op,rmin,rmax,fl,par,n);
    END IF;

    tbl_id := NULL;

    INSERT INTO process_reference_tables
      (process_id, table_name, table_description, column_definitions, display_order, is_editable)
    VALUES (proc_id,
      'Magnetic Chuck & Fixturing Guide',
      'Workholding recommendations by part geometry and material',
      '[{"name":"part_type","type":"text","label":"Part Type"},
        {"name":"material","type":"text","label":"Material"},
        {"name":"fixturing_method","type":"text","label":"Fixturing Method"},
        {"name":"min_surface_area_cm2","type":"number","label":"Min Holding Area (cm²)"},
        {"name":"caution","type":"text","label":"Caution"}]'::jsonb,
      3, true)
    ON CONFLICT (process_id, table_name) DO NOTHING
    RETURNING id INTO tbl_id;

    IF tbl_id IS NOT NULL THEN
      INSERT INTO process_table_rows (table_id, row_data, row_order)
      SELECT tbl_id,
        jsonb_build_object('part_type',pt,'material',m,'fixturing_method',fx,'min_surface_area_cm2',area,'caution',c),
        ROW_NUMBER() OVER ()
      FROM (VALUES
        ('Flat plate >5mm thick',      'Ferrous',       'Electromagnetic chuck',       10, 'Degauss after grinding'),
        ('Flat plate <3mm thin',       'Ferrous',       'Fine-pole permanent mag chuck', 5, 'Check bow before/after; thermal distortion risk'),
        ('Small / complex shape',      'Ferrous',       'Sine chuck + clamps',         10, 'Indicate datum face before clamping'),
        ('Non-magnetic (Al, SS, Cu)',  'Non-ferrous',   'Vacuum chuck or vise',        15, 'Vacuum holds flat parts; avoid side grip force'),
        ('Hardened tool steel plate',  'Ferrous',       'Permanent mag chuck',         12, 'Pre-stress relieve if >60 HRC — distortion risk'),
        ('Thin shims <1mm',            'Ferrous/Non',   'Double-sided tape + steel backing plate', 5, 'Tape thermal limit ~80°C; flood cool essential')
      ) AS t(pt,m,fx,area,c);
    END IF;

    tbl_id := NULL;

  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 5: GEAR GRINDING LOOKUP TABLES
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  proc_id UUID;
  tbl_id  UUID;
BEGIN
  FOR proc_id IN
    SELECT id FROM processes WHERE process_name ILIKE '%Gear%Grind%' LIMIT 5
  LOOP

    INSERT INTO process_reference_tables
      (process_id, table_name, table_description, column_definitions, display_order, is_editable)
    VALUES (proc_id,
      'Gear Grinding Parameters by Module',
      'Wheel speed, feed and stock allowance by module and tooth geometry',
      '[{"name":"module_mn","type":"text","label":"Module (mn)"},
        {"name":"wheel_speed_ms","type":"number","label":"Wheel Speed (m/s)"},
        {"name":"axial_feed_mm_rev","type":"number","label":"Axial Feed (mm/rev)"},
        {"name":"radial_stock_mm","type":"number","label":"Stock per Flank (mm)"},
        {"name":"roughing_passes","type":"number","label":"Roughing Passes"},
        {"name":"finishing_passes","type":"number","label":"Finishing Passes"}]'::jsonb,
      1, true)
    ON CONFLICT (process_id, table_name) DO NOTHING
    RETURNING id INTO tbl_id;

    IF tbl_id IS NOT NULL THEN
      INSERT INTO process_table_rows (table_id, row_data, row_order)
      SELECT tbl_id,
        jsonb_build_object('module_mn',mn,'wheel_speed_ms',ws,'axial_feed_mm_rev',af,'radial_stock_mm',rs,'roughing_passes',rp,'finishing_passes',fp),
        ROW_NUMBER() OVER ()
      FROM (VALUES
        ('1.0 - 1.5', 45, 0.15, 0.10, 2, 2),
        ('2.0 - 2.5', 45, 0.20, 0.12, 2, 2),
        ('3.0 - 4.0', 45, 0.25, 0.15, 3, 2),
        ('5.0 - 6.0', 50, 0.30, 0.18, 3, 3),
        ('7.0 - 8.0', 50, 0.35, 0.20, 4, 3),
        ('10 - 12',   55, 0.40, 0.25, 4, 3),
        ('14 - 16',   55, 0.45, 0.30, 5, 4)
      ) AS t(mn,ws,af,rs,rp,fp);
    END IF;

    tbl_id := NULL;

    INSERT INTO process_reference_tables
      (process_id, table_name, table_description, column_definitions, display_order, is_editable)
    VALUES (proc_id,
      'Gear Accuracy Grade Reference (DIN 3962)',
      'Achievable DIN/ISO accuracy grades by gear grinding method and module',
      '[{"name":"grinding_method","type":"text","label":"Grinding Method"},
        {"name":"module_range","type":"text","label":"Module Range"},
        {"name":"din_grade","type":"text","label":"DIN 3962 Grade"},
        {"name":"pitch_error_um","type":"number","label":"Pitch Error (µm)"},
        {"name":"profile_error_um","type":"number","label":"Profile Error (µm)"},
        {"name":"typical_application","type":"text","label":"Typical Application"}]'::jsonb,
      2, true)
    ON CONFLICT (process_id, table_name) DO NOTHING
    RETURNING id INTO tbl_id;

    IF tbl_id IS NOT NULL THEN
      INSERT INTO process_table_rows (table_id, row_data, row_order)
      SELECT tbl_id,
        jsonb_build_object('grinding_method',gm,'module_range',mr,'din_grade',dg,'pitch_error_um',pe,'profile_error_um',pfe,'typical_application',app),
        ROW_NUMBER() OVER ()
      FROM (VALUES
        ('Continuous Generating (Reishauer)', '1-6',   'DIN 4-5',  4,  4,  'Automotive transmission gears (high volume)'),
        ('Continuous Generating (Reishauer)', '1-6',   'DIN 3',    2,  2,  'Precision automotive / racing gearboxes'),
        ('Profile Grinding (form wheel)',     '3-16',  'DIN 5-6',  8,  6,  'Industrial gearboxes, wind turbines'),
        ('Profile Grinding (form wheel)',     '3-16',  'DIN 4',    4,  4,  'Aerospace gearboxes, servo drives'),
        ('Bevel Gear Grinding (Gleason)',     '2-10',  'DIN 5-6',  8,  6,  'Differential, axle gears'),
        ('Internal Gear Grinding',           '2-6',   'DIN 5-7', 12,  8,  'Planetary carriers, ring gears'),
        ('Worm Gear Grinding',               '1-5',   'DIN 5-6',  6,  5,  'Machine tool spindles, actuators')
      ) AS t(gm,mr,dg,pe,pfe,app);
    END IF;

    tbl_id := NULL;

    INSERT INTO process_reference_tables
      (process_id, table_name, table_description, column_definitions, display_order, is_editable)
    VALUES (proc_id,
      'Surface Finish Requirements by Gear Application',
      'Tooth flank Ra targets and hardness ranges by application type',
      '[{"name":"application","type":"text","label":"Application"},
        {"name":"ra_flank_um","type":"text","label":"Flank Ra (µm)"},
        {"name":"hardness_case_hrc","type":"text","label":"Case Hardness (HRC)"},
        {"name":"case_depth_mm","type":"text","label":"Case Depth (mm)"},
        {"name":"din_grade","type":"text","label":"Min DIN Grade"},
        {"name":"note","type":"text","label":"Note"}]'::jsonb,
      3, true)
    ON CONFLICT (process_id, table_name) DO NOTHING
    RETURNING id INTO tbl_id;

    IF tbl_id IS NOT NULL THEN
      INSERT INTO process_table_rows (table_id, row_data, row_order)
      SELECT tbl_id,
        jsonb_build_object('application',app,'ra_flank_um',ra,'hardness_case_hrc',hrd,'case_depth_mm',cd,'din_grade',dg,'note',n),
        ROW_NUMBER() OVER ()
      FROM (VALUES
        ('Passenger car transmission',  '0.4-0.8',  '58-62', '0.5-0.9', 'DIN 5', 'Ground + superfinish for NVH'),
        ('Truck / heavy vehicle',       '0.8-1.6',  '58-62', '0.8-1.2', 'DIN 6', NULL),
        ('Aerospace gearbox',           '0.2-0.4',  '58-62', '0.5-0.9', 'DIN 4', 'AGMA 13-15 equivalent'),
        ('Wind turbine main gearbox',   '0.4-0.8',  '58-62', '1.0-2.0', 'DIN 5', 'ISO 1328 Class 5; ground + hone'),
        ('Industrial gearbox (general)','1.6-3.2',  '55-60', '0.8-1.5', 'DIN 6-7','Hobbed + ground only for high loads'),
        ('Racing / motorsport',         '0.1-0.2',  '60-64', '0.4-0.8', 'DIN 3', 'Isotropic superfinishing after grind'),
        ('Machine tool spindle',        '0.2-0.4',  '58-62', '0.5-0.8', 'DIN 4', 'Low backlash; thermal stability critical')
      ) AS t(app,ra,hrd,cd,dg,n);
    END IF;

    tbl_id := NULL;

  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 6: CARBON FOOTPRINT REFERENCE TABLE — ALL MAJOR PROCESSES
-- ══════════════════════════════════════════════════════════════════════════════
-- Seeds a "Carbon Footprint" lookup table for every process so CO2 data
-- appears directly in the process UI. No backend or frontend code changes needed.

DO $$
DECLARE
  proc_id  UUID;
  tbl_id   UUID;
  proc_nm  TEXT;
  kwh_kg   NUMERIC;
  co2_india   NUMERIC;
  co2_china   NUMERIC;
  co2_europe  NUMERIC;
  co2_uk      NUMERIC;
  co2_global  NUMERIC;
BEGIN
  -- Process energy map: (ilike_pattern, kWh_per_kg_processed)
  -- CO2 = kWh × grid factor (India=0.708, China=0.558, EU=0.233, UK=0.207, Global=0.450)
  FOR proc_id, proc_nm, kwh_kg IN
    SELECT p.id, p.process_name,
      CASE
        WHEN p.process_name ILIKE '%Injection Mould%'         THEN 1.20
        WHEN p.process_name ILIKE '%Rubber Mould%'            THEN 1.50
        WHEN p.process_name ILIKE '%Thermoform%'              THEN 1.80
        WHEN p.process_name ILIKE '%Blow Mould%'              THEN 1.40
        WHEN p.process_name ILIKE '%Extrusion%'               THEN 0.90
        WHEN p.process_name ILIKE '%CNC Mill%'                THEN 8.00
        WHEN p.process_name ILIKE '%CNC Turn%'                THEN 6.00
        WHEN p.process_name ILIKE '%Cylindrical Grind%'       THEN 20.00
        WHEN p.process_name ILIKE '%Centerless Grind%'        THEN 18.00
        WHEN p.process_name ILIKE '%Surface Grind%'           THEN 22.00
        WHEN p.process_name ILIKE '%Gear Grind%'              THEN 25.00
        WHEN p.process_name ILIKE '%Grind%' OR
             p.process_name ILIKE '%Honing%' OR
             p.process_name ILIKE '%Lapping%'                 THEN 20.00
        WHEN p.process_name ILIKE '%Laser Cut%'               THEN 3.50
        WHEN p.process_name ILIKE '%Laser Weld%'              THEN 4.00
        WHEN p.process_name ILIKE '%Bend%' OR
             p.process_name ILIKE '%Press Brake%'             THEN 0.80
        WHEN p.process_name ILIKE '%Stamp%' OR
             p.process_name ILIKE '%Fine Blank%'              THEN 0.60
        WHEN p.process_name ILIKE '%Deep Draw%'               THEN 1.20
        WHEN p.process_name ILIKE '%MIG Weld%'                THEN 2.50
        WHEN p.process_name ILIKE '%TIG Weld%'                THEN 3.00
        WHEN p.process_name ILIKE '%Spot Weld%'               THEN 0.50
        WHEN p.process_name ILIKE '%Die Cast%'                THEN 1.00
        WHEN p.process_name ILIKE '%Investment Cast%'         THEN 4.50
        WHEN p.process_name ILIKE '%Sand Cast%'               THEN 3.00
        WHEN p.process_name ILIKE '%Gravity Cast%'            THEN 2.00
        WHEN p.process_name ILIKE '%Forg%'                    THEN 1.80
        WHEN p.process_name ILIKE '%Powder Coat%'             THEN 2.00
        WHEN p.process_name ILIKE '%Anodis%' OR
             p.process_name ILIKE '%Anodiz%'                  THEN 3.50
        WHEN p.process_name ILIKE '%Electroplat%' OR
             p.process_name ILIKE '%Plating%'                 THEN 2.50
        WHEN p.process_name ILIKE '%Heat Treat%'              THEN 1.20
        WHEN p.process_name ILIKE '%Assembly%'                THEN 0.30
        WHEN p.process_name ILIKE '%Inspect%' OR
             p.process_name ILIKE '%CMM%'                     THEN 0.15
        WHEN p.process_name ILIKE '%Pack%'                    THEN 0.20
        ELSE 1.50  -- default for unlisted processes
      END
    FROM processes p
    WHERE is_global = TRUE
  LOOP
    co2_india  := ROUND(kwh_kg * 0.708, 3);
    co2_china  := ROUND(kwh_kg * 0.558, 3);
    co2_europe := ROUND(kwh_kg * 0.233, 3);
    co2_uk     := ROUND(kwh_kg * 0.207, 3);
    co2_global := ROUND(kwh_kg * 0.450, 3);

    INSERT INTO process_reference_tables
      (process_id, table_name, table_description, column_definitions, display_order, is_editable)
    VALUES (proc_id,
      'Carbon Footprint Reference',
      'Energy intensity and CO₂e emissions per kg processed by grid/country',
      '[{"name":"parameter","type":"text","label":"Parameter"},
        {"name":"value","type":"number","label":"Value"},
        {"name":"unit","type":"text","label":"Unit"},
        {"name":"note","type":"text","label":"Note"}]'::jsonb,
      99, false)
    ON CONFLICT (process_id, table_name) DO NOTHING
    RETURNING id INTO tbl_id;

    IF tbl_id IS NOT NULL THEN
      INSERT INTO process_table_rows (table_id, row_data, row_order)
      SELECT tbl_id,
        jsonb_build_object('parameter',param,'value',val,'unit',unit,'note',n),
        ROW_NUMBER() OVER ()
      FROM (VALUES
        ('Process Energy Intensity',               kwh_kg,      'kWh / kg processed',   'Electrical energy consumed per kg of material processed'),
        ('CO₂e — India Grid (0.708 kgCO₂/kWh)',   co2_india,   'kgCO₂e / kg processed','CEA 2023; coal-heavy grid'),
        ('CO₂e — China Grid (0.558 kgCO₂/kWh)',   co2_china,   'kgCO₂e / kg processed','IEA 2023'),
        ('CO₂e — Europe Grid (0.233 kgCO₂/kWh)',  co2_europe,  'kgCO₂e / kg processed','EEA 2023; EU-27 average'),
        ('CO₂e — UK Grid (0.207 kgCO₂/kWh)',      co2_uk,      'kgCO₂e / kg processed','DESNZ 2023'),
        ('CO₂e — Global Avg (0.450 kgCO₂/kWh)',   co2_global,  'kgCO₂e / kg processed','IEA 2023 World Energy Outlook'),
        ('Scope Classification',                   NULL,        'Scope 1+2',             'Direct process energy; excludes upstream material & transport (Scope 3)'),
        ('Carbon Reduction Lever',                 NULL,        'Grid switch',           'Moving from India to EU grid reduces process CO₂ by ~67% for this operation')
      ) AS t(param,val,unit,n);
    END IF;

    tbl_id := NULL;

  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  grind_procs  INTEGER;
  grind_tables INTEGER;
  carbon_tables INTEGER;
  total_rows   INTEGER;
BEGIN
  SELECT COUNT(*) INTO grind_procs
  FROM processes WHERE process_name ILIKE '%Grind%';

  SELECT COUNT(*) INTO grind_tables
  FROM process_reference_tables rt
  JOIN processes p ON p.id = rt.process_id
  WHERE p.process_name ILIKE '%Grind%';

  SELECT COUNT(*) INTO carbon_tables
  FROM process_reference_tables
  WHERE table_name = 'Carbon Footprint Reference';

  SELECT COUNT(*) INTO total_rows
  FROM process_table_rows tr
  JOIN process_reference_tables rt ON rt.id = tr.table_id
  WHERE rt.table_name = 'Carbon Footprint Reference';

  RAISE NOTICE '=== Migration 166 ===';
  RAISE NOTICE 'Grinding processes in DB:              %', grind_procs;
  RAISE NOTICE 'Lookup tables for grinding processes:  %', grind_tables;
  RAISE NOTICE 'Carbon Footprint tables (all procs):   %', carbon_tables;
  RAISE NOTICE 'Carbon Footprint rows seeded:          %', total_rows;
  RAISE NOTICE '====================';
END $$;
