-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 455: Reclassify "Roper Whitney - 10M14" off press_brake (2026-08-09)
--
-- Verified against OEM/dealer documentation (roperwhitney.com's own product
-- page, the OEM operation manual on ManualsLib, multiple used-machinery
-- dealer listings — Demmler, Red River Machinery, Norman Machine Tool, Three
-- Rivers Machinery, all describing the same machine consistently): the
-- Roper Whitney 10M14 is a MECHANICAL SQUARING SHEAR (14ga mild steel /
-- 18ga stainless steel cutting capacity, 35 strokes/min, 121.25" max cut
-- length). It has no bending capability and no tonnage rating in the
-- press-brake sense — "tonnage" isn't a property this real machine has.
--
-- This is why it had no real max_tonnage on file: there was never a real
-- number to enter. Tagging it machine_class='press_brake' made the selector
-- offer it for bending work it physically cannot do, and its complete lack
-- of real capability data silently triggered MACHINE_CLASS_DEFAULTS'
-- generic 60T press-brake floor (seed-registry.ts) as if it were this
-- specific machine's real rating.
--
-- No corresponding "shear"/"guillotine" machine_class exists anywhere in
-- this app's registry (MACHINE_REGISTRY, default-rates.ts) today — sheet
-- metal cutting is only modeled via fiber_laser/turret_punch/waterjet.
-- Building a real shearing process class is a genuine, separate scope
-- decision, not made here. Setting machine_class to NULL is the minimal,
-- honest fix: it stops this real machine from being mis-offered as a press
-- brake without inventing a new class it hasn't been asked to build.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE mhr_records
SET machine_class = NULL
WHERE machine_name = 'Roper Whitney - 10M14'
  AND location = 'India'
  AND machine_class = 'press_brake';

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT id, location, machine_name, machine_class FROM mhr_records WHERE machine_name = 'Roper Whitney - 10M14';
-- Expect machine_class NULL.
