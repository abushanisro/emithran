-- Calculator Atomic Operations
-- Functions to handle atomic delete+insert operations for calculator fields and formulas

-- Function to atomically replace calculator fields
CREATE OR REPLACE FUNCTION replace_calculator_fields(
  p_calculator_id UUID,
  p_fields JSONB[]
) RETURNS SETOF calculator_fields AS $$
BEGIN
  -- Delete all existing fields for this calculator
  DELETE FROM calculator_fields WHERE calculator_id = p_calculator_id;
  
  -- Insert new fields if provided
  IF array_length(p_fields, 1) > 0 THEN
    RETURN QUERY
    INSERT INTO calculator_fields (
      calculator_id,
      field_name,
      display_label,
      field_type,
      data_source,
      source_table,
      source_field,
      lookup_config,
      default_value,
      unit,
      min_value,
      max_value,
      is_required,
      validation_rules,
      input_config,
      display_order,
      field_group
    )
    SELECT 
      (field_data->>'calculator_id')::UUID,
      field_data->>'field_name',
      field_data->>'display_label',
      field_data->>'field_type',
      field_data->>'data_source',
      field_data->>'source_table',
      field_data->>'source_field',
      COALESCE(field_data->'lookup_config', '{}'::JSONB),
      field_data->>'default_value',
      field_data->>'unit',
      CASE WHEN field_data->>'min_value' IS NOT NULL AND field_data->>'min_value' != '' 
           THEN (field_data->>'min_value')::NUMERIC 
           ELSE NULL END,
      CASE WHEN field_data->>'max_value' IS NOT NULL AND field_data->>'max_value' != '' 
           THEN (field_data->>'max_value')::NUMERIC 
           ELSE NULL END,
      COALESCE((field_data->>'is_required')::BOOLEAN, false),
      COALESCE(field_data->'validation_rules', '{}'::JSONB),
      COALESCE(field_data->'input_config', '{}'::JSONB),
      COALESCE((field_data->>'display_order')::INTEGER, 0),
      field_data->>'field_group'
    FROM unnest(p_fields) AS field_data
    RETURNING *;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to atomically replace calculator formulas
CREATE OR REPLACE FUNCTION replace_calculator_formulas(
  p_calculator_id UUID,
  p_formulas JSONB[]
) RETURNS SETOF calculator_formulas AS $$
BEGIN
  -- Delete all existing formulas for this calculator
  DELETE FROM calculator_formulas WHERE calculator_id = p_calculator_id;
  
  -- Insert new formulas if provided
  IF array_length(p_formulas, 1) > 0 THEN
    RETURN QUERY
    INSERT INTO calculator_formulas (
      calculator_id,
      formula_name,
      display_label,
      description,
      formula_type,
      formula_expression,
      visual_formula,
      depends_on_fields,
      depends_on_formulas,
      output_unit,
      decimal_places,
      display_format,
      execution_order,
      display_in_results,
      is_primary_result,
      result_group
    )
    SELECT 
      (formula_data->>'calculator_id')::UUID,
      formula_data->>'formula_name',
      formula_data->>'display_label',
      formula_data->>'description',
      COALESCE(formula_data->>'formula_type', 'expression'),
      formula_data->>'formula_expression',
      COALESCE(formula_data->'visual_formula', '{}'::JSONB),
      COALESCE(
        CASE 
          WHEN formula_data->'depends_on_fields' IS NOT NULL 
          THEN ARRAY(SELECT jsonb_array_elements_text(formula_data->'depends_on_fields'))
          ELSE ARRAY[]::TEXT[]
        END
      ),
      COALESCE(
        CASE 
          WHEN formula_data->'depends_on_formulas' IS NOT NULL 
          THEN ARRAY(SELECT jsonb_array_elements_text(formula_data->'depends_on_formulas'))
          ELSE ARRAY[]::TEXT[]
        END
      ),
      formula_data->>'output_unit',
      COALESCE((formula_data->>'decimal_places')::INTEGER, 2),
      COALESCE(formula_data->>'display_format', 'number'),
      COALESCE((formula_data->>'execution_order')::INTEGER, 0),
      COALESCE((formula_data->>'display_in_results')::BOOLEAN, true),
      COALESCE((formula_data->>'is_primary_result')::BOOLEAN, false),
      formula_data->>'result_group'
    FROM unnest(p_formulas) AS formula_data
    RETURNING *;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION replace_calculator_fields(UUID, JSONB[]) TO authenticated;
GRANT EXECUTE ON FUNCTION replace_calculator_formulas(UUID, JSONB[]) TO authenticated;