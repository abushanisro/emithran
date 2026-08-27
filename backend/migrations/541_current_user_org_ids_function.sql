-- ============================================================================
-- Migration 541: current_user_org_ids() helper function
--
-- Phase 1 of the org-scoped tenancy initiative (see
-- .claude/plans/delegated-gliding-swan.md) — reused by every org-scoped RLS
-- policy from here on, same SECURITY DEFINER pattern already established by
-- is_user_authorized() (migrations/019_rls_authorization.sql). SECURITY
-- DEFINER is required here for the same reason it is on is_user_authorized():
-- a normal `authenticated` role can read organization_members fine (it's a
-- regular public table with its own RLS), but wrapping the lookup in one
-- function keeps every consuming policy identical and avoids re-deriving the
-- "active membership" condition table-by-table.
--
-- Returns the set of organization_id values the calling user (auth.uid())
-- currently has an ACTIVE organization_members row for. A user with zero
-- active memberships gets an empty set — RLS policies built on this treat
-- "no rows" as "no organization access", not as an error.
-- ============================================================================

CREATE OR REPLACE FUNCTION current_user_org_ids()
RETURNS SETOF UUID AS $$
  SELECT organization_id
  FROM organization_members
  WHERE user_id = auth.uid() AND status = 'active';
$$ LANGUAGE sql SECURITY DEFINER STABLE;
