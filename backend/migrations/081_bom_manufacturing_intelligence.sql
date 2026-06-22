-- Migration 081: Manufacturing Intelligence Placeholders
-- Purpose: Schema columns required by Phase 1 extraction (material provenance, sheet metal geometry).
--          Populated automatically by 3D CAD analysis and 2D drawing extraction.
--          Consumed by Phase 2 costing engine (thickness-based laser / bending cost).
-- All columns nullable — existing rows unaffected.

ALTER TABLE bom_items
  ADD COLUMN IF NOT EXISTS material_source      TEXT         CHECK (material_source IN ('cad', 'drawing', 'manual', 'estimate')),
  ADD COLUMN IF NOT EXISTS material_confidence  NUMERIC(4,2) CHECK (material_confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS sheet_thickness_mm   NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS cut_length_mm        NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS bend_count           SMALLINT;

COMMENT ON COLUMN bom_items.material_source     IS 'Provenance of material_grade: cad | drawing | manual | estimate';
COMMENT ON COLUMN bom_items.material_confidence IS 'Confidence 0–1 for the material identification (1.0 = user-verified)';
COMMENT ON COLUMN bom_items.sheet_thickness_mm  IS 'Sheet metal material thickness in mm (extracted from 2D drawing or CAD)';
COMMENT ON COLUMN bom_items.cut_length_mm       IS 'Total laser/plasma cut perimeter in mm — Phase 2 costing input';
COMMENT ON COLUMN bom_items.bend_count          IS 'Number of bends / press-brake operations — Phase 2 costing input';
