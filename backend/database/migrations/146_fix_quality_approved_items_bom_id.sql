-- Migration 146: Fix quality_approved_items with null bom_item_id
-- selected_items was stored as string[] but service read item.id (undefined on a string)

-- For each approved inspection, re-insert quality_approved_items where bom_item_id is null
-- by expanding the selected_items JSON array (each element is a UUID string)
DO $$
DECLARE
  rec RECORD;
  item_id TEXT;
BEGIN
  FOR rec IN
    SELECT qi.id AS inspection_id, qi.selected_items, qi.created_by
    FROM quality_inspections qi
    WHERE qi.status = 'approved'
      AND qi.selected_items IS NOT NULL
      AND jsonb_array_length(qi.selected_items::jsonb) > 0
      AND EXISTS (
        SELECT 1 FROM quality_approved_items qa
        WHERE qa.inspection_id = qi.id AND qa.bom_item_id IS NULL
      )
  LOOP
    -- Remove the broken null-bom_item_id rows for this inspection
    DELETE FROM quality_approved_items
    WHERE inspection_id = rec.inspection_id AND bom_item_id IS NULL;

    -- Re-insert one row per selected item
    FOR item_id IN
      SELECT jsonb_array_elements_text(rec.selected_items::jsonb)
    LOOP
      -- Only insert if this bom_item actually exists
      IF EXISTS (SELECT 1 FROM bom_items WHERE id = item_id::uuid) THEN
        INSERT INTO quality_approved_items (
          bom_item_id, inspection_id, approved_quantity,
          approval_status, delivery_ready, delivery_ready_date,
          approved_by, approved_at, quality_grade, created_by
        )
        SELECT
          item_id::uuid, rec.inspection_id, 1,
          'approved', true, NOW(),
          qi.approved_by, qi.approved_at, 'A', rec.created_by
        FROM quality_inspections qi WHERE qi.id = rec.inspection_id
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, description)
VALUES ('146', 'Fix quality_approved_items with null bom_item_id caused by string[] selected_items')
ON CONFLICT (version) DO NOTHING;
