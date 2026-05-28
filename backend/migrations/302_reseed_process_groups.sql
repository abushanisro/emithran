-- ============================================================================
-- Migration: Reseed Process Calculator Mappings with Standard Process Groups
-- Clears all existing mappings and seeds with the standard process group list.
-- Each group gets one placeholder entry (route = 'General', operation = 'General').
-- Add real routes/operations via the Process page → Add Mapping.
-- ============================================================================

-- Clear all existing process calculator mappings
DELETE FROM process_calculator_mappings;

-- Seed standard process groups
INSERT INTO process_calculator_mappings (process_group, process_route, operation, is_active, display_order)
VALUES
  ('2-Model Machining',            'General', 'General', true,  1),
  ('Additive Manufacturing',       'General', 'General', true,  2),
  ('Assembly',                     'General', 'General', true,  3),
  ('Assembly Molding',             'General', 'General', true,  4),
  ('Assembly Plastic Molding',     'General', 'General', true,  5),
  ('Bar & Tube Fab',               'General', 'General', true,  6),
  ('Casting',                      'General', 'General', true,  7),
  ('Casting - Die',                'General', 'General', true,  8),
  ('Casting - Investment',         'General', 'General', true,  9),
  ('Casting - Sand',               'General', 'General', true, 10),
  ('Composites',                   'General', 'General', true, 11),
  ('Forging',                      'General', 'General', true, 12),
  ('Heat Treatment',               'General', 'General', true, 13),
  ('Machining',                    'General', 'General', true, 14),
  ('Multi-Spindle Machining',      'General', 'General', true, 15),
  ('Other Secondary Processes',    'General', 'General', true, 16),
  ('PCB',                          'General', 'General', true, 17),
  ('Part Assembly',                'General', 'General', true, 18),
  ('Plastic Molding',              'General', 'General', true, 19),
  ('Powder Metal',                 'General', 'General', true, 20),
  ('Rapid Prototyping',            'General', 'General', true, 21),
  ('Roto & Blow Molding',          'General', 'General', true, 22),
  ('Sheet Metal',                  'General', 'General', true, 23),
  ('Sheet Metal - Hydroforming',   'General', 'General', true, 24),
  ('Sheet Metal - Roll Forming',   'General', 'General', true, 25),
  ('Sheet Metal - Stretch Forming','General', 'General', true, 26),
  ('Sheet Metal - Transfer Die',   'General', 'General', true, 27),
  ('Sheet Plastic',                'General', 'General', true, 28),
  ('Stock Machining',              'General', 'General', true, 29),
  ('Surface Treatment',            'General', 'General', true, 30);
