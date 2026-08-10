-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 444: Restore bend-count multiplication in "Sheet Metal - Bending
-- Manufacturing"'s Cycle Time formula (2026-08-08)
--
-- Root cause: migration 377 originally set Cycle Time to
--   ({Stroke Time Per Bend} * {No Of Bends}) + ({Sheet Loading Time} * 60)
-- but the live formula (confirmed via SELECT on calculator_id
-- '102772ff-5422-45c1-b391-6d2d4a96ab1b') is now
--   {Time Per Stroke} + ({Sheet Loading Time} * 60)
-- — not only was the field renamed (fixed in migration 443), the
-- `* {No Of Bends}` multiplication was dropped entirely. This is a real
-- correctness regression, not just a naming mismatch: for any part with more
-- than one bend, Cycle Time now equals a SINGLE stroke's time plus sheet
-- loading time, undercounting every additional bend. Most likely introduced
-- by the same interactive Calculator Builder edit that renamed the field,
-- since removing/re-adding a field there can silently reset a dependent
-- formula field to a fresh single-symbol default rather than preserving the
-- surrounding expression.
--
-- Fix: restore the bend-count multiplication under the field's current real
-- name (matches migration 443's re-added 'Time Per Stroke' field).
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE calculator_fields
SET default_value = '({Time Per Stroke} * {No Of Bends}) + ({Sheet Loading Time} * 60)'
WHERE calculator_id = '102772ff-5422-45c1-b391-6d2d4a96ab1b'
  AND field_name = 'Cycle Time'
  AND default_value = '{Time Per Stroke} + ({Sheet Loading Time} * 60)';

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT field_name, field_type, default_value FROM calculator_fields
-- WHERE calculator_id = '102772ff-5422-45c1-b391-6d2d4a96ab1b' AND field_name = 'Cycle Time';
-- Expect default_value = '({Time Per Stroke} * {No Of Bends}) + ({Sheet Loading Time} * 60)'.
-- If the UPDATE affected 0 rows, the live formula text differs from what was
-- diagnosed here — re-check the current default_value before assuming this
-- migration applied cleanly.
