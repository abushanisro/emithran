-- ============================================================================
-- Migration 1040: minimum wall thickness of a machined part, per material class
-- ============================================================================
-- The CAD analysis now measures the wall behind each machined feature
-- (cad-engine machining/feature_access.py). The design-for-machining check
-- grades it against a minimum wall for the material, staged here as
-- tblMachiningMinWall so it is read, shown and changed like every other lookup.
--
-- memory/Machining has no wall-thickness limit. These are the eMithran
-- baseline, the values the published CNC design guides agree on (Hubs /
-- Protolabs Network "How to design parts for CNC machining"; Fast Radius CNC
-- design checklist):
--   RecommendedMinWallMm   0.8 mm metals, 1.5 mm plastics: below it the wall is a
--                          major finding;
--   FeasibleMinWallMm      0.5 mm metals, 1.0 mm plastics: below it, critical.
-- Plastics take thicker walls: they warp from residual stress and soften
-- with heat.
--
-- Idempotent: the row is inserted once and never overwritten.
-- ============================================================================

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, notes, raw)
VALUES (
  'lookup_table', 'USA', '2026-03', 'tblMachiningMinWall', '7',
  'eMithran baseline: recommended and feasible minimum wall thickness of a machined part per material class (published CNC design guides)',
  '[
    {"MaterialClass": "aluminum",     "RecommendedMinWallMm": 0.8, "FeasibleMinWallMm": 0.5},
    {"MaterialClass": "mild_steel",   "RecommendedMinWallMm": 0.8, "FeasibleMinWallMm": 0.5},
    {"MaterialClass": "stainless",    "RecommendedMinWallMm": 0.8, "FeasibleMinWallMm": 0.5},
    {"MaterialClass": "titanium",     "RecommendedMinWallMm": 0.8, "FeasibleMinWallMm": 0.5},
    {"MaterialClass": "copper_alloy", "RecommendedMinWallMm": 0.8, "FeasibleMinWallMm": 0.5},
    {"MaterialClass": "tool_steel",   "RecommendedMinWallMm": 0.8, "FeasibleMinWallMm": 0.5},
    {"MaterialClass": "plastic",      "RecommendedMinWallMm": 1.5, "FeasibleMinWallMm": 1.0}
  ]'::jsonb
)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;
