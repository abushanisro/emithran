-- ============================================================================
-- Migration 609: Create process_taxonomy + child tables (Phase 2a)
-- ============================================================================
-- Schema-only migration. No seed data here -- seeding is a separate,
-- reviewable generator-script pass (gen_609_seed_process_taxonomy.js),
-- because it requires reconciling three independently-spelled vocabularies
-- (process_operations.json, process_calculator_mappings.operation,
-- mhr_records' derived category) and that reconciliation needs a human
-- review checkpoint for anything the script can't confidently resolve.
--
-- process_taxonomy is the one canonical source of truth this platform has
-- never had: process_calculator_mappings is flat (no feature-type grain,
-- migration 503 explicitly dropped that grain when it seeded 391 raw rows
-- down to 22), and mhr_records has no real category column at all (today
-- derived at read time by splitting free text -- see mhrCategoryOf.ts).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS process_taxonomy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Canonical identity is (process_group, process_name) -- deliberately NOT
  -- scoped by process_route. The live process_calculator_mappings table
  -- files the same real operation under more than one route within a
  -- group (e.g. Sheet Metal's "Waterjet Cutting" under both "Cutting" and
  -- "Sheet Cutting"; Machining's "Drilling"/"Boring"/"Countersinking" under
  -- Drilling, Turning Center, AND VMC) -- confirmed directly against a
  -- live snapshot of all 270 rows, 2026-09-01. Keying on process_name alone
  -- (no route) lets every one of those live rows resolve to ONE shared
  -- canonical row instead of fragmenting the same real process across
  -- routes. process_group is kept (not a fully global process_name) so
  -- same-named operations that are genuinely different across domains
  -- don't collide (e.g. "Manual" means Trimming/Degating in Plastic &
  -- Rubber vs. Weld Cleaning in Assembly).
  process_group VARCHAR(100) NOT NULL,
  process_name VARCHAR(150) NOT NULL,

  -- Mirrors process_calculator_mappings.machine_class; NULL for rows with
  -- no real cost engine (routing-spine markers like "Material Stock", or
  -- genuinely unwired/not-modeled placeholder processes).
  machine_class VARCHAR(100),

  -- Reuses structured/processes.json's already-validated vocabulary:
  -- 'production'  -- dedicated cost engine, DB-first capability selector
  -- 'thin'         -- substituted through a generic calculator, real gap
  -- 'unwired'      -- mapping row inactive, no cost path
  -- 'not_modeled'  -- absent from process_calculator_mappings entirely
  -- 'non_mfg'      -- system marker, not a real manufacturing process
  roadmap_status VARCHAR(20) NOT NULL DEFAULT 'not_modeled'
    CHECK (roadmap_status IN ('production', 'thin', 'unwired', 'not_modeled', 'non_mfg')),

  -- From process_machine_data.json's `machine` / `tool_shop_name` fields.
  -- Most source rows have "" for tool_shop_name -- stored as NULL, never
  -- fabricated as a real value.
  default_machine_name VARCHAR(200),
  default_tool_shop_name VARCHAR(200),

  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT unique_process_taxonomy_row UNIQUE (process_group, process_name)
);

CREATE INDEX IF NOT EXISTS idx_process_taxonomy_process_group ON process_taxonomy(process_group);
CREATE INDEX IF NOT EXISTS idx_process_taxonomy_process_name ON process_taxonomy(process_name);
CREATE INDEX IF NOT EXISTS idx_process_taxonomy_roadmap_status ON process_taxonomy(roadmap_status);

CREATE OR REPLACE FUNCTION update_process_taxonomy_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_process_taxonomy_updated_at ON process_taxonomy;
CREATE TRIGGER trigger_update_process_taxonomy_updated_at
  BEFORE UPDATE ON process_taxonomy
  FOR EACH ROW
  EXECUTE FUNCTION update_process_taxonomy_updated_at();

-- ----------------------------------------------------------------------------
-- process_taxonomy_operations
-- Child table, not a nullable column on the parent: a parent like
-- "Progressive Die" needs 83+ operation rows, and duplicating
-- machine_class/roadmap_status/etc. across all of them for one 1-to-many
-- fact would be wasteful duplication and would break the parent's own
-- (process_group, process_name) uniqueness constraint.
--
-- Column names deliberately match the vocabulary every one of the three
-- source files already uses for this exact concept (Sheet Metal's
-- process_operations.json, Machining's operations_full.json, the
-- Injection Molding digital-factory operations file all decompose a raw
-- compound string "Process:OperationCategory//FeatureType" the same way):
-- operation_category is the leaf operation name, feature_type the leaf
-- feature (nullable -- some raw strings, e.g. "Laser Punch:Countersinking",
-- are a bare operation qualifier with no feature-type axis at all, which
-- is real data, not a gap). raw_compound_string preserves the full
-- original string (including any multi-level chain, e.g. "Bend
-- Brake:Bending//StraightBend:As Formed//CurvedSurface") so nothing is
-- lost by only summarizing the leaf pair in the two typed columns.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS process_taxonomy_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_process_id UUID NOT NULL REFERENCES process_taxonomy(id) ON DELETE CASCADE,

  operation_category VARCHAR(150),
  feature_type VARCHAR(100),
  raw_compound_string TEXT NOT NULL,

  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT unique_process_taxonomy_operation UNIQUE (canonical_process_id, raw_compound_string)
);

CREATE INDEX IF NOT EXISTS idx_pt_operations_canonical_process_id
  ON process_taxonomy_operations(canonical_process_id);

-- ----------------------------------------------------------------------------
-- process_taxonomy_aliases
-- Child table, not a text[] column: needs per-entry provenance (which of
-- the 3 vocabularies an alias came from) and a global case-insensitive
-- uniqueness guarantee across ALL canonical rows -- an array column can't
-- express either.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS process_taxonomy_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_process_id UUID NOT NULL REFERENCES process_taxonomy(id) ON DELETE CASCADE,

  alias VARCHAR(150) NOT NULL,
  source VARCHAR(50) NOT NULL CHECK (source IN (
    'process_operations_json',
    'mhr_benchmark_category',
    'process_calculator_mappings_operation',
    'manual'
  )),

  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pt_aliases_canonical_process_id
  ON process_taxonomy_aliases(canonical_process_id);

-- Hard DB error if two canonical rows ever claim the same alias.
CREATE UNIQUE INDEX IF NOT EXISTS unique_process_taxonomy_alias_ci
  ON process_taxonomy_aliases (lower(alias));

-- ----------------------------------------------------------------------------
-- process_taxonomy_lookup_tables
-- Child table, not an array: sm-lookup-bridge.config.ts already shows a
-- single route can list up to 6 real table entries, each with its own
-- displayName/description/filter/orderBy -- real per-entry metadata, not
-- just names. Deliberately NOT unique on (canonical_process_id, table_name)
-- -- the same lookup table can serve one operation twice with different
-- filters (e.g. sm_lookup_tool_setup filtered 'brake' vs 'press').
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS process_taxonomy_lookup_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_process_id UUID NOT NULL REFERENCES process_taxonomy(id) ON DELETE CASCADE,

  table_name VARCHAR(100) NOT NULL,
  display_name VARCHAR(200),
  description TEXT,
  filter_column VARCHAR(100),
  filter_values TEXT[],
  order_by VARCHAR(150),
  key_pattern TEXT,
  is_readonly BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pt_lookup_tables_canonical_process_id
  ON process_taxonomy_lookup_tables(canonical_process_id);

-- ----------------------------------------------------------------------------
-- RLS: mirrors migration 319's process_calculator_mappings policy (shared
-- config data, no owner_id column on any of these 4 tables).
-- ----------------------------------------------------------------------------
ALTER TABLE process_taxonomy ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_taxonomy_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_taxonomy_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_taxonomy_lookup_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "process_taxonomy_select" ON process_taxonomy;
CREATE POLICY "process_taxonomy_select" ON process_taxonomy FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "process_taxonomy_insert" ON process_taxonomy;
CREATE POLICY "process_taxonomy_insert" ON process_taxonomy FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "process_taxonomy_update" ON process_taxonomy;
CREATE POLICY "process_taxonomy_update" ON process_taxonomy FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pt_operations_select" ON process_taxonomy_operations;
CREATE POLICY "pt_operations_select" ON process_taxonomy_operations FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "pt_operations_insert" ON process_taxonomy_operations;
CREATE POLICY "pt_operations_insert" ON process_taxonomy_operations FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "pt_operations_update" ON process_taxonomy_operations;
CREATE POLICY "pt_operations_update" ON process_taxonomy_operations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pt_aliases_select" ON process_taxonomy_aliases;
CREATE POLICY "pt_aliases_select" ON process_taxonomy_aliases FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "pt_aliases_insert" ON process_taxonomy_aliases;
CREATE POLICY "pt_aliases_insert" ON process_taxonomy_aliases FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "pt_aliases_update" ON process_taxonomy_aliases;
CREATE POLICY "pt_aliases_update" ON process_taxonomy_aliases FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pt_lookup_tables_select" ON process_taxonomy_lookup_tables;
CREATE POLICY "pt_lookup_tables_select" ON process_taxonomy_lookup_tables FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "pt_lookup_tables_insert" ON process_taxonomy_lookup_tables;
CREATE POLICY "pt_lookup_tables_insert" ON process_taxonomy_lookup_tables FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "pt_lookup_tables_update" ON process_taxonomy_lookup_tables;
CREATE POLICY "pt_lookup_tables_update" ON process_taxonomy_lookup_tables FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- Verification (run manually after):
-- SELECT count(*) FROM process_taxonomy; -- expect 0 -- schema only, seeded separately
-- SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'process_taxonomy%';
