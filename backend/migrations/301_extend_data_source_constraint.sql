-- ============================================================================
-- EXTEND CONSTRAINTS FOR SHEET METAL CALCULATORS
-- ============================================================================

-- 1. Extend data_source to allow 'sheet_metal_lookup'
ALTER TABLE calculator_fields
    DROP CONSTRAINT IF EXISTS valid_data_source;

ALTER TABLE calculator_fields
    ADD CONSTRAINT valid_data_source CHECK (
        data_source IS NULL OR data_source IN (
            'lhr',
            'mhr',
            'raw_materials',
            'processes',
            'manual',
            'sheet_metal_lookup'
        )
    );

-- 2. Extend field_type to allow 'table_lookup'
ALTER TABLE calculator_fields
    DROP CONSTRAINT IF EXISTS valid_field_type;

ALTER TABLE calculator_fields
    ADD CONSTRAINT valid_field_type CHECK (
        field_type IN (
            'number',
            'text',
            'select',
            'database_lookup',
            'calculated',
            'multi_select',
            'const',
            'table_lookup'
        )
    );

-- 3. Extend calc_category to allow 'sheet_metal'
ALTER TABLE calculators
    DROP CONSTRAINT IF EXISTS valid_category;

ALTER TABLE calculators
    ADD CONSTRAINT valid_category CHECK (
        calc_category IS NULL OR calc_category IN (
            'costing',
            'material',
            'process',
            'tooling',
            'custom',
            'sheet_metal'
        )
    );
