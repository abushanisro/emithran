-- ============================================================================
-- MIGRATION 350: Add regional cost columns to raw_materials
-- ============================================================================
-- The raw_materials table only had a single `cost` column. The Excel upload
-- pipeline (controller createBatch) already writes 7 regional costs and
-- cost_mexico, but those columns were never created — Supabase silently
-- dropped them on insert. This migration adds all missing regional cost
-- columns so subsequent uploads persist the full pricing data.
-- ============================================================================

ALTER TABLE raw_materials
  ADD COLUMN IF NOT EXISTS cost_france   DECIMAL(15,4),
  ADD COLUMN IF NOT EXISTS cost_germany  DECIMAL(15,4),
  ADD COLUMN IF NOT EXISTS cost_w_europe DECIMAL(15,4),
  ADD COLUMN IF NOT EXISTS cost_usa      DECIMAL(15,4),
  ADD COLUMN IF NOT EXISTS cost_india    DECIMAL(15,4),
  ADD COLUMN IF NOT EXISTS cost_e_europe DECIMAL(15,4),
  ADD COLUMN IF NOT EXISTS cost_china    DECIMAL(15,4),
  ADD COLUMN IF NOT EXISTS cost_mexico   DECIMAL(15,4);

-- Helpful comments
COMMENT ON COLUMN raw_materials.cost_france   IS 'Material cost USD/kg — France';
COMMENT ON COLUMN raw_materials.cost_germany  IS 'Material cost USD/kg — Germany';
COMMENT ON COLUMN raw_materials.cost_w_europe IS 'Material cost USD/kg — Western Europe';
COMMENT ON COLUMN raw_materials.cost_usa      IS 'Material cost USD/kg — USA';
COMMENT ON COLUMN raw_materials.cost_india    IS 'Material cost USD/kg — India';
COMMENT ON COLUMN raw_materials.cost_e_europe IS 'Material cost USD/kg — Eastern Europe';
COMMENT ON COLUMN raw_materials.cost_china    IS 'Material cost USD/kg — China';
COMMENT ON COLUMN raw_materials.cost_mexico   IS 'Material cost USD/kg — Mexico';

-- Back-fill `cost` (legacy India fallback) from cost_india where cost is null.
-- Safe: cost_india is NULL for existing rows too, so this is a no-op until
-- re-upload; after re-upload cost_india is set and cost is already set to
-- cost_india by the service (line: cost: dto.costIndia ?? dto.cost).
UPDATE raw_materials
  SET cost_india = cost
  WHERE cost IS NOT NULL AND cost_india IS NULL;

-- Indexes for cost range queries
CREATE INDEX IF NOT EXISTS idx_raw_materials_cost_india   ON raw_materials(cost_india)   WHERE cost_india   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_materials_cost_usa     ON raw_materials(cost_usa)     WHERE cost_usa     IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_materials_cost_china   ON raw_materials(cost_china)   WHERE cost_china   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_materials_cost_france  ON raw_materials(cost_france)  WHERE cost_france  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_materials_cost_germany ON raw_materials(cost_germany) WHERE cost_germany IS NOT NULL;

-- Reload PostgREST schema cache so new columns are visible immediately
-- without a service restart.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
