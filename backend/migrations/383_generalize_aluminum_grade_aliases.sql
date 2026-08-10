-- ===================================================================================
-- Migration 383: Generalize aluminum grade aliases (2026-07-30)
--
-- Migration 382 fixed AL6101 specifically. Testing then showed the same gap is
-- systemic: AL5052 also returned zero results, because "AL5052" is not a
-- substring of "Generic Aluminum, ANSI 5052" either -- and neither is any other
-- "AL<number>"/"AA<number>" shorthand for any of the 39 existing
-- "Generic Aluminum, ANSI <grade>" rows.
--
-- This is mechanical and safe, unlike the earlier 6101->6061 mistake: each
-- alias is DERIVED from that row's own existing designation (its own number),
-- not asserting a new equivalence between two different alloys. No alloy is
-- ever aliased to a different alloy's row.
--
-- Scope: only rows matching 'Generic Aluminum, ANSI <digits><optional letter>'
-- (e.g. "5052", "1050A", "6061" -- including "6061 (LD30)", extracting "6061").
-- Deliberately excludes cast-alloy / DIN-style rows (e.g. "AC-AlSi9 (46000)",
-- "AIMg1") -- those don't have a single unambiguous number to derive an alias
-- from, and guessing one would repeat the exact mistake this migration is
-- fixing. Add those individually, with a real verified designation, if needed.
-- ===================================================================================

WITH graded AS (
    SELECT
        id,
        substring(material from '^Generic Aluminum, ANSI (\d{3,4}[A-Z]?)\y') AS grade
    FROM raw_materials
)
INSERT INTO material_aliases (raw_material_id, alias)
SELECT g.id, v.alias_value
FROM graded g
CROSS JOIN LATERAL (VALUES ('AL' || g.grade), ('AA' || g.grade), (g.grade)) AS v(alias_value)
WHERE g.grade IS NOT NULL
ON CONFLICT DO NOTHING;

-- Verification:
-- SELECT alias, alias_normalized, rm.material
--   FROM material_aliases ma JOIN raw_materials rm ON rm.id = ma.raw_material_id
--   WHERE ma.alias LIKE 'AL%' OR ma.alias LIKE 'AA%'
--   ORDER BY rm.material;
-- Should be 39 rows x 3 aliases = 117 new rows (minus any that collide with
-- migration 382's 6101 aliases, which ON CONFLICT DO NOTHING skips safely).
