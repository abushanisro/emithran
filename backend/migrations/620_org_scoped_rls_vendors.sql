-- ============================================================================
-- Migration 620: Org-scoped RLS for vendors, vendor_equipment, vendor_services,
-- vendor_contacts, vendor_ratings + fix two view-bypass gaps
--
-- Phase 7a of the master-data org-scoping initiative (see
-- .claude/plans/vivid-conjuring-reef.md). Reuses current_user_org_ids()
-- (migration 541) exactly like the mhr_records/boms/bom_items conversion
-- (migration 544).
--
-- CONFIRMED EROSION BUG (found auditing this table, same class migration 552
-- already fixed once for rfq_tracking, and the same class found on
-- calculators below in migration 624): migration 015_comprehensive_vendor_
-- system.sql created ungated policies named "Users can view/insert/update/
-- delete their own vendors" (and the vendor_equipment/services/contacts
-- equivalents). migration 019_rls_authorization.sql added is_user_authorized()
-- -gated policies under DIFFERENT names ("Authorized users can ...") without
-- ever dropping 015's originals (019's own DROP POLICY IF EXISTS lines target
-- the "Authorized users..." names, not 015's "Users can..." names — a
-- self-referential no-op, not a real drop of the old policy). Since
-- permissive policies OR together, 015's ungated policies have been silently
-- keeping is_user_authorized() non-functional on vendors and all 3 child
-- tables this whole time. This migration drops BOTH layers explicitly by
-- name (not a dynamic pg_policies loop — the exact two layers are known and
-- named, matching this codebase's established DROP-POLICY-IF-EXISTS-by-name
-- convention used in 544/561) and replaces them with one clean org-scoped
-- set that keeps is_user_authorized() functioning.
--
-- SEPARATE, DEEPER GAP (view-bypass, not a policy-erosion bug — no RLS
-- policy content could ever fix it): vendor_summary (a plain CREATE VIEW,
-- migration 015) and vendor_rating_aggregates (a CREATE MATERIALIZED VIEW,
-- migration 055) are what vendors.service.ts's findAll()/matchForPart()
-- actually query — never the base tables directly for those two paths. A
-- plain view with no security_invoker set (the default, and the only mode
-- ever used anywhere in this codebase's migration history) applies RLS as if
-- its OWNER queries the underlying tables, not the actual caller — and a
-- materialized view cannot carry RLS at all, structurally, regardless of any
-- policy on its source tables. This is the real explanation for
-- vendors.service.ts's "shared database" code comments: those two read paths
-- were never actually gated by whatever vendors' RLS said, in either its old
-- or new form. Fixed below by (a) flipping vendor_summary to
-- security_invoker = true (a one-line ALTER, Postgres 15+), and (b)
-- converting vendor_rating_aggregates from a materialized view to a plain
-- security_invoker view, since there is no other way to make a materialized
-- view respect per-row RLS.
--
-- Backfill is fully generic (no hardcoded org/user UUIDs) — every vendor's
-- organization_id comes from its own owning user's CURRENT organization_members
-- row, not a literal ID copied from a point-in-time snapshot. A defensive
-- transitional SELECT-only clause (organization_id IS NULL AND user_id =
-- auth.uid()), identical in spirit to migration 544's mhr_records clause,
-- covers any owner who is somehow not (or not yet) an organization_members
-- row at the moment this runs — never silently 404s an existing user out of
-- their own data.
-- ============================================================================

-- ── Schema: add organization_id ─────────────────────────────────────────────

ALTER TABLE vendors          ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE vendor_equipment ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE vendor_services  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE vendor_contacts  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE vendor_ratings   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_vendors_organization_id          ON vendors(organization_id);
CREATE INDEX IF NOT EXISTS idx_vendor_equipment_organization_id ON vendor_equipment(organization_id);
CREATE INDEX IF NOT EXISTS idx_vendor_services_organization_id  ON vendor_services(organization_id);
CREATE INDEX IF NOT EXISTS idx_vendor_contacts_organization_id  ON vendor_contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_vendor_ratings_organization_id   ON vendor_ratings(organization_id);

-- ── Backfill (generic — no hardcoded UUIDs) ─────────────────────────────────

UPDATE vendors v
SET organization_id = om.organization_id
FROM organization_members om
WHERE v.user_id = om.user_id
  AND om.status = 'active'
  AND v.organization_id IS NULL;

UPDATE vendor_equipment ve
SET organization_id = v.organization_id
FROM vendors v
WHERE ve.vendor_id = v.id
  AND v.organization_id IS NOT NULL
  AND ve.organization_id IS NULL;

UPDATE vendor_services vs
SET organization_id = v.organization_id
FROM vendors v
WHERE vs.vendor_id = v.id
  AND v.organization_id IS NOT NULL
  AND vs.organization_id IS NULL;

UPDATE vendor_contacts vc
SET organization_id = v.organization_id
FROM vendors v
WHERE vc.vendor_id = v.id
  AND v.organization_id IS NOT NULL
  AND vc.organization_id IS NULL;

-- vendor_ratings has no user_id column (only user_email) — its organization_id
-- is the org of the VENDOR being rated, not the rater. A vendor only visible
-- to one org going forward can only sensibly be rated by that org's users
-- anyway.
UPDATE vendor_ratings vr
SET organization_id = v.organization_id
FROM vendors v
WHERE vr.vendor_id = v.id
  AND v.organization_id IS NOT NULL
  AND vr.organization_id IS NULL;

-- ── RLS: vendors ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view their own vendors" ON vendors;
DROP POLICY IF EXISTS "Users can insert their own vendors" ON vendors;
DROP POLICY IF EXISTS "Users can update their own vendors" ON vendors;
DROP POLICY IF EXISTS "Users can delete their own vendors" ON vendors;
DROP POLICY IF EXISTS "Authorized users can view their own vendors" ON vendors;
DROP POLICY IF EXISTS "Authorized users can insert their own vendors" ON vendors;
DROP POLICY IF EXISTS "Authorized users can update their own vendors" ON vendors;
DROP POLICY IF EXISTS "Authorized users can delete their own vendors" ON vendors;

CREATE POLICY "org_select_vendors" ON vendors FOR SELECT
    USING (
        is_user_authorized() AND (
            organization_id IN (SELECT current_user_org_ids())
            OR (organization_id IS NULL AND user_id = auth.uid())
        )
    );

CREATE POLICY "org_insert_vendors" ON vendors FOR INSERT
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_update_vendors" ON vendors FOR UPDATE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_delete_vendors" ON vendors FOR DELETE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

-- ── RLS: vendor_equipment / vendor_services / vendor_contacts ──────────────
-- Same EXISTS-subquery-via-parent shape migration 015/019 already used,
-- swapped from vendors.user_id = auth.uid() to vendors.organization_id
-- membership.

DROP POLICY IF EXISTS "Users can view equipment of their vendors" ON vendor_equipment;
DROP POLICY IF EXISTS "Users can insert equipment for their vendors" ON vendor_equipment;
DROP POLICY IF EXISTS "Users can update equipment of their vendors" ON vendor_equipment;
DROP POLICY IF EXISTS "Users can delete equipment of their vendors" ON vendor_equipment;
DROP POLICY IF EXISTS "Authorized users can view vendor_equipment for their vendors" ON vendor_equipment;
DROP POLICY IF EXISTS "Authorized users can insert vendor_equipment for their vendors" ON vendor_equipment;
DROP POLICY IF EXISTS "Authorized users can update vendor_equipment for their vendors" ON vendor_equipment;
DROP POLICY IF EXISTS "Authorized users can delete vendor_equipment for their vendors" ON vendor_equipment;

CREATE POLICY "org_select_vendor_equipment" ON vendor_equipment FOR SELECT
    USING (is_user_authorized() AND EXISTS (
        SELECT 1 FROM vendors WHERE vendors.id = vendor_equipment.vendor_id
        AND vendors.organization_id IN (SELECT current_user_org_ids())
    ));
CREATE POLICY "org_insert_vendor_equipment" ON vendor_equipment FOR INSERT
    WITH CHECK (is_user_authorized() AND EXISTS (
        SELECT 1 FROM vendors WHERE vendors.id = vendor_equipment.vendor_id
        AND vendors.organization_id IN (SELECT current_user_org_ids())
    ));
CREATE POLICY "org_update_vendor_equipment" ON vendor_equipment FOR UPDATE
    USING (is_user_authorized() AND EXISTS (
        SELECT 1 FROM vendors WHERE vendors.id = vendor_equipment.vendor_id
        AND vendors.organization_id IN (SELECT current_user_org_ids())
    ));
CREATE POLICY "org_delete_vendor_equipment" ON vendor_equipment FOR DELETE
    USING (is_user_authorized() AND EXISTS (
        SELECT 1 FROM vendors WHERE vendors.id = vendor_equipment.vendor_id
        AND vendors.organization_id IN (SELECT current_user_org_ids())
    ));

DROP POLICY IF EXISTS "Users can view services of their vendors" ON vendor_services;
DROP POLICY IF EXISTS "Users can insert services for their vendors" ON vendor_services;
DROP POLICY IF EXISTS "Users can update services of their vendors" ON vendor_services;
DROP POLICY IF EXISTS "Users can delete services of their vendors" ON vendor_services;
DROP POLICY IF EXISTS "Authorized users can view vendor_services for their vendors" ON vendor_services;
DROP POLICY IF EXISTS "Authorized users can insert vendor_services for their vendors" ON vendor_services;
DROP POLICY IF EXISTS "Authorized users can update vendor_services for their vendors" ON vendor_services;
DROP POLICY IF EXISTS "Authorized users can delete vendor_services for their vendors" ON vendor_services;

CREATE POLICY "org_select_vendor_services" ON vendor_services FOR SELECT
    USING (is_user_authorized() AND EXISTS (
        SELECT 1 FROM vendors WHERE vendors.id = vendor_services.vendor_id
        AND vendors.organization_id IN (SELECT current_user_org_ids())
    ));
CREATE POLICY "org_insert_vendor_services" ON vendor_services FOR INSERT
    WITH CHECK (is_user_authorized() AND EXISTS (
        SELECT 1 FROM vendors WHERE vendors.id = vendor_services.vendor_id
        AND vendors.organization_id IN (SELECT current_user_org_ids())
    ));
CREATE POLICY "org_update_vendor_services" ON vendor_services FOR UPDATE
    USING (is_user_authorized() AND EXISTS (
        SELECT 1 FROM vendors WHERE vendors.id = vendor_services.vendor_id
        AND vendors.organization_id IN (SELECT current_user_org_ids())
    ));
CREATE POLICY "org_delete_vendor_services" ON vendor_services FOR DELETE
    USING (is_user_authorized() AND EXISTS (
        SELECT 1 FROM vendors WHERE vendors.id = vendor_services.vendor_id
        AND vendors.organization_id IN (SELECT current_user_org_ids())
    ));

DROP POLICY IF EXISTS "Users can view contacts of their vendors" ON vendor_contacts;
DROP POLICY IF EXISTS "Users can insert contacts for their vendors" ON vendor_contacts;
DROP POLICY IF EXISTS "Users can update contacts of their vendors" ON vendor_contacts;
DROP POLICY IF EXISTS "Users can delete contacts of their vendors" ON vendor_contacts;
DROP POLICY IF EXISTS "Authorized users can view vendor_contacts for their vendors" ON vendor_contacts;
DROP POLICY IF EXISTS "Authorized users can insert vendor_contacts for their vendors" ON vendor_contacts;
DROP POLICY IF EXISTS "Authorized users can update vendor_contacts for their vendors" ON vendor_contacts;
DROP POLICY IF EXISTS "Authorized users can delete vendor_contacts for their vendors" ON vendor_contacts;

CREATE POLICY "org_select_vendor_contacts" ON vendor_contacts FOR SELECT
    USING (is_user_authorized() AND EXISTS (
        SELECT 1 FROM vendors WHERE vendors.id = vendor_contacts.vendor_id
        AND vendors.organization_id IN (SELECT current_user_org_ids())
    ));
CREATE POLICY "org_insert_vendor_contacts" ON vendor_contacts FOR INSERT
    WITH CHECK (is_user_authorized() AND EXISTS (
        SELECT 1 FROM vendors WHERE vendors.id = vendor_contacts.vendor_id
        AND vendors.organization_id IN (SELECT current_user_org_ids())
    ));
CREATE POLICY "org_update_vendor_contacts" ON vendor_contacts FOR UPDATE
    USING (is_user_authorized() AND EXISTS (
        SELECT 1 FROM vendors WHERE vendors.id = vendor_contacts.vendor_id
        AND vendors.organization_id IN (SELECT current_user_org_ids())
    ));
CREATE POLICY "org_delete_vendor_contacts" ON vendor_contacts FOR DELETE
    USING (is_user_authorized() AND EXISTS (
        SELECT 1 FROM vendors WHERE vendors.id = vendor_contacts.vendor_id
        AND vendors.organization_id IN (SELECT current_user_org_ids())
    ));

-- ── RLS: vendor_ratings ──────────────────────────────────────────────────────
-- Replaces BOTH the broken migration-021 policy (referenced a user_id column
-- vendor_ratings never had) and its "_v2" fix (kept per-user_email scoping,
-- never org-scoped). No application code writes to this table today
-- (confirmed by audit) — this closes the gap defensively for whenever it is
-- used, same discipline as every other table in this migration.

DROP POLICY IF EXISTS "Authorized users can view their own vendor ratings" ON vendor_ratings;
DROP POLICY IF EXISTS "Authorized users can insert their own vendor ratings" ON vendor_ratings;
DROP POLICY IF EXISTS "Authorized users can update their own vendor ratings" ON vendor_ratings;
DROP POLICY IF EXISTS "Authorized users can delete their own vendor ratings" ON vendor_ratings;
DROP POLICY IF EXISTS "Users can view their own vendor ratings" ON vendor_ratings;
DROP POLICY IF EXISTS "Users can insert their own vendor ratings" ON vendor_ratings;
DROP POLICY IF EXISTS "Users can update their own vendor ratings" ON vendor_ratings;
DROP POLICY IF EXISTS "Users can delete their own vendor ratings" ON vendor_ratings;

CREATE POLICY "org_select_vendor_ratings" ON vendor_ratings FOR SELECT
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_insert_vendor_ratings" ON vendor_ratings FOR INSERT
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_update_vendor_ratings" ON vendor_ratings FOR UPDATE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_delete_vendor_ratings" ON vendor_ratings FOR DELETE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

-- ── Fix view-bypass gap #1: vendor_summary ──────────────────────────────────
-- Makes the view re-check RLS as the actual calling role instead of its
-- (BYPASSRLS-capable) owner. No rebuild needed — Postgres 15+ supports
-- altering this option on an existing view in place.

ALTER VIEW vendor_summary SET (security_invoker = true);

-- ── Fix view-bypass gap #2: vendor_rating_aggregates ────────────────────────
-- Materialized views cannot carry RLS at all — there is no policy that could
-- ever scope this by org while it stays materialized. Converted to a plain
-- security_invoker view with an IDENTICAL SELECT to migration 055's, so it
-- now inherits real per-row RLS from vendors/vendor_ratings live, at query
-- time. The STATEMENT-level refresh trigger and its two support functions
-- become dead weight once there is nothing to refresh — dropped as part of
-- the same change (they exist only to serve the materialized form being
-- removed here).
--
-- Trade-off, disclosed: this recomputes the rating aggregation on every
-- query instead of once per write. Acceptable at current real vendor/rating
-- counts (low hundreds); revisit with a real security_invoker-friendly
-- caching strategy only if this becomes a measured bottleneck.

DROP TRIGGER IF EXISTS vendor_ratings_refresh_trigger ON vendor_ratings;
DROP FUNCTION IF EXISTS trigger_refresh_vendor_ratings();
DROP FUNCTION IF EXISTS refresh_vendor_rating_aggregates();
DROP MATERIALIZED VIEW IF EXISTS vendor_rating_aggregates;

CREATE VIEW vendor_rating_aggregates
WITH (security_invoker = true) AS
WITH rating_stats AS (
    SELECT
        vendor_id,
        COUNT(*) as total_ratings,
        ROUND(AVG(overall_rating), 2) as avg_overall_rating,
        ROUND(AVG(quality_rating), 2) as avg_quality_rating,
        ROUND(AVG(delivery_rating), 2) as avg_delivery_rating,
        ROUND(AVG(cost_rating), 2) as avg_cost_rating,
        ROUND(AVG(service_rating), 2) as avg_service_rating,
        ROUND(AVG(communication_rating), 2) as avg_communication_rating,

        COUNT(CASE WHEN overall_rating >= 4.5 THEN 1 END) as excellent_ratings,
        COUNT(CASE WHEN overall_rating >= 3.5 AND overall_rating < 4.5 THEN 1 END) as good_ratings,
        COUNT(CASE WHEN overall_rating >= 2.5 AND overall_rating < 3.5 THEN 1 END) as average_ratings,
        COUNT(CASE WHEN overall_rating < 2.5 THEN 1 END) as poor_ratings,

        ROUND(
            (COUNT(CASE WHEN would_recommend = true THEN 1 END) * 100.0 /
             NULLIF(COUNT(CASE WHEN would_recommend IS NOT NULL THEN 1 END), 0)), 1
        ) as recommendation_rate,

        ROUND(
            AVG(CASE
                WHEN created_at >= CURRENT_DATE - INTERVAL '6 months'
                THEN overall_rating
                END), 2
        ) as recent_avg_rating,

        CASE
            WHEN COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '6 months' THEN 1 END) >= 3 THEN
                CASE
                    WHEN AVG(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '3 months' THEN overall_rating END) >
                         AVG(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '6 months' AND
                                       created_at < CURRENT_DATE - INTERVAL '3 months' THEN overall_rating END)
                    THEN 'improving'
                    WHEN AVG(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '3 months' THEN overall_rating END) <
                         AVG(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '6 months' AND
                                       created_at < CURRENT_DATE - INTERVAL '3 months' THEN overall_rating END)
                    THEN 'declining'
                    ELSE 'stable'
                END
            ELSE 'insufficient_data'
        END as performance_trend,

        MAX(created_at) as last_rated_at

    FROM vendor_ratings
    WHERE overall_rating IS NOT NULL
    GROUP BY vendor_id
)
SELECT
    v.id as vendor_id,
    v.name as vendor_name,
    v.supplier_code,
    v.city,
    v.state,
    v.country,

    COALESCE(rs.total_ratings, 0) as total_ratings,
    rs.avg_overall_rating,
    rs.avg_quality_rating,
    rs.avg_delivery_rating,
    rs.avg_cost_rating,
    rs.avg_service_rating,
    rs.avg_communication_rating,

    COALESCE(rs.excellent_ratings, 0) as excellent_ratings,
    COALESCE(rs.good_ratings, 0) as good_ratings,
    COALESCE(rs.average_ratings, 0) as average_ratings,
    COALESCE(rs.poor_ratings, 0) as poor_ratings,

    rs.recommendation_rate,
    rs.recent_avg_rating,
    rs.performance_trend,
    rs.last_rated_at,

    CASE
        WHEN rs.avg_overall_rating >= 4.5 AND rs.total_ratings >= 5 THEN 'preferred'
        WHEN rs.avg_overall_rating >= 4.0 AND rs.total_ratings >= 3 THEN 'approved'
        WHEN rs.avg_overall_rating >= 3.0 THEN 'conditional'
        WHEN rs.avg_overall_rating < 3.0 THEN 'restricted'
        ELSE 'unrated'
    END as vendor_classification,

    CASE
        WHEN rs.performance_trend = 'declining' AND rs.recent_avg_rating < 3.5 THEN 'high'
        WHEN rs.performance_trend = 'declining' OR rs.recent_avg_rating < 3.0 THEN 'medium'
        WHEN rs.avg_overall_rating >= 4.0 THEN 'low'
        ELSE 'medium'
    END as risk_level

FROM vendors v
LEFT JOIN rating_stats rs ON v.id = rs.vendor_id
WHERE v.status = 'active';

COMMENT ON VIEW vendor_rating_aggregates IS 'Vendor rating statistics, computed live per query with security_invoker so RLS on vendors/vendor_ratings applies to the actual caller. Was a materialized view (migration 055) until migration 620 — matviews cannot carry RLS.';

NOTIFY pgrst, 'reload schema';
