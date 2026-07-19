-- Migration 344: Comprehensive process_calculator_mappings for Sheet Metal, Machining, Injection Molding
-- ════════════════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS
-- Three systems write/read process_group + process_route + operation and they use
-- different naming conventions:
--
--   1. Old LLM orchestrator (pre-deterministic)  → invented names: "waterjet_cutting",
--      "press_brake" (as route), "CNC Machining" (as group), "deburring" (as route)
--
--   2. Deterministic planner (current, post-318) → MACHINE_TYPE_ROUTE lookup:
--      "Laser Cutting", "Press Brake", "CNC Turning", "CNC Milling", "Finishing"
--
--   3. ProcessCostDialog hierarchy picker        → reads this table:
--      "Sheet Cutting", "Bending/Floating /Forming", "Laser Cutting", "Press Brake"
--
-- All entries use ON CONFLICT DO NOTHING so this is safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── SHEET METAL ──────────────────────────────────────────────────────────────

INSERT INTO process_calculator_mappings (process_group, process_route, operation, is_active, display_order)
VALUES

  -- ── Cutting / profiling ──────────────────────────────────────────────────
  -- MACHINE_TYPE_ROUTE 'laser_cut' → 'Laser Cutting' (deterministic planner)
  ('Sheet Metal', 'Laser Cutting',        'Fiber Laser Cut',          true, 200),
  ('Sheet Metal', 'Laser Cutting',        'CO2 Laser Cut',            true, 201),
  ('Sheet Metal', 'Laser Cutting',        'Laser Cut',                true, 202),
  ('Sheet Metal', 'Laser Cutting',        '3D Laser Cut',             true, 203),

  -- 'Sheet Cutting' (original migration 024 / dialog hierarchy)
  ('Sheet Metal', 'Sheet Cutting',        'Shearing',                 true, 210),
  ('Sheet Metal', 'Sheet Cutting',        'Fiber laser Cutting',      true, 211),
  ('Sheet Metal', 'Sheet Cutting',        'Co2 Laser Cutting',        true, 212),
  ('Sheet Metal', 'Sheet Cutting',        'Plasma Cutting',           true, 213),
  ('Sheet Metal', 'Sheet Cutting',        'Water jet Cutting',        true, 214),
  ('Sheet Metal', 'Sheet Cutting',        'Blanking',                 true, 215),
  ('Sheet Metal', 'Sheet Cutting',        'Turret Press',             true, 216),

  -- 'Waterjet Cutting' — covers old AI-generated route "waterjet_cutting" (normalized display)
  ('Sheet Metal', 'Waterjet Cutting',     'Waterjet Cutting',         true, 220),
  ('Sheet Metal', 'Waterjet Cutting',     'Water Jet Cutting',        true, 221),
  ('Sheet Metal', 'Waterjet Cutting',     'Abrasive Waterjet',        true, 222),

  -- ── Bending / forming ────────────────────────────────────────────────────
  -- MACHINE_TYPE_ROUTE 'press_brake' → 'Press Brake' (deterministic planner)
  ('Sheet Metal', 'Press Brake',          'Press Brake Bend',         true, 230),
  ('Sheet Metal', 'Press Brake',          'Bend',                     true, 231),
  ('Sheet Metal', 'Press Brake',          'Form',                     true, 232),

  -- 'Bending/Floating /Forming' (original 024 / dialog hierarchy with exact spacing)
  ('Sheet Metal', 'Bending/Floating /Forming', 'Bend Brake',         true, 240),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Stage Tool Bending', true, 241),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Stage Tool Forming', true, 242),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Roll Forming',       true, 243),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Deep Draw',          true, 244),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Laser Punch',        true, 245),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Progressive Die',    true, 246),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Stretch Forming',    true, 247),

  -- ── Deburring / finishing ────────────────────────────────────────────────
  -- MACHINE_TYPE_ROUTE 'bench_manual' → 'Manual' → displayed as 'Finishing' in hierarchy
  ('Sheet Metal', 'Finishing',            'Deburr',                   true, 250),
  ('Sheet Metal', 'Finishing',            'Manual Deburr',            true, 251),
  ('Sheet Metal', 'Finishing',            'Edge Finish',              true, 252),
  ('Sheet Metal', 'Finishing',            'Grinding Deburr',          true, 253),

  -- ── Inspection ────────────────────────────────────────────────────────────
  -- MACHINE_TYPE_ROUTE 'inspection_bench' → 'Inspection'
  ('Sheet Metal', 'Inspection',           'Inspect',                  true, 260),
  ('Sheet Metal', 'Inspection',           'Dimensional Inspect',      true, 261),
  ('Sheet Metal', 'Inspection',           'Visual Inspection',        true, 262),
  ('Sheet Metal', 'Inspection',           'First Article Inspection', true, 263),

  -- ── Surface treatment ─────────────────────────────────────────────────────
  ('Sheet Metal', 'Surface Treatment',    'Powder Coat',              true, 270),
  ('Sheet Metal', 'Surface Treatment',    'Paint',                    true, 271),
  ('Sheet Metal', 'Surface Treatment',    'Anodize',                  true, 272),
  ('Sheet Metal', 'Surface Treatment',    'Zinc Plating',             true, 273),
  ('Sheet Metal', 'Surface Treatment',    'E-Coat',                   true, 274),
  ('Sheet Metal', 'Surface Treatment',    'Passivation',              true, 275),

  -- ── Raw material ──────────────────────────────────────────────────────────
  ('Sheet Metal', 'Raw Material',         'Sheet',                    true, 280),
  ('Sheet Metal', 'Raw Material',         'Coil',                     true, 281),
  ('Sheet Metal', 'Raw Material',         'Flat Bar',                 true, 282)

ON CONFLICT (process_group, process_route, operation) DO NOTHING;

-- ── MACHINING (CNC) ──────────────────────────────────────────────────────────

INSERT INTO process_calculator_mappings (process_group, process_route, operation, is_active, display_order)
VALUES

  -- ── CNC Turning — MACHINE_TYPE_ROUTE 'cnc_lathe' → 'CNC Turning' ─────────
  ('Machining', 'CNC Turning',            'Turning',                  true, 300),
  ('Machining', 'CNC Turning',            'Facing',                   true, 301),
  ('Machining', 'CNC Turning',            'Threading',                true, 302),
  ('Machining', 'CNC Turning',            'Grooving',                 true, 303),
  ('Machining', 'CNC Turning',            'Parting',                  true, 304),
  ('Machining', 'CNC Turning',            'Taper Turning',            true, 305),
  ('Machining', 'CNC Turning',            'Contour Turning',          true, 306),
  ('Machining', 'CNC Turning',            'Knurling',                 true, 307),
  ('Machining', 'CNC Turning',            'Boring',                   true, 308),

  -- ── CNC Milling — MACHINE_TYPE_ROUTE 'cnc_mill' → 'CNC Milling' ─────────
  ('Machining', 'CNC Milling',            'Face Milling',             true, 310),
  ('Machining', 'CNC Milling',            'Pocket Milling',           true, 311),
  ('Machining', 'CNC Milling',            'Profile Milling',          true, 312),
  ('Machining', 'CNC Milling',            'Slot Milling',             true, 313),
  ('Machining', 'CNC Milling',            'Chamfering',               true, 314),
  ('Machining', 'CNC Milling',            'Thread Milling',           true, 315),
  ('Machining', 'CNC Milling',            'Circular Milling',         true, 316),

  -- ── Drilling ─────────────────────────────────────────────────────────────
  ('Machining', 'Drilling',               'Drilling',                 true, 320),
  ('Machining', 'Drilling',               'Tapping',                  true, 321),
  ('Machining', 'Drilling',               'Reaming',                  true, 322),
  ('Machining', 'Drilling',               'Gun Drilling',             true, 323),
  ('Machining', 'Drilling',               'Countersink',              true, 324),
  ('Machining', 'Drilling',               'Counterbore',              true, 325),

  -- ── Grinding — MACHINE_TYPE_ROUTE 'cylindrical_grinder' → 'Grinding' ─────
  ('Machining', 'Grinding',               'Cylindrical Grinding',     true, 330),
  ('Machining', 'Grinding',               'Centerless Grinding',      true, 331),
  ('Machining', 'Grinding',               'Surface Grinding',         true, 332),

  -- ── Deburring / finishing for machined parts ─────────────────────────────
  -- 'Finishing' is MACHINE_TYPE_GROUP 'bench_manual'; also covers old AI "deburring" route
  ('Machining', 'Finishing',              'Deburr',                   true, 340),
  ('Machining', 'Finishing',             'Manual Deburr',             true, 341),
  ('Machining', 'Finishing',              'Edge Break',               true, 342),
  ('Machining', 'Finishing',              'Polishing',                true, 343),

  -- Historical compatibility: old AI generated ('CNC Machining', 'deburring', 'Manual Deburr')
  ('CNC Machining', 'Deburring',          'Manual Deburr',            true, 350),
  ('CNC Machining', 'Deburring',          'Deburr',                   true, 351),
  ('CNC Machining', 'CNC Milling',        'Face Milling',             true, 352),
  ('CNC Machining', 'CNC Turning',        'Turning',                  true, 353),
  ('CNC Machining', 'Drilling',           'Drilling',                 true, 354),
  ('CNC Machining', 'Drilling',           'Tapping',                  true, 355),
  ('CNC Machining', 'Inspection',         'Dimensional Inspect',      true, 356),

  -- ── Inspection ────────────────────────────────────────────────────────────
  ('Machining', 'Inspection',             'CMM Inspection',           true, 360),
  ('Machining', 'Inspection',             'Dimensional Inspect',      true, 361),
  ('Machining', 'Inspection',             'First Article Inspection', true, 362),

  -- ── Raw material ──────────────────────────────────────────────────────────
  ('Machining', 'Raw Material',           'Round Bar',                true, 370),
  ('Machining', 'Raw Material',           'Rectangular Bar',          true, 371),
  ('Machining', 'Raw Material',           'Hex Bar',                  true, 372),
  ('Machining', 'Raw Material',           'Tube',                     true, 373),
  ('Machining', 'Raw Material',           'Casting Blank',            true, 374),
  ('Machining', 'Raw Material',           'Forging Blank',            true, 375)

ON CONFLICT (process_group, process_route, operation) DO NOTHING;

-- ── INJECTION MOLDING ────────────────────────────────────────────────────────
-- Process group: 'Injection Molding' (matches what aPriori and most tooling systems use)
-- Also seeds 'Plastics' group used by MACHINE_TYPE_GROUP for plastics machines.

INSERT INTO process_calculator_mappings (process_group, process_route, operation, is_active, display_order)
VALUES

  -- ── Pre-processing ────────────────────────────────────────────────────────
  ('Injection Molding', 'Material Prep',  'Material Drying',          true, 400),
  ('Injection Molding', 'Material Prep',  'Colorant Blending',        true, 401),
  ('Injection Molding', 'Material Prep',  'Regrind Blending',         true, 402),

  -- ── Moulding ─────────────────────────────────────────────────────────────
  ('Injection Molding', 'Injection',      'Injection Molding',        true, 410),
  ('Injection Molding', 'Injection',      'Hot Runner Molding',       true, 411),
  ('Injection Molding', 'Injection',      'Cold Runner Molding',      true, 412),
  ('Injection Molding', 'Injection',      'Insert Molding',           true, 413),
  ('Injection Molding', 'Injection',      'Overmolding',              true, 414),
  ('Injection Molding', 'Injection',      'Two-Shot Molding',         true, 415),
  ('Injection Molding', 'Injection',      'Gas-Assist Molding',       true, 416),

  -- ── Post-mould operations ─────────────────────────────────────────────────
  ('Injection Molding', 'Gate Trim',      'Manual Gate Trim',         true, 420),
  ('Injection Molding', 'Gate Trim',      'Robotic Degating',         true, 421),
  ('Injection Molding', 'Gate Trim',      'Automated Degating',       true, 422),

  ('Injection Molding', 'Finishing',      'Deflashing',               true, 430),
  ('Injection Molding', 'Finishing',      'Polishing',                true, 431),
  ('Injection Molding', 'Finishing',      'Texturing',                true, 432),

  -- ── Assembly & secondary ops ──────────────────────────────────────────────
  ('Injection Molding', 'Assembly',       'Insert Press-In',          true, 440),
  ('Injection Molding', 'Assembly',       'Ultrasonic Welding',       true, 441),
  ('Injection Molding', 'Assembly',       'Spin Welding',             true, 442),
  ('Injection Molding', 'Assembly',       'Pad Printing',             true, 443),
  ('Injection Molding', 'Assembly',       'Hot Stamping',             true, 444),

  -- ── Surface treatment ─────────────────────────────────────────────────────
  ('Injection Molding', 'Surface Treatment', 'Painting',              true, 450),
  ('Injection Molding', 'Surface Treatment', 'Plating',               true, 451),
  ('Injection Molding', 'Surface Treatment', 'Anodizing',             true, 452),
  ('Injection Molding', 'Surface Treatment', 'Laser Marking',         true, 453),

  -- ── Inspection ────────────────────────────────────────────────────────────
  ('Injection Molding', 'Inspection',     'Visual Inspection',        true, 460),
  ('Injection Molding', 'Inspection',     'Dimensional Check',        true, 461),
  ('Injection Molding', 'Inspection',     'CMM Inspection',           true, 462),
  ('Injection Molding', 'Inspection',     'Functional Test',          true, 463),

  -- ── Raw material ──────────────────────────────────────────────────────────
  ('Injection Molding', 'Raw Material',   'Pellets / Granules',       true, 470),
  ('Injection Molding', 'Raw Material',   'Masterbatch',              true, 471),

  -- ── 'Plastics' group — used by MACHINE_TYPE_GROUP for IM machines ─────────
  ('Plastics', 'Injection',               'Injection Molding',        true, 480),
  ('Plastics', 'Injection',               'Insert Molding',           true, 481),
  ('Plastics', 'Gate Trim',               'Manual Gate Trim',         true, 482),
  ('Plastics', 'Finishing',               'Deflashing',               true, 483),
  ('Plastics', 'Inspection',              'Visual Inspection',        true, 484),

  -- ── 'Plastic & Rubber' group — backward compat with migration 024 ─────────
  ('Plastic & Rubber', 'Injection Molding', 'Injection Molding',      true, 490),
  ('Plastic & Rubber', 'Injection Molding', 'Insert Molding',         true, 491),
  ('Plastic & Rubber', 'Trimming / Degating', 'Manual',               true, 492),
  ('Plastic & Rubber', 'Trimming / Degating', 'Semi Automated',       true, 493)

ON CONFLICT (process_group, process_route, operation) DO NOTHING;
