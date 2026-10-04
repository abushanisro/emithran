-- 865: raw_materials column names follow memory.
--   material       -> grade        memory Source Name (the generic name, shown as Source name)
--   material_grade -> name         memory Name (the reference key that stock prices and costing match on)
--   description    unchanged       memory Description (shown as Grade)
-- Run after 863, which still uses the old names. Everything that reads the old names
-- is recreated here, in the same transaction: the sm_material_usage_reference view
-- and the save_raw_material_editor function.

ALTER TABLE raw_materials RENAME COLUMN material TO grade;
ALTER TABLE raw_materials RENAME COLUMN material_grade TO name;

-- The view's output column follows the new name, so it is recreated (a rename alone keeps "material").
DROP VIEW IF EXISTS sm_material_usage_reference;
CREATE VIEW sm_material_usage_reference AS
SELECT id, grade, material_type, density_kg_m3, shear_strength_mpa
FROM raw_materials
ORDER BY grade;
GRANT SELECT ON sm_material_usage_reference TO authenticated;

-- Form payload: core.material is the Source name (now grade); core.grade is the Grade (now description).
-- Name is read-only in the form, so the function never writes it.
CREATE OR REPLACE FUNCTION save_raw_material_editor(
  p_material_id uuid,
  p_core jsonb,
  p_properties jsonb,
  p_stock_prices jsonb
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  r jsonb;
  v_rows int;
  v_reference text;
BEGIN
  UPDATE raw_materials SET
    material_group       = p_core->>'materialGroup',
    grade                = p_core->>'material',
    description          = NULLIF(p_core->>'grade', ''),
    material_type        = NULLIF(p_core->>'materialType', ''),
    material_description = NULLIF(p_core->>'materialDescription', ''),
    cost_usa             = NULLIF(p_core->>'costUsa', '')::numeric
  WHERE id = p_material_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'raw material % not found', p_material_id USING ERRCODE = 'P0002';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_properties) LOOP
    UPDATE raw_material_properties SET
      value_num      = NULLIF(r->>'valueNum', '')::numeric,
      value_text     = NULLIF(r->>'valueText', ''),
      source_version = 'entered in the app'
    WHERE raw_material_id = p_material_id
      AND property_key = r->>'propertyKey';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'material % has no property %', p_material_id, r->>'propertyKey' USING ERRCODE = 'P0002';
    END IF;
  END LOOP;

  -- Stock prices belong to the reference alloy: name, falling back to grade.
  SELECT COALESCE(NULLIF(name, ''), grade) INTO v_reference
  FROM raw_materials WHERE id = p_material_id;

  FOR r IN SELECT * FROM jsonb_array_elements(p_stock_prices) LOOP
    INSERT INTO material_stock_prices
      (reference_material, stock_form, location, price_per_kg, currency_code, source, updated_at)
    VALUES
      (v_reference, r->>'stockForm', r->>'location', (r->>'pricePerKg')::numeric, 'USD', 'entered in the app', now())
    ON CONFLICT (reference_material, stock_form, location) DO UPDATE SET
      price_per_kg  = EXCLUDED.price_per_kg,
      currency_code = EXCLUDED.currency_code,
      source        = EXCLUDED.source,
      updated_at    = EXCLUDED.updated_at;
  END LOOP;
END;
$$;
