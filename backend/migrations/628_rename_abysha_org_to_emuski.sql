-- ============================================================================
-- Migration 628: Rename the "abysha" organization to "EMUSKI"
--
-- Looked up by owner email (not a hardcoded org UUID) — the org owned by
-- enquiries@emuski.com, the same one abushan.a@emuski.com was added to as a
-- member in migration 624.
-- ============================================================================

UPDATE organizations o
SET name = 'EMUSKI'
FROM auth.users owner
WHERE owner.id = o.owner_id
  AND owner.email = 'enquiries@emuski.com';
