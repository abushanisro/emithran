-- ===================================================================================
-- Migration 382: Material aliases + real 6101 row (2026-07-30)
--
-- Root cause: drawings specify materials by shorthand/regional designation
-- (e.g. "AL6101") that has no row in raw_materials at all, and no alias/synonym
-- layer exists to catch it -- the material search (raw-materials.service.ts,
-- both findAll() and getEnhancedMaterials()) matches by ilike substring only
-- against material/material_group/material_grade, so an unmatched drawing
-- callout silently returns zero results instead of finding the right material.
--
-- IMPORTANT correction from an earlier draft of this migration: 6101 is NOT an
-- alias for 6061. They are different alloys for different applications -- 6101 is
-- a high-conductivity electrical-conductor alloy (busbars, ~57% IACS min per
-- ASTM B317), 6061 is a structural alloy (~40-45% IACS, higher strength). An
-- earlier version of this file aliased AL6101 to the existing 6061 row as a
-- placeholder; that was wrong and has been replaced with a real, dedicated 6101
-- row below. Never alias one alloy to a different alloy's row just because a
-- match wasn't otherwise available -- leave it unmatched/flagged instead.
--
-- Scope, revised after review -- dropped the previously-proposed
-- elastic_modulus_gpa / poisson_ratio / elongation_pct / formability_rating /
-- weldability_rating / punchability_rating / electrical_conductivity_iacs_pct
-- columns: none of the seven has an actual consumer anywhere in the codebase
-- today (checked, not assumed). Add any of them later alongside the bend/DFM
-- engine code that would actually read them -- not speculatively now.
--
-- What's left, both genuinely needed:
--   1. material_aliases -- many-to-one alias -> raw_materials mapping.
--   2. A real Aluminum 6101 row (didn't exist before -- confirmed via direct
--      query), using only pre-existing raw_materials columns, with aliases
--      pointing to it specifically.
--
-- Does NOT wire the alias table into raw-materials.service.ts's search yet --
-- that's the application-code change in the same commit/PR as this migration,
-- not optional follow-up, since the migration is otherwise unobservable from
-- the UI (see raw-materials.service.ts changes alongside this file).
-- ===================================================================================

-- Table: material_aliases
CREATE TABLE IF NOT EXISTS material_aliases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_material_id UUID NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
    alias           VARCHAR(100) NOT NULL,     -- e.g. 'AL6101', 'EN AW-6101', 'AA6101'
    alias_normalized VARCHAR(100) GENERATED ALWAYS AS (
        UPPER(REGEXP_REPLACE(alias, '[\s\-]', '', 'g'))
    ) STORED,                                  -- 'AL 6101' / 'AL-6101' / 'al6101' all match 'AL6101'
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS material_aliases_normalized_key ON material_aliases(alias_normalized);
CREATE INDEX IF NOT EXISTS material_aliases_raw_material_id ON material_aliases(raw_material_id);

ALTER TABLE material_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read" ON material_aliases;
CREATE POLICY "Public read" ON material_aliases FOR SELECT USING (true);

COMMENT ON TABLE material_aliases IS 'Alternate names/designations (regional standards, shorthand) that resolve to a raw_materials row -- e.g. AL6101 resolves to its own dedicated 6101 row. Never point an alloy alias at a DIFFERENT alloys row (e.g. 6101 must not resolve to 6061 -- different composition, different application: 6101 is a high-conductivity electrical-conductor alloy (busbars), 6061 is structural). alias_normalized strips spaces/hyphens and uppercases for lookup.';

-- Real 6101-T6 row -- no substitution, per explicit correction.
-- Mechanical properties (density, UTS, yield, shear) are standard published
-- Aluminum Association data for 6101-T6, not a fabricated estimate. Cost fields
-- are intentionally left NULL -- no verified market price for this specific alloy
-- is available here; an unknown value is left unmatched/flagged for review
-- rather than filled with a guess. price_source = 'PENDING_REVIEW' flags this
-- row for real cost data to be entered.
-- raw_materials has no unique constraint on `material`, so this uses a
-- NOT EXISTS guard (rather than ON CONFLICT, which would be a no-op here)
-- to stay safely re-runnable.
INSERT INTO raw_materials (
    material, material_group, material_type, astm_standard,
    density_kg_m3, ultimate_tensile_strength, yield_tensile_strength, shearing_strength,
    currency, country_code, price_source, is_global
)
SELECT
    'Generic Aluminum, ANSI 6101', 'Ferrous & Non-Ferrous', 'Aluminum', 'ASTM B317',
    2700, 221, 193, 133,
    'USD', 'GL', 'PENDING_REVIEW', false
WHERE NOT EXISTS (
    SELECT 1 FROM raw_materials WHERE material = 'Generic Aluminum, ANSI 6101'
);

-- Aliases -> the new 6101 row (never -> 6061)
INSERT INTO material_aliases (raw_material_id, alias)
SELECT rm.id, a.alias
FROM raw_materials rm
CROSS JOIN (VALUES ('AL6101'), ('AA6101'), ('EN AW-6101'), ('6101-T6'), ('6101')) AS a(alias)
WHERE rm.material = 'Generic Aluminum, ANSI 6101'
ON CONFLICT DO NOTHING;

-- Verification
-- SELECT * FROM raw_materials WHERE material = 'Generic Aluminum, ANSI 6101';
-- SELECT alias, alias_normalized, rm.material, rm.material_grade
--   FROM material_aliases ma JOIN raw_materials rm ON rm.id = ma.raw_material_id
--   WHERE rm.material = 'Generic Aluminum, ANSI 6101';
-- Cost data still needed:
-- SELECT material, price_source FROM raw_materials WHERE price_source = 'PENDING_REVIEW';

-- Known separate gap (not fixed here):
-- SECC (and galvanized steel grades generally -- SGCC, EG, GI, Z275, DX51D) have
-- no rows in raw_materials at all (confirmed via direct query: zero matches for
-- '%SECC%' or '%galvani%'). That's a real data gap, not a search/alias bug --
-- flagging it rather than fabricating a row, same reasoning as the 6101 fix above.
