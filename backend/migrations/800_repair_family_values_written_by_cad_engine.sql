-- 800: Repair part-family values the CAD engine kept writing after 735/789.
--
-- ROOT CAUSE
--
-- Migrations 735 (injection_molded -> plastic_molded) and 789 (cnc_milled ->
-- milled, cnc_turned -> turned) renamed the platform part-family vocabulary
-- in the backend, frontend and stored data -- but not in the CAD engine, the
-- component that PRODUCES the value. The engine kept emitting the retired
-- names, so every CAD analysis since then wrote them back into bom_items:
-- process_taxonomy lookups keyed on the platform names missed (the upload
-- badge fell back to a hardcoded "CNC Machining"), and family-gated costing
-- did not recognise the part. The engine now emits the platform names
-- (cad-engine/shared/part_family.py); this migration repairs the rows
-- written in between.
--
-- Scope: exactly the fields a CAD analysis writes --
--   bom_items.family_classification
--   bom_items.feature_graph -> classification -> family
--   bom_items.feature_graph -> cnc_features  -> family
-- Every statement is self-contained (no temp tables, no session state) and
-- idempotent: a re-run matches no rows.

UPDATE bom_items SET family_classification = 'milled'         WHERE family_classification = 'cnc_milled';
UPDATE bom_items SET family_classification = 'turned'         WHERE family_classification = 'cnc_turned';
UPDATE bom_items SET family_classification = 'plastic_molded' WHERE family_classification = 'injection_molded';

UPDATE bom_items
SET feature_graph = jsonb_set(feature_graph, '{classification,family}',
      to_jsonb(CASE feature_graph -> 'classification' ->> 'family'
                 WHEN 'cnc_milled' THEN 'milled'
                 WHEN 'cnc_turned' THEN 'turned'
                 WHEN 'injection_molded' THEN 'plastic_molded' END))
WHERE feature_graph -> 'classification' ->> 'family' IN ('cnc_milled', 'cnc_turned', 'injection_molded');

UPDATE bom_items
SET feature_graph = jsonb_set(feature_graph, '{cnc_features,family}',
      to_jsonb(CASE feature_graph -> 'cnc_features' ->> 'family'
                 WHEN 'cnc_milled' THEN 'milled'
                 WHEN 'cnc_turned' THEN 'turned' END))
WHERE feature_graph -> 'cnc_features' ->> 'family' IN ('cnc_milled', 'cnc_turned');

-- Post-check: nothing may still carry a retired family name.
DO $do$
DECLARE leftover int;
BEGIN
  SELECT count(*) INTO leftover
  FROM bom_items
  WHERE family_classification IN ('cnc_milled', 'cnc_turned', 'injection_molded')
     OR feature_graph -> 'classification' ->> 'family' IN ('cnc_milled', 'cnc_turned', 'injection_molded')
     OR feature_graph -> 'cnc_features' ->> 'family' IN ('cnc_milled', 'cnc_turned');
  IF leftover > 0 THEN
    RAISE EXCEPTION 'migration 800: % bom_items rows still carry a retired family name', leftover;
  END IF;
END
$do$;
