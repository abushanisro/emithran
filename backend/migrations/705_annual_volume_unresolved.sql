-- Migration: annual_volume becomes an optional, unresolved-capable input
-- Description: Drops the artificial NOT NULL DEFAULT 1000 on bom_items.annual_volume
--              so "nobody has told us the volume" is representable.
-- Date: 2026-09-07

-- WHY THIS EXISTS
--
-- migration 005 declared:
--
--   annual_volume INTEGER NOT NULL DEFAULT 1000
--
-- That 1000 is not a measurement, an import, or a decision. It is a schema
-- convenience, and it has never been distinguishable from a real figure,
-- because NOT NULL means every row has one. It reaches costing:
--
--   annual_volume -> resolveCostingInputs -> batchSize = ceil(volume / 4)
--                 -> route scoring volume branches
--
-- so a part nobody entered a volume for was quoted at batch 250 and scored as
-- a genuine low-volume part. Measured on the real scoring branches, the
-- fabricated 1000 doubles the laser-over-turret cost-score spread (15 -> 30):
-- laser collects the "low volume, no tooling amortization needed" bonus and
-- turret takes the matching "punch-die tooling not amortized" penalty, purely
-- because of a database default. The recommendation changes on data nobody
-- supplied.
--
-- After this migration a NULL annual_volume resolves with provenance absent:
-- batch size falls back to the canonical default instead of being derived, and
-- every volume-dependent scoring branch declines to score rather than scoring
-- against an invented figure. That path already exists and is already tested --
-- it was simply unreachable, because the column could not be NULL.

-- ── 1. Stop manufacturing a volume for every new row ────────────────────────
ALTER TABLE bom_items ALTER COLUMN annual_volume DROP DEFAULT;

-- ── 2. Allow "not on file" to be stated ─────────────────────────────────────
ALTER TABLE bom_items ALTER COLUMN annual_volume DROP NOT NULL;

-- ── 3. EXISTING ROWS ARE NOT TOUCHED. This is deliberate. ───────────────────
--
-- There is no UPDATE in this migration, and there must not be one.
--
-- An existing annual_volume of 1000 can have three different origins:
--
--   A. a user typed 1000, because 1000 is the real annual volume
--   B. the row was created without a volume and took the schema default
--   C. 1000 arrived from a real import or a real source document
--
-- bom_items has no column-level provenance, no history table, and no audit
-- trail -- only created_at/updated_at, which cannot separate these. So the
-- three are INDISTINGUISHABLE in the data as it stands, and any bulk conversion
-- of 1000 -> NULL would silently destroy every genuine A and C.
--
-- The honest position is therefore: existing rows keep exactly the value they
-- have and keep behaving exactly as they do today. Only rows created AFTER
-- this migration can carry a truthful NULL. Parts whose 1000 is really a
-- case B will need a human to say so, one part at a time -- the same rule the
-- rest of this system follows: if we do not know, we do not assert.

COMMENT ON COLUMN bom_items.annual_volume IS
  'Parts per year. NULL means genuinely not on file -- resolveCostingInputs '
  'reports provenance "absent", batch size is not derived from it, and every '
  'volume-dependent route-scoring branch declines to score rather than scoring '
  'against a substitute. Had a NOT NULL DEFAULT 1000 until migration 705; rows '
  'predating that migration may still carry a 1000 that nobody chose, and that '
  'is not recoverable from the data (no column provenance, no history table).';

NOTIFY pgrst, 'reload schema';
