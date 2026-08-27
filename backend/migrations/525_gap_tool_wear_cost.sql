-- Migration: log capability gap - tool_wear_cost
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
  '{"concept": "tool_wear_cost"}'::jsonb,
  ARRAY['tblToolLife export, migration 513'],
  'Turret-punch die tooling has no wear-cost amortization - real parts-per-tool life data exists (9 materials) but there is no real die or tool replacement cost figure to amortize against, so a dollar-per-part cost cannot be computed yet',
  'Die or punch tool-wear cost amortization -- BLOCKED pending real tool replacement cost data, not implementable from data on hand',
  'low'
);
