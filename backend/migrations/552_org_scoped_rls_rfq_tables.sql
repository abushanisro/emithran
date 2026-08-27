-- ============================================================================
-- Migration 552: Org-scoped RLS for the RFQ table cluster
--
-- Phase 3 RLS step (see .claude/plans/delegated-gliding-swan.md). Replaces
-- per-individual-user policies with organization-scoped ones built on
-- current_user_org_ids() (migration 541).
--
-- Real erosion bug found and fixed while doing this (independent of the org
-- conversion): rfq_tracking/rfq_tracking_vendors/rfq_tracking_parts have TWO
-- separate, un-synced policy sets layered on top of each other —
-- 058_rfq_tracking_system.sql (2026-01-25, creates the tables, plain
-- user_id = auth.uid() policies, no is_user_authorized() gate) and
-- migrations/021_complete_rls_authorization_fix_v2.sql (2026-04-18, later,
-- adds is_user_authorized()-gated policies under DIFFERENT names without
-- dropping 058's). Since permissive policies OR together, 058's looser
-- policies have been silently letting the later is_user_authorized() gate
-- be bypassed this whole time — same erosion pattern already found on
-- calculators/mhr_records earlier in this initiative. This migration drops
-- BOTH old sets and replaces them with one clean set that DOES keep
-- is_user_authorized() (preserving 021's later, more deliberate choice).
--
-- rfq_records never had is_user_authorized() (migrations/043_rfq_system.sql)
-- — not added now, preserved as-is per this initiative's standing rule of
-- leaving that gate exactly where it was.
--
-- rfq_tracking_vendors/rfq_tracking_parts now check their OWN
-- organization_id column directly (added in migration 550) instead of an
-- EXISTS join to rfq_tracking on every row check.
-- ============================================================================

-- ── rfq_records (no is_user_authorized) ──────────────────────────────────────

DROP POLICY IF EXISTS "Users can view own RFQ records" ON rfq_records;
DROP POLICY IF EXISTS "Users can create own RFQ records" ON rfq_records;
DROP POLICY IF EXISTS "Users can update own RFQ records" ON rfq_records;
DROP POLICY IF EXISTS "Users can delete own RFQ records" ON rfq_records;

CREATE POLICY "org_select_rfq_records" ON rfq_records FOR SELECT
    USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_insert_rfq_records" ON rfq_records FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_update_rfq_records" ON rfq_records FOR UPDATE
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_delete_rfq_records" ON rfq_records FOR DELETE
    USING (organization_id IN (SELECT current_user_org_ids()));

-- ── rfq_tracking (KEEPS is_user_authorized — see header note) ───────────────

DROP POLICY IF EXISTS "Users can view their own RFQ tracking" ON rfq_tracking;
DROP POLICY IF EXISTS "Users can insert their own RFQ tracking" ON rfq_tracking;
DROP POLICY IF EXISTS "Users can update their own RFQ tracking" ON rfq_tracking;
DROP POLICY IF EXISTS "Authorized users can view their own RFQ tracking" ON rfq_tracking;
DROP POLICY IF EXISTS "Authorized users can insert their own RFQ tracking" ON rfq_tracking;
DROP POLICY IF EXISTS "Authorized users can update their own RFQ tracking" ON rfq_tracking;
DROP POLICY IF EXISTS "Authorized users can delete their own RFQ tracking" ON rfq_tracking;

CREATE POLICY "org_select_rfq_tracking" ON rfq_tracking FOR SELECT
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_insert_rfq_tracking" ON rfq_tracking FOR INSERT
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_update_rfq_tracking" ON rfq_tracking FOR UPDATE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_delete_rfq_tracking" ON rfq_tracking FOR DELETE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

-- ── rfq_tracking_vendors (KEEPS is_user_authorized) ──────────────────────────

DROP POLICY IF EXISTS "Users can view RFQ tracking vendors for their RFQs" ON rfq_tracking_vendors;
DROP POLICY IF EXISTS "Users can insert RFQ tracking vendors for their RFQs" ON rfq_tracking_vendors;
DROP POLICY IF EXISTS "Users can update RFQ tracking vendors for their RFQs" ON rfq_tracking_vendors;
DROP POLICY IF EXISTS "Authorized users can manage RFQ tracking vendors" ON rfq_tracking_vendors;

CREATE POLICY "org_select_rfq_tracking_vendors" ON rfq_tracking_vendors FOR SELECT
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_insert_rfq_tracking_vendors" ON rfq_tracking_vendors FOR INSERT
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_update_rfq_tracking_vendors" ON rfq_tracking_vendors FOR UPDATE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_delete_rfq_tracking_vendors" ON rfq_tracking_vendors FOR DELETE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

-- ── rfq_tracking_parts (KEEPS is_user_authorized) ────────────────────────────

DROP POLICY IF EXISTS "Users can view RFQ tracking parts for their RFQs" ON rfq_tracking_parts;
DROP POLICY IF EXISTS "Users can insert RFQ tracking parts for their RFQs" ON rfq_tracking_parts;
DROP POLICY IF EXISTS "Authorized users can manage RFQ tracking parts" ON rfq_tracking_parts;

CREATE POLICY "org_select_rfq_tracking_parts" ON rfq_tracking_parts FOR SELECT
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_insert_rfq_tracking_parts" ON rfq_tracking_parts FOR INSERT
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_update_rfq_tracking_parts" ON rfq_tracking_parts FOR UPDATE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_delete_rfq_tracking_parts" ON rfq_tracking_parts FOR DELETE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

-- ── rfq_email_logs: SELECT policy re-derived via rfq_records.organization_id ─
-- INSERT/UPDATE stay exactly as-is (system/webhook writes, WITH CHECK (true)
-- / USING (true) — not user- or org-scoped, deliberately, since email
-- delivery webhooks carry no user session at all).

DROP POLICY IF EXISTS "Users can view own RFQ email logs" ON rfq_email_logs;

CREATE POLICY "org_select_rfq_email_logs" ON rfq_email_logs FOR SELECT
    USING (
        rfq_id IN (
            SELECT id FROM rfq_records WHERE organization_id IN (SELECT current_user_org_ids())
        )
    );

-- ============================================================================
-- send_rfq/close_rfq are SECURITY DEFINER functions (migrations/043) that do
-- their OWN internal ownership check ("user_id = p_user_id") — this runs
-- with the function owner's privileges and completely bypasses RLS
-- regardless of which client calls it, so rewriting rfq_records' RLS above
-- has ZERO effect on these two. Without this fix, an org-mate other than the
-- original creator could never send/close a colleague's RFQ even after
-- every other part of this migration lands. Rewritten to check org
-- membership (via organization_members) instead of exact user_id match.
-- ============================================================================

CREATE OR REPLACE FUNCTION send_rfq(
  p_rfq_id UUID,
  p_user_id UUID
) RETURNS VOID AS $$
BEGIN
  -- Validate the caller is an active member of the org that owns this RFQ
  -- (not necessarily the original creator).
  IF NOT EXISTS (
    SELECT 1 FROM rfq_records rr
    JOIN organization_members om ON om.organization_id = rr.organization_id
    WHERE rr.id = p_rfq_id AND om.user_id = p_user_id AND om.status = 'active'
  ) THEN
    RAISE EXCEPTION 'RFQ not found or unauthorized';
  END IF;

  -- Validate status
  IF EXISTS (
    SELECT 1 FROM rfq_records
    WHERE id = p_rfq_id AND status != 'draft'
  ) THEN
    RAISE EXCEPTION 'RFQ already sent';
  END IF;

  -- Mark as sent
  UPDATE rfq_records
  SET
    status = 'sent',
    sent_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = p_rfq_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION send_rfq IS 'Marks RFQ as sent. Should be called after email distribution. Org-scoped as of migration 552.';

CREATE OR REPLACE FUNCTION close_rfq(
  p_rfq_id UUID,
  p_user_id UUID
) RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM rfq_records rr
    JOIN organization_members om ON om.organization_id = rr.organization_id
    WHERE rr.id = p_rfq_id AND om.user_id = p_user_id AND om.status = 'active'
  ) THEN
    RAISE EXCEPTION 'RFQ not found or unauthorized';
  END IF;

  UPDATE rfq_records
  SET
    status = 'closed',
    closed_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = p_rfq_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION close_rfq IS 'Marks RFQ as closed. Org-scoped as of migration 552.';
