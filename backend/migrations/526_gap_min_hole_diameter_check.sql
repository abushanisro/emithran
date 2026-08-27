-- Migration: log capability gap - min_hole_diameter_check
-- Plain-ASCII, single-statement file. Split out of an earlier combined
-- migration 522 after repeated "relation turret does not exist" errors
-- that traced back to non-ASCII punctuation (em dash and box-drawing
-- characters, used purely in comments) getting corrupted somewhere
-- between disk and the SQL editor. This file and its 6 siblings
-- (522, 524-529) use plain hyphens only, and each is a single
-- independent statement, so a failure on any one is trivially isolated
-- instead of blocking the whole batch.
-- Uses upsert_lookup_coverage_gap() (migration 431). gap_type is
-- 'unsupported_operation' (the engine does not model this at all, vs.
-- 'missing_lookup' which means a data row is missing within an existing
-- capability). The 'concept' key inside missing_inputs exists only to keep
-- this row's dedupe key distinct from other findings that share the same
-- process + machine_class.

SELECT upsert_lookup_coverage_gap(
  'unsupported_operation',
  NULL,
  'Sheet Metal DFM',
  'turret_punch',
  '{"concept": "min_hole_diameter_check"}'::jsonb,
  ARRAY['tblMinHoleDiameterRatio export, migration 518'],
  'No min-hole-diameter-to-thickness-ratio DFM check existed until closeout Phase 1 shipped it - real material-UTS-based bracket data exists (5 brackets) and this app already resolves per-item UTS for kerf calc',
  'Min-hole-diameter DFM risk check -- SHIPPED in closeout Plan Phase 1 (2026-08-20), leave this row for historical record',
  'medium'
);
