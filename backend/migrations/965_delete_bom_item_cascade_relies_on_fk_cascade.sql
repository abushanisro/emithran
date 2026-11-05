-- ============================================================================
-- Migration 965: delete_bom_item_cascade() no longer deletes process routes by hand
-- ============================================================================
-- Migration 945 made the function delete the item's process_route_steps and process_routes itself before deleting the item. It need not: the
-- foreign keys do it (process_routes.bom_item_id REFERENCES bom_items ON DELETE CASCADE, 011; process_route_steps.process_route_id REFERENCES
-- process_routes ON DELETE CASCADE; the other references to routes are CASCADE or SET NULL). Naming the two tables in the function made it fail in
-- any database built without them (they belong to a retired planner no code creates routes in any more): "relation process_routes does not
-- exist", on every forced delete. The function now deletes what the foreign keys do not (the lots' materials, which are RESTRICT, and the children's
-- parent link), and the item; the routes go with it where they exist, and nothing is needed where they do not. Same checks, same audit event.
-- Idempotent.
-- ============================================================================

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
