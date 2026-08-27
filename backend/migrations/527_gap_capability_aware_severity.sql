-- Migration: log capability gap - capability_aware_severity
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
  'GD&T Analysis',
  'gdt',
  '{"concept": "capability_aware_severity"}'::jsonb,
  ARRAY['GtolProcessCapabilities export, migration 516'],
  'gdt-severity.ts is an explicitly self-labeled Phase 1 fallback using fixed absolute-tolerance thresholds, with an unused PROCESS_CAPABILITY_REQUIRED reason code never wired to a real per-process capability table - real IT-grade achievable-capability data now exists for 5 of this app''s many processes',
  'Process-capability-aware GD&T severity (closeout Plan Phase 4) -- partial coverage only (5 processes), needs an ISO 286-1 IT-grade-to-mm conversion layer too',
  'medium'
);
