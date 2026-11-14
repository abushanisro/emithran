-- ============================================================================
-- Migration 1015: a tooling record keeps its process, sub-process and catalog source
-- ============================================================================
-- The Add Tooling dialog has always sent the manufacturing process and sub-process, but tooling_cost_records had no column for them, so
-- the request validation dropped both and every row showed "Unassigned". The dialog now prices items from the tooling catalog (staged
-- memory/ reference data, GET /tooling-catalogs/:domain), so a row also records which catalog row it was priced from:
--   manufacturing_process  the catalog domain key (injection_molding, die_casting, ...) or an older process key
--   sub_process            a Machining operation (process_calculator_mappings), the only sub-processes with real data
--   catalog_source         the catalog item id, dataset:table:row (e.g. 2026-Plastic:cmStandardToolingComponents:0); null for a custom
--                          item or a row saved before the catalog. The backend checks the item exists before saving it.
-- Rows saved before this migration keep null: their process was never stored, and is not guessed. Idempotent.
-- ============================================================================

ALTER TABLE public.tooling_cost_records
  ADD COLUMN IF NOT EXISTS manufacturing_process text
    CONSTRAINT tooling_cost_records_manufacturing_process_len CHECK (manufacturing_process IS NULL OR char_length(btrim(manufacturing_process)) BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS sub_process text
    CONSTRAINT tooling_cost_records_sub_process_len CHECK (sub_process IS NULL OR char_length(btrim(sub_process)) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS catalog_source text
    CONSTRAINT tooling_cost_records_catalog_source_format CHECK (catalog_source IS NULL OR (catalog_source ~ '^[^:]+:[^:]+:[0-9]+$' AND char_length(catalog_source) <= 300));

-- A catalog item is not custom: a row cannot claim both.
ALTER TABLE public.tooling_cost_records DROP CONSTRAINT IF EXISTS tooling_cost_records_catalog_not_custom;
ALTER TABLE public.tooling_cost_records
  ADD CONSTRAINT tooling_cost_records_catalog_not_custom CHECK (catalog_source IS NULL OR is_custom IS NOT TRUE);

COMMENT ON COLUMN public.tooling_cost_records.manufacturing_process IS 'The tooling catalog domain (or an older process key) the item belongs to; null for rows saved before migration 1015.';
COMMENT ON COLUMN public.tooling_cost_records.sub_process IS 'A Machining operation, when the item is for one.';
COMMENT ON COLUMN public.tooling_cost_records.catalog_source IS 'The tooling catalog item the price came from, dataset:table:row; null for a custom item.';
