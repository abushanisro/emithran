-- 945: an admin of the item's organization force-deletes a BOM item used in other members' production lots, in one transaction
-- and audited; anyone else is refused before anything changes. The legacy cascade_delete_bom_item (drift) is gone.
ALTER TABLE public.bom_items ADD COLUMN name text, ADD COLUMN parent_item_id uuid;
CREATE TABLE public.production_lots (id uuid PRIMARY KEY);
CREATE TABLE public.production_lot_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_lot_id uuid NOT NULL REFERENCES public.production_lots(id),
  bom_item_id uuid NOT NULL REFERENCES public.bom_items(id) ON DELETE RESTRICT
);
CREATE TABLE public.process_routes (id uuid PRIMARY KEY, bom_item_id uuid REFERENCES public.bom_items(id));
CREATE TABLE public.process_route_steps (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), process_route_id uuid REFERENCES public.process_routes(id));
-- the legacy function, as some databases carry it
CREATE FUNCTION public.cascade_delete_bom_item(p_item uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;

INSERT INTO auth.users (id) VALUES ('11111111-0000-4000-8000-00000000000a'), ('11111111-0000-4000-8000-00000000000c'),
  ('11111111-0000-4000-8000-00000000000e');
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-00000000000a', 'admin'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-00000000000c', 'member'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '11111111-0000-4000-8000-00000000000e', 'admin');
INSERT INTO public.bom_items (id, organization_id, name) VALUES
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Bracket'),
  ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'Bolt');
UPDATE public.bom_items SET parent_item_id = 'cccccccc-0000-4000-8000-000000000001' WHERE id = 'cccccccc-0000-4000-8000-000000000002';
INSERT INTO public.production_lots (id) VALUES ('dddddddd-0000-4000-8000-000000000001'), ('dddddddd-0000-4000-8000-000000000002');
INSERT INTO public.production_lot_materials (production_lot_id, bom_item_id) VALUES
  ('dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001'),
  ('dddddddd-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001');
INSERT INTO public.process_routes (id, bom_item_id) VALUES ('eeeeeeee-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001');
INSERT INTO public.process_route_steps (process_route_id) VALUES ('eeeeeeee-0000-4000-8000-000000000001');

\i /migrations/945_delete_bom_item_cascade.sql
\i /migrations/945_delete_bom_item_cascade.sql

SET ROLE authenticated;
DO $$
DECLARE who text;
BEGIN
  -- a member of the item's organization, and an admin of another organization, are refused
  FOREACH who IN ARRAY ARRAY['11111111-0000-4000-8000-00000000000c', '11111111-0000-4000-8000-00000000000e'] LOOP
    PERFORM set_config('test.uid', who, false);
    BEGIN
      PERFORM public.delete_bom_item_cascade('cccccccc-0000-4000-8000-000000000001');
      RAISE EXCEPTION '% force-deleted an item without being its organization''s admin', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  PERFORM set_config('test.uid', '', false);
  BEGIN
    PERFORM public.delete_bom_item_cascade('cccccccc-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'a caller without a user force-deleted an item';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.bom_items) = 2, 'nothing was deleted by a refused caller';
  ASSERT (SELECT count(*) FROM public.production_lot_materials) = 2, 'no lot material was removed by a refused caller';
  ASSERT (SELECT count(*) FROM public.audit_events) = 0, 'a refused call records nothing';
END $$;

-- The organization's admin forces it.
SET ROLE authenticated;
SELECT set_config('test.uid', '11111111-0000-4000-8000-00000000000a', false);
DO $$
DECLARE result jsonb;
BEGIN
  result := public.delete_bom_item_cascade('cccccccc-0000-4000-8000-000000000001');
  ASSERT result = '{"lots": 2, "lotMaterials": 2}'::jsonb, format('the result counts what was removed: %s', result);
  BEGIN
    PERFORM public.delete_bom_item_cascade('cccccccc-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'a deleted item was deleted again';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
END $$;
RESET ROLE;

DO $$
DECLARE e public.audit_events;
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.bom_items WHERE id = 'cccccccc-0000-4000-8000-000000000001'), 'the item is gone';
  ASSERT (SELECT parent_item_id FROM public.bom_items WHERE id = 'cccccccc-0000-4000-8000-000000000002') IS NULL, 'its child is detached';
  ASSERT (SELECT count(*) FROM public.production_lot_materials) = 0, 'every lot''s reference to it is removed';
  ASSERT (SELECT count(*) FROM public.production_lots) = 2, 'the lots themselves stay';
  ASSERT (SELECT count(*) FROM public.process_routes) = 0 AND (SELECT count(*) FROM public.process_route_steps) = 0, 'its routes are removed';
  SELECT * INTO e FROM public.audit_events;
  ASSERT e.action = 'bom_item.force_deleted' AND e.actor_id = '11111111-0000-4000-8000-00000000000a' AND e.actor_kind = 'user'
     AND e.org_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND e.target_id = 'cccccccc-0000-4000-8000-000000000001'
     AND e.meta = '{"name": "Bracket", "lots": 2, "lotMaterials": 2}'::jsonb, format('the force delete is audited: %s', row_to_json(e));
  ASSERT to_regproc('public.cascade_delete_bom_item') IS NULL, 'the legacy function is dropped';
  ASSERT NOT has_function_privilege('anon', 'public.delete_bom_item_cascade(uuid)', 'EXECUTE'), 'anon cannot call it';
  ASSERT (SELECT proconfig FROM pg_proc WHERE oid = 'public.delete_bom_item_cascade(uuid)'::regprocedure) = '{"search_path=public, pg_temp"}',
    'its search_path is pinned';
END $$;
