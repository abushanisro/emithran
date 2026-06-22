-- Manufacturing Knowledge Base V1
-- 6 tables that give the AI process planner ground-truth manufacturing knowledge
-- Idempotent: safe to run multiple times

-- ============================================================
-- 1. feature_process_mapping
-- ============================================================
create table if not exists feature_process_mapping (
  id                   uuid primary key default gen_random_uuid(),
  feature_type         text not null,
  primary_process      text not null,
  secondary_processes  text[],
  prerequisite_process text,
  typical_tool_type    text,
  typical_machine_type text,
  applies_to_families  text[],
  notes                text,
  is_system            boolean not null default true,
  owner_id             uuid references auth.users(id),
  created_at           timestamptz default now(),
  unique(feature_type, primary_process)
);

-- ============================================================
-- 2. machine_capabilities
-- ============================================================
create table if not exists machine_capabilities (
  id                    uuid primary key default gen_random_uuid(),
  machine_name          text not null,
  machine_type          text not null,
  supported_processes   text[] not null,
  min_tolerance_mm      numeric(8,4),
  max_part_length_mm    numeric(10,2),
  max_part_diameter_mm  numeric(10,2),
  max_spindle_rpm       int,
  supported_materials   text[],
  mhr_id                uuid,
  is_system             boolean not null default false,
  owner_id              uuid references auth.users(id),
  created_at            timestamptz default now()
);

-- ============================================================
-- 3. process_routing_rules
-- ============================================================
create table if not exists process_routing_rules (
  id                  uuid primary key default gen_random_uuid(),
  rule_name           text not null,
  rule_type           text not null check (rule_type in ('sequence','dependency','exclusion')),
  first_process       text not null,
  second_process      text not null,
  constraint_type     text not null check (constraint_type in ('must_precede','must_follow','cannot_coexist')),
  applies_to_families text[],
  severity            text not null check (severity in ('error','warning')),
  message             text not null,
  suggested_fix       text,
  is_system           boolean not null default true,
  owner_id            uuid references auth.users(id),
  created_at          timestamptz default now()
);

-- ============================================================
-- 4. part_family_routing_templates
-- ============================================================
create table if not exists part_family_routing_templates (
  id                    uuid primary key default gen_random_uuid(),
  part_family           text not null check (part_family in (
                          'cnc_turned','cnc_milled','sheet_metal','laser_cut',
                          'casting','forging','injection_molded','fabrication','press_brake'
                        )),
  template_name         text not null,
  complexity_level      text check (complexity_level in ('simple','standard','complex')),
  routing_sequence      jsonb not null,
  applicable_materials  text[],
  notes                 text,
  is_system             boolean not null default true,
  owner_id              uuid references auth.users(id),
  created_at            timestamptz default now(),
  unique(part_family, template_name)
);

-- ============================================================
-- 5. machine_process_mapping
-- ============================================================
create table if not exists machine_process_mapping (
  id               uuid primary key default gen_random_uuid(),
  feature_type     text not null,
  process_key      text not null,
  machine_type     text not null,
  applies_to_family text,
  applies_when     jsonb,
  priority         int not null default 100,
  is_required      boolean not null default false,
  notes            text,
  is_system        boolean not null default true,
  owner_id         uuid references auth.users(id),
  created_at       timestamptz default now()
);

-- ============================================================
-- 6. process_plan_feedback
-- ============================================================
create table if not exists process_plan_feedback (
  id                    uuid primary key default gen_random_uuid(),
  bom_item_id           uuid not null,
  owner_id              uuid not null references auth.users(id),
  ai_process_sequence   jsonb not null,
  ai_machines           jsonb,
  engineer_sequence     jsonb not null,
  engineer_machines     jsonb,
  correction_reason     text,
  part_family           text,
  material              text,
  is_training_candidate boolean not null default false,
  created_at            timestamptz default now()
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table feature_process_mapping       enable row level security;
alter table machine_capabilities          enable row level security;
alter table process_routing_rules         enable row level security;
alter table part_family_routing_templates enable row level security;
alter table machine_process_mapping       enable row level security;
alter table process_plan_feedback         enable row level security;

do $$ begin
  create policy "fpm_read" on feature_process_mapping
    for select using (is_system = true or owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "fpm_insert" on feature_process_mapping
    for insert with check (owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "fpm_update" on feature_process_mapping
    for update using (owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "mc_read" on machine_capabilities
    for select using (is_system = true or owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "mc_insert" on machine_capabilities
    for insert with check (owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "mc_update" on machine_capabilities
    for update using (owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "prr_read" on process_routing_rules
    for select using (is_system = true or owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "prr_insert" on process_routing_rules
    for insert with check (owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "prr_update" on process_routing_rules
    for update using (owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "pfrt_read" on part_family_routing_templates
    for select using (is_system = true or owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "pfrt_insert" on part_family_routing_templates
    for insert with check (owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "mpm_read" on machine_process_mapping
    for select using (is_system = true or owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "mpm_insert" on machine_process_mapping
    for insert with check (owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "mpm_update" on machine_process_mapping
    for update using (owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "ppf_owner" on process_plan_feedback
    for all using (owner_id = auth.uid());
exception when duplicate_object then null; end $$;


-- ── SEED DATA ─────────────────────────────────────────────────────────────────

-- feature_process_mapping — ON CONFLICT DO NOTHING so re-runs are safe
insert into feature_process_mapping (feature_type, primary_process, secondary_processes, prerequisite_process, typical_tool_type, typical_machine_type, notes, is_system) values
  ('hole',              'drilling',       ARRAY['reaming','boring'],    null,         'twist_drill',  'vmc',         'Standard through/blind holes',           true),
  ('thread_internal',   'tapping',        null,                         'drilling',   'tap',          'vmc',         'Must drill pilot first',                 true),
  ('thread_external',   'turning',        ARRAY['thread_milling'],      null,         'insert_tool',  'lathe',       'OD thread on turned parts',              true),
  ('pocket',            'end_milling',    ARRAY['roughing'],            null,         'end_mill',     'vmc',         'Closed pocket milling',                  true),
  ('slot',              'end_milling',    null,                         null,         'end_mill',     'vmc',         'Open slot milling',                      true),
  ('od_turn',           'rough_turning',  ARRAY['finish_turning'],      null,         'insert_tool',  'lathe',       'OD turning operations',                  true),
  ('surface',           'face_milling',   ARRAY['grinding'],            null,         'face_mill',    'vmc',         'Flat surface operations',                true),
  ('boss',              'turning',        null,                         null,         'insert_tool',  'lathe',       'Turned boss or raised feature',          true),
  ('chamfer',           'chamfering',     null,                         null,         'chamfer_tool', 'vmc',         'Chamfer on edge or hole',                true),
  ('fillet',            'end_milling',    null,                         null,         'ball_end_mill','vmc',         'Internal radius / fillet milling',       true),
  ('profile_2d',        'laser_cutting',  null,                         null,         null,           'laser',       'Sheet metal outer profile',              true),
  ('bend',              'press_braking',  null,                         'laser_cutting','punch_die',  'press_brake', 'Forming bends in sheet metal',           true),
  ('louver',            'punching',       null,                         null,         'louver_die',   'punch_press', 'Sheet metal louvers',                    true),
  ('extrusion_feature', 'forming',        null,                         'laser_cutting','form_die',   'press_brake', 'Extruded holes or ribs in sheet metal',  true),
  ('countersink',       'countersinking', null,                         'drilling',   'countersink',  'vmc',         'Must drill pilot first',                 true),
  ('flange',            'forming',        null,                         'laser_cutting','flange_die', 'press_brake', 'Sheet metal flange forming',             true),
  ('id_bore',           'boring',         ARRAY['honing'],              null,         'boring_bar',   'lathe',       'Internal diameter boring',               true),
  ('keyway',            'broaching',      null,                         null,         'broach',       'lathe',       'Internal keyway broaching',              true),
  ('spline',            'hobbing',        null,                         null,         'hob',          'hobbing_machine','Spline/gear hobbing',               true),
  ('groove',            'grooving',       null,                         null,         'grooving_tool','lathe',       'OD/ID groove turning',                   true)
on conflict (feature_type, primary_process) do nothing;


-- machine_process_mapping
insert into machine_process_mapping (feature_type, process_key, machine_type, applies_to_family, priority, notes, is_system) values
  ('hole',            'drilling',      'lathe',      'cnc_turned',  1,   'Cross holes on shaft use lathe live tooling',   true),
  ('hole',            'drilling',      'vmc',        'cnc_milled',  1,   'Standard VMC drilling for milled parts',        true),
  ('hole',            'drilling',      'vmc',        null,          2,   'Default fallback machine for drilling',         true),
  ('thread_internal', 'tapping',       'lathe',      'cnc_turned',  1,   'Tapping on lathe with live tooling',           true),
  ('thread_internal', 'tapping',       'vmc',        'cnc_milled',  1,   'VMC tapping for milled parts',                 true),
  ('od_turn',         'rough_turning', 'lathe',      'cnc_turned',  1,   'Lathe REQUIRED for OD turning',                true),
  ('od_turn',         'finish_turning','lathe',      'cnc_turned',  1,   'Lathe REQUIRED for finish OD',                 true),
  ('profile_2d',      'laser_cutting', 'laser',      null,          1,   'Laser cutter REQUIRED for 2D profile',         true),
  ('bend',            'press_braking', 'press_brake',null,          1,   'Press brake REQUIRED for bending',             true),
  ('surface',         'grinding',      'grinder',    null,          1,   'Surface grinder for precision surfaces',        true)
on conflict do nothing;


-- process_routing_rules
insert into process_routing_rules (rule_name, rule_type, first_process, second_process, constraint_type, applies_to_families, severity, message, suggested_fix, is_system) values
  ('drill_before_tap',    'sequence',   'drilling',      'tapping',          'must_precede', null,                         'error',   'Drilling must precede tapping — tap has no pilot hole to follow',                                 'Add a drilling operation before tapping',          true),
  ('heat_before_finish',  'sequence',   'heat_treat',    'finish_machine',   'must_precede', null,                         'error',   'Heat treatment must precede finish machining — distortion after heat treat ruins finish dimensions','Move heat treatment before finish machining',      true),
  ('coat_after_machine',  'sequence',   'machining',     'surface_coating',  'must_precede', null,                         'error',   'All machining must complete before surface coating — coating cannot be machined after',            'Move surface coating to the end of the route',    true),
  ('laser_before_bend',   'sequence',   'laser_cutting', 'press_braking',    'must_precede', ARRAY['sheet_metal','cnc_milled'],'error','Laser cutting must precede press braking — cannot bend what has not been cut',                    'Add laser cutting before bending',                 true),
  ('grind_after_heat',    'sequence',   'heat_treat',    'grinding',         'must_precede', null,                         'error',   'Heat treatment must precede grinding — grinding after heat treat achieves final precision dims',    'Move heat treatment before grinding',              true),
  ('inspect_after_crit',  'sequence',   'finish_milling','inspection',       'must_precede', null,                         'warning', 'Inspection should follow finish milling to verify critical dimensions',                             'Add an inspection step after finish milling',      true),
  ('deburr_before_assy',  'sequence',   'milling',       'assembly',         'must_precede', null,                         'warning', 'Deburring should occur before assembly — burrs can cause assembly fit issues',                      'Add deburring between milling and assembly',       true),
  ('weld_before_pwht',    'sequence',   'welding',       'post_weld_ht',     'must_precede', ARRAY['fabrication'],         'warning', 'Welding must precede post-weld heat treatment',                                                    'Ensure all welds are completed before PWHT',       true)
on conflict do nothing;


-- part_family_routing_templates
insert into part_family_routing_templates (part_family, template_name, complexity_level, routing_sequence, notes, is_system) values
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
      {"step": 80, "process": "inspection",    "required": true,  "machine_type": "cmm",   "description": "Final dimensional inspection"}
    ]'::jsonb,
    'Standard CNC milling route for blocks, brackets, housings',
    true
  ),
  (
    'sheet_metal',
    'Sheet Metal (standard)',
    'standard',
    '[
      {"step": 10, "process": "laser_cutting", "required": true,  "machine_type": "laser",       "description": "Laser cut outer profile and holes from sheet"},
      {"step": 20, "process": "deburr",        "required": true,  "machine_type": "bench",       "description": "Deburr cut edges"},
      {"step": 30, "process": "press_braking", "required": false, "machine_type": "press_brake", "description": "Bend to form"},
      {"step": 40, "process": "welding",       "required": false, "machine_type": "welder",      "description": "Weld sub-assemblies if required"},
      {"step": 50, "process": "surface_treatment","required":true,"machine_type": "paint_line",  "description": "Powder coat or zinc plate"},
      {"step": 60, "process": "inspection",    "required": true,  "machine_type": "bench",       "description": "Final inspection"}
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
      {"step": 10, "process": "laser_cutting", "required": true,  "machine_type": "laser",       "description": "Laser/plasma cut all flat components"},
      {"step": 20, "process": "press_braking", "required": false, "machine_type": "press_brake", "description": "Bend formed components"},
      {"step": 30, "process": "sub_assembly",  "required": false, "machine_type": "bench",       "description": "Fit and tack sub-assemblies"},
      {"step": 40, "process": "welding",       "required": true,  "machine_type": "welder",      "description": "Full weld fabrication"},
      {"step": 50, "process": "post_weld_ht",  "required": false, "machine_type": "furnace",     "description": "Post-weld heat treatment if required"},
      {"step": 60, "process": "grind_welds",   "required": true,  "machine_type": "grinder",     "description": "Grind welds smooth"},
      {"step": 70, "process": "surface_treatment","required":true, "machine_type":"paint_line",  "description": "Blast and paint"},
      {"step": 80, "process": "inspection",    "required": true,  "machine_type": "bench",       "description": "Final inspection"}
    ]'::jsonb,
    'Structural fabrication weldment route',
    true
  )
on conflict (part_family, template_name) do nothing;
