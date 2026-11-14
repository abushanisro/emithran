-- 1041: the stock a part's material record was costed from
--
-- raw_material_cost_records keeps the material, its usage and its price, but not what the gross usage
-- is a piece of: the blank the cost engine sized for the part ("59×50×49 billet", "Ø40 × 62 bar").
-- The Part Summary's Stock field could therefore only show the library's stock form, which most rows
-- lack. stock_label carries the engine's own description of the blank, written when the scenario is
-- applied. NULL = the record was written before this column, or the engine sized no blank.
--
-- Idempotent.

ALTER TABLE raw_material_cost_records ADD COLUMN IF NOT EXISTS stock_label text;

COMMENT ON COLUMN raw_material_cost_records.stock_label IS
  'The blank the cost engine sized for the part, as it describes it (blankSpec.sizeLabel). NULL when none was sized.';
