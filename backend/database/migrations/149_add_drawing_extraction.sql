-- ============================================================================
-- Migration: Add drawing_extraction JSONB column to bom_items
-- Purpose: Cache the Claude-vision extraction of the 2D drawing PDF so the
--   Process Plan Generator can re-use it without paying for vision tokens
--   on every Generate click. The same cache also feeds the QC module's
--   measurement table in a follow-up.
--
-- Shape of the JSONB:
--   {
--     "extractedAt": ISO timestamp,
--     "extractionModel": "claude-sonnet-4-6",
--     "sourceFilePath": file_2d_path snapshot,
--     "drawingNumber": string | null,
--     "revision": string | null,
--     "title": string | null,
--     "scale": string | null,
--     "material": string | null,
--     "heatTreatment": string | null,
--     "surfaceTreatment": string | null,
--     "hardness": string | null,
--     "generalTolerance": string | null,    // e.g. "ISO 2768-mK"
--     "datums": [{ "label": "A", "feature": "..." }, ...],
--     "dimensions": [{
--       "balloon": int | null,
--       "label": string,
--       "nominal": number,
--       "unit": string,
--       "upperTol": number | null,
--       "lowerTol": number | null,
--       "toleranceClass": string | null,    // e.g. "h7", "H8", "IT8"
--       "type": "linear" | "diameter" | "radius" | "angular"
--     }, ...],
--     "gdt": [{
--       "feature": string,
--       "symbol": string,                   // "position", "perpendicularity", ...
--       "tolerance": number,
--       "datumRefs": ["A","B"],
--       "modifier": string | null
--     }, ...],
--     "surfaceFinishes": [{
--       "feature": string,
--       "raMicrons": number | null,
--       "rzMicrons": number | null,
--       "directionSymbol": string | null
--     }, ...],
--     "threads": [{
--       "feature": string,
--       "spec": string                       // "M6×1", "1/4-20 UNC"
--     }, ...],
--     "holes": [{
--       "feature": string,
--       "diameter": number,
--       "depth": number | null,
--       "throughHole": boolean,
--       "counterbore": object | null,
--       "countersink": object | null
--     }, ...],
--     "notes": string[]                     // free-text general notes
--   }
-- ============================================================================

ALTER TABLE bom_items
    ADD COLUMN IF NOT EXISTS drawing_extraction JSONB;

CREATE INDEX IF NOT EXISTS idx_bom_items_drawing_extraction
    ON bom_items USING GIN(drawing_extraction)
    WHERE drawing_extraction IS NOT NULL;

COMMENT ON COLUMN bom_items.drawing_extraction IS
'Cached Claude-vision extraction of the 2D drawing PDF: dimensions, tolerances, GD&T, surface finishes, threads, holes, notes. Consumed by the Process Plan Generator. Recomputed when file_2d_path changes.';
