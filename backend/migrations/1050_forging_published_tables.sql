-- ============================================================================
-- Migration 1050: two published forging tables the forging calculators read
-- ============================================================================
-- memory/Forging has the coefficients of the flash land and the alloys' flow properties, but two things a closed-die
-- forging cannot be priced without are not in it:
--
--   forging_tblFlashMassPerPeriphery
--     The flash metal (land and gutter) of a steel forging per length of its parting line, by forging mass: the
--     recommendation of the National Association of Drop Forgings, as tabulated in closed-die forging design
--     literature (kg per cm of periphery). The data's own flash figure is a percentage by a part complexity score
--     (forging_partComplexityBasedData) that the data does not say how to find. The last row covers any heavier forging.
--
--   forging_tblEquipmentSpeed
--     The ram speed range of each kind of forging machine (m/s), the table given by Altan (Forging Equipment,
--     Materials and Practices) and Kalpakjian (Manufacturing Engineering and Technology). The flow stress of a hot
--     alloy depends on the strain rate; the forging press records carry a force and a cycle time, not a ram speed.
--
-- These are the eMithran baseline, staged beside the forging reference data so the calculators read them like any
-- other table and a plant can replace them with its own.
--
-- Idempotent: a row is inserted once and never overwritten.
-- ============================================================================

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, notes, raw)
VALUES
(
  'lookup_table', 'USA', '2026-Forging', 'forging_tblFlashMassPerPeriphery', '8',
  'eMithran baseline: flash mass per length of parting line by forging mass, steel (recommendation of the National Association of Drop Forgings)',
  '{"rows": [
    {"Max Forging Mass (kg)": 0.45,    "Flash Mass (kg / cm of periphery)": 0.0047},
    {"Max Forging Mass (kg)": 2.273,   "Flash Mass (kg / cm of periphery)": 0.0063},
    {"Max Forging Mass (kg)": 4.545,   "Flash Mass (kg / cm of periphery)": 0.0098},
    {"Max Forging Mass (kg)": 6.818,   "Flash Mass (kg / cm of periphery)": 0.0130},
    {"Max Forging Mass (kg)": 11.364,  "Flash Mass (kg / cm of periphery)": 0.0168},
    {"Max Forging Mass (kg)": 22.727,  "Flash Mass (kg / cm of periphery)": 0.0223},
    {"Max Forging Mass (kg)": 45.455,  "Flash Mass (kg / cm of periphery)": 0.0324},
    {"Max Forging Mass (kg)": 1000000, "Flash Mass (kg / cm of periphery)": 0.0477}
  ]}'::jsonb
),
(
  'lookup_table', 'USA', '2026-Forging', 'forging_tblEquipmentSpeed', '6',
  'eMithran baseline: ram speed range of forging machines (Altan, Forging Equipment, Materials and Practices; Kalpakjian, Manufacturing Engineering and Technology)',
  '{"rows": [
    {"Equipment": "Hydraulic press",     "Min Speed (m / s)": 0.06, "Max Speed (m / s)": 0.30},
    {"Equipment": "Mechanical press",    "Min Speed (m / s)": 0.06, "Max Speed (m / s)": 1.5},
    {"Equipment": "Screw press",         "Min Speed (m / s)": 0.6,  "Max Speed (m / s)": 1.2},
    {"Equipment": "Gravity drop hammer", "Min Speed (m / s)": 3.6,  "Max Speed (m / s)": 4.8},
    {"Equipment": "Power drop hammer",   "Min Speed (m / s)": 3.0,  "Max Speed (m / s)": 9.0},
    {"Equipment": "Counterblow hammer",  "Min Speed (m / s)": 4.5,  "Max Speed (m / s)": 9.0}
  ]}'::jsonb
)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;
