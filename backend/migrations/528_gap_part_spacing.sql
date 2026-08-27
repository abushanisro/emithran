-- Migration: log capability gap - part_spacing
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
  'Sheet Metal Nesting',
  'sheet_metal_gross_usage_nesting',
  '{"concept": "part_spacing"}'::jsonb,
  ARRAY['tblPartSpacing export, migration 518'],
  'computePartAllowanceMm uses one continuous shear-strength-based formula for part-to-part nesting spacing regardless of process - real per-process and thickness data exists (Fiber Laser and Laser about 1x thickness, Oxyfuel about 3x, Plasma about 2x, Turret Press flat 6.35mm, Waterjet flat 5.08mm) and disagrees materially with the current formula at several thicknesses',
  'Process-aware nesting part-spacing resolver (closeout Plan Phase 3)',
  'medium'
);
