-- 798: Machining feature types -> reference catalog vocabulary.
--
-- The CAD engine (cad-engine CACHE_VERSION geo_v45) now emits machining
-- features in the reference operation-catalog vocabulary
-- (memory/machining/operations_full__operations.csv, generated into
-- cad-engine/shared/reference_features.json): a reference feature type plus a
-- geometric variant, e.g. tapped_hole -> SimpleHole/threaded. The backend and
-- frontend now dispatch only on the new names, so every bom_items.feature_graph
-- analyzed before this change is rewritten here to the same shape a fresh
-- analysis produces.
--
-- Scope: only rows carrying a machining feature tree (feature_graph ? cnc_features).
-- The sheet-metal feature_graph_v2 has its own vocabulary (it also uses slot)
-- and is never touched.
--
-- Rewritten paths (each only when present):
--   cnc_features.features[]                    type -> type + variant
--   cnc_features.feature_summary               rebuilt per reference type
--   cnc_features.variant_summary               added, per type:variant
--   feature_graph_v2.features[]                feature_type -> feature_type + variant,
--   cnc_features.feature_graph_v2.features[]   canonical_operation relabelled
--
-- The only family-dependent mappings: the concave toroid (old groove) is a
-- plunged Ring/groove on a turned part and a milled Slot/groove otherwise; the
-- chamfer label is Mill Chamfering on turning routes.
--
-- Every statement below is self-contained (no temp tables, no session state),
-- so it runs correctly whether the SQL editor executes the file as one
-- transaction or commits statement by statement. The helper functions are
-- dropped at the end. Re-running is a no-op: already-migrated entries carry a
-- variant and are left untouched.

-- 1. old type -> {"type": new_type, "variant": variant}, or NULL when unmapped.
CREATE OR REPLACE FUNCTION public.mig798_map(old_type text, turned boolean)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE old_type
    WHEN 'through_hole'      THEN '{"type":"SimpleHole","variant":"through"}'::jsonb
    WHEN 'blind_hole'        THEN '{"type":"SimpleHole","variant":"blind"}'::jsonb
    WHEN 'tapped_hole'       THEN '{"type":"SimpleHole","variant":"threaded"}'::jsonb
    WHEN 'cross_hole'        THEN '{"type":"SimpleHole","variant":"cross"}'::jsonb
    WHEN 'pcd_hole_pattern'  THEN '{"type":"SimpleHole","variant":"pcd_pattern"}'::jsonb
    WHEN 'counterbore'       THEN '{"type":"MultiStepHole","variant":"counterbore"}'::jsonb
    WHEN 'multi_step_hole'   THEN '{"type":"MultiStepHole","variant":"stepped"}'::jsonb
    WHEN 'countersink'       THEN '{"type":"Edge","variant":"countersink"}'::jsonb
    WHEN 'chamfer'           THEN '{"type":"Edge","variant":"chamfer"}'::jsonb
    WHEN 'fillet'            THEN '{"type":"Edge","variant":"round"}'::jsonb
    WHEN 'external_diameter' THEN '{"type":"Ring","variant":"outer_diameter"}'::jsonb
    WHEN 'groove'            THEN CASE WHEN turned
                                   THEN '{"type":"Ring","variant":"groove"}'::jsonb
                                   ELSE '{"type":"Slot","variant":"groove"}'::jsonb END
    WHEN 'pocket'            THEN '{"type":"PocketV2","variant":"default"}'::jsonb
    WHEN 'slot'              THEN '{"type":"Slot","variant":"straight"}'::jsonb
    WHEN 'radial_slot'       THEN '{"type":"Slot","variant":"radial"}'::jsonb
    WHEN 'keyway'            THEN '{"type":"Keyway","variant":"default"}'::jsonb
    WHEN 'cutout'            THEN '{"type":"Cutout","variant":"default"}'::jsonb
    WHEN 'planar_face'       THEN '{"type":"PlanarFace","variant":"default"}'::jsonb
    WHEN 'curved_wall'       THEN '{"type":"CurvedWall","variant":"default"}'::jsonb
    WHEN 'curved_surface'    THEN '{"type":"CurvedSurface","variant":"default"}'::jsonb
  END
$fn$;

-- 2. Catalog operation attached to a feature (same table as canonical-operation.ts).
CREATE OR REPLACE FUNCTION public.mig798_label(new_type text, variant text, turned boolean)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE new_type || ':' || variant
    WHEN 'SimpleHole:through'        THEN 'Drilling'
    WHEN 'SimpleHole:blind'          THEN 'Drilling'
    WHEN 'SimpleHole:cross'          THEN 'Drilling'
    WHEN 'SimpleHole:pcd_pattern'    THEN 'Drilling'
    WHEN 'SimpleHole:threaded'       THEN 'Tapping'
    WHEN 'MultiStepHole:counterbore' THEN 'Multistep Holemaking'
    WHEN 'MultiStepHole:stepped'     THEN 'Step Drilling'
    WHEN 'Edge:countersink'          THEN 'Countersinking'
    WHEN 'Edge:chamfer'              THEN CASE WHEN turned THEN 'Mill Chamfering' ELSE 'Chamfering' END
    WHEN 'Edge:round'                THEN 'Rounding'
    WHEN 'PocketV2:default'          THEN 'Rough Milling'
    WHEN 'Slot:straight'             THEN 'Slot Milling'
    WHEN 'Slot:radial'               THEN 'Slot Milling'
    WHEN 'Slot:groove'               THEN 'Groove Milling'
    WHEN 'Keyway:default'            THEN 'Rough Milling'
    WHEN 'Cutout:default'            THEN 'Perimeter Milling'
    WHEN 'PlanarFace:default'        THEN 'Fine Finish Milling'
    WHEN 'CurvedWall:default'        THEN 'Contouring'
    WHEN 'CurvedSurface:default'     THEN 'Contouring'
    WHEN 'Ring:outer_diameter'       THEN 'Rough Turning'
    WHEN 'Ring:groove'               THEN 'Plunging'
  END
$fn$;

-- 3. Rewrite one feature_graph_v2 object.
CREATE OR REPLACE FUNCTION public.mig798_fgv2(v2 jsonb, turned boolean)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN v2 IS NULL OR jsonb_typeof(v2->'features') IS DISTINCT FROM 'array' THEN v2
    ELSE jsonb_set(v2, '{features}', COALESCE((
      SELECT jsonb_agg(
        CASE
          WHEN x.e ? 'variant' OR m.map IS NULL THEN x.e
          ELSE (x.e - 'canonical_operation')
               || jsonb_build_object('feature_type', m.map->>'type', 'variant', m.map->>'variant')
               || CASE WHEN x.e ? 'canonical_operation'
                        AND public.mig798_label(m.map->>'type', m.map->>'variant', turned) IS NOT NULL
                       THEN jsonb_build_object('canonical_operation',
                              public.mig798_label(m.map->>'type', m.map->>'variant', turned)
                              || ' // ' || (m.map->>'type'))
                       ELSE '{}'::jsonb END
        END ORDER BY x.ord)
      FROM jsonb_array_elements(v2->'features') WITH ORDINALITY AS x(e, ord)
      CROSS JOIN LATERAL (SELECT public.mig798_map(x.e->>'feature_type', turned) AS map) m
    ), '[]'::jsonb))
  END
$fn$;

-- 4. Rewrite the cnc_features tree and rebuild both summaries from it.
CREATE OR REPLACE FUNCTION public.mig798_cnc(cnc jsonb, turned boolean)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $fn$
  WITH feats AS (
    SELECT x.ord,
           CASE WHEN x.e ? 'variant' OR m.map IS NULL THEN x.e
                ELSE x.e || jsonb_build_object('type', m.map->>'type', 'variant', m.map->>'variant') END AS e
    FROM jsonb_array_elements(COALESCE(cnc->'features', '[]'::jsonb)) WITH ORDINALITY AS x(e, ord)
    CROSS JOIN LATERAL (SELECT public.mig798_map(x.e->>'type', turned) AS map) m
  )
  SELECT cnc
    || jsonb_build_object(
         'features', COALESCE((SELECT jsonb_agg(e ORDER BY ord) FROM feats), '[]'::jsonb),
         'feature_summary', COALESCE((
           SELECT jsonb_object_agg(t, n) FROM (
             SELECT e->>'type' AS t, count(*) AS n FROM feats GROUP BY 1) s), '{}'::jsonb),
         'variant_summary', COALESCE((
           SELECT jsonb_object_agg(k, n) FROM (
             SELECT (e->>'type') || ':' || COALESCE(e->>'variant', 'default') AS k, count(*) AS n
             FROM feats GROUP BY 1) s), '{}'::jsonb))
    || CASE WHEN cnc ? 'feature_graph_v2'
            THEN jsonb_build_object('feature_graph_v2', public.mig798_fgv2(cnc->'feature_graph_v2', turned))
            ELSE '{}'::jsonb END
$fn$;

-- 5. Pre-flight: every stored machining feature type must be either an old
--    name with a mapping or an already-migrated reference type. Anything else
--    aborts before a single row is changed.
DO $do$
DECLARE unknown text;
BEGIN
  SELECT string_agg(DISTINCT f->>'type', ', ') INTO unknown
  FROM bom_items b,
       jsonb_array_elements(COALESCE(b.feature_graph->'cnc_features'->'features', '[]'::jsonb)) f
  WHERE b.feature_graph ? 'cnc_features'
    AND public.mig798_map(f->>'type', false) IS NULL
    AND NOT (f ? 'variant');
  IF unknown IS NOT NULL THEN
    RAISE EXCEPTION 'migration 798: unmapped stored machining feature types: %', unknown;
  END IF;
END
$do$;

-- 6. The rewrite (one statement, atomic on its own).
UPDATE bom_items b
SET feature_graph =
      jsonb_set(b.feature_graph, '{cnc_features}', public.mig798_cnc(b.feature_graph->'cnc_features', r.turned))
      || CASE WHEN b.feature_graph ? 'feature_graph_v2'
              THEN jsonb_build_object('feature_graph_v2', public.mig798_fgv2(b.feature_graph->'feature_graph_v2', r.turned))
              ELSE '{}'::jsonb END
FROM (
  SELECT id,
         COALESCE((feature_graph->'cnc_features'->>'family') IN ('cnc_turned', 'mill_turn', 'turned'), false) AS turned
  FROM bom_items
  WHERE feature_graph ? 'cnc_features'
    AND jsonb_typeof(feature_graph->'cnc_features') = 'object'
) r
WHERE b.id = r.id;

-- 7. Post-check: no machining feature may still carry an old type name.
DO $do$
DECLARE leftover int;
BEGIN
  SELECT count(*) INTO leftover
  FROM bom_items b,
       jsonb_array_elements(COALESCE(b.feature_graph->'cnc_features'->'features', '[]'::jsonb)) f
  WHERE b.feature_graph ? 'cnc_features'
    AND public.mig798_map(f->>'type', false) IS NOT NULL;
  IF leftover > 0 THEN
    RAISE EXCEPTION 'migration 798: % machining features still carry old type names', leftover;
  END IF;
END
$do$;

-- 8. Remove the helpers.
DROP FUNCTION public.mig798_cnc(jsonb, boolean);
DROP FUNCTION public.mig798_fgv2(jsonb, boolean);
DROP FUNCTION public.mig798_label(text, text, boolean);
DROP FUNCTION public.mig798_map(text, boolean);
