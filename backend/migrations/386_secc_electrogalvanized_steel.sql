-- ===================================================================================
-- Migration 386: Real SECC (JIS G3313 electrogalvanized cold-rolled steel) row (2026-07-30)
--
-- SECC does NOT belong aliased to the existing "Generic Galv. Steel, Hot Worked"
-- rows (migration-visible via material_type = 'Galvanized Steel', jis_standard
-- 'JIS G3302', astm_standard 'ASTM A653'). Those are HOT-DIP galvanized,
-- hot-rolled base steel. SECC is COLD-ROLLED base steel, ELECTROgalvanized
-- (JIS G3313, ASTM A591 equivalent) -- different base steel processing and a
-- much thinner/smoother coating process. Same reasoning as not aliasing 6101
-- to 6061: similar-sounding, genuinely different material.
--
-- Source: JIS G3313 SECC specification data, cross-checked across two
-- reference sites (materialgrades.com for chemistry, wanzhigalvanized.com for
-- the SECC/SECD/SECE mechanical comparison table). Values used are the
-- guaranteed SPECIFICATION MINIMUMS (this is a spec-driven commercial product,
-- not a single-target alloy, so citing the guaranteed floor is the correct,
-- non-fabricated representation -- same convention as citing 270 MPa as "the"
-- SECC tensile strength rather than picking an arbitrary point in its
-- 270-410 MPa mill range):
--   Tensile strength: >= 270 MPa
--   Yield strength:   >= 140 MPa
--   Elongation:       >= 28% (thin gauge, t <= 0.4mm; JIS specifies higher
--                      minimums at greater thickness -- this is the
--                      conservative/thin-gauge figure)
--   Hardness range 40-70 HRB is a two-sided spec (not a single guaranteed
--   floor like the above), so it is NOT reduced to one number here --
--   left NULL rather than picking an arbitrary midpoint.
--
-- SECD and SECE (JIS G3313's drawing / deep-drawing grades) have different
-- elongation and hardness targets from SECC -- they are NOT aliased to this
-- row. Add them as their own rows, with their own verified data, if needed.
--
-- Cost: left unset (PENDING_REVIEW), same reasoning as 6101 -- no verified
-- current quote available.
-- ===================================================================================

INSERT INTO raw_materials (
    material, material_group, material_type, astm_standard, jis_standard,
    density_kg_m3, ultimate_tensile_strength, yield_tensile_strength, elongation_pct,
    elastic_modulus_gpa, poisson_ratio,
    currency, country_code, price_source, is_global
)
SELECT
    'Generic Steel, Cold Rolled Electrogalvanized (SECC)', 'Ferrous & Non-Ferrous', 'Galvanized Steel', 'ASTM A591', 'JIS G3313',
    7850, 270, 140, 28,
    200, 0.29,
    'USD', 'GL', 'PENDING_REVIEW', false
WHERE NOT EXISTS (
    SELECT 1 FROM raw_materials WHERE material = 'Generic Steel, Cold Rolled Electrogalvanized (SECC)'
);

INSERT INTO material_aliases (raw_material_id, alias)
SELECT id, 'SECC' FROM raw_materials
WHERE material = 'Generic Steel, Cold Rolled Electrogalvanized (SECC)'
ON CONFLICT DO NOTHING;

-- Verification:
-- SELECT * FROM raw_materials WHERE material = 'Generic Steel, Cold Rolled Electrogalvanized (SECC)';
-- SELECT alias, alias_normalized FROM material_aliases WHERE alias = 'SECC';
