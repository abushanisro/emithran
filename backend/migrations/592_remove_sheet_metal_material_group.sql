-- ============================================================================
-- Migration 592: Remove the 'Sheet Metal' material_group (2026-08-28,
-- user: "remove the group")
--
-- Migrations 590/591 introduced material_group = 'Sheet Metal' as a new,
-- separate group value for the materials seeded from
-- memory/sheetmetal/rawmetrial/rawmetalusa.json. That created exactly the
-- confusion documented in 590/591's own headers: ~39 of those 101 material
-- names already existed live under 'Ferrous & Non-Ferrous', so the same
-- real alloys ended up split across two different group labels depending on
-- whether a row was newly inserted or already existed -- and the fuzzy
-- '%metal%' match used everywhere else in the app (ferrous-container.
-- service.ts, retrieval.service.ts) already treated 'Sheet Metal' the same
-- as 'Ferrous & Non-Ferrous' anyway, so the new group value added a second
-- name for the same thing without adding any real distinction.
--
-- User decision: don't keep a separate 'Sheet Metal' group at all. This
-- migration retags every row currently in it back to 'Ferrous & Non-Ferrous'
-- -- the group these are all real examples of (aluminum/steel/stainless/
-- galvanized steel/copper/brass/titanium/nickel-superalloy grades) -- so
-- every one of the 101 rawmetalusa.json materials (whether newly inserted by
-- 590/591 or already pre-existing) ends up under the SAME group as every
-- other metal in the table, with no third category. No other column is
-- touched -- this is a pure relabel, same discipline as the retag migration
-- it replaces (never-run migration 592, deleted, which retagged the
-- opposite direction and is now moot).
-- ============================================================================

BEGIN;

UPDATE raw_materials
SET material_group = 'Ferrous & Non-Ferrous'
WHERE material_group = 'Sheet Metal';

COMMIT;

-- Verification (run manually after):
-- SELECT count(*) FROM raw_materials WHERE material_group = 'Sheet Metal';
-- -- Should now be 0.
-- SELECT count(*) FROM raw_materials WHERE material_group = 'Ferrous & Non-Ferrous'
--   AND material IN ('Generic Aluminum, AA 1100', 'Generic Copper, UNS C11000', 'Generic Titanium, Ti-6Al-4V');
-- -- Should be 3 -- confirms the retag landed on real rows.
