-- ============================================================================
-- Migration 1069: 2-Model Machining is priced from the part's own model only
-- ============================================================================
-- User decision 2026-11-18: a 2-Model Machining part is costed from its own 3D model alone. Its blank is derived from the part
-- (costing/two-model/derived-blank.ts): the part as cast with its machining allowance. A separate blank model, linked from another
-- item of the BOM and compared with the part, is no longer used. This drops what migrations 1066 (the source link and its integrity
-- trigger) and 1068 (the stored comparison of the two models) added. No reader is left: the backend that wrote and read them goes
-- with this migration.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_bom_items_source_component ON public.bom_items;
DROP FUNCTION IF EXISTS public.check_bom_item_source_component();
DROP INDEX IF EXISTS public.idx_bom_items_source_item_id;
ALTER TABLE public.bom_items DROP COLUMN IF EXISTS source_item_id;
ALTER TABLE public.bom_items DROP COLUMN IF EXISTS two_model_comparison;

NOTIFY pgrst, 'reload schema';
