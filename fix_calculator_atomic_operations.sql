-- Fix Calculator Atomic Operations and RLS Policies
-- Run this in Supabase SQL Editor

-- 1. First, fix the calculator policies to remove auth.users references
DROP POLICY IF EXISTS "calculators_select_policy" ON calculators;
DROP POLICY IF EXISTS "calculators_insert_policy" ON calculators;
DROP POLICY IF EXISTS "calculators_update_policy" ON calculators;
DROP POLICY IF EXISTS "calculators_delete_policy" ON calculators;

-- Create clean policies without auth.users table access
CREATE POLICY "calculators_select_policy" ON calculators
    FOR SELECT USING (true);

CREATE POLICY "calculators_insert_policy" ON calculators
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "calculators_update_policy" ON calculators
    FOR UPDATE USING (
        user_id = auth.uid() OR 
        auth.uid() = '6e7124e7-bf9e-4686-9cac-2245f016a3e4'::uuid
    );

CREATE POLICY "calculators_delete_policy" ON calculators
    FOR DELETE USING (
        user_id = auth.uid() OR 
        auth.uid() = '6e7124e7-bf9e-4686-9cac-2245f016a3e4'::uuid
    );

-- 2. Fix calculator_fields policies
DROP POLICY IF EXISTS "calculator_fields_select_policy" ON calculator_fields;
DROP POLICY IF EXISTS "calculator_fields_insert_policy" ON calculator_fields;
DROP POLICY IF EXISTS "calculator_fields_update_policy" ON calculator_fields;
DROP POLICY IF EXISTS "calculator_fields_delete_policy" ON calculator_fields;

CREATE POLICY "calculator_fields_select_policy" ON calculator_fields
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM calculators c 
            WHERE c.id = calculator_fields.calculator_id
        )
    );

CREATE POLICY "calculator_fields_insert_policy" ON calculator_fields
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM calculators c 
            WHERE c.id = calculator_fields.calculator_id 
            AND (c.user_id = auth.uid() OR auth.uid() = '6e7124e7-bf9e-4686-9cac-2245f016a3e4'::uuid)
        )
    );

CREATE POLICY "calculator_fields_update_policy" ON calculator_fields
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM calculators c 
            WHERE c.id = calculator_fields.calculator_id 
            AND (c.user_id = auth.uid() OR auth.uid() = '6e7124e7-bf9e-4686-9cac-2245f016a3e4'::uuid)
        )
    );

CREATE POLICY "calculator_fields_delete_policy" ON calculator_fields
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM calculators c 
            WHERE c.id = calculator_fields.calculator_id 
            AND (c.user_id = auth.uid() OR auth.uid() = '6e7124e7-bf9e-4686-9cac-2245f016a3e4'::uuid)
        )
    );

-- 3. Fix calculator_formulas policies
DROP POLICY IF EXISTS "calculator_formulas_select_policy" ON calculator_formulas;
DROP POLICY IF EXISTS "calculator_formulas_insert_policy" ON calculator_formulas;
DROP POLICY IF EXISTS "calculator_formulas_update_policy" ON calculator_formulas;
DROP POLICY IF EXISTS "calculator_formulas_delete_policy" ON calculator_formulas;

CREATE POLICY "calculator_formulas_select_policy" ON calculator_formulas
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM calculators c 
            WHERE c.id = calculator_formulas.calculator_id
        )
    );

CREATE POLICY "calculator_formulas_insert_policy" ON calculator_formulas
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM calculators c 
            WHERE c.id = calculator_formulas.calculator_id 
            AND (c.user_id = auth.uid() OR auth.uid() = '6e7124e7-bf9e-4686-9cac-2245f016a3e4'::uuid)
        )
    );

CREATE POLICY "calculator_formulas_update_policy" ON calculator_formulas
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM calculators c 
            WHERE c.id = calculator_formulas.calculator_id 
            AND (c.user_id = auth.uid() OR auth.uid() = '6e7124e7-bf9e-4686-9cac-2245f016a3e4'::uuid)
        )
    );

CREATE POLICY "calculator_formulas_delete_policy" ON calculator_formulas
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM calculators c 
            WHERE c.id = calculator_formulas.calculator_id 
            AND (c.user_id = auth.uid() OR auth.uid() = '6e7124e7-bf9e-4686-9cac-2245f016a3e4'::uuid)
        )
    );

-- 4. Create atomic operation functions
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create formula replacement function
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Grant permissions
GRANT EXECUTE ON FUNCTION replace_calculator_fields(UUID, JSONB[]) TO authenticated;
GRANT EXECUTE ON FUNCTION replace_calculator_formulas(UUID, JSONB[]) TO authenticated;

-- 7. Test that policies work
SELECT 'Calculator policies fixed successfully' as status;