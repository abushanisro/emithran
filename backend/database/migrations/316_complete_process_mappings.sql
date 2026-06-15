-- ============================================================================
-- Migration 316 — Complete Process Calculator Mappings
--
-- Adds all process groups, routes, and operations needed by the AI process
-- planner. Safe to re-run: ON CONFLICT DO NOTHING prevents duplicates.
--
-- Groups:
--   Plastic & Rubber      (injection molding, thermoforming, compression, etc.)
--   Machining             (turning, VMC, drilling, grinding, EDM, sawing, etc.)
--   Sheet Metal           (laser, plasma, press brake, etc.)
--   Assembly              (welding, fastening, pick & place, etc.)
--   Post Processing       (anodising, plating, heat treatment, deburring, inspection)
--   Packing & Delivery    (packing, delivery terms)
-- ============================================================================

INSERT INTO process_calculator_mappings
  (process_group, process_route, operation, is_active, display_order)
VALUES

-- ════════════════════════════════════════════════════════════════════════════
-- PLASTIC & RUBBER
-- ════════════════════════════════════════════════════════════════════════════

  ('Plastic & Rubber', 'Compression Molding',    'Compression Molding',                   true,   1),
  ('Plastic & Rubber', 'Injection Molding',       'Injection Molding',                     true,   2),
  ('Plastic & Rubber', 'Injection Molding',       'Injection Molding-Hot Runner',           true,   3),
  ('Plastic & Rubber', 'Injection Molding',       'Injection Molding-Cold Runner',          true,   4),
  ('Plastic & Rubber', 'Injection Molding',       'Insert Molding',                        true,   5),
  ('Plastic & Rubber', 'Injection Molding',       'Overmolding',                           true,   6),
  ('Plastic & Rubber', 'Injection Molding',       'Gas-Assist Injection Molding',          true,   7),
  ('Plastic & Rubber', 'Structural foam molding', 'Structural foam molding',               true,   8),
  ('Plastic & Rubber', 'Reaction Foam Molding',   'Reaction Foam Molding',                 true,   9),
  ('Plastic & Rubber', 'Thermoforming',           '3 Station Rotary Thermoforming',        true,  10),
  ('Plastic & Rubber', 'Thermoforming',           '4 Station Rotary Thermoforming',        true,  11),
  ('Plastic & Rubber', 'Thermoforming',           'Shuttle Station Thermoforming',         true,  12),
  ('Plastic & Rubber', 'Thermoforming',           'Single Station Thermoforming',          true,  13),
  ('Plastic & Rubber', 'Blow Molding',            'Extrusion Blow Molding',                true,  14),
  ('Plastic & Rubber', 'Blow Molding',            'Injection Blow Molding',                true,  15),
  ('Plastic & Rubber', 'Blow Molding',            'Stretch Blow Molding',                  true,  16),
  ('Plastic & Rubber', 'Extrusion',               'Profile Extrusion',                     true,  17),
  ('Plastic & Rubber', 'Extrusion',               'Sheet Extrusion',                       true,  18),
  ('Plastic & Rubber', 'Extrusion',               'Pipe / Tube Extrusion',                 true,  19),
  ('Plastic & Rubber', 'Rotational Molding',      'Rotational Molding',                    true,  20),
  ('Plastic & Rubber', 'Rubber Molding',          'Rubber Compression Molding',            true,  21),
  ('Plastic & Rubber', 'Rubber Molding',          'Rubber Injection Molding',              true,  22),
  ('Plastic & Rubber', 'Rubber Molding',          'Rubber Transfer Molding',               true,  23),
  ('Plastic & Rubber', 'Trimming / Degating',     'Manual',                                true,  24),
  ('Plastic & Rubber', 'Trimming / Degating',     'Semi Automated',                        true,  25),
  ('Plastic & Rubber', 'Raw Material',            'Granules / Pellets',                    true,  26),

-- ════════════════════════════════════════════════════════════════════════════
-- MACHINING — Turning Center
-- ════════════════════════════════════════════════════════════════════════════

  ('Machining', 'Turning Center', 'Saw Cut / Stock Cut',          true, 100),
  ('Machining', 'Turning Center', 'Facing',                       true, 101),
  ('Machining', 'Turning Center', 'OD Rough Turning',             true, 102),
  ('Machining', 'Turning Center', 'OD Finish Turning',            true, 103),
  ('Machining', 'Turning Center', 'Turning',                      true, 104),
  ('Machining', 'Turning Center', 'Shoulder Turning',             true, 105),
  ('Machining', 'Turning Center', 'Flange Turning',               true, 106),
  ('Machining', 'Turning Center', 'Step turning',                 true, 107),
  ('Machining', 'Turning Center', 'Taper Turning',                true, 108),
  ('Machining', 'Turning Center', 'Contour turning',              true, 109),
  ('Machining', 'Turning Center', 'Grooving',                     true, 110),
  ('Machining', 'Turning Center', 'Parting /Cut-off',             true, 111),
  ('Machining', 'Turning Center', 'Knurling',                     true, 112),
  ('Machining', 'Turning Center', 'Threading',                    true, 113),
  ('Machining', 'Turning Center', 'Chambering',                   true, 114),
  ('Machining', 'Turning Center', 'Eccentric / Off-Center Turning', true, 115),
  ('Machining', 'Turning Center', 'Boring',                       true, 116),
  ('Machining', 'Turning Center', 'Drilling',                     true, 117),
  ('Machining', 'Turning Center', 'Counterboring',                true, 118),
  ('Machining', 'Turning Center', 'Countersinking',               true, 119),
  ('Machining', 'Turning Center', 'Tapping',                      true, 120),
  ('Machining', 'Turning Center', 'Reaming',                      true, 121),

-- ════════════════════════════════════════════════════════════════════════════
-- MACHINING — VMC (Vertical Machining Centre)
-- ════════════════════════════════════════════════════════════════════════════

  ('Machining', 'VMC', 'Face Milling',             true, 140),
  ('Machining', 'VMC', 'Peripheral Milling',       true, 141),
  ('Machining', 'VMC', 'Pocket Milling',           true, 142),
  ('Machining', 'VMC', 'Contour / Profile Milling',true, 143),
  ('Machining', 'VMC', 'Slot Milling',             true, 144),
  ('Machining', 'VMC', 'Thread Milling',           true, 145),
  ('Machining', 'VMC', 'Circular / Helical Milling', true, 146),
  ('Machining', 'VMC', 'Chamfering',               true, 147),
  ('Machining', 'VMC', 'Drilling',                 true, 148),
  ('Machining', 'VMC', 'Counterboring',            true, 149),
  ('Machining', 'VMC', 'Countersinking',           true, 150),
  ('Machining', 'VMC', 'Tapping',                  true, 151),
  ('Machining', 'VMC', 'Reaming',                  true, 152),
  ('Machining', 'VMC', 'Boring',                   true, 153),

-- ════════════════════════════════════════════════════════════════════════════
-- MACHINING — Milling Center (existing route name kept)
-- ════════════════════════════════════════════════════════════════════════════

  ('Machining', 'Milling  Center', 'Face milling',                true, 160),
  ('Machining', 'Milling  Center', 'Peripheral (Slab) Milling',   true, 161),
  ('Machining', 'Milling  Center', 'Thread Milling',              true, 162),
  ('Machining', 'Milling  Center', 'Pocket Milling',              true, 163),
  ('Machining', 'Milling  Center', 'Slot Milling',                true, 164),
  ('Machining', 'Milling  Center', 'Contour / Profile Milling',   true, 165),
  ('Machining', 'Milling  Center', 'Circular / Helical Milling',  true, 166),
  ('Machining', 'Milling  Center', 'Chamfering',                  true, 167),

-- ════════════════════════════════════════════════════════════════════════════
-- MACHINING — Sawing (Band Saw / Cold Saw)
-- ════════════════════════════════════════════════════════════════════════════

  ('Machining', 'Sawing', 'Band Saw Cut',     true, 170),
  ('Machining', 'Sawing', 'Cold Saw Cut',     true, 171),
  ('Machining', 'Sawing', 'Stock Cut',        true, 172),
  ('Machining', 'Cutting', 'Band Saw Cutting', true, 173),

-- ════════════════════════════════════════════════════════════════════════════
-- MACHINING — Drilling / Boring
-- ════════════════════════════════════════════════════════════════════════════

  ('Machining', 'Drilling', 'Drilling',     true, 180),
  ('Machining', 'Drilling', 'Tapping',      true, 181),
  ('Machining', 'Drilling', 'Gun Drilling', true, 182),
  ('Machining', 'Drilling', 'Boring',       true, 183),
  ('Machining', 'Drilling', 'Reaming',      true, 184),
  ('Machining', 'Drilling', 'Counterboring',true, 185),

-- ════════════════════════════════════════════════════════════════════════════
-- MACHINING — Grinding
-- ════════════════════════════════════════════════════════════════════════════

  ('Machining', 'Grinding', 'Cylindrical Grinding',   true, 190),
  ('Machining', 'Grinding', 'Cyclinderical Grinding',  true, 191),
  ('Machining', 'Grinding', 'Centerless Grinding',    true, 192),
  ('Machining', 'Grinding', 'Centreless Grinding',    true, 193),
  ('Machining', 'Grinding', 'Surface grinding',       true, 194),
  ('Machining', 'Grinding', 'ID Grinding',            true, 195),
  ('Machining', 'Grinding', 'Gear Grinding',          true, 196),
  ('Machining', 'Grinding', 'Honing',                 true, 197),
  ('Machining', 'Grinding', 'Lapping',                true, 198),

-- ════════════════════════════════════════════════════════════════════════════
-- MACHINING — Gear Cutting / EDM / Broaching / Special
-- ════════════════════════════════════════════════════════════════════════════

  ('Machining', 'Gear Cutting', 'Gear Hobbing',  true, 200),
  ('Machining', 'Gear Cutting', 'Gear Shaping',  true, 201),
  ('Machining', 'Gear Cutting', 'Gear Milling',  true, 202),
  ('Machining', 'Gear Cutting', 'Gear Honing',   true, 203),
  ('Machining', 'Gear Cutting', 'Gear Lapping',  true, 204),
  ('Machining', 'Broach',       'Broaching',     true, 205),
  ('Machining', 'Broach',       'Gear Broaching',true, 206),
  ('Machining', 'EDM',          'Wire EDM',      true, 207),
  ('Machining', 'EDM',          'Spark EDM',     true, 208),
  ('Machining', 'Waterjet',     'Waterjet Cutting', true, 209),

-- ════════════════════════════════════════════════════════════════════════════
-- MACHINING — Raw Material forms
-- ════════════════════════════════════════════════════════════════════════════

  ('Machining', 'Raw Material', 'Round Bar',       true, 210),
  ('Machining', 'Raw Material', 'Rectangular Bar', true, 211),
  ('Machining', 'Raw Material', 'Square Bar',      true, 212),
  ('Machining', 'Raw Material', 'Hexagonal Bar',   true, 213),
  ('Machining', 'Raw Material', 'Tube',            true, 214),
  ('Machining', 'Raw Material', 'Rectangular Tube',true, 215),
  ('Machining', 'Raw Material', 'Square Tube',     true, 216),
  ('Machining', 'Raw Material', 'Ingot',           true, 217),
  ('Machining', 'Raw Material', 'Casted RM',       true, 218),
  ('Machining', 'Raw Material', 'Billet',          true, 219),
  ('Machining', 'Raw Material', 'Wire Rod',        true, 220),
  ('Machining', 'Raw Material', 'Forged RM',       true, 221),

-- ════════════════════════════════════════════════════════════════════════════
-- SHEET METAL
-- ════════════════════════════════════════════════════════════════════════════

  ('Sheet Metal', 'Sheet Cutting', 'Shearning',           true, 300),
  ('Sheet Metal', 'Sheet Cutting', 'Shearing',            true, 301),
  ('Sheet Metal', 'Sheet Cutting', 'Fiber laser Cutting', true, 302),
  ('Sheet Metal', 'Sheet Cutting', 'Co2 Laser Cutting',   true, 303),
  ('Sheet Metal', 'Sheet Cutting', 'Plasma Cutting',      true, 304),
  ('Sheet Metal', 'Sheet Cutting', 'Water jet Cutting',   true, 305),
  ('Sheet Metal', 'Sheet Cutting', 'Waterjet Cutting',    true, 306),
  ('Sheet Metal', 'Sheet Cutting', 'Blanking',            true, 307),
  ('Sheet Metal', 'Sheet Cutting', '3D Laser Cut',        true, 308),
  ('Sheet Metal', 'Sheet Cutting', 'Turret Press',        true, 309),
  ('Sheet Metal', 'Sheet Cutting', 'Nibbling',            true, 310),

  ('Sheet Metal', 'Bending/Floating /Forming', 'Bend Brake',          true, 320),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Stage Tool Bending',  true, 321),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Stage Tool Forming',  true, 322),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Roll Forming',        true, 323),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Deep Draw',           true, 324),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Laser Puch',          true, 325),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Turret Press',        true, 326),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Progressive die',     true, 327),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Offline Blank',       true, 328),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Stretch forming',     true, 329),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Hemming',             true, 330),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Flanging',            true, 331),

  ('Sheet Metal', 'Raw Material', 'Sheet',                   true, 340),
  ('Sheet Metal', 'Raw Material', 'Flat',                    true, 341),
  ('Sheet Metal', 'Raw Material', 'Coil',                    true, 342),
  ('Sheet Metal', 'Raw Material', 'I-Beam',                  true, 343),
  ('Sheet Metal', 'Raw Material', 'H-Beam',                  true, 344),
  ('Sheet Metal', 'Raw Material', 'Angle (L-shape)',          true, 345),
  ('Sheet Metal', 'Raw Material', 'Channel (C-shape / U-shape)', true, 346),
  ('Sheet Metal', 'Raw Material', 'T-Sections',              true, 347),
  ('Sheet Metal', 'Raw Material', 'Z-Sections',              true, 348),

-- ════════════════════════════════════════════════════════════════════════════
-- ASSEMBLY
-- ════════════════════════════════════════════════════════════════════════════

  ('Assembly', 'Pick & Place',         'Manual Pick and Place',       true, 400),
  ('Assembly', 'Pick & Place',         'Semi automated',              true, 401),
  ('Assembly', 'Pick & Place',         'Fully Automated',             true, 402),

  ('Assembly', 'Welding',              'Mig Welding',                 true, 410),
  ('Assembly', 'Welding',              'Tig Welding',                 true, 411),
  ('Assembly', 'Welding',              'Spot Weld',                   true, 412),
  ('Assembly', 'Welding',              'Seam Weld',                   true, 413),
  ('Assembly', 'Welding',              'Laser Weld',                  true, 414),
  ('Assembly', 'Welding',              'Plasma Weld',                 true, 415),
  ('Assembly', 'Welding',              'Electron Beam Weld',          true, 416),
  ('Assembly', 'Welding',              'Friction Stir Weld',          true, 417),

  ('Assembly', 'Screwing',             'Manal',                       true, 420),
  ('Assembly', 'Screwing',             'Power gun',                   true, 421),
  ('Assembly', 'Bolt Nut Assy',        'Power gun',                   true, 422),
  ('Assembly', 'Bolt Nut Assy',        'Manal',                       true, 423),
  ('Assembly', 'Electrical Connection','Wire Harness',                true, 424),
  ('Assembly', 'Electrical Connection','Connector Crimping',          true, 425),
  ('Assembly', 'Electrical Connection','PCB Assembly',                true, 426),

  ('Assembly', 'Adhesive Bonding',     'Manual Bonding',              true, 430),
  ('Assembly', 'Adhesive Bonding',     'Dispensing Robot',            true, 431),

  ('Assembly', 'Debur',                'Manual Debur',                true, 440),
  ('Assembly', 'Weld Cleaning',        'Manual',                      true, 441),
  ('Assembly', 'Weld Cleaning',        'Semi automated-Sanding',      true, 442),

-- ════════════════════════════════════════════════════════════════════════════
-- POST PROCESSING — Surface Treatment / Protection
-- ════════════════════════════════════════════════════════════════════════════

  ('Post Processing', 'Surface Protection', 'Degrease',                  true, 500),
  ('Post Processing', 'Surface Protection', 'Phosphating',               true, 501),
  ('Post Processing', 'Surface Protection', 'Blackning',                 true, 502),
  ('Post Processing', 'Surface Protection', 'Black Oxide',               true, 503),
  ('Post Processing', 'Surface Protection', 'Plating',                   true, 504),
  ('Post Processing', 'Surface Protection', 'Zinc Plating',              true, 505),
  ('Post Processing', 'Surface Protection', 'Zinc Nickel plating',       true, 506),
  ('Post Processing', 'Surface Protection', 'Nickel Plating',            true, 507),
  ('Post Processing', 'Surface Protection', 'Nickel Chrome Plating',     true, 508),
  ('Post Processing', 'Surface Protection', 'Hard Chrome plating',       true, 509),
  ('Post Processing', 'Surface Protection', 'Chrome Plating',            true, 510),
  ('Post Processing', 'Surface Protection', 'Electroless Nickel',        true, 511),
  ('Post Processing', 'Surface Protection', 'Passivation',               true, 512),
  ('Post Processing', 'Surface Protection', 'Anodizing Type I',          true, 513),
  ('Post Processing', 'Surface Protection', 'Anodizing Type II',         true, 514),
  ('Post Processing', 'Surface Protection', 'Anodizing Type III',        true, 515),
  ('Post Processing', 'Surface Protection', 'Anodising',                 true, 516),
  ('Post Processing', 'Surface Protection', 'Hard Anodising',            true, 517),
  ('Post Processing', 'Surface Protection', 'Type III Hardcoat',         true, 518),
  ('Post Processing', 'Surface Protection', 'Manual Paint primer',       true, 519),
  ('Post Processing', 'Surface Protection', 'Manual Paint finish Coat',  true, 520),
  ('Post Processing', 'Surface Protection', 'Manual Paint hand Cleaning',true, 521),
  ('Post Processing', 'Surface Protection', 'Manual Paint hand Sanding', true, 522),
  ('Post Processing', 'Surface Protection', 'Masking',                   true, 523),
  ('Post Processing', 'Surface Protection', 'Powder Coating',            true, 524),
  ('Post Processing', 'Surface Protection', 'ED Coating',                true, 525),
  ('Post Processing', 'Surface Protection', 'PVD Coating',               true, 526),
  ('Post Processing', 'Surface Protection', 'CVD Coating',               true, 527),
  ('Post Processing', 'Surface Protection', 'Tin Plating',               true, 528),

-- ════════════════════════════════════════════════════════════════════════════
-- POST PROCESSING — Heat Treatment
-- ════════════════════════════════════════════════════════════════════════════

  ('Post Processing', 'Heat Treatment', 'Surface Harden',            true, 540),
  ('Post Processing', 'Heat Treatment', 'Through Harden',            true, 541),
  ('Post Processing', 'Heat Treatment', 'Anneal',                    true, 542),
  ('Post Processing', 'Heat Treatment', 'Annealing',                 true, 543),
  ('Post Processing', 'Heat Treatment', 'Temper',                    true, 544),
  ('Post Processing', 'Heat Treatment', 'Normalising',               true, 545),
  ('Post Processing', 'Heat Treatment', 'Hardening & Tempering',     true, 546),
  ('Post Processing', 'Heat Treatment', 'Carburising',               true, 547),
  ('Post Processing', 'Heat Treatment', 'Carburizing',               true, 548),
  ('Post Processing', 'Heat Treatment', 'Nitriding',                 true, 549),
  ('Post Processing', 'Heat Treatment', 'Stress Relieving',          true, 550),
  ('Post Processing', 'Heat Treatment', 'Age Hardening',             true, 551),
  ('Post Processing', 'Heat Treatment', 'Solution Annealing',        true, 552),
  ('Post Processing', 'Heat Treatment', 'Induction Hardening',       true, 553),

-- ════════════════════════════════════════════════════════════════════════════
-- POST PROCESSING — Deburring (for machined parts — distinct from Assembly/Debur)
-- ════════════════════════════════════════════════════════════════════════════

  ('Post Processing', 'Deburring', 'Hand Deburring',         true, 560),
  ('Post Processing', 'Deburring', 'Tumble Deburring',       true, 561),
  ('Post Processing', 'Deburring', 'Vibratory Deburring',    true, 562),
  ('Post Processing', 'Deburring', 'Robotic Deburring',      true, 563),
  ('Post Processing', 'Deburring', 'Cleaning',               true, 564),
  ('Post Processing', 'Deburring', 'Marking',                true, 565),

-- ════════════════════════════════════════════════════════════════════════════
-- POST PROCESSING — Inspection
-- ════════════════════════════════════════════════════════════════════════════

  ('Post Processing', 'Inspection', 'CMM Inspection',           true, 570),
  ('Post Processing', 'Inspection', 'Manual Inspection',        true, 571),
  ('Post Processing', 'Inspection', 'Final Inspection',         true, 572),
  ('Post Processing', 'Inspection', 'Dimensional Inspection',   true, 573),
  ('Post Processing', 'Inspection', 'Visual Inspection',        true, 574),
  ('Post Processing', 'Inspection', 'First Article Inspection', true, 575),
  ('Post Processing', 'Inspection', 'In-Process Inspection',    true, 576),
  ('Post Processing', 'Inspection', 'Go / No-Go Gauging',       true, 577),

-- ════════════════════════════════════════════════════════════════════════════
-- POST PROCESSING — Testing / NDT
-- ════════════════════════════════════════════════════════════════════════════

  ('Post Processing', 'Testing', 'Leak test',         true, 580),
  ('Post Processing', 'Testing', 'Ultrasonic Test',   true, 581),
  ('Post Processing', 'Testing', 'MPT',               true, 582),
  ('Post Processing', 'Testing', 'Dye Penetrant',     true, 583),
  ('Post Processing', 'Testing', 'X-Ray',             true, 584),
  ('Post Processing', 'Testing', 'Hardness Test',     true, 585),
  ('Post Processing', 'Testing', 'Tensile Test',      true, 586),

-- ════════════════════════════════════════════════════════════════════════════
-- PACKING & DELIVERY
-- ════════════════════════════════════════════════════════════════════════════

  ('Packing & Delivery', 'Packing',  'Wooden Box Packing',        true, 600),
  ('Packing & Delivery', 'Packing',  'Corrugated box packing',    true, 601),
  ('Packing & Delivery', 'Packing',  'Pallet',                    true, 602),
  ('Packing & Delivery', 'Packing',  'Blister / Tray Packing',    true, 603),
  ('Packing & Delivery', 'Packing',  'Bubble Wrap',               true, 604),
  ('Packing & Delivery', 'Packing',  'VCI Packaging',             true, 605),
  ('Packing & Delivery', 'Delivery', 'Ex',                        true, 610),
  ('Packing & Delivery', 'Delivery', 'FCA',                       true, 611),
  ('Packing & Delivery', 'Delivery', 'DDP',                       true, 612),
  ('Packing & Delivery', 'Delivery', 'FOB',                       true, 613),
  ('Packing & Delivery', 'Delivery', 'CIF',                       true, 614)

ON CONFLICT (process_group, process_route, operation) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- Verify row count after insert
-- ════════════════════════════════════════════════════════════════════════════
SELECT process_group, COUNT(*) AS ops
FROM process_calculator_mappings
WHERE is_active = true
GROUP BY process_group
ORDER BY process_group;
