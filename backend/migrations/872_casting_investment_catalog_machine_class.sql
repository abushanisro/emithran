-- 872: Casting Investment catalog rows, machine_class where still NULL.
-- Same step as migration 845's part 2 does for Die Casting -- links each process_taxonomy /
-- process_calculator_mappings row (created by migration 871) to the machine_class its real
-- machine file seeded (migration 869), only where the row doesn't already carry one.
-- No die/cost engine exists for Casting Investment, so the mapping rows stay INACTIVE
-- (roadmap_status stays 'not_modeled'/'non_mfg' from 871) -- this only fills machine_class.

UPDATE process_taxonomy pt
SET machine_class = v.machine_class
FROM (VALUES
  ('Band Saw', 'casting_investment_band_saw'),
  ('Belt Sand', 'casting_investment_belt_sand'),
  ('Ceramic Core Extrusion', 'casting_investment_ceramic_core_extrusion'),
  ('Ceramic Core Firing', 'casting_investment_ceramic_core_firing'),
  ('Ceramic Core Making', 'casting_investment_ceramic_core_making'),
  ('Ceramic Leaching', 'casting_investment_ceramic_leaching'),
  ('Chemical Etching', 'casting_investment_chemical_etching'),
  ('Flash Fire De-Waxing', 'casting_investment_flash_fire_de_waxing'),
  ('Knockout', 'casting_investment_knockout'),
  ('Metal Pouring', 'casting_investment_metal_pouring'),
  ('Mold Burnout', 'casting_investment_mold_burnout'),
  ('Mold Preheating', 'casting_investment_mold_preheating'),
  ('Primary Sand Coating', 'casting_investment_primary_sand_coating'),
  ('Primary Slurry Dipping', 'casting_investment_primary_slurry_dipping'),
  ('Robotic Assist', 'casting_investment_robotic_assist'),
  ('Secondary Slurry Dipping', 'casting_investment_secondary_slurry_dipping'),
  ('Soluble Wax Core Making', 'casting_investment_soluble_wax_core_making'),
  ('Soluble Wax Leaching', 'casting_investment_soluble_wax_leaching'),
  ('Steam Autoclave De-Waxing', 'casting_investment_steam_autoclave_de_waxing'),
  ('Wax Pattern Molding', 'casting_investment_wax_pattern_molding')
) AS v(process_name, machine_class)
WHERE pt.process_group = 'Casting Investment' AND pt.process_name = v.process_name AND pt.machine_class IS NULL;

UPDATE process_calculator_mappings pcm
SET machine_class = v.machine_class, updated_at = now()
FROM (VALUES
  ('Band Saw', 'casting_investment_band_saw'),
  ('Belt Sand', 'casting_investment_belt_sand'),
  ('Ceramic Core Extrusion', 'casting_investment_ceramic_core_extrusion'),
  ('Ceramic Core Firing', 'casting_investment_ceramic_core_firing'),
  ('Ceramic Core Making', 'casting_investment_ceramic_core_making'),
  ('Ceramic Leaching', 'casting_investment_ceramic_leaching'),
  ('Chemical Etching', 'casting_investment_chemical_etching'),
  ('Flash Fire De-Waxing', 'casting_investment_flash_fire_de_waxing'),
  ('Knockout', 'casting_investment_knockout'),
  ('Metal Pouring', 'casting_investment_metal_pouring'),
  ('Mold Burnout', 'casting_investment_mold_burnout'),
  ('Mold Preheating', 'casting_investment_mold_preheating'),
  ('Primary Sand Coating', 'casting_investment_primary_sand_coating'),
  ('Primary Slurry Dipping', 'casting_investment_primary_slurry_dipping'),
  ('Robotic Assist', 'casting_investment_robotic_assist'),
  ('Secondary Slurry Dipping', 'casting_investment_secondary_slurry_dipping'),
  ('Soluble Wax Core Making', 'casting_investment_soluble_wax_core_making'),
  ('Soluble Wax Leaching', 'casting_investment_soluble_wax_leaching'),
  ('Steam Autoclave De-Waxing', 'casting_investment_steam_autoclave_de_waxing'),
  ('Wax Pattern Molding', 'casting_investment_wax_pattern_molding')
) AS v(operation, machine_class)
WHERE pcm.process_group = 'Casting Investment' AND pcm.operation = v.operation AND pcm.machine_class IS NULL;

NOTIFY pgrst, 'reload schema';

-- Not linked, with the reason: Bench Operation, Cooling, Drying, Secondary Sand Coating are
-- real processes (migration 871) with no real machine_class -- their own machine files were
-- placeholder "Default" values, never seeded (migration 869's own disclosed exclusions).
--
-- Verify (expect 20 of 25 processes with machine_class set):
-- SELECT process_name, machine_class FROM process_taxonomy
--   WHERE process_group = 'Casting Investment' ORDER BY process_name;
