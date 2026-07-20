-- ============================================================================
-- MIGRATION 351: raw_materials schema hardening
-- ============================================================================
-- Three targeted fixes applied after migrating to a global shared library
-- (migration 349) and adding regional cost columns (migration 350):
--
--   1. FK ON DELETE CASCADE → ON DELETE SET NULL
--      After 349 made raw_materials a global library, a user deletion must



--      NULL the audit-trail owner reference, not cascade-delete shared data.
--
--   2. pg_trgm GIN index on material_group
--      Both container services query with .ilike.%ferrous% / .ilike.%plastic%.
--      A plain B-tree index is useless for leading-wildcard patterns; pg_trgm
--      is the correct tool. At 500 rows this doesn't matter yet — at 50k it
--      will and we won't want a zero-downtime index build under load.
--
--   3. Composite B-tree index on (material_group, material_type)
--      Supports the common pattern: filter by group (tab), then sort/search
--      by material_type (metal family / plastic family). Covers both tabs.
-- ============================================================================


-- ── 1. Fix FK cascade behaviour ─────────────────────────────────────────────
-- Find the auto-generated constraint name (PostgreSQL names it
-- raw_materials_user_id_fkey by convention, but we look it up to be safe).

DO $$
DECLARE v_fk TEXT;
BEGIN
  SELECT constraint_name INTO v_fk
  FROM   information_schema.table_constraints
  WHERE  table_name      = 'raw_materials'
    AND  constraint_type = 'FOREIGN KEY'
    AND  constraint_name LIKE '%user_id%'
  LIMIT  1;

  IF v_fk IS NOT NULL THEN
    EXECUTE format('ALTER TABLE raw_materials DROP CONSTRAINT %I', v_fk);
  END IF;
END $$;

ALTER TABLE raw_materials
  ADD CONSTRAINT raw_materials_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;


-- ── 2. pg_trgm GIN index for ilike queries on material_group ────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_raw_materials_group_trgm
  ON raw_materials USING GIN (material_group gin_trgm_ops);


-- ── 3. Composite B-tree index (material_group, material_type) ───────────────

CREATE INDEX IF NOT EXISTS idx_raw_materials_group_type
  ON raw_materials (material_group, material_type);


-- ── Documentation ────────────────────────────────────────────────────────────

COMMENT ON COLUMN raw_materials.user_id IS
  'Audit-trail owner. NULL for system-imported global rows. '
  'Not enforced for access control — see RLS policies on this table.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
