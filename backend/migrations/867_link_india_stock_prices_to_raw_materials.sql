-- 867: link India stock prices to their raw_materials row by name, after the column rename (865).
-- Migration 833's link step still reads raw_materials.material, which is now grade, so it
-- cannot run unchanged. This is the same rule, on the current names: a price links to the row
-- whose grade is the reference name, or "Generic " + the reference name, when that matches
-- exactly one row. Only India prices are touched; USA links are set by migration 859b.

UPDATE material_stock_prices p
SET raw_material_name = m.grade
FROM (
  SELECT p2.reference_material, min(r.grade) AS grade
  FROM (SELECT DISTINCT reference_material FROM material_stock_prices WHERE location = 'India') p2
  JOIN raw_materials r
    ON lower(r.grade) IN (lower(p2.reference_material), lower('Generic ' || p2.reference_material))
  GROUP BY p2.reference_material
  HAVING count(DISTINCT lower(r.grade)) = 1
) m
WHERE p.reference_material = m.reference_material
  AND p.location = 'India';
