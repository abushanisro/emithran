-- Migration 329: Scope machine overrides (and selection snapshots) by location.
--
-- Defect: bom_item_machine_overrides PK was (bom_item_id, process_key) — no
-- location. An override saved while viewing India ("Virtual 5 Axis Mill" at
-- ₹1,709/hr) kept forcing that machine after the Digital Factory switched to
-- USA/China/Germany, so the Cost Summary priced one country's part on another
-- country's machine and disagreed with Route Comparison.
--
-- Backfill: an override always references an mhr_records row, and a machine
-- lives at exactly one location — so the referenced machine's own location is
-- the correct scope for every pre-existing override (no guessing). Overrides
-- pointing at machines with no location fall back to 'India' (the only
-- location the pre-scoping UI defaulted to).

BEGIN;

ALTER TABLE bom_item_machine_overrides
  ADD COLUMN IF NOT EXISTS location VARCHAR(64);

UPDATE bom_item_machine_overrides o
SET location = COALESCE(m.location, 'India')
FROM mhr_records m
WHERE m.id = o.mhr_record_id
  AND o.location IS NULL;

-- Orphaned rows (machine deleted between FK cascade windows) — scope to India
UPDATE bom_item_machine_overrides
SET location = 'India'
WHERE location IS NULL;

ALTER TABLE bom_item_machine_overrides
  ALTER COLUMN location SET NOT NULL;

ALTER TABLE bom_item_machine_overrides
  DROP CONSTRAINT IF EXISTS bom_item_machine_overrides_pkey;

ALTER TABLE bom_item_machine_overrides
  ADD PRIMARY KEY (bom_item_id, process_key, location);

-- Selection snapshots have the same blind spot: the change-detection dedupe
-- compared the latest snapshot per (item, process) across ALL locations, so
-- flipping the Digital Factory back and forth wrote no audit rows. Nullable —
-- historical snapshots keep NULL (location unknown at the time; do not guess).
ALTER TABLE bom_item_machine_selection_snapshots
  ADD COLUMN IF NOT EXISTS location VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_machine_selection_snapshots_item_loc
  ON bom_item_machine_selection_snapshots (bom_item_id, location, process_key, created_at DESC);

COMMIT;
