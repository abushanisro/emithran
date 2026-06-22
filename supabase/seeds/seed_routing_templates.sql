-- Run this in Supabase SQL Editor if part_family_routing_templates is empty.
-- Safe to re-run — ON CONFLICT DO NOTHING skips existing rows.

insert into part_family_routing_templates (part_family, template_name, complexity_level, routing_sequence, notes, is_system)
values
  (
    'cnc_turned',
    'CNC Turned (standard)',
    'standard',
    '[
      {"step": 10, "process": "saw_cut",       "required": true,  "machine_type": "saw",   "description": "Cut bar stock to length"},
      {"step": 20, "process": "facing",         "required": true,  "machine_type": "lathe", "description": "Face both ends to length"},
      {"step": 30, "process": "rough_turning",  "required": true,  "machine_type": "lathe", "description": "Rough turn OD to within 0.5mm"},
      {"step": 40, "process": "finish_turning", "required": true,  "machine_type": "lathe", "description": "Finish turn OD to drawing dimension"},
      {"step": 50, "process": "drilling",       "required": false, "machine_type": "lathe", "description": "Drill axial or cross holes (live tooling)"},
      {"step": 60, "process": "tapping",        "required": false, "machine_type": "lathe", "description": "Tap internal threads"},
      {"step": 70, "process": "deburr",         "required": true,  "machine_type": "bench", "description": "Deburr all edges and holes"},
      {"step": 80, "process": "inspection",     "required": true,  "machine_type": "cmm",   "description": "Final dimensional inspection"}
    ]'::jsonb,
    'Standard CNC turning route for shafts, pins, bushings',
    true
  ),
  (
    'cnc_milled',
    'CNC Milled (standard)',
    'standard',
    '[
      {"step": 10, "process": "saw_cut",       "required": true,  "machine_type": "saw",   "description": "Cut billet/plate to size"},
      {"step": 20, "process": "face_milling",  "required": true,  "machine_type": "vmc",   "description": "Mill datum face flat"},
      {"step": 30, "process": "rough_milling", "required": true,  "machine_type": "vmc",   "description": "Rough mill profiles and pockets"},
      {"step": 40, "process": "finish_milling","required": true,  "machine_type": "vmc",   "description": "Finish mill to dimension"},
      {"step": 50, "process": "drilling",      "required": false, "machine_type": "vmc",   "description": "Drill all holes"},
      {"step": 60, "process": "tapping",       "required": false, "machine_type": "vmc",   "description": "Tap threaded holes"},
      {"step": 70, "process": "deburr",        "required": true,  "machine_type": "bench", "description": "Deburr all edges"},
      {"step": 80, "process": "inspection",    "required": true,  "machine_type": "cmm",   "description": "Final inspection"}
    ]'::jsonb,
    'Standard CNC milling route for blocks, brackets, housings',
    true
  ),
  (
    'sheet_metal',
    'Sheet Metal (standard)',
    'standard',
    '[
      {"step": 10, "process": "laser_cutting",    "required": true,  "machine_type": "laser",       "description": "Laser cut outer profile and holes from sheet"},
      {"step": 20, "process": "deburr",           "required": true,  "machine_type": "bench",       "description": "Deburr cut edges"},
      {"step": 30, "process": "press_braking",    "required": false, "machine_type": "press_brake", "description": "Bend to form"},
      {"step": 40, "process": "welding",          "required": false, "machine_type": "welder",      "description": "Weld sub-assemblies if required"},
      {"step": 50, "process": "surface_treatment","required": true,  "machine_type": "paint_line",  "description": "Powder coat or zinc plate"},
      {"step": 60, "process": "inspection",       "required": true,  "machine_type": "bench",       "description": "Final inspection"}
    ]'::jsonb,
    'Standard sheet metal fabrication route',
    true
  ),
  (
    'casting',
    'Casting Machining (standard)',
    'standard',
    '[
      {"step": 10, "process": "fettling",      "required": true,  "machine_type": "bench",  "description": "Remove gates, risers, flash"},
      {"step": 20, "process": "face_milling",  "required": true,  "machine_type": "vmc",    "description": "Mill datum face"},
      {"step": 30, "process": "rough_milling", "required": true,  "machine_type": "vmc",    "description": "Rough machine casting"},
      {"step": 40, "process": "finish_milling","required": true,  "machine_type": "vmc",    "description": "Finish machine critical faces"},
      {"step": 50, "process": "drilling",      "required": false, "machine_type": "vmc",    "description": "Drill bolt holes and features"},
      {"step": 60, "process": "tapping",       "required": false, "machine_type": "vmc",    "description": "Tap threaded features"},
      {"step": 70, "process": "inspection",    "required": true,  "machine_type": "cmm",    "description": "Final inspection"}
    ]'::jsonb,
    'Casting + CNC machining route (gravity die, sand cast)',
    true
  ),
  (
    'forging',
    'Forging Machining (standard)',
    'standard',
    '[
      {"step": 10, "process": "face_milling",  "required": true,  "machine_type": "vmc",     "description": "Mill datum face on forging"},
      {"step": 20, "process": "rough_turning", "required": true,  "machine_type": "lathe",   "description": "Rough turn forging OD"},
      {"step": 30, "process": "heat_treat",    "required": true,  "machine_type": "furnace", "description": "Heat treatment / normalising"},
      {"step": 40, "process": "finish_turning","required": true,  "machine_type": "lathe",   "description": "Finish turn after heat treat"},
      {"step": 50, "process": "drilling",      "required": false, "machine_type": "vmc",     "description": "Drill bolt holes and features"},
      {"step": 60, "process": "tapping",       "required": false, "machine_type": "vmc",     "description": "Tap threads"},
      {"step": 70, "process": "grinding",      "required": false, "machine_type": "grinder", "description": "Grind precision diameters"},
      {"step": 80, "process": "inspection",    "required": true,  "machine_type": "cmm",     "description": "Final inspection"}
    ]'::jsonb,
    'Forging + CNC machining route',
    true
  ),
  (
    'fabrication',
    'Fabrication (standard)',
    'standard',
    '[
      {"step": 10, "process": "laser_cutting",    "required": true,  "machine_type": "laser",       "description": "Laser/plasma cut all flat components"},
      {"step": 20, "process": "press_braking",    "required": false, "machine_type": "press_brake", "description": "Bend formed components"},
      {"step": 30, "process": "sub_assembly",     "required": false, "machine_type": "bench",       "description": "Fit and tack sub-assemblies"},
      {"step": 40, "process": "welding",          "required": true,  "machine_type": "welder",      "description": "Full weld fabrication"},
      {"step": 50, "process": "post_weld_ht",     "required": false, "machine_type": "furnace",     "description": "Post-weld heat treatment if required"},
      {"step": 60, "process": "grind_welds",      "required": true,  "machine_type": "grinder",     "description": "Grind welds smooth"},
      {"step": 70, "process": "surface_treatment","required": true,  "machine_type": "paint_line",  "description": "Blast and paint"},
      {"step": 80, "process": "inspection",       "required": true,  "machine_type": "bench",       "description": "Final inspection"}
    ]'::jsonb,
    'Structural fabrication weldment route',
    true
  )
on conflict (part_family, template_name) do nothing;
