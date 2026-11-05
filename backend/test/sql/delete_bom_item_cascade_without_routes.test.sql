-- 965: the forced delete works in a database that has no process_routes or process_route_steps (a retired planner's tables, absent from a database
-- built from the current baseline). Migration 945 named them in the function and every forced delete failed there with "relation does not exist".
ALTER TABLE public.bom_items ADD COLUMN name text, ADD COLUMN parent_item_id uuid;
CREATE TABLE public.production_lots (id uuid PRIMARY KEY);
CREATE TABLE public.production_lot_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_lot_id uuid NOT NULL REFERENCES public.production_lots(id),
  bom_item_id uuid NOT NULL REFERENCES public.bom_items(id) ON DELETE RESTRICT
);

INSERT INTO auth.users (id) VALUES ('11111111-0000-4000-8000-00000000000a');
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-00000000000a', 'admin');
INSERT INTO public.bom_items (id, organization_id, name) VALUES
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Bracket');
INSERT INTO public.production_lots (id) VALUES ('dddddddd-0000-4000-8000-000000000001');
INSERT INTO public.production_lot_materials (production_lot_id, bom_item_id) VALUES
  ('dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001');

DO $$
BEGIN
  ASSERT to_regclass('public.process_routes') IS NULL AND to_regclass('public.process_route_steps') IS NULL, 'this database has no route tables';
END $$;

SET ROLE authenticated;
SELECT set_config('test.uid', '11111111-0000-4000-8000-00000000000a', false);
DO $$
DECLARE result jsonb;
BEGIN
  result := public.delete_bom_item_cascade('cccccccc-0000-4000-8000-000000000001');
  ASSERT result = '{"lots": 1, "lotMaterials": 1}'::jsonb, format('the result counts what was removed: %s', result);
END $$;
RESET ROLE;

DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.bom_items WHERE id = 'cccccccc-0000-4000-8000-000000000001'), 'the item is gone';
  ASSERT (SELECT count(*) FROM public.production_lot_materials) = 0, 'the lot''s reference to it is removed';
  ASSERT (SELECT count(*) FROM public.audit_events WHERE action = 'bom_item.force_deleted') = 1, 'the force delete is audited';
END $$;
