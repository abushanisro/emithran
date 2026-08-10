-- ============================================================================
-- Migration 052: Wire "Tapping" operations to the real Machining - Tapping
-- calculator (2026-08-02)
--
-- "Machining - Tapping" (fe42139c-...) is a complete, real tapping-cost
-- calculator (Tap Diameter, Cutting Speed, Feed per Rev, Spindle RPM, Tool
-- Cost per Part, Total Process Cost, etc.) but was wired to none of its own
-- matching operation rows -- Sheet Metal/Drilling/Tapping referenced a ghost
-- "Drilling Calculator" name, and Machining/VMC/Tapping + Machining/Turning
-- Center/Tapping had no calculator reference at all. Tapping physics
-- (torque/speed/feed) are the same regardless of whether the hole is in
-- sheet metal or a machined block, so one calculator correctly serves all
-- three operation contexts.
--
-- Deburring (Hand/Tumble/Vibratory/Robotic, under Post Processing, plus
-- Sheet Metal/Finishing/Deburr) is intentionally NOT touched here -- no
-- deburring calculator exists anywhere in the system to point at.
-- ============================================================================

UPDATE process_calculator_mappings
SET calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf'
WHERE operation = 'Tapping'
  AND calculator_id IS NULL
  AND (
    (process_group = 'Sheet Metal' AND process_route = 'Drilling') OR
    (process_group = 'Machining' AND process_route IN ('VMC', 'Turning Center'))
  );

-- Verification:
-- SELECT process_group, process_route, operation, calculator_id, calculator_name
--   FROM process_calculator_mappings WHERE operation = 'Tapping';
