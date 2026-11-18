-- ============================================================================
-- Migration 1068: a 2-Model Machining part's comparison with its source component
-- ============================================================================
-- The cad-engine's POST /analyze/two-model result for the part and the source it names (bom_items.source_item_id, migration 1066):
-- whether the two models are aligned, the part's faces left as supplied and those machined, the volume machined off. Stored with the two
-- STEP files it was made from, so a re-uploaded file makes it stale (the cost then asks for Refresh analysis) instead of being reused.
-- Written when the source is linked and when the part is re-analysed; read by the cost. Row access is bom_items' own.
-- ============================================================================

ALTER TABLE public.bom_items ADD COLUMN IF NOT EXISTS two_model_comparison jsonb;

COMMENT ON COLUMN public.bom_items.two_model_comparison IS
  '2-Model Machining: { sourceItemId, targetFile, sourceFile, comparedAt, result } from cad-engine /analyze/two-model; stale when either file changed.';

NOTIFY pgrst, 'reload schema';
