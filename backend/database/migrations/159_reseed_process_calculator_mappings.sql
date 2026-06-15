-- Migration 159: Re-seed process_calculator_mappings
--
-- Table is empty (wiped by a prior migration). This re-seeds the full
-- process-group → route → operation hierarchy.
-- Uses ON CONFLICT DO NOTHING so it is safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO process_calculator_mappings
  (process_group, process_route, operation, calculator_name, is_active, display_order)
VALUES

  -- ── Plastic & Rubber ──────────────────────────────────────────────────────
  ('Plastic & Rubber', 'Compression Molding',      'Compression Molding',             'Compression Calculator',         true,   1),
  ('Plastic & Rubber', 'Injection Molding',         'Injection Molding',               'Injection Molding Calculator',   true,   2),
  ('Plastic & Rubber', 'Injection Molding',         'Injection Molding-Hot Runner',    'Injection Molding Calculator',   true,   3),
  ('Plastic & Rubber', 'Injection Molding',         'Injection Molding-Cold Runner',   'Injection Molding Calculator',   true,   4),
  ('Plastic & Rubber', 'Injection Molding',         'Insert Molding',                  'Insert Molding Calculator',      true,   5),
  ('Plastic & Rubber', 'Structural foam molding',   'Structural foam molding',         'Structural Foam Calculator',     true,   6),
  ('Plastic & Rubber', 'Reaction Foam Molding',     'Reaction Foam Molding',           'Reaction Foam Calculator',       true,   7),
  ('Plastic & Rubber', 'Thermoforming',             '3 Station Rotary Thermoforming',  'Thermoforming Calculator',       true,   8),
  ('Plastic & Rubber', 'Thermoforming',             '4 Station Rotary Thermoforming',  'Thermoforming Calculator',       true,   9),
  ('Plastic & Rubber', 'Thermoforming',             'Shuttle Station Thermoforming',   'Thermoforming Calculator',       true,  10),
  ('Plastic & Rubber', 'Thermoforming',             'Single Station Thermoforming',    'Thermoforming Calculator',       true,  11),
  ('Plastic & Rubber', 'Trimming / Degating',       'Manual',                          'Manual Time Calculator',         true,  12),
  ('Plastic & Rubber', 'Trimming / Degating',       'Semi Automated',                  'Semi-Auto Time Calculator',      true,  13),
  ('Plastic & Rubber', 'Raw Material',              'Granules / Pellets',              'Material Weight Calculator',     true,  14),

  -- ── Machining ─────────────────────────────────────────────────────────────
  ('Machining', 'Cutting',          'Band Saw Cutting',              'Band Saw Calculator',          true, 100),
  ('Machining', 'Turning Center',   'Facing',                        'Turning Center Calculator',    true, 101),
  ('Machining', 'Turning Center',   'Turning',                       'Turning Center Calculator',    true, 102),
  ('Machining', 'Turning Center',   'Drilling',                      'Turning Center Calculator',    true, 103),
  ('Machining', 'Turning Center',   'Threading',                     'Turning Center Calculator',    true, 104),
  ('Machining', 'Turning Center',   'Chambering',                    'Turning Center Calculator',    true, 105),
  ('Machining', 'Turning Center',   'Taper Turning',                 'Turning Center Calculator',    true, 106),
  ('Machining', 'Turning Center',   'Step turning',                  'Turning Center Calculator',    true, 107),
  ('Machining', 'Turning Center',   'Contour turning',               'Turning Center Calculator',    true, 108),
  ('Machining', 'Turning Center',   'Grooving',                      'Turning Center Calculator',    true, 109),
  ('Machining', 'Turning Center',   'Parting /Cut-off',              'Turning Center Calculator',    true, 110),
  ('Machining', 'Turning Center',   'Knurling',                      'Turning Center Calculator',    true, 111),
  ('Machining', 'Turning Center',   'Eccentric / Off-Center Turning','Turning Center Calculator',    true, 112),
  ('Machining', 'Milling  Center',  'Face milling',                  'Milling Center Calculator',    true, 113),
  ('Machining', 'Milling  Center',  'Peripheral (Slab) Milling',     'Milling Center Calculator',    true, 114),
  ('Machining', 'Milling  Center',  'Thread Milling',                'Milling Center Calculator',    true, 115),
  ('Machining', 'Milling  Center',  'Pocket Milling',                'Milling Center Calculator',    true, 116),
  ('Machining', 'Milling  Center',  'Slot Milling',                  'Milling Center Calculator',    true, 117),
  ('Machining', 'Milling  Center',  'Contour / Profile Milling',     'Milling Center Calculator',    true, 118),
  ('Machining', 'Milling  Center',  'Circular / Helical Milling',    'Milling Center Calculator',    true, 119),
  ('Machining', 'Milling  Center',  'Chamfering',                    'Milling Center Calculator',    true, 120),
  ('Machining', 'Gear Cutting',     'Gear Hobbing',                  'Gear Cutting Calculator',      true, 121),
  ('Machining', 'Gear Cutting',     'Gear Shaping',                  'Gear Cutting Calculator',      true, 122),
  ('Machining', 'Gear Cutting',     'Gear Milling',                  'Gear Cutting Calculator',      true, 123),
  ('Machining', 'Gear Cutting',     'Gear Honing',                   'Gear Cutting Calculator',      true, 124),
  ('Machining', 'Gear Cutting',     'Gear Lapping',                  'Gear Cutting Calculator',      true, 125),
  ('Machining', 'Broach',           'Broaching',                     'Broaching Calculator',         true, 126),
  ('Machining', 'Broach',           'Gear Broaching',                'Broaching Calculator',         true, 127),
  ('Machining', 'Grinding',         'Cyclinderical Grinding',        'Grinding Calculator',          true, 128),
  ('Machining', 'Grinding',         'Centerless Grinding',           'Grinding Calculator',          true, 129),
  ('Machining', 'Grinding',         'Surface grinding',              'Grinding Calculator',          true, 130),
  ('Machining', 'Grinding',         'Gear Grinding',                 'Grinding Calculator',          true, 131),
  ('Machining', 'Drilling',         'Drilling',                      'Drilling Calculator',          true, 132),
  ('Machining', 'Drilling',         'Tapping',                       'Drilling Calculator',          true, 133),
  ('Machining', 'Drilling',         'Gun Drilling',                  'Drilling Calculator',          true, 134),
  ('Machining', 'Drilling',         'Boring',                        'Drilling Calculator',          true, 135),
  ('Machining', 'Drilling',         'Reaming',                       'Drilling Calculator',          true, 136),
  ('Machining', 'EDM',              'Wire EDM',                      'EDM Calculator',               true, 137),
  ('Machining', 'EDM',              'Spark EDM',                     'EDM Calculator',               true, 138),
  ('Machining', 'Raw Material',     'Round Bar',                     'Bar Stock Calculator',         true, 139),
  ('Machining', 'Raw Material',     'Rectangular Bar',               'Bar Stock Calculator',         true, 140),
  ('Machining', 'Raw Material',     'Square Bar',                    'Bar Stock Calculator',         true, 141),
  ('Machining', 'Raw Material',     'Hexagonal Bar',                 'Bar Stock Calculator',         true, 142),
  ('Machining', 'Raw Material',     'Tube',                          'Tube Stock Calculator',        true, 143),
  ('Machining', 'Raw Material',     'Rectangular Tube',              'Tube Stock Calculator',        true, 144),
  ('Machining', 'Raw Material',     'Square Tube',                   'Tube Stock Calculator',        true, 145),
  ('Machining', 'Raw Material',     'Ingot',                         'Material Entry',               true, 146),
  ('Machining', 'Raw Material',     'Casted RM',                     'Material Entry',               true, 147),
  ('Machining', 'Raw Material',     'Billet',                        'Material Entry',               true, 148),
  ('Machining', 'Raw Material',     'Wire Rod',                      'Wire Stock Calculator',        true, 149),
  ('Machining', 'Raw Material',     'Forged RM',                     'Material Entry',               true, 150),

  -- ── Sheet Metal ───────────────────────────────────────────────────────────
  ('Sheet Metal', 'Sheet Cutting',              'Shearning',                         'Shearing Calculator',          true, 200),
  ('Sheet Metal', 'Sheet Cutting',              'Fiber laser Cutting',               'Laser Cutting Calculator',     true, 201),
  ('Sheet Metal', 'Sheet Cutting',              'Co2 Laser Cutting',                 'Laser Cutting Calculator',     true, 202),
  ('Sheet Metal', 'Sheet Cutting',              'Plasma Cutting',                    'Plasma Cutting Calculator',    true, 203),
  ('Sheet Metal', 'Sheet Cutting',              'Water jet Cutting',                 'Water Jet Calculator',         true, 204),
  ('Sheet Metal', 'Sheet Cutting',              'Blanking',                          'Blanking Press Calculator',    true, 205),
  ('Sheet Metal', 'Sheet Cutting',              '3D Laser Cut',                      'Laser Cutting Calculator',     true, 206),
  ('Sheet Metal', 'Sheet Cutting',              'Turret Press',                      'Turret Press Calculator',      true, 207),
  ('Sheet Metal', 'Bending/Floating /Forming',  'Bend Brake',                        'Press Brake Calculator',       true, 208),
  ('Sheet Metal', 'Bending/Floating /Forming',  'Stage Tool Bending',               'Bending Calculator',           true, 209),
  ('Sheet Metal', 'Bending/Floating /Forming',  'Stage Tool Forming',               'Forming Calculator',           true, 210),
  ('Sheet Metal', 'Bending/Floating /Forming',  'Roll Forming',                      'Roll Forming Calculator',      true, 211),
  ('Sheet Metal', 'Bending/Floating /Forming',  'Deep Draw',                         'Deep Draw Calculator',         true, 212),
  ('Sheet Metal', 'Bending/Floating /Forming',  'Laser Puch',                        'Punch Calculator',             true, 213),
  ('Sheet Metal', 'Bending/Floating /Forming',  'Turret Press',                      'Turret Press Calculator',      true, 214),
  ('Sheet Metal', 'Bending/Floating /Forming',  'Progressive die',                   'Progressive Die Calculator',   true, 215),
  ('Sheet Metal', 'Bending/Floating /Forming',  'Offline Blank',                     'Blanking Calculator',          true, 216),
  ('Sheet Metal', 'Bending/Floating /Forming',  'Stretch forming',                   'Stretch Forming Calculator',   true, 217),
  ('Sheet Metal', 'Raw Material',               'Sheet',                             'Sheet Stock Calculator',       true, 218),
  ('Sheet Metal', 'Raw Material',               'Flat',                              'Flat Stock Calculator',        true, 219),
  ('Sheet Metal', 'Raw Material',               'Coil',                              'Coil Stock Calculator',        true, 220),
  ('Sheet Metal', 'Raw Material',               'I-Beam',                            'Beam Stock Calculator',        true, 221),
  ('Sheet Metal', 'Raw Material',               'H-Beam',                            'Beam Stock Calculator',        true, 222),
  ('Sheet Metal', 'Raw Material',               'Angle (L-shape)',                   'Angle Stock Calculator',       true, 223),
  ('Sheet Metal', 'Raw Material',               'Channel (C-shape / U-shape)',        'Channel Stock Calculator',     true, 224),
  ('Sheet Metal', 'Raw Material',               'T-Sections',                        'Section Stock Calculator',     true, 225),
  ('Sheet Metal', 'Raw Material',               'Z-Sections',                        'Section Stock Calculator',     true, 226),

  -- ── Assembly ──────────────────────────────────────────────────────────────
  ('Assembly', 'Pick & Place',          'Manual Pick and Place',   'Manual Assembly Time Calculator', true, 300),
  ('Assembly', 'Pick & Place',          'Semi automated',          'Semi-Auto Assembly Calculator',   true, 301),
  ('Assembly', 'Welding',               'Mig Welding',             'MIG Welding Calculator',          true, 302),
  ('Assembly', 'Welding',               'Tig Welding',             'TIG Welding Calculator',          true, 303),
  ('Assembly', 'Welding',               'Spot Weld',               'Spot Welding Calculator',         true, 304),
  ('Assembly', 'Welding',               'Seam Weld',               'Seam Welding Calculator',         true, 305),
  ('Assembly', 'Welding',               'Laser Weld',              'Laser Welding Calculator',        true, 306),
  ('Assembly', 'Screwing',              'Manal',                   'Manual Fastening Calculator',     true, 307),
  ('Assembly', 'Screwing',              'Power gun',               'Power Tool Calculator',           true, 308),
  ('Assembly', 'Bolt Nut Assy',         'Power gun',               'Power Tool Calculator',           true, 309),
  ('Assembly', 'Bolt Nut Assy',         'Manal',                   'Manual Fastening Calculator',     true, 310),
  ('Assembly', 'Electrical Connection', 'Wire Harness',            'Harness Assembly Calculator',     true, 311),
  ('Assembly', 'Debur',                 'Manual Debur',            'Deburring Time Calculator',       true, 312),
  ('Assembly', 'Weld Cleaning',         'Manual',                  'Manual Cleaning Calculator',      true, 313),
  ('Assembly', 'Weld Cleaning',         'Semi automated-Sanding',  'Sanding Calculator',              true, 314),

  -- ── Post Processing ───────────────────────────────────────────────────────
  ('Post Processing', 'Surface Protection', 'Degrease',                   'Degreasing Calculator',        true, 400),
  ('Post Processing', 'Surface Protection', 'Phosphating',                'Phosphating Calculator',       true, 401),
  ('Post Processing', 'Surface Protection', 'Blackning',                  'Blackening Calculator',        true, 402),
  ('Post Processing', 'Surface Protection', 'Plating',                    'Plating Calculator',           true, 403),
  ('Post Processing', 'Surface Protection', 'Zinc Nickel plating',        'Plating Calculator',           true, 404),
  ('Post Processing', 'Surface Protection', 'Nickel Chrome Plating',      'Plating Calculator',           true, 405),
  ('Post Processing', 'Surface Protection', 'Hard Chrome plating',        'Plating Calculator',           true, 406),
  ('Post Processing', 'Surface Protection', 'Passivation',                'Passivation Calculator',       true, 407),
  ('Post Processing', 'Surface Protection', 'Anodizing Type I',           'Anodizing Calculator',         true, 408),
  ('Post Processing', 'Surface Protection', 'Anodizing Type II',          'Anodizing Calculator',         true, 409),
  ('Post Processing', 'Surface Protection', 'Anodizing Type III',         'Anodizing Calculator',         true, 410),
  ('Post Processing', 'Surface Protection', 'Manual Paint primer',        'Painting Calculator',          true, 411),
  ('Post Processing', 'Surface Protection', 'Manual Paint finish Coat',   'Painting Calculator',          true, 412),
  ('Post Processing', 'Surface Protection', 'Manual Paint hand Cleaning', 'Paint Prep Calculator',        true, 413),
  ('Post Processing', 'Surface Protection', 'Manual Paint hand Sanding',  'Paint Prep Calculator',        true, 414),
  ('Post Processing', 'Surface Protection', 'Masking',                    'Masking Calculator',           true, 415),
  ('Post Processing', 'Surface Protection', 'Powder Coating',             'Powder Coating Calculator',    true, 416),
  ('Post Processing', 'Surface Protection', 'ED Coating',                 'ED Coating Calculator',        true, 417),
  ('Post Processing', 'Heat Treatment',     'Surface Harden',             'Heat Treatment Calculator',    true, 418),
  ('Post Processing', 'Heat Treatment',     'Through Harden',             'Heat Treatment Calculator',    true, 419),
  ('Post Processing', 'Heat Treatment',     'Anneal',                     'Heat Treatment Calculator',    true, 420),
  ('Post Processing', 'Heat Treatment',     'Temper',                     'Heat Treatment Calculator',    true, 421),
  ('Post Processing', 'Inspection',         'CMM Inspection',             'CMM Inspection Calculator',    true, 422),
  ('Post Processing', 'Inspection',         'Manual Inspection',          'Manual Inspection Calculator', true, 423),
  ('Post Processing', 'Testing',            'Leak test',                  'Leak Test Calculator',         true, 424),
  ('Post Processing', 'Testing',            'Ultrasonic Test',            'UT Calculator',                true, 425),
  ('Post Processing', 'Testing',            'MPT',                        'MPT Calculator',               true, 426),

  -- ── Packing & Delivery ────────────────────────────────────────────────────
  ('Packing & Delivery', 'Packing',  'Wooden Box Packing',       'Packing Calculator',          true, 500),
  ('Packing & Delivery', 'Packing',  'Corrugated box packing',   'Packing Calculator',          true, 501),
  ('Packing & Delivery', 'Packing',  'Pallet',                   'Pallet Calculator',           true, 502),
  ('Packing & Delivery', 'Delivery', 'Ex',                       'Delivery Cost Calculator',    true, 503),
  ('Packing & Delivery', 'Delivery', 'FCA',                      'Delivery Cost Calculator',    true, 504),
  ('Packing & Delivery', 'Delivery', 'DDP',                      'Delivery Cost Calculator',    true, 505)

ON CONFLICT (process_group, process_route, operation) DO NOTHING;

-- Verify
DO $$
DECLARE
  cnt INTEGER;
  grp INTEGER;
BEGIN
  SELECT COUNT(*), COUNT(DISTINCT process_group)
  INTO cnt, grp
  FROM process_calculator_mappings;
  RAISE NOTICE 'Seeded: % mappings across % process groups', cnt, grp;
END $$;
