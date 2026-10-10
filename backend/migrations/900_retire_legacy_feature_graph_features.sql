-- ============================================================================
-- Migration 900: retire the legacy bom_items.feature_graph.features list
-- ============================================================================
-- feature_graph.features was a third, backend-built representation of the
-- sheet-metal features (flat_pattern / hole / bend objects rebuilt from the
-- summary counts by the deleted SheetMetalFeatureExtractorService), next to
-- the canonical feature_graph_v2 and the summary. Nothing in costing read it;
-- the part page tree now reads the summary (Flat Pattern) and
-- feature_graph_v2 (bend groups, with real faces).
--
-- Its flat_pattern entry carried six real CAD facts the summary did not:
-- the cut-length breakdown, the longest continuous cut, the rapid-traverse
-- time and the nesting metrics (bounding rectangle, utilization, scrap).
-- New analyses write them into the summary (auto-fill.service.ts); this
-- migration copies them into the summary of every stored row that has them
-- (a value already in the summary wins), then removes the list.
-- Its est_laser_time_sec is NOT copied: it was a fixed-rate guess
-- (cut length / 4000 mm per min + 2 s per pierce), not CAD data.
--
-- One DO block. Idempotent.
-- ============================================================================

DO $m900$
DECLARE
  n_rows integer;
BEGIN
  WITH flat AS (
    SELECT b.id,
           (SELECT f -> 'recognition'
              FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(b.feature_graph -> 'features') = 'array'
                          THEN b.feature_graph -> 'features' ELSE '[]'::jsonb END) AS f
             WHERE f ->> 'type' = 'flat_pattern'
             LIMIT 1) AS r
      FROM bom_items b
     WHERE b.feature_graph ? 'features'
  ),
  facts AS (
    SELECT id,
           jsonb_strip_nulls(jsonb_build_object(
             'cutLengthBreakdownMm', CASE WHEN r ? 'cut_length_breakdown' THEN jsonb_build_object(
                 'outerProfile',     r -> 'cut_length_breakdown' -> 'outer_profile_mm',
                 'circularHoles',    r -> 'cut_length_breakdown' -> 'circular_holes_mm',
                 'internalProfiles', r -> 'cut_length_breakdown' -> 'internal_profiles_mm') END,
             'longestContinuousCutMm',     r -> 'longest_continuous_cut_mm',
             'rapidTraverseSec',           r -> 'rapid_traverse_sec',
             'flatPatternBoundingRectMm2', r -> 'bounding_rect_mm2',
             'materialUtilizationPct',     CASE WHEN r ? 'bounding_rect_mm2' THEN r -> 'material_utilization_pct' END,
             'scrapAreaMm2',               CASE WHEN r ? 'bounding_rect_mm2' THEN r -> 'scrap_area_mm2' END
           )) AS j
      FROM flat
  )
  UPDATE bom_items b
     SET feature_graph = CASE
           WHEN b.feature_graph ? 'summary' AND jsonb_typeof(b.feature_graph -> 'summary') = 'object'
             THEN (b.feature_graph - 'features')
                  || jsonb_build_object('summary', coalesce(facts.j, '{}'::jsonb) || (b.feature_graph -> 'summary'))
           ELSE b.feature_graph - 'features'
         END
    FROM facts
   WHERE b.id = facts.id;
  GET DIAGNOSTICS n_rows = ROW_COUNT;

  RAISE NOTICE 'feature_graph.features retired on % bom_items rows', n_rows;
END
$m900$;

-- Verify (expect 0):
--   SELECT count(*) FROM bom_items WHERE feature_graph ? 'features';
