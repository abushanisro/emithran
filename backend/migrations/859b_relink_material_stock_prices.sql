-- ============================================================================
-- 859b: relink every USA stock price to its raw material (standalone)
-- ============================================================================
-- The same single UPDATE as migration 859, on its own so it can be run and
-- checked by itself. Idempotent: only prices with no link yet are set.
-- ============================================================================

WITH ranked AS (
  SELECT p.reference_material,
         r.material,
         CASE WHEN lower(r.material) = lower('Generic ' || p.reference_material) THEN 1
              WHEN lower(r.material) = lower(p.reference_material) THEN 2
         END AS priority,
         r.material_group,
         r.id
  FROM (SELECT DISTINCT reference_material FROM material_stock_prices) p
  JOIN raw_materials r
    ON lower(r.material) IN (lower(p.reference_material), lower('Generic ' || p.reference_material))
),
chosen AS (
  SELECT DISTINCT ON (reference_material) reference_material, material
  FROM ranked
  ORDER BY reference_material, priority, material_group NULLS LAST, id
)
UPDATE material_stock_prices p
SET raw_material_name = c.material
FROM chosen c
WHERE p.reference_material = c.reference_material
  AND p.raw_material_name IS NULL;
