-- 877: relink the remaining India stock prices, using the same proven ranked-pick logic
-- migration 859b already uses for USA (DISTINCT ON reference_material, priority, then
-- material_group/id as a deterministic tiebreak) -- not a stricter uniqueness guard.
--
-- Root cause of the 73 India materials migration 867 left unlinked: many alloys (e.g.
-- "Aluminum, AA 3105") have a raw_materials row in several process groups sharing the exact
-- same reference key (name), but with slightly different grade text across groups (some
-- "Generic X", one plain "X" from Forging, which never carries the Generic prefix). Migration
-- 867's `HAVING count(DISTINCT grade) = 1` rejected every one of these as "ambiguous" even
-- though 859b's own proof (USA, 1281/1281 linked) shows picking the best-priority candidate
-- deterministically is the right, already-established answer -- not a gap to leave unlinked.
--
-- Idempotent: only rows with raw_material_name IS NULL are touched (India only).

WITH ranked AS (
  SELECT p.reference_material,
         r.grade,
         CASE WHEN lower(r.grade) = lower('Generic ' || p.reference_material) THEN 1
              WHEN lower(r.grade) = lower(p.reference_material) THEN 2
         END AS priority,
         r.material_group,
         r.id
  FROM (SELECT DISTINCT reference_material FROM material_stock_prices WHERE location = 'India' AND raw_material_name IS NULL) p
  JOIN raw_materials r
    ON lower(r.grade) IN (lower(p.reference_material), lower('Generic ' || p.reference_material))
),
chosen AS (
  SELECT DISTINCT ON (reference_material) reference_material, grade
  FROM ranked
  ORDER BY reference_material, priority, material_group NULLS LAST, id
)
UPDATE material_stock_prices p
SET raw_material_name = c.grade
FROM chosen c
WHERE p.reference_material = c.reference_material
  AND p.location = 'India'
  AND p.raw_material_name IS NULL;

-- Verify (expect 0 or close to 0 remaining unlinked):
-- SELECT count(DISTINCT reference_material) FROM material_stock_prices
--   WHERE location = 'India' AND raw_material_name IS NULL;
