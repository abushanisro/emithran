-- Migration: log capability gap - handling_allowance
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
  'Turret Press',
  'turret_punch',
  '{"concept": "handling_allowance"}'::jsonb,
  ARRAY['smTurretPressHandling export, migration 515'],
  'Turret-punch costing has no material-handling-allowance cost line - real $0-46-by-weight-bracket data exists (5 near-identical process curves, only Turret Press is a real live-costed process among them) but is not wired into turret-punch-engine.ts',
  'Material handling allowance cost term (closeout Plan Phase 2a)',
  'medium'
);
