-- Migration 317: Seed sheet metal routing template + process master rows
-- Enables deterministic planning for sheet metal parts (Laser Cut → Press Brake → Deburr → Inspect).
-- Required by: ScopeClassifierService (fixed in this release) now correctly identifies
-- sheet metal frames. Without this data the orchestrator falls back to engineering_review_required.

-- ── Block A: Routing template ────────────────────────────────────────────────
-- ManufacturingKnowledgeService.getTemplate() queries:
--   .eq('part_family', 'sheet_metal').eq('complexity_level', 'standard')
-- machine_type values must match DeterministicPlannerService.MACHINE_TYPE_KEYWORDS keys:
--   laser_cut, press_brake, bench_manual, inspection_bench

INSERT INTO part_family_routing_templates
  (part_family, template_name, complexity_level, routing_sequence, is_system, applicable_materials, notes)
VALUES (
  'sheet_metal',
  'Sheet Metal (standard)',
  'standard',
  '[
    {
      "step": 10,
      "process": "Laser Cut",
      "required": true,
      "machine_type": "laser_cut",
      "description": "Laser cut profile, holes, slots, and outer contour from sheet"
    },
    {
      "step": 20,
      "process": "Press Brake Bend",
      "required": false,
      "machine_type": "press_brake",
      "description": "Bend flanges and forms per drawing bend table"
    },
    {
      "step": 30,
      "process": "Deburr",
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
  'Standard sheet metal routing: Laser Cut → Press Brake → Deburr → Inspect'
)
ON CONFLICT DO NOTHING;

-- ── Block B: Process master rows ─────────────────────────────────────────────
-- DeterministicPlannerService.findProcessCandidate() matches each routing step
-- against (process_group, process_route, operation) via keyword search.
-- Unique constraint: uq_process_calculator_mapping (process_group, process_route, operation)
-- added in migration 303.

INSERT INTO process_calculator_mappings
  (process_group, process_route, operation, is_active, display_order)
VALUES
  ('Sheet Metal', 'Laser Cutting',     'Laser Cut',           true, 200),
  ('Sheet Metal', 'Laser Cutting',     'Fiber Laser Cut',     true, 201),
  ('Sheet Metal', 'Press Brake',       'Bend',                true, 210),
  ('Sheet Metal', 'Press Brake',       'Form',                true, 211),
  ('Sheet Metal', 'Press Brake',       'Press Brake Bend',    true, 212),
  ('Sheet Metal', 'Finishing',         'Deburr',              true, 220),
  ('Sheet Metal', 'Finishing',         'Edge Finish',         true, 221),
  ('Sheet Metal', 'Inspection',        'Inspect',             true, 230),
  ('Sheet Metal', 'Inspection',        'Dimensional Inspect', true, 231),
  ('Sheet Metal', 'Surface Treatment', 'Powder Coat',         true, 240),
  ('Sheet Metal', 'Surface Treatment', 'Paint',               true, 241),
  ('Sheet Metal', 'Surface Treatment', 'Anodize',             true, 242)
ON CONFLICT (process_group, process_route, operation) DO NOTHING;
