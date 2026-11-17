-- ============================================================================
-- Migration 1045: the two wax pattern cooling inputs the investment casting data lacks
-- ============================================================================
-- The wax pattern's cooling time in the die is the plate cooling equation: the wall, the wax's thermal diffusivity
-- (conductivity / (density x specific heat)), and the melt, die and eject temperatures. memory/Casting Investment
-- gives the wax density, specific heat, melting and eject temperatures (tblWaxProperties) but neither the wax's
-- thermal conductivity nor the die temperature, so the wax pattern molding time could not be derived at all.
--
-- They are staged here as variables of the investment casting reference (source version 2026-CastInvest), so they
-- are read, shown and changed like every other variable and the engine holds no value of its own. They are the
-- eMithran baseline, not reference values:
--   waxPatternThermalConductivity  0.33 W/(m K)  the conductivity of an investment casting pattern wax reported in a
--                                                published study of wax melt-out from the shell.
--   waxPatternDieTemperature       25 C          the die at room temperature, as published wax injection studies run
--                                                it; the same ambient the data's investmentMoldEjectionTemperature is.
--
-- Idempotent: each row is inserted once and never overwritten (a plant's own value stays).
-- ============================================================================

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw)
VALUES
  ('variable', 'USA', '2026-CastInvest', 'waxPatternThermalConductivity', '0.33', 'Watts/(m*K)',
   'eMithran baseline: thermal conductivity of the pattern wax (published value for an investment casting wax). Used to calculate the wax pattern cooling time in the die.',
   '{"Variable Name": "waxPatternThermalConductivity", "String Value": 0.33, "Unit Type Name": "Watts/(m*K)", "Notes": "eMithran baseline: thermal conductivity of the pattern wax (published value for an investment casting wax). Used to calculate the wax pattern cooling time in the die."}'::jsonb),
  ('variable', 'USA', '2026-CastInvest', 'waxPatternDieTemperature', '25', 'Temperature',
   'eMithran baseline: temperature of the wax pattern die, at room temperature. Used to calculate the wax pattern cooling time in the die.',
   '{"Variable Name": "waxPatternDieTemperature", "String Value": 25, "Unit Type Name": "Temperature", "Notes": "eMithran baseline: temperature of the wax pattern die, at room temperature. Used to calculate the wax pattern cooling time in the die."}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;
