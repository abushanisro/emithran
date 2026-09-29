-- 801: Rename the stored machining feature tree key
-- feature_graph.cnc_features -> feature_graph.machining_features.
--
-- ROOT CAUSE
--
-- "Machining is the canonical domain, not CNC" (CLAUDE.md; the same mandate
-- behind migrations 789 and 800). The response key of the CAD engine, and so the
-- key every analyzed bom_items.feature_graph stores the machining feature
-- tree under, was still "cnc_features". The engine, backend and frontend now
-- read and write "machining_features"; this migration moves the stored key so
-- existing items keep their machining features.
--
-- Self-contained, idempotent: a row that already has machining_features (or
-- no cnc_features) is not matched, so a re-run changes nothing. If a row
-- somehow carries both keys, the existing machining_features value is kept.

UPDATE bom_items
SET feature_graph = (feature_graph - 'cnc_features')
                    || jsonb_build_object('machining_features', feature_graph -> 'cnc_features')
WHERE feature_graph ? 'cnc_features'
  AND NOT (feature_graph ? 'machining_features');

UPDATE bom_items
SET feature_graph = feature_graph - 'cnc_features'
WHERE feature_graph ? 'cnc_features'
  AND feature_graph ? 'machining_features';

-- Post-check: no stored feature graph may still use the old key.
DO $do$
DECLARE leftover int;
BEGIN
  SELECT count(*) INTO leftover FROM bom_items WHERE feature_graph ? 'cnc_features';
  IF leftover > 0 THEN
    RAISE EXCEPTION 'migration 801: % bom_items rows still store cnc_features', leftover;
  END IF;
END
$do$;
