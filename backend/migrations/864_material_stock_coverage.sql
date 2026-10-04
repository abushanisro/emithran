-- 864: how many stock forms each material has a price for, in one location.
-- The raw materials list shows this per row. One function call returns one row per
-- reference key, so a page of rows is never cut short by the 1000-row query limit.
-- Keys are the reference materials the costing uses (grade, falling back to name).

CREATE OR REPLACE FUNCTION material_stock_coverage(p_keys text[], p_location text)
RETURNS TABLE (reference_material text, priced_forms int)
LANGUAGE sql
STABLE
AS $$
  SELECT msp.reference_material, count(*)::int
  FROM material_stock_prices msp
  WHERE msp.location = p_location
    AND msp.reference_material = ANY (p_keys)
  GROUP BY msp.reference_material;
$$;

GRANT EXECUTE ON FUNCTION material_stock_coverage(text[], text) TO authenticated, service_role;
