-- ============================================================================
-- Migration 879: which raw_materials groups belong to each process group
-- ============================================================================
-- The Cost Guide material search shows only the materials of the part's
-- process group. A process group and its material group usually share a name
-- (the memory/ folder both came from); where they do not, the link is stated
-- here (user decision 2026-10-04):
--   Sheet Metal, Sheet Metal - Hydroforming -> Ferrous & Non-Ferrous
--     (the sheet-metal materials, migrations 590 and 855b)
--   Plastic Molding -> Plastic & Rubber (there is no Plastic Molding material group)
--   Machining, Stock Machining -> Machining + Ferrous & Non-Ferrous
--     (the Machining group has 10 rows; bar stock is in Ferrous & Non-Ferrous)
-- Every other row pairs a process group with the material group of the same name.
--
-- Read by RawMaterialsService (GET /raw-materials?processGroup=).
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.process_material_groups (
  process_group text NOT NULL,
  material_group text NOT NULL,
  PRIMARY KEY (process_group, material_group)
);

ALTER TABLE public.process_material_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS process_material_groups_read ON public.process_material_groups;
CREATE POLICY process_material_groups_read ON public.process_material_groups FOR SELECT TO authenticated USING (true);

INSERT INTO public.process_material_groups (process_group, material_group) VALUES
  ('Die Casting', 'Die Casting'),
  ('Sand Casting', 'Sand Casting'),
  ('Casting', 'Casting'),
  ('Casting Investment', 'Casting Investment'),
  ('Forging', 'Forging'),
  ('Additive Manufacturing', 'Additive Manufacturing'),
  ('Composites', 'Composites'),
  ('PCB', 'PCB'),
  ('Machining', 'Machining'),
  ('Machining', 'Ferrous & Non-Ferrous'),
  ('Stock Machining', 'Machining'),
  ('Stock Machining', 'Ferrous & Non-Ferrous'),
  ('Sheet Metal', 'Ferrous & Non-Ferrous'),
  ('Sheet Metal - Hydroforming', 'Ferrous & Non-Ferrous'),
  ('Plastic Molding', 'Plastic & Rubber')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- Verify:
--   SELECT pmg.process_group, pmg.material_group, count(rm.id) AS materials
--   FROM process_material_groups pmg LEFT JOIN raw_materials rm ON rm.material_group = pmg.material_group
--   GROUP BY 1, 2 ORDER BY 1, 2;
