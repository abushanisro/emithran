-- ============================================================================
-- Migration 051: Fix ghost calculator_name references for Sheet Metal
-- operations with a clear, textbook match to an existing calculator
-- (2026-08-01)
--
-- These process_calculator_mappings rows had calculator_id=NULL and a
-- calculator_name that matches no real calculator ("Bending Calculator",
-- "Forming Calculator", etc. were never created under those names) --
-- surfaced by adding process-group filtering to the calculator picker
-- dropdown, which (correctly) only shows calculators a mapping actually
-- resolves to.
--
-- Only operations with an unambiguous conceptual match to an EXISTING,
-- already-built calculator are fixed here. Left alone (genuinely no match):
-- Roll Forming, Stretch Forming, Punch/Plasma/Waterjet/CO2/3D-Laser cutting
-- variants, Tapping/Drilling/Shearing, and all Raw-Material stock-shape rows
-- -- none of these have a real calculator to point at; inventing a mapping
-- to the nearest-sounding calculator would be worse than leaving them
-- unmapped.
-- ============================================================================

-- Stage Tool Bending -> Bending Manufacturing (same underlying bend-force physics)
UPDATE process_calculator_mappings
SET calculator_id = '102772ff-5422-45c1-b391-6d2d4a96ab1b'
WHERE process_group = 'Sheet Metal' AND operation = 'Stage Tool Bending' AND calculator_id IS NULL;

-- Stage Tool Forming / Deep Draw -> Drawing/Forming Manufacturing
UPDATE process_calculator_mappings
SET calculator_id = '966fff11-5b69-44bc-ad55-6645f1df223c'
WHERE process_group = 'Sheet Metal' AND operation IN ('Stage Tool Forming', 'Deep Draw') AND calculator_id IS NULL;

-- Progressive die / Offline Blank / Blanking -> Stamping Manufacturing
UPDATE process_calculator_mappings
SET calculator_id = 'e12094c7-cdfd-4dde-a153-1f98a5250a72'
WHERE process_group = 'Sheet Metal' AND operation IN ('Progressive die', 'Offline Blank', 'Blanking') AND calculator_id IS NULL;

-- Turret Press (both routes) / Laser Puch -> TPP Manufacturing (TPP = Turret Punch Press)
UPDATE process_calculator_mappings
SET calculator_id = 'a5d9b23a-5b8c-4d2b-98dd-3fa623458716'
WHERE process_group = 'Sheet Metal' AND operation IN ('Turret Press', 'Laser Puch') AND calculator_id IS NULL;

-- Verification:
-- SELECT process_route, operation, calculator_id, calculator_name FROM process_calculator_mappings
--   WHERE process_group = 'Sheet Metal' ORDER BY operation;
