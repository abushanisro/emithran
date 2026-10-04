-- Migration 892: Material Grade for parts whose grade was saved as material
-- Date: 2026-10-04
--
-- The Create BOM dialog material picker lists raw_materials grades (the grade
-- column, e.g. Aluminum, AA 3105) but saved the picked grade into
-- bom_items.material and left material_grade NULL. Costing falls back to
-- material, but the screens and services that read material_grade only (Cost
-- Guide Apply, machining need, readiness flags, ...) saw no grade at all: a
-- die-cast part was quoted on its alloy yet Apply skipped its material and
-- route, and Auto machining found no alloy for hole castability.
--
-- The dialog now saves a picked grade as material_grade too. This fills
-- material_grade for existing parts where material is exactly a raw_materials
-- grade, the same value costing already uses for them, so no quote changes.
-- A free-text material that is not a raw_materials grade is left as it is.
-- material_source is not touched: nothing records who picked these.

DO $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE bom_items b
     SET material_grade = b.material
   WHERE b.material_grade IS NULL
     AND b.material IS NOT NULL
     AND EXISTS (SELECT 1 FROM raw_materials r WHERE r.grade = b.material);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'material_grade filled from material on % BOM items.', v_updated;
END $$;
