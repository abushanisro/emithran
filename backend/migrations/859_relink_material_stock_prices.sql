-- ============================================================================
-- Migration 859: link every stock price to its raw material
-- ============================================================================
-- Migrations 833/857/858 linked a price only when exactly one distinct raw
-- material name matched, so an alloy that also existed under a second name (for
-- example "Aluminum, AA 1100" beside "Generic Aluminum, AA 1100") stayed unlinked,
-- and 1,143 of 1,281 USA prices were not used in costing.
--
-- Rule, deterministic: prefer the row named "Generic " + the reference name, then
-- the exact reference name; among rows with the same name, the first by group
-- then id. Only prices with no link yet are set. A reference with no raw material
-- at all stays unlinked and is listed in the NOTICE.
--
-- Idempotent: a second run changes nothing.
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

DO $$
DECLARE
  unlinked text;
BEGIN
  SELECT string_agg(DISTINCT reference_material, ', ' ORDER BY reference_material) INTO unlinked
  FROM material_stock_prices WHERE raw_material_name IS NULL;
  RAISE NOTICE 'Migration 859: stock prices with no raw material at all: %', coalesce(unlinked, '(none)');
END $$;

NOTIFY pgrst, 'reload schema';

-- Verify: SELECT location, count(*), count(raw_material_name) FROM material_stock_prices GROUP BY 1;
