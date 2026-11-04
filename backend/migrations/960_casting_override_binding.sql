-- ============================================================================
-- Migration 960: a draw direction is bound to the file and the geometry it was chosen on (design step S7, gap G5)
-- ============================================================================
-- An engineer fixes the draw axis of a part (957) looking at its geometry. If the item's 3D file is later replaced, the axis may only carry over to the same
-- geometry: a different part, or the same part turned in its file, would silently get an axis it was never chosen for. So the override records
--   source_path  the item's file when it was set (a replaced file has a new path, as for casting_analyses.source_path)
--   geometry     what the analysis measured of that file then (solids, faces, edges, volume, area, extents) as jsonb, or NULL when no analysis existed yet
-- The application compares the stored geometry with the new file's automatic analysis: the same geometry keeps the override, anything else holds it back (the
-- part is analysed automatically) until the engineer confirms it for the new file or removes it. An override with no recorded geometry is never carried over to
-- a replaced file without that confirmation.
-- Overrides made before this migration are bound to the file the item has now (the best that is known); their geometry is not recorded. Idempotent.
-- ============================================================================

ALTER TABLE public.casting_draw_directions
  ADD COLUMN IF NOT EXISTS source_path text,
  ADD COLUMN IF NOT EXISTS geometry jsonb;

UPDATE public.casting_draw_directions d
   SET source_path = b.file_3d_path
  FROM public.bom_items b
 WHERE b.id = d.bom_item_id
   AND d.source_path IS NULL;
