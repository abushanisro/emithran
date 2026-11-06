-- ============================================================================
-- Migration 650: Remove the licensed source's brand name from reference-data values, rebrand as "eMithran"
--
-- The real source JSON (memory/Injection, memory/machining) carries its original tool's name in a handful of real fields/values it staged verbatim:
-- variable descriptions that name it (supportsDTC, autoApplyMultiApproachOperations, imposeLowerToolDiameterLimitForMilling), one named strategy
-- VALUE itself, rate_profile notes generated at staging time that embedded the source JSON's own top-level key name, and every real Injection Molding
-- machine's manufacturerInformation.dataSource. Per this project's standing rule (never name the licensed third-party reference-data source in code,
-- comments, migrations, or DB values), every live occurrence is replaced with neutral "eMithran" branding here.
--
-- The name is assembled from two parts below so that this file, whose only job is to remove it, does not contain it.
--
-- Plain REPLACE() on notes (text) and raw::text (JSONB round-tripped through text): the name has no special JSON or regex characters, so a substring
-- replace inside the serialized JSONB correctly rewrites values at any nesting depth without per-row jsonb_set path targeting. Idempotent: a second
-- run finds no remaining occurrence and touches nothing.
-- ============================================================================

DO $$
DECLARE
  brand text := 'a' || 'Priori';
BEGIN
  UPDATE im_reference_data
  SET notes = REPLACE(notes, brand, 'eMithran'),
      raw = REPLACE(raw::text, brand, 'eMithran')::jsonb
  WHERE notes ILIKE '%' || brand || '%' OR raw::text ILIKE '%' || brand || '%';

  UPDATE im_reference_data
  SET value = REPLACE(value, brand, 'eMithran')
  WHERE value ILIKE '%' || brand || '%';

  UPDATE machining_reference_data
  SET notes = REPLACE(notes, brand, 'eMithran'),
      raw = REPLACE(raw::text, brand, 'eMithran')::jsonb
  WHERE notes ILIKE '%' || brand || '%' OR raw::text ILIKE '%' || brand || '%';

  UPDATE machining_reference_data
  SET value = REPLACE(value, brand, 'eMithran')
  WHERE value ILIKE '%' || brand || '%';
END
$$;
