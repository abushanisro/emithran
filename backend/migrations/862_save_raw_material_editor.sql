-- 862: one transactional save for the raw material edit form.
-- The form edits the core fields, the material's property values and its stock
-- prices together. This function applies all three in one transaction, so a bad
-- value or an unknown property leaves nothing half-written.
-- Called only by the backend with the service role, after the caller has been
-- checked to be able to see the material.

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
    material             = p_core->>'material',
    material_grade       = NULLIF(p_core->>'materialGrade', ''),
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

  -- Stock prices belong to the reference alloy (grade, falling back to the name).
  SELECT COALESCE(NULLIF(material_grade, ''), material) INTO v_reference
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

REVOKE EXECUTE ON FUNCTION save_raw_material_editor(uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_raw_material_editor(uuid, jsonb, jsonb, jsonb) TO service_role;
