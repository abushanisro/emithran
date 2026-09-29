-- ============================================================================
-- Migration 827: give the Part Assembly welding machines their own classes
-- ============================================================================
-- memory/Assembly and memory/Part Assembly are two separate reference
-- contexts. Both list the same welders (C240/C280/C420 ESAB, Deltaweld 653,
-- the Miller spot welders, Pro System robots, the Default welders) but with
-- different values: e.g. C240 direct overhead 1.00 vs 1.72 USD/h, power 5.24
-- vs 10 kW, gun placement 10 vs 2 s, and Part Assembly adds a wire feed rate.
--
-- Migrations 794 (Assembly) and 795 (Part Assembly) seeded both under the SAME
-- machine_class (manual_mig_welding, manual_spot_welding, robotic_mig_welding,
-- robotic_spot_welding), same location and machine name: 16 machines with two
-- contradicting rows each. Any engine selecting a welder by class, and any
-- location join by name (migration 825), would see two answers for one
-- machine.
--
-- Fix: Part Assembly keeps its own reference values under its own classes,
-- part_assembly_<class>. Its catalog rows (process_taxonomy /
-- process_calculator_mappings, group Part Assembly) move with it. The Assembly
-- rows are unchanged. Scoped by process_group, so it touches only the 794/795
-- seeded rows. Independent, idempotent statements.
-- ============================================================================

UPDATE mhr_records
SET machine_class = 'part_assembly_' || machine_class
WHERE process_group = 'Part Assembly'
  AND machine_class IN ('manual_mig_welding', 'manual_spot_welding', 'robotic_mig_welding', 'robotic_spot_welding');

UPDATE process_taxonomy
SET machine_class = 'part_assembly_' || machine_class
WHERE process_group = 'Part Assembly'
  AND machine_class IN ('manual_mig_welding', 'manual_spot_welding', 'robotic_mig_welding', 'robotic_spot_welding');

UPDATE process_calculator_mappings
SET machine_class = 'part_assembly_' || machine_class, updated_at = now()
WHERE process_group = 'Part Assembly'
  AND machine_class IN ('manual_mig_welding', 'manual_spot_welding', 'robotic_mig_welding', 'robotic_spot_welding');

NOTIFY pgrst, 'reload schema';

-- Verify (expect no class shared by the two groups):
-- SELECT machine_class, array_agg(DISTINCT process_group) FROM mhr_records
-- WHERE process_group IN ('Assembly', 'Part Assembly') GROUP BY 1
-- HAVING count(DISTINCT process_group) > 1;
