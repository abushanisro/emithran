-- ============================================================================
-- Migration 834: add the memory/ reference plastics that have no raw_materials row
-- ============================================================================
-- Source: memory/Plastic Modeling/materials_final.csv (109 materials), staged
-- by migration 823 (machining_reference_data category material, source_version
-- 2026-Plastic). Migration 831 linked the 39 whose reference sourceName is an
-- existing raw_materials name and wrote the reference properties onto them.
-- This adds every other reference material as its own catalog row, under its
-- reference sourceName (e.g. "Generic ABS, 10% Glass"), carrying:
--   material_group Plastic and Rubber, material_type (reference materialType),
--   shape (PELLET -> pellets, the injection-molding preferred shape; SMC / BMC
--   as the reference names them), density, the thermal properties, cost_usa
--   (reference unit cost, USD/kg) and the im_* clamp / melt properties of 831.
--   Thermoset cure time is migration 835 (kept apart: the SQL editor runs a
--   script as one transaction, so a failing statement would roll this back).
--
-- Owner: raw_materials.user_id is required. The new rows take the owner of the
-- reference rows 831 linked, only when those rows share exactly one owner:
-- otherwise the owner subquery is NULL and the insert fails on user_id, adding
-- nothing. No user id is written into this file. organization_id stays NULL,
-- as for those rows (a shared catalog).
--
-- One plain statement (no DO block), idempotent: a reference material that
-- already has a raw_materials row (by name, case-insensitive) is skipped.
-- Needs migrations 823 and 831 first.
-- ============================================================================

INSERT INTO raw_materials (
  material_group, material, material_type, shape, user_id, organization_id,
  density_kg_m3, density, melting_temp_c, mold_temp_c, eject_deflection_temp_c,
  specific_heat_melt, thermal_conductivity_melt, cost_usa,
  im_injection_pressure_max_mpa, im_injection_pressure_min_mpa, im_flow_length_ratio,
  im_density_of_melt_kg_m3, im_reference_material
)
SELECT
  'Plastic & Rubber',
  m.raw->>'sourceName',
  m.raw->>'materialType',
  CASE upper(m.raw->>'processCompatibility.materialForm') WHEN 'PELLET' THEN 'pellets' ELSE m.raw->>'processCompatibility.materialForm' END,
  (SELECT min(user_id::text)::uuid FROM raw_materials WHERE im_reference_material IS NOT NULL HAVING count(DISTINCT user_id) = 1),
  NULL,
  (m.raw->>'physicalProperties.densityKgM3')::numeric,
  (m.raw->>'physicalProperties.densityKgM3')::numeric / 1000.0,
  (m.raw->>'thermalProperties.meltingTempC')::numeric,
  (m.raw->>'thermalProperties.moldTempC')::numeric,
  (m.raw->>'thermalProperties.ejectDeflectionTempC')::numeric,
  (m.raw->>'physicalProperties.specificHeatOfMeltJgC')::numeric,
  (m.raw->>'physicalProperties.thermalConductivityOfMeltWattsMC')::numeric,
  (m.raw->>'cost.unitCostUsdPerKg')::numeric,
  (m.raw->>'processingParameters.injectionPressureMaxMPa')::numeric,
  (m.raw->>'processingParameters.injectionPressureMinMPa')::numeric,
  (m.raw->>'processingParameters.flowLengthRatio')::numeric,
  (m.raw->>'physicalProperties.densityOfMeltKgM3')::numeric,
  m.key
FROM machining_reference_data m
WHERE m.category = 'material' AND m.source_version = '2026-Plastic'
  AND m.raw->>'sourceName' IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM raw_materials r WHERE lower(r.material) = lower(m.raw->>'sourceName'));

NOTIFY pgrst, 'reload schema';

-- Verify (expect with_reference 109, with_clamp_data 72):
-- SELECT count(*) FILTER (WHERE im_reference_material IS NOT NULL) AS with_reference,
--        count(*) FILTER (WHERE im_flow_length_ratio IS NOT NULL) AS with_clamp_data
-- FROM raw_materials;
