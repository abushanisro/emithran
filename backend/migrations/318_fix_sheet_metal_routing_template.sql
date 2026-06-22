-- Migration 318: Replace sheet metal routing template with correct step names
-- Root cause: the existing template had snake_case process names (laser_cutting,
-- press_braking, welding, surface_treatment, inspection) which caused
-- DeterministicPlannerService.findProcessCandidate() to keyword-match the wrong
-- operations (e.g. "cutting" matched "Gear Cutting" route, "press" matched "Turret Press").
--
-- Fix: delete the old template and re-insert with human-readable names that
-- match actual operations in process_calculator_mappings:
--   "Fiber Laser Cut"  → ('Sheet Metal', 'Sheet Cutting', 'Fiber laser Cutting')
--   "Bend Brake"       → ('Sheet Metal', 'Bending/Floating /Forming', 'Bend Brake')
--   "Debur"            → ('Assembly', 'Debur', 'Manual Debur')
--   "Inspect"          → ('Post Processing', 'Inspection', 'Manual Inspection')

-- Step 1: Remove all existing sheet_metal standard templates (may be multiple due to
-- previous ON CONFLICT DO NOTHING inserts landing alongside a pre-existing row)
DELETE FROM part_family_routing_templates
WHERE part_family = 'sheet_metal'
  AND complexity_level = 'standard';

-- Step 2: Insert the correct 4-step template
INSERT INTO part_family_routing_templates
  (part_family, template_name, complexity_level, routing_sequence, is_system, applicable_materials, notes)
VALUES (
  'sheet_metal',
  'Sheet Metal (standard)',
  'standard',
  '[
    {
      "step": 10,
      "process": "Fiber Laser Cut",
      "required": true,
      "machine_type": "laser_cut",
      "description": "Laser cut profile, holes, slots, and outer contour from flat sheet"
    },
    {
      "step": 20,
      "process": "Bend Brake",
      "required": false,
      "machine_type": "press_brake",
      "condition_feature": "bend",
      "description": "Bend flanges and forms per drawing bend table"
    },
    {
      "step": 30,
      "process": "Debur",
      "required": true,
      "machine_type": "bench_manual",
      "description": "Deburr all laser-cut edges and punched holes"
    },
    {
      "step": 40,
      "process": "Inspect",
      "required": true,
      "machine_type": "inspection_bench",
      "description": "Dimensional inspection against drawing"
    }
  ]'::jsonb,
  true,
  ARRAY[
    'Steel Sheet', 'CRCA', 'CRCA Sheet', 'Cold Rolled Sheet',
    'Aluminium Sheet', 'Stainless Sheet', 'Galvanized Sheet',
    'MS Sheet', 'HR Sheet'
  ],
  'Standard sheet metal routing: Fiber Laser Cut → Bend Brake → Debur → Inspect'
);
