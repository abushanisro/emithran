-- 875: link Secondary Sand Coating's catalog row to its machine_class.
-- memory/Countries data/India_XML_Data_.csv confirmed Secondary Sand Coating is its own real
-- process (same VATECH RS300250 model as Primary, but a distinct process role) -- migration 869
-- was corrected to seed it as its own mhr_records row (casting_investment_secondary_sand_coating),
-- closing the gap migration 872 had to leave unlinked. Same two-table step as 872, one process.

UPDATE process_taxonomy
SET machine_class = 'casting_investment_secondary_sand_coating'
WHERE process_group = 'Casting Investment' AND process_name = 'Secondary Sand Coating' AND machine_class IS NULL;

UPDATE process_calculator_mappings
SET machine_class = 'casting_investment_secondary_sand_coating', updated_at = now()
WHERE process_group = 'Casting Investment' AND operation = 'Secondary Sand Coating' AND machine_class IS NULL;

NOTIFY pgrst, 'reload schema';

-- Verify (expect 21 of 25 now, up from 20):
-- SELECT count(machine_class) FROM process_taxonomy WHERE process_group = 'Casting Investment';
