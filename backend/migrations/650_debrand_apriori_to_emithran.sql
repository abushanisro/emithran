-- ============================================================================
-- Migration 650: Remove all "aPriori" branding from reference-data values,
-- rebrand as "eMithran"
--
-- The real source JSON (memory/Injection, memory/machining) carries its
-- original tool's name in a handful of real fields/values it staged
-- verbatim: variable descriptions that reference "aPriori" by name
-- (supportsDTC, autoApplyMultiApproachOperations,
-- imposeLowerToolDiameterLimitForMilling), one named strategy VALUE itself
-- ("Roughing - aPriori Traditional"), rate_profile notes generated at
-- staging time that embedded the source JSON's own top-level key name
-- (digitalFactory_aPrioriUSA), and every real Injection Molding machine's
-- manufacturerInformation.dataSource ("aPriori Baseline"). Per this
-- project's standing rule (never name the licensed third-party reference-
-- data source in code, comments, migrations, or DB values), every live
-- occurrence is replaced with neutral "eMithran" branding here.
--
-- Plain REPLACE() on notes (text) and raw::text (JSONB round-tripped
-- through text) — safe for "aPriori" specifically: no special JSON/regex
-- characters, so a substring replace inside the serialized JSONB correctly
-- rewrites values at any nesting depth (top-level raw.notes for 'variable'
-- rows, nested raw.manufacturerInformation.dataSource for 'machine' rows)
-- without needing per-row jsonb_set path targeting. Idempotent — a second
-- run finds no remaining "aPriori" substring and touches nothing.
-- ============================================================================

UPDATE im_reference_data
SET notes = REPLACE(notes, 'aPriori', 'eMithran'),
    raw = REPLACE(raw::text, 'aPriori', 'eMithran')::jsonb
WHERE notes ILIKE '%apriori%' OR raw::text ILIKE '%apriori%';

UPDATE im_reference_data
SET value = REPLACE(value, 'aPriori', 'eMithran')
WHERE value ILIKE '%apriori%';

UPDATE machining_reference_data
SET notes = REPLACE(notes, 'aPriori', 'eMithran'),
    raw = REPLACE(raw::text, 'aPriori', 'eMithran')::jsonb
WHERE notes ILIKE '%apriori%' OR raw::text ILIKE '%apriori%';

UPDATE machining_reference_data
SET value = REPLACE(value, 'aPriori', 'eMithran')
WHERE value ILIKE '%apriori%';
