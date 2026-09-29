-- ============================================================================
-- Migration 831: raw_materials plastics carry the memory/ reference properties
-- ============================================================================
-- Source: memory/Plastic Modeling/materials_final.csv, staged by migration 823
-- as machining_reference_data category material, source_version 2026-Plastic.
--
-- The injection-molding models read, per material: melting / mold / eject
-- temperature, specific heat and thermal conductivity of melt, density and
-- density of melt (cooling, shot size) and max / min injection pressure and
-- flow length ratio (clamp force).
--
-- Link: a reference material's own sourceName ("Generic ABS", "Generic ABS,
-- 10% Glass", ...) equal to a raw_materials material name (case-insensitive,
-- unique on both sides). An earlier version linked by a thermal-property
-- fingerprint and matched nothing: the live raw_materials plastic values come
-- from another source (e.g. Generic ABS melt 230 / mold 65 C vs the reference
-- 240 / 70 C), so memory/ values are written onto the linked rows here.
--   * thermal / physical / clamp properties: overwritten from the reference
--   * cost_usa: filled from the reference cost only where it is empty (an
--     existing price is never overwritten)
-- A raw_materials row with no linked reference material keeps its values and
-- has no im_* properties: the engine then reports "no reference clamp data".
-- Reference materials with no raw_materials row are listed by the NOTICE
-- (they are added as catalog rows by a later migration).
--
-- The existing injection_pressure_mpa_min / _max columns (migration 081 sample
-- data) are neither read nor changed. One statement (a DO block), idempotent.
-- Needs migration 823 (all parts) first.
-- ============================================================================

DO $$
DECLARE
  ref_count integer;
  linked integer;
  unlinked text;
BEGIN
  SELECT count(*) INTO ref_count
  FROM machining_reference_data
  WHERE category = 'material' AND source_version = '2026-Plastic';
  IF ref_count = 0 THEN
    RAISE EXCEPTION 'Migration 831: no 2026-Plastic material rows. Run migration 823 (all parts) first.';
  END IF;

  ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS im_injection_pressure_max_mpa numeric;
  ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS im_injection_pressure_min_mpa numeric;
  ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS im_flow_length_ratio numeric;
  ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS im_density_of_melt_kg_m3 numeric;
  ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS im_reference_material text;

  UPDATE raw_materials
  SET im_injection_pressure_max_mpa = NULL, im_injection_pressure_min_mpa = NULL,
      im_flow_length_ratio = NULL, im_density_of_melt_kg_m3 = NULL, im_reference_material = NULL
  WHERE im_reference_material IS NOT NULL;

  WITH ref AS (
    SELECT key AS name, raw->>'sourceName' AS source_name,
      (raw->>'physicalProperties.densityKgM3')::numeric                    AS density,
      (raw->>'physicalProperties.densityOfMeltKgM3')::numeric              AS melt_density,
      (raw->>'thermalProperties.meltingTempC')::numeric                    AS melt,
      (raw->>'thermalProperties.moldTempC')::numeric                       AS mold,
      (raw->>'thermalProperties.ejectDeflectionTempC')::numeric            AS eject,
      (raw->>'physicalProperties.specificHeatOfMeltJgC')::numeric          AS cp,
      (raw->>'physicalProperties.thermalConductivityOfMeltWattsMC')::numeric AS k,
      (raw->>'processingParameters.injectionPressureMaxMPa')::numeric      AS p_max,
      (raw->>'processingParameters.injectionPressureMinMPa')::numeric      AS p_min,
      (raw->>'processingParameters.flowLengthRatio')::numeric              AS flow,
      (raw->>'cost.unitCostUsdPerKg')::numeric                             AS cost_usd
    FROM machining_reference_data
    WHERE category = 'material' AND source_version = '2026-Plastic'
      AND raw->>'sourceName' IS NOT NULL
  ),
  one_row AS (
    SELECT lower(material) AS lname
    FROM raw_materials
    GROUP BY lower(material)
    HAVING count(*) = 1
  )
  UPDATE raw_materials r
  SET melting_temp_c                = coalesce(ref.melt, r.melting_temp_c),
      mold_temp_c                   = coalesce(ref.mold, r.mold_temp_c),
      eject_deflection_temp_c       = coalesce(ref.eject, r.eject_deflection_temp_c),
      specific_heat_melt            = coalesce(ref.cp, r.specific_heat_melt),
      thermal_conductivity_melt     = coalesce(ref.k, r.thermal_conductivity_melt),
      density_kg_m3                 = coalesce(ref.density, r.density_kg_m3),
      density                       = CASE WHEN ref.density IS NOT NULL THEN ref.density / 1000.0 ELSE r.density END,
      im_injection_pressure_max_mpa = ref.p_max,
      im_injection_pressure_min_mpa = ref.p_min,
      im_flow_length_ratio          = ref.flow,
      im_density_of_melt_kg_m3      = ref.melt_density,
      im_reference_material         = ref.name,
      cost_usa                      = CASE WHEN (r.cost_usa IS NULL OR r.cost_usa = 0) AND ref.cost_usd > 0 THEN ref.cost_usd ELSE r.cost_usa END
  FROM ref
  JOIN one_row ON one_row.lname = lower(ref.source_name)
  WHERE lower(r.material) = lower(ref.source_name);
  GET DIAGNOSTICS linked = ROW_COUNT;

  SELECT string_agg(ref_key, ', ' ORDER BY ref_key) INTO unlinked
  FROM (
    SELECT m.key AS ref_key
    FROM machining_reference_data m
    WHERE m.category = 'material' AND m.source_version = '2026-Plastic'
      AND NOT EXISTS (SELECT 1 FROM raw_materials r WHERE r.im_reference_material = m.key)
  ) x;

  RAISE NOTICE 'Migration 831: % raw_materials rows now carry reference properties (of % reference materials).', linked, ref_count;
  RAISE NOTICE 'Migration 831: reference materials with no raw_materials row: %', coalesce(unlinked, '(none)');
END $$;

NOTIFY pgrst, 'reload schema';

-- Verify:
-- SELECT count(*) FILTER (WHERE im_reference_material IS NOT NULL) AS linked FROM raw_materials;
-- SELECT material, melting_temp_c, mold_temp_c, im_injection_pressure_max_mpa, im_flow_length_ratio,
--        im_density_of_melt_kg_m3, im_reference_material
-- FROM raw_materials WHERE im_reference_material IS NOT NULL ORDER BY material;
