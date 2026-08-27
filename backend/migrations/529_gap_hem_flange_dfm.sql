-- Migration: log capability gap - hem_flange_dfm
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
  'Bend Brake',
  'press_brake',
  '{"concept": "hem_flange_dfm"}'::jsonb,
  ARRAY['bend_brake_and_press_parameters export, migration 519'],
  'DFM scoring only recognizes hole and bend feature types - hemming and flanging are not detected as features at all in the CAD engine, so the real hem and flange DFM parameters now on file have nothing to attach to yet',
  'Hem or flange feature detection plus DFM scoring (closeout Plan Phase 5) -- largest, most open-ended item, needs a CAD feasibility spike before any engine code is written',
  'low'
);
