-- ============================================================================
-- Migration 945: an organization admin's forced delete of a BOM item, as one reviewed function
-- ============================================================================
-- A BOM item used in a production lot cannot be deleted by a plain delete: production_lot_materials references it ON DELETE
-- RESTRICT (067), and a member can see only the lot materials of lots on their own BOMs. A member's delete is refused with 409
-- and the list of blocking lots (BOMItemsService.remove). An admin of the item's organization may force it:
--
--   delete_bom_item_cascade(item) checks, itself, that the caller is an active owner or admin of the item's organization, then
--   removes the item's lot materials (every lot's, which is the point of forcing), its process routes and their steps, detaches
--   its child items, deletes the item and records bom_item.force_deleted in audit_events, all in one transaction. It runs as its
--   owner because the lots of other members are invisible to the caller; nothing else is reachable through it.
--
-- Also drops cascade_delete_bom_item: it existed in some databases without ever being in migrations/ (drift), did the same
-- without any role check, and nothing calls it.
-- Idempotent.
-- ============================================================================

DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'cascade_delete_bom_item'
  LOOP
    EXECUTE format('DROP FUNCTION %s', f);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.delete_bom_item_cascade(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_name text;
  v_lot_materials integer;
  v_lots integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;

  SELECT i.organization_id, i.name INTO v_org, v_name FROM public.bom_items i WHERE i.id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOM item % not found', p_item_id USING ERRCODE = 'P0002';
  END IF;
  IF v_org IS NULL OR v_org NOT IN (SELECT public.current_user_admin_org_ids()) THEN
    RAISE EXCEPTION 'not an admin of the organization of BOM item %', p_item_id USING ERRCODE = '42501';
  END IF;

  SELECT count(*), count(DISTINCT m.production_lot_id) INTO v_lot_materials, v_lots
    FROM public.production_lot_materials m WHERE m.bom_item_id = p_item_id;
  DELETE FROM public.production_lot_materials WHERE bom_item_id = p_item_id;
  DELETE FROM public.process_route_steps
   WHERE process_route_id IN (SELECT r.id FROM public.process_routes r WHERE r.bom_item_id = p_item_id);
  DELETE FROM public.process_routes WHERE bom_item_id = p_item_id;
  UPDATE public.bom_items SET parent_item_id = NULL WHERE parent_item_id = p_item_id;
  DELETE FROM public.bom_items WHERE id = p_item_id;

  PERFORM public.record_audit_event(
    v_org, v_uid, 'user', 'bom_item.force_deleted', 'bom_item', p_item_id::text, 'ok', NULL, NULL,
    jsonb_strip_nulls(jsonb_build_object('name', left(v_name, 120), 'lotMaterials', v_lot_materials, 'lots', v_lots))
  );
  RETURN jsonb_build_object('lotMaterials', v_lot_materials, 'lots', v_lots);
END
$fn$;
REVOKE ALL ON FUNCTION public.delete_bom_item_cascade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_bom_item_cascade(uuid) TO authenticated;
