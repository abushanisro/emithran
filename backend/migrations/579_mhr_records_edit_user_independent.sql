-- ============================================================================
-- Migration 579: mhr_records — Edit is user-independent, Delete stays scoped
--
-- Context: migration 578 normalized the 281 machine_library.json reference
-- rows to user_id/organization_id = NULL (a shared library, per the app's
-- confirmed architecture). migration 544's "org_update_own" policy only
-- grants UPDATE via an org match or `user_id = auth.uid()` — with no clause
-- for a genuinely-global row, so those 281 rows became silently uneditable
-- through the app (a generic "Failed to update MHR record" error) the moment
-- they lost their owner.
--
-- Decision (confirmed with the user, 2026-08-27): Edit should be
-- user-independent — any authorized user can correct/improve any mhr_records
-- row, global or not, since this is a shared reference database everyone
-- draws from. Delete stays scoped to ownership exactly as migration 544 left
-- it (org match or `user_id = auth.uid()`) — a global row has neither, so it
-- remains non-deletable through the app by design, protecting the shared
-- library from being removed by any one user. org_select_own_and_global and
-- org_delete_own are untouched by this migration; only org_update_own
-- changes.
-- ============================================================================

DROP POLICY IF EXISTS "org_update_own" ON mhr_records;

CREATE POLICY "org_update_own" ON mhr_records FOR UPDATE
    USING (is_user_authorized())
    WITH CHECK (is_user_authorized());
