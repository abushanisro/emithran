-- 799: Sheet-metal feature_graph_v2 -> reference catalog vocabulary.
--
-- The CAD engine (CACHE_VERSION geo_v46) now emits sheet-metal
-- feature_graph_v2 entries in the reference operation-catalog vocabulary
-- (memory/sheetmetal/process/process_operations.csv, generated into
-- cad-engine/shared/reference_features.json) with a geometric variant, the same
-- shape migration 798 gave machining features. The backend DFM scorer and the
-- frontend now read only the new names, so stored rows are rewritten to what
-- a fresh analysis produces:
--
--   hole            -> SimpleHole   / through
--   extruded_flange -> SimpleHole   / extruded
--   perforation     -> SimpleHole   / perforated
--   slot            -> ComplexHole  / slot
--   bend            -> StraightBend / default
--   cut_profile     -> Blank        / default
--   thin_web        -> moved out of features into feature_graph_v2.conditions
--                      (a DFM condition between two holes, not a feature)
--
-- Also removed: feature_graph_v2.normalized_features (a parallel copy of the
-- same occurrences with zero consumers) and metadata.feature_contract_version.
--
-- Scope: rows WITHOUT a machining tree (machining rows were handled by 798 and
-- never carry these names). Injection-molding rows only use im_undercut /
-- im_undrafted, which are not in the mapping and pass through untouched.
-- Recognized rolled forms, formed features and lances are NOT back-filled as
-- features here: that needs geometry, so they appear on the next re-analysis.
--
-- Self-contained statements (no temp tables, no session state), helpers
-- dropped at the end, safe to re-run.

-- 1. old sheet-metal type -> {"type","variant"}, or NULL when not an old name.
CREATE OR REPLACE FUNCTION public.mig799_map(old_type text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE old_type
    WHEN 'hole'            THEN '{"type":"SimpleHole","variant":"through"}'::jsonb
    WHEN 'extruded_flange' THEN '{"type":"SimpleHole","variant":"extruded"}'::jsonb
    WHEN 'perforation'     THEN '{"type":"SimpleHole","variant":"perforated"}'::jsonb
    WHEN 'slot'            THEN '{"type":"ComplexHole","variant":"slot"}'::jsonb
    WHEN 'bend'            THEN '{"type":"StraightBend","variant":"default"}'::jsonb
    WHEN 'cut_profile'     THEN '{"type":"Blank","variant":"default"}'::jsonb
  END
$fn$;

-- 2. Rewrite one sheet-metal feature_graph_v2 object.
CREATE OR REPLACE FUNCTION public.mig799_fgv2(v2 jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $fn$
  WITH feats AS (
    SELECT x.ord, x.e, public.mig799_map(x.e->>'feature_type') AS map
    FROM jsonb_array_elements(COALESCE(v2->'features', '[]'::jsonb)) WITH ORDINALITY AS x(e, ord)
  )
  SELECT (v2 - 'normalized_features')
    || jsonb_build_object(
         'metadata', COALESCE(v2->'metadata', '{}'::jsonb) - 'feature_contract_version',
         'features', COALESCE((
           SELECT jsonb_agg(
             CASE WHEN map IS NULL THEN e
                  ELSE e || jsonb_build_object('feature_type', map->>'type', 'variant', map->>'variant') END
             ORDER BY ord)
           FROM feats WHERE e->>'feature_type' IS DISTINCT FROM 'thin_web'), '[]'::jsonb),
         'conditions', COALESCE(v2->'conditions', '[]'::jsonb) || COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', 'thin_web', 'condition', 'thin_web',
                    'occurrences', COALESCE(e->'occurrences', '[]'::jsonb)) ORDER BY ord)
           FROM feats WHERE e->>'feature_type' = 'thin_web'), '[]'::jsonb))
$fn$;

-- 3. The rewrite: only sheet-metal rows that still carry an old name or a
--    removed key, so a re-run touches nothing.
UPDATE bom_items
SET feature_graph = jsonb_set(feature_graph, '{feature_graph_v2}', public.mig799_fgv2(feature_graph->'feature_graph_v2'))
WHERE NOT (feature_graph ? 'cnc_features')
  AND jsonb_typeof(feature_graph->'feature_graph_v2') = 'object'
  AND (
    feature_graph->'feature_graph_v2' ? 'normalized_features'
    OR COALESCE(feature_graph->'feature_graph_v2'->'metadata', '{}'::jsonb) ? 'feature_contract_version'
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(feature_graph->'feature_graph_v2'->'features', '[]'::jsonb)) f
      WHERE public.mig799_map(f->>'feature_type') IS NOT NULL OR f->>'feature_type' = 'thin_web')
  );

-- 4. Post-check: no sheet-metal feature may still carry an old name.
DO $do$
DECLARE leftover int;
BEGIN
  SELECT count(*) INTO leftover
  FROM bom_items b,
       jsonb_array_elements(COALESCE(b.feature_graph->'feature_graph_v2'->'features', '[]'::jsonb)) f
  WHERE NOT (b.feature_graph ? 'cnc_features')
    AND (public.mig799_map(f->>'feature_type') IS NOT NULL OR f->>'feature_type' = 'thin_web');
  IF leftover > 0 THEN
    RAISE EXCEPTION 'migration 799: % sheet-metal features still carry old type names', leftover;
  END IF;
END
$do$;

-- 5. Remove the helpers.
DROP FUNCTION public.mig799_fgv2(jsonb);
DROP FUNCTION public.mig799_map(text);
