-- ============================================================================
-- Migration 1052: the forging press force inputs the forging data lacks
-- ============================================================================
-- A closed-die forging's press must deliver the finishing blow: the hot flow stress of the metal over the part's outline
-- and its flash land, times a pressure-multiplying factor for how hard the shape is to fill (F = K x Yf x A, Kalpakjian
-- and Schmid, Manufacturing Engineering and Technology, the forging force). memory/Forging gives each material's hot
-- flow law (strength coefficient C and strain-rate sensitivity m: Yf = C x strain rate ^ m) and the flash land, but
-- neither the strain rate nor the multiplying factor, so no press could be chosen and the Press step could not be costed.
--
-- They are staged here as variables of the forging reference (source version 2026-Forging), read, shown and changed like
-- every other variable; the engine holds no value of its own. The eMithran baseline, not reference values:
--   forgingStrainRate               10   1/s  hot forging on a press: ram speed over the part's height, the order of 1 to
--                                             10 per second for hydraulic, mechanical and screw presses (with m = 0.25,
--                                             a factor of 3 in strain rate moves the force by 32 %).
--   forgingPressureFactorNoFlash    4         simple shapes forged without flash (published range 3 to 5).
--   forgingPressureFactorFlash      6.5       simple shapes forged with flash (5 to 8).
--   forgingPressureFactorComplex    10        complex shapes, ribs and thin webs, with flash (8 to 12); a part at or above
--                                             the data's least 3D complexity score (min3DComplexityScore).
--
-- Idempotent: each row is inserted once and never overwritten (a plant's own value stays).
-- ============================================================================

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw)
VALUES
  ('variable', 'USA', '2026-Forging', 'forgingStrainRate', '10', '1/Time',
   'eMithran baseline: the strain rate of hot forging on a press, at which the material flow stress (strength coefficient x strain rate ^ strain rate sensitivity) is read for the press force.',
   '{"Variable Name": "forgingStrainRate", "String Value": 10, "Unit Type Name": "1/Time", "Notes": "eMithran baseline: the strain rate of hot forging on a press, at which the material flow stress (strength coefficient x strain rate ^ strain rate sensitivity) is read for the press force."}'::jsonb),
  ('variable', 'USA', '2026-Forging', 'forgingPressureFactorNoFlash', '4', NULL,
   'eMithran baseline: pressure-multiplying factor of the forging force for a simple shape forged without flash (published range 3 to 5).',
   '{"Variable Name": "forgingPressureFactorNoFlash", "String Value": 4, "Unit Type Name": null, "Notes": "eMithran baseline: pressure-multiplying factor of the forging force for a simple shape forged without flash (published range 3 to 5)."}'::jsonb),
  ('variable', 'USA', '2026-Forging', 'forgingPressureFactorFlash', '6.5', NULL,
   'eMithran baseline: pressure-multiplying factor of the forging force for a simple shape forged with flash (published range 5 to 8).',
   '{"Variable Name": "forgingPressureFactorFlash", "String Value": 6.5, "Unit Type Name": null, "Notes": "eMithran baseline: pressure-multiplying factor of the forging force for a simple shape forged with flash (published range 5 to 8)."}'::jsonb),
  ('variable', 'USA', '2026-Forging', 'forgingPressureFactorComplex', '10', NULL,
   'eMithran baseline: pressure-multiplying factor of the forging force for a complex shape (ribs, thin webs) forged with flash (published range 8 to 12).',
   '{"Variable Name": "forgingPressureFactorComplex", "String Value": 10, "Unit Type Name": null, "Notes": "eMithran baseline: pressure-multiplying factor of the forging force for a complex shape (ribs, thin webs) forged with flash (published range 8 to 12)."}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;
