-- ============================================================================
-- Migration: Backfill max_tonnage for kN-named press brakes
-- Purpose: 12 press-brake mhr_records rows (USA/Mexico/Germany/China) are
--          named directly after their force rating — "Bend Brake-800kN",
--          "-1500kN", "-2500kN" — but max_tonnage was never populated, so
--          sm_lookup_manual_stroke's tonnage-class matching had nothing to
--          resolve against for these real, already-on-file machines (see
--          lookup_coverage_gaps id 114: tonnage 81.6 at thickness 1.5mm —
--          that 81.6 IS 800kN converted, fired because max_tonnage was NULL,
--          not because a real machine's tonnage was unknown).
--          This is a zero-guesswork fix: the rating is already encoded in
--          the machine's own name, so converting kN -> metric tonnes-force
--          (1 tonne-force = 9.80665 kN, the standard SI definition) requires
--          no external data at all. Resulting classes (800/1500/2500 kN ->
--          81.6/153.0/255.0 t) land within sm_lookup_manual_stroke's
--          existing 10% nearest-class tolerance of its seeded 80/150/250t
--          rows, so this alone should resolve most of that lookup's open
--          gaps for these machines without adding a single new lookup row.
-- Author: Principal Engineering Team
-- Date: 2026-08-19
-- Version: 1.0.0
-- ============================================================================

UPDATE mhr_records
SET max_tonnage = ROUND((substring(machine_name FROM '(\d+(?:\.\d+)?)\s*kN')::numeric / 9.80665)::numeric, 1)
WHERE machine_class = 'press_brake'
  AND max_tonnage IS NULL
  AND machine_name ~* '\d+\s*kN';
