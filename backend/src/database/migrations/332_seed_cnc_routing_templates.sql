-- Migration 332: Seed CNC milled + turned routing templates with conditional steps
--
-- Root cause of the "missing Tapping/Anodize/CMM/Cleaning" routing bug: the only
-- CNC routing template lives in the production DB with 3 bare steps, so the
-- deterministic planner (which emits one route line per template step) could
-- never show tapping — while the cost engine charged for it independently.
--
-- This seed pairs with two code changes:
--   1. DeterministicPlannerService now matches condition_feature case-insensitively
--      with '|'-separated alternatives ("ANODIZE|PLATE"). Feature types are
--      UPPER_SNAKE — earlier lowercase seeds ("bend") never matched (see 333).
--   2. The planner also merges rule-engine mandatory ops not covered by the
--      template (CMM Inspection is intentionally left to that merge — it fires
--      from GD&T/tolerance analysis, which a static template cannot express).
--
-- Delete-and-reinsert (318 pattern), restricted to is_system=true standard
-- templates so user-authored templates are never touched.

DELETE FROM part_family_routing_templates
WHERE part_family IN ('cnc_milled', 'cnc_turned')
  AND complexity_level = 'standard'
  AND is_system = true;

INSERT INTO part_family_routing_templates
  (part_family, template_name, complexity_level, routing_sequence, is_system, applicable_materials, notes)
VALUES (
  'cnc_milled',
  'CNC Milled (standard)',
  'standard',
  '[
    {
      "step": 10,
      "process": "Saw Cut",
      "required": true,
      "machine_type": "saw",
      "description": "Saw cut billet/blank to size from bar or plate stock"
    },
    {
      "step": 20,
      "process": "CNC Milling",
      "required": true,
      "machine_type": "cnc_mill",
      "description": "Rough and finish milling: faces, pockets, profiles, slots"
    },
    {
      "step": 30,
      "process": "Drilling",
      "required": false,
      "machine_type": "cnc_mill",
      "condition_feature": "AXIAL_HOLE|CROSS_HOLE",
      "description": "Drill and bore all holes on the machining center"
    },
    {
      "step": 40,
      "process": "Tapping",
      "required": false,
      "machine_type": "cnc_mill",
      "condition_feature": "THREAD_INTERNAL",
      "description": "Rigid tap all internal threads per drawing callouts"
    },
    {
      "step": 50,
      "process": "Deburring",
      "required": true,
      "machine_type": "bench_manual",
      "description": "Deburr all machined edges, holes, and tapped features"
    },
    {
      "step": 60,
      "process": "Cleaning / Degreasing",
      "required": false,
      "machine_type": "cleaning",
      "condition_feature": "ANODIZE|PLATE|HEAT_TREAT",
      "description": "Wash and degrease before surface or heat treatment — oil residue fails adhesion"
    },
    {
      "step": 70,
      "process": "Surface Treatment",
      "required": false,
      "machine_type": "surface_treatment",
      "condition_feature": "ANODIZE|PLATE",
      "description": "Anodize / plate / coat per drawing surface treatment callout"
    },
    {
      "step": 80,
      "process": "Final Inspection",
      "required": true,
      "machine_type": "inspection_bench",
      "description": "Dimensional inspection against drawing (CMM step added automatically when GD&T demands it)"
    }
  ]'::jsonb,
  true,
  ARRAY[
    'Aluminium', 'AL6061', 'AL7075', 'Mild Steel', 'EN8', 'EN19',
    'Stainless Steel', 'SS304', 'SS316', 'Tool Steel', 'Brass', 'Delrin', 'Nylon'
  ],
  'Standard CNC milled routing: Saw Cut → CNC Milling → Drilling* → Tapping* → Deburring → Cleaning* → Surface Treatment* → Final Inspection (* conditional on features)'
);

INSERT INTO part_family_routing_templates
  (part_family, template_name, complexity_level, routing_sequence, is_system, applicable_materials, notes)
VALUES (
  'cnc_turned',
  'CNC Turned (standard)',
  'standard',
  '[
    {
      "step": 10,
      "process": "Saw Cut",
      "required": true,
      "machine_type": "saw",
      "description": "Saw cut bar stock to blank length (skipped operationally for bar-fed work)"
    },
    {
      "step": 20,
      "process": "CNC Turning",
      "required": true,
      "machine_type": "cnc_lathe",
      "description": "OD/ID turning, facing, grooving, and parting"
    },
    {
      "step": 30,
      "process": "Drilling",
      "required": false,
      "machine_type": "cnc_lathe",
      "condition_feature": "AXIAL_HOLE|CROSS_HOLE|ID_BORE",
      "description": "Drill and bore axial/cross holes on the lathe or a secondary op"
    },
    {
      "step": 40,
      "process": "Tapping",
      "required": false,
      "machine_type": "cnc_lathe",
      "condition_feature": "THREAD_INTERNAL",
      "description": "Tap internal threads per drawing callouts"
    },
    {
      "step": 50,
      "process": "Deburring",
      "required": true,
      "machine_type": "bench_manual",
      "description": "Deburr all machined edges and cross-hole breakthroughs"
    },
    {
      "step": 60,
      "process": "Cleaning / Degreasing",
      "required": false,
      "machine_type": "cleaning",
      "condition_feature": "ANODIZE|PLATE|HEAT_TREAT",
      "description": "Wash and degrease before surface or heat treatment — oil residue fails adhesion"
    },
    {
      "step": 70,
      "process": "Surface Treatment",
      "required": false,
      "machine_type": "surface_treatment",
      "condition_feature": "ANODIZE|PLATE",
      "description": "Anodize / plate / coat per drawing surface treatment callout"
    },
    {
      "step": 80,
      "process": "Final Inspection",
      "required": true,
      "machine_type": "inspection_bench",
      "description": "Dimensional inspection against drawing (CMM step added automatically when GD&T demands it)"
    }
  ]'::jsonb,
  true,
  ARRAY[
    'Mild Steel', 'EN8', 'EN19', 'Stainless Steel', 'SS304', 'SS316',
    'Aluminium', 'AL6061', 'Brass', 'Delrin', 'Nylon'
  ],
  'Standard CNC turned routing: Saw Cut → CNC Turning → Drilling* → Tapping* → Deburring → Cleaning* → Surface Treatment* → Final Inspection (* conditional on features)'
);
