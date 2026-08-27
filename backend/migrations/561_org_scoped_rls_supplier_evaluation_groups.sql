-- ============================================================================
-- Migration 561: Org-scoped RLS + functions + trigger for supplier-evaluation-groups
--
-- Phase 6 RLS/function step (see .claude/plans/delegated-gliding-swan.md).
-- No is_user_authorized() on any of these tables originally (migrations
-- 053/054) — not added now.
--
-- Real bugs found and fixed here, independent of the org conversion:
--
-- 1. Four SECURITY DEFINER functions (get_supplier_evaluation_group,
--    get_supplier_evaluation_groups_by_project, get_supplier_evaluation_group_
--    detailed, get_supplier_evaluation_metrics) do their own internal
--    "seg.user_id = p_user_id" check — this runs with the function owner's
--    privileges and completely bypasses RLS regardless of which client calls
--    it, exactly like send_rfq/close_rfq in Phase 3. Rewriting this
--    migration's RLS alone would do nothing for these four; an org-mate
--    other than the original creator could never see a colleague's
--    evaluation group through them. Rewritten to check org membership via
--    organization_members instead of exact user_id match.
--
-- 2. log_evaluation_activity() (SECURITY DEFINER trigger) inserts into
--    supplier_evaluation_activities without ever setting organization_id.
--    The insert itself still succeeds (SECURITY DEFINER bypasses RLS), but
--    with organization_id = NULL every activity row it creates would become
--    permanently invisible under the new org-scoped SELECT policy (NULL
--    never matches "organization_id IN (...)"). Fixed to look up and set
--    organization_id from the parent evaluation group.
-- ============================================================================

-- ── supplier_evaluation_groups ────────────────────────────────────────────

DROP POLICY IF EXISTS seg_select ON supplier_evaluation_groups;
DROP POLICY IF EXISTS seg_insert ON supplier_evaluation_groups;
DROP POLICY IF EXISTS seg_update ON supplier_evaluation_groups;
DROP POLICY IF EXISTS seg_delete ON supplier_evaluation_groups;

CREATE POLICY org_select_seg ON supplier_evaluation_groups FOR SELECT
    USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_insert_seg ON supplier_evaluation_groups FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_update_seg ON supplier_evaluation_groups FOR UPDATE
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_delete_seg ON supplier_evaluation_groups FOR DELETE
    USING (organization_id IN (SELECT current_user_org_ids()));

-- ── supplier_evaluation_group_bom_items ───────────────────────────────────

DROP POLICY IF EXISTS segbi_select ON supplier_evaluation_group_bom_items;
DROP POLICY IF EXISTS segbi_insert ON supplier_evaluation_group_bom_items;
DROP POLICY IF EXISTS segbi_update ON supplier_evaluation_group_bom_items;
DROP POLICY IF EXISTS segbi_delete ON supplier_evaluation_group_bom_items;

CREATE POLICY org_select_segbi ON supplier_evaluation_group_bom_items FOR SELECT
    USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_insert_segbi ON supplier_evaluation_group_bom_items FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_update_segbi ON supplier_evaluation_group_bom_items FOR UPDATE
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_delete_segbi ON supplier_evaluation_group_bom_items FOR DELETE
    USING (organization_id IN (SELECT current_user_org_ids()));

-- ── supplier_evaluation_group_processes ───────────────────────────────────

DROP POLICY IF EXISTS segp_select ON supplier_evaluation_group_processes;
DROP POLICY IF EXISTS segp_insert ON supplier_evaluation_group_processes;
DROP POLICY IF EXISTS segp_update ON supplier_evaluation_group_processes;
DROP POLICY IF EXISTS segp_delete ON supplier_evaluation_group_processes;

CREATE POLICY org_select_segp ON supplier_evaluation_group_processes FOR SELECT
    USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_insert_segp ON supplier_evaluation_group_processes FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_update_segp ON supplier_evaluation_group_processes FOR UPDATE
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_delete_segp ON supplier_evaluation_group_processes FOR DELETE
    USING (organization_id IN (SELECT current_user_org_ids()));

-- ── supplier_evaluation_vendor_selections ─────────────────────────────────

DROP POLICY IF EXISTS sevs_select ON supplier_evaluation_vendor_selections;
DROP POLICY IF EXISTS sevs_insert ON supplier_evaluation_vendor_selections;
DROP POLICY IF EXISTS sevs_update ON supplier_evaluation_vendor_selections;
DROP POLICY IF EXISTS sevs_delete ON supplier_evaluation_vendor_selections;

CREATE POLICY org_select_sevs ON supplier_evaluation_vendor_selections FOR SELECT
    USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_insert_sevs ON supplier_evaluation_vendor_selections FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_update_sevs ON supplier_evaluation_vendor_selections FOR UPDATE
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_delete_sevs ON supplier_evaluation_vendor_selections FOR DELETE
    USING (organization_id IN (SELECT current_user_org_ids()));

-- ── supplier_evaluation_rfq_responses ─────────────────────────────────────

DROP POLICY IF EXISTS serr_select ON supplier_evaluation_rfq_responses;
DROP POLICY IF EXISTS serr_insert ON supplier_evaluation_rfq_responses;
DROP POLICY IF EXISTS serr_update ON supplier_evaluation_rfq_responses;
DROP POLICY IF EXISTS serr_delete ON supplier_evaluation_rfq_responses;

CREATE POLICY org_select_serr ON supplier_evaluation_rfq_responses FOR SELECT
    USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_insert_serr ON supplier_evaluation_rfq_responses FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_update_serr ON supplier_evaluation_rfq_responses FOR UPDATE
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_delete_serr ON supplier_evaluation_rfq_responses FOR DELETE
    USING (organization_id IN (SELECT current_user_org_ids()));

-- ── supplier_evaluation_rfq_line_items ─────────────────────────────────────

DROP POLICY IF EXISTS serli_select ON supplier_evaluation_rfq_line_items;
DROP POLICY IF EXISTS serli_insert ON supplier_evaluation_rfq_line_items;
DROP POLICY IF EXISTS serli_update ON supplier_evaluation_rfq_line_items;
DROP POLICY IF EXISTS serli_delete ON supplier_evaluation_rfq_line_items;

CREATE POLICY org_select_serli ON supplier_evaluation_rfq_line_items FOR SELECT
    USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_insert_serli ON supplier_evaluation_rfq_line_items FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_update_serli ON supplier_evaluation_rfq_line_items FOR UPDATE
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_delete_serli ON supplier_evaluation_rfq_line_items FOR DELETE
    USING (organization_id IN (SELECT current_user_org_ids()));

-- ── supplier_evaluation_activities (SELECT+INSERT only, matches original) ──

DROP POLICY IF EXISTS sea_select ON supplier_evaluation_activities;
DROP POLICY IF EXISTS sea_insert ON supplier_evaluation_activities;

CREATE POLICY org_select_sea ON supplier_evaluation_activities FOR SELECT
    USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_insert_sea ON supplier_evaluation_activities FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

-- ============================================================================
-- SECURITY DEFINER function rewrites (bypass RLS regardless of policy above)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_supplier_evaluation_group(
  p_group_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS TABLE (
  id UUID,
  project_id UUID,
  name VARCHAR,
  description TEXT,
  notes TEXT,
  status VARCHAR,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  bom_items JSONB,
  processes JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    seg.id, seg.project_id, seg.name, seg.description, seg.notes, seg.status,
    seg.created_at, seg.updated_at,
    COALESCE(
      jsonb_agg(DISTINCT jsonb_build_object(
        'id', segbi.bom_item_id, 'name', segbi.bom_item_name, 'partNumber', segbi.part_number,
        'material', segbi.material, 'quantity', segbi.quantity
      )) FILTER (WHERE segbi.id IS NOT NULL),
      '[]'::jsonb
    ) as bom_items,
    COALESCE(
      jsonb_agg(DISTINCT jsonb_build_object(
        'id', segp.process_id, 'name', segp.process_name, 'processGroup', segp.process_group,
        'type', segp.process_type, 'isPredefined', segp.is_predefined
      )) FILTER (WHERE segp.id IS NOT NULL),
      '[]'::jsonb
    ) as processes
  FROM supplier_evaluation_groups seg
  LEFT JOIN supplier_evaluation_group_bom_items segbi ON seg.id = segbi.evaluation_group_id
  LEFT JOIN supplier_evaluation_group_processes segp ON seg.id = segp.evaluation_group_id
  WHERE
    seg.id = p_group_id
    AND EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = seg.organization_id AND om.user_id = p_user_id AND om.status = 'active'
    )
  GROUP BY seg.id, seg.project_id, seg.name, seg.description, seg.notes, seg.status, seg.created_at, seg.updated_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_supplier_evaluation_group IS
  'SECURITY DEFINER: Get supplier evaluation group with all BOM items and processes. Org-scoped as of migration 561.';

CREATE OR REPLACE FUNCTION get_supplier_evaluation_groups_by_project(
  p_project_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS TABLE (
  id UUID,
  project_id UUID,
  name VARCHAR,
  description TEXT,
  notes TEXT,
  status VARCHAR,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  bom_items_count BIGINT,
  processes_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    seg.id, seg.project_id, seg.name, seg.description, seg.notes, seg.status,
    seg.created_at, seg.updated_at,
    COUNT(DISTINCT segbi.id) as bom_items_count,
    COUNT(DISTINCT segp.id) as processes_count
  FROM supplier_evaluation_groups seg
  LEFT JOIN supplier_evaluation_group_bom_items segbi ON seg.id = segbi.evaluation_group_id
  LEFT JOIN supplier_evaluation_group_processes segp ON seg.id = segp.evaluation_group_id
  WHERE
    seg.project_id = p_project_id
    AND EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = seg.organization_id AND om.user_id = p_user_id AND om.status = 'active'
    )
  GROUP BY seg.id, seg.project_id, seg.name, seg.description, seg.notes, seg.status, seg.created_at, seg.updated_at
  ORDER BY seg.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_supplier_evaluation_groups_by_project IS
  'SECURITY DEFINER: Get all supplier evaluation groups for a project with counts. Org-scoped as of migration 561.';

CREATE OR REPLACE FUNCTION get_supplier_evaluation_group_detailed(
    p_group_id UUID,
    p_user_id UUID DEFAULT auth.uid()
)
RETURNS TABLE (
    id UUID, project_id UUID, name VARCHAR, description TEXT, notes TEXT, status VARCHAR,
    vendor_selection_status VARCHAR, rfq_status VARCHAR, rfq_sent_at TIMESTAMP, rfq_deadline TIMESTAMP,
    selected_vendors_count INTEGER, total_vendors_invited INTEGER, evaluation_deadline TIMESTAMP,
    priority VARCHAR, evaluation_type VARCHAR, created_at TIMESTAMP, updated_at TIMESTAMP,
    bom_items JSONB, processes JSONB, vendors JSONB, activities JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        seg.id, seg.project_id, seg.name, seg.description, seg.notes, seg.status,
        seg.vendor_selection_status, seg.rfq_status, seg.rfq_sent_at, seg.rfq_deadline,
        seg.selected_vendors_count, seg.total_vendors_invited, seg.evaluation_deadline,
        seg.priority, seg.evaluation_type, seg.created_at, seg.updated_at,
        COALESCE(
            jsonb_agg(DISTINCT jsonb_build_object(
                'id', segbi.bom_item_id, 'name', segbi.bom_item_name, 'partNumber', segbi.part_number,
                'material', segbi.material, 'quantity', segbi.quantity
            )) FILTER (WHERE segbi.id IS NOT NULL),
            '[]'::jsonb
        ) as bom_items,
        COALESCE(
            jsonb_agg(DISTINCT jsonb_build_object(
                'id', segp.process_id, 'name', segp.process_name, 'processGroup', segp.process_group,
                'type', segp.process_type, 'isPredefined', segp.is_predefined
            )) FILTER (WHERE segp.id IS NOT NULL),
            '[]'::jsonb
        ) as processes,
        COALESCE(
            jsonb_agg(DISTINCT jsonb_build_object(
                'id', sevs.id, 'vendorId', sevs.vendor_id, 'vendorName', sevs.vendor_name,
                'selectionStatus', sevs.selection_status, 'rfqResponseStatus', sevs.rfq_response_status,
                'overallScore', sevs.overall_score, 'finalStatus', sevs.final_status,
                'invitedAt', sevs.invited_at, 'responseReceivedAt', sevs.response_received_at
            )) FILTER (WHERE sevs.id IS NOT NULL),
            '[]'::jsonb
        ) as vendors,
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', sea.id, 'activityType', sea.activity_type,
                        'description', sea.activity_description, 'createdAt', sea.created_at
                    ) ORDER BY sea.created_at DESC
                )
                FROM supplier_evaluation_activities sea
                WHERE sea.evaluation_group_id = seg.id
                LIMIT 10
            ),
            '[]'::jsonb
        ) as activities
    FROM supplier_evaluation_groups seg
    LEFT JOIN supplier_evaluation_group_bom_items segbi ON seg.id = segbi.evaluation_group_id
    LEFT JOIN supplier_evaluation_group_processes segp ON seg.id = segp.evaluation_group_id
    LEFT JOIN supplier_evaluation_vendor_selections sevs ON seg.id = sevs.evaluation_group_id
    WHERE
        seg.id = p_group_id
        AND EXISTS (
          SELECT 1 FROM organization_members om
          WHERE om.organization_id = seg.organization_id AND om.user_id = p_user_id AND om.status = 'active'
        )
    GROUP BY seg.id, seg.project_id, seg.name, seg.description, seg.notes, seg.status,
             seg.vendor_selection_status, seg.rfq_status, seg.rfq_sent_at, seg.rfq_deadline,
             seg.selected_vendors_count, seg.total_vendors_invited, seg.evaluation_deadline,
             seg.priority, seg.evaluation_type, seg.created_at, seg.updated_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_supplier_evaluation_group_detailed IS
    'SECURITY DEFINER: Get detailed supplier evaluation group with vendors and activities. Org-scoped as of migration 561.';

CREATE OR REPLACE FUNCTION get_supplier_evaluation_metrics(
    p_project_id UUID,
    p_user_id UUID DEFAULT auth.uid()
)
RETURNS TABLE (
    total_evaluations BIGINT, active_evaluations BIGINT, pending_rfqs BIGINT, completed_evaluations BIGINT,
    total_vendors_engaged BIGINT, avg_response_time_days NUMERIC, total_quoted_value NUMERIC,
    evaluations_by_status JSONB, recent_activities JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(seg.id) as total_evaluations,
        COUNT(seg.id) FILTER (WHERE seg.status = 'active') as active_evaluations,
        COUNT(seg.id) FILTER (WHERE seg.rfq_status IN ('sent', 'responses_received')) as pending_rfqs,
        COUNT(seg.id) FILTER (WHERE seg.status = 'completed') as completed_evaluations,
        COALESCE(SUM(seg.total_vendors_invited), 0) as total_vendors_engaged,
        AVG(EXTRACT(DAYS FROM (sevs.response_received_at - sevs.invited_at))) FILTER (WHERE sevs.response_received_at IS NOT NULL) as avg_response_time_days,
        COALESCE(SUM(serr.total_quoted_value), 0) as total_quoted_value,
        jsonb_build_object(
            'draft', COUNT(seg.id) FILTER (WHERE seg.status = 'draft'),
            'active', COUNT(seg.id) FILTER (WHERE seg.status = 'active'),
            'completed', COUNT(seg.id) FILTER (WHERE seg.status = 'completed'),
            'archived', COUNT(seg.id) FILTER (WHERE seg.status = 'archived')
        ) as evaluations_by_status,
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', sea.id, 'evaluationName', seg_act.name, 'activityType', sea.activity_type,
                        'description', sea.activity_description, 'createdAt', sea.created_at
                    ) ORDER BY sea.created_at DESC
                )
                FROM supplier_evaluation_activities sea
                JOIN supplier_evaluation_groups seg_act ON sea.evaluation_group_id = seg_act.id
                WHERE seg_act.project_id = p_project_id
                AND EXISTS (
                  SELECT 1 FROM organization_members om
                  WHERE om.organization_id = seg_act.organization_id AND om.user_id = p_user_id AND om.status = 'active'
                )
                LIMIT 20
            ),
            '[]'::jsonb
        ) as recent_activities
    FROM supplier_evaluation_groups seg
    LEFT JOIN supplier_evaluation_vendor_selections sevs ON seg.id = sevs.evaluation_group_id
    LEFT JOIN supplier_evaluation_rfq_responses serr ON seg.id = serr.evaluation_group_id
    WHERE seg.project_id = p_project_id
      AND EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = seg.organization_id AND om.user_id = p_user_id AND om.status = 'active'
      );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_supplier_evaluation_metrics IS
    'SECURITY DEFINER: Get comprehensive metrics for supplier evaluation dashboard. Org-scoped as of migration 561.';

-- ============================================================================
-- Trigger fix: log_evaluation_activity() must set organization_id on the
-- activity rows it inserts, or they become invisible to everyone under the
-- new org-scoped SELECT policy above (NULL never matches "IN (...)").
-- ============================================================================

CREATE OR REPLACE FUNCTION log_evaluation_activity()
RETURNS TRIGGER AS $$
DECLARE
    activity_desc TEXT;
    activity_type_val VARCHAR(50);
    v_group_id UUID;
    v_org_id UUID;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF TG_TABLE_NAME = 'supplier_evaluation_vendor_selections' THEN
            activity_type_val := 'vendors_selected';
            activity_desc := format('Vendor %s added to evaluation', NEW.vendor_name);
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF TG_TABLE_NAME = 'supplier_evaluation_groups' THEN
            IF OLD.rfq_status != NEW.rfq_status THEN
                activity_type_val := 'rfq_sent';
                activity_desc := format('RFQ status changed from %s to %s', OLD.rfq_status, NEW.rfq_status);
            END IF;
        ELSIF TG_TABLE_NAME = 'supplier_evaluation_rfq_responses' THEN
            IF OLD.response_status != NEW.response_status AND NEW.response_status = 'submitted' THEN
                activity_type_val := 'rfq_response_received';
                activity_desc := 'RFQ response received from vendor';
            END IF;
        END IF;
    END IF;

    IF activity_type_val IS NOT NULL THEN
        v_group_id := CASE
            WHEN TG_TABLE_NAME = 'supplier_evaluation_groups' THEN NEW.id
            WHEN TG_TABLE_NAME = 'supplier_evaluation_vendor_selections' THEN NEW.evaluation_group_id
            WHEN TG_TABLE_NAME = 'supplier_evaluation_rfq_responses' THEN NEW.evaluation_group_id
            ELSE NULL
        END;

        SELECT organization_id INTO v_org_id FROM supplier_evaluation_groups WHERE id = v_group_id;

        INSERT INTO supplier_evaluation_activities (
            evaluation_group_id,
            organization_id,
            activity_type,
            activity_description,
            vendor_id,
            user_id
        ) VALUES (
            v_group_id,
            v_org_id,
            activity_type_val,
            activity_desc,
            CASE
                WHEN TG_TABLE_NAME = 'supplier_evaluation_vendor_selections' THEN NEW.vendor_id
                WHEN TG_TABLE_NAME = 'supplier_evaluation_rfq_responses' THEN
                    (SELECT vendor_id FROM supplier_evaluation_vendor_selections WHERE id = NEW.vendor_selection_id)
                ELSE NULL
            END,
            auth.uid()
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION log_evaluation_activity IS
    'SECURITY DEFINER: auto-logs evaluation activity. Sets organization_id (from the parent evaluation group) as of migration 561 — previously left NULL, which silently made every logged activity invisible under org-scoped RLS.';
