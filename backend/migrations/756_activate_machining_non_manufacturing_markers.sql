-- ============================================================================
-- Migration 756: Activate Machining's 3 real non-manufacturing markers
-- (No Cost Feature, Perimeter Cut, Use Stock Machining) via a new, named
-- chk_machine_class_required exemption
--
-- Root cause: migration 753 correctly left ALL 5 of Machining's remaining
-- inactive stations disclosed as inactive, because none had a real
-- machine_class to satisfy chk_machine_class_required (migration 369/617).
-- But that treated two DIFFERENT real situations identically:
--
--   Real machine-requiring processes with NO spec data anywhere on file
--   (genuine data gap, correctly stays inactive/not_modeled):
--     - Jig Bore     -- memory/machining/processes.json defaultMachine =
--                       "SIP Hydroptic 6A" (a real, named machine) but zero
--                       per-machine JSON exists anywhere in
--                       memory/machining/machine/ for it.
--     - Shaver       -- same: defaultMachine = "Gleason Genesis 130 SV",
--                       zero per-machine spec data on file.
--
--   Real non-manufacturing markers with NO machine by design (verified
--   directly against the source data, not assumed -- these 3 are the ONLY
--   Machining stations whose defaultMachine field is genuinely empty):
--     - No Cost Feature     -- defaultMachine = ""
--     - Perimeter Cut       -- defaultMachine = ""
--     - Use Stock Machining -- defaultMachine = ""
--   This is the EXACT SAME real situation migration 617 already solved for
--   Sheet Metal's "Material Stock"/"No Cost Feature" (that migration's own
--   comment: "a non-machine routing/material marker, zero cost by design").
--   Machining's 3 markers were never given the equivalent exemption because
--   691/752/753 all treated every non-machine-class Machining row as the
--   SAME kind of gap as Jig Bore/Shaver -- conflating "no data yet" with
--   "will never have a machine, by design." This migration corrects that:
--   a genuinely different root cause gets a genuinely different fix, not a
--   blanket "still inactive" for all 5.
--
-- Fix, matching migration 617's own established discipline exactly (a
-- real, explicitly named exemption -- never an invented machine_class):
--   1. Add a new named clause to chk_machine_class_required for these 3
--      specific real Machining markers (process_group='Machining' AND
--      operation IN (...)), the same style as the existing named
--      '(process_route = ''General'' AND operation = ''General'')' clause.
--   2. Activate their process_calculator_mappings rows (is_active=true,
--      machine_class stays NULL -- there is no machine to assign).
--   3. Set their process_taxonomy.roadmap_status = 'non_mfg' ("system
--      marker, not a real manufacturing process" -- the exact real value
--      migration 617 cites for Sheet Metal's identical situation).
--
-- Jig Bore and Shaver are deliberately UNTOUCHED by this migration -- they
-- remain is_active=false, machine_class=NULL, roadmap_status='not_modeled'
-- until real per-machine spec data is sourced for them. Activating them
-- would require fabricating a machine_class with no real cost/capability
-- data behind it, which this project's standing rule forbids.
-- ============================================================================

BEGIN;

ALTER TABLE process_calculator_mappings DROP CONSTRAINT chk_machine_class_required;
ALTER TABLE process_calculator_mappings
  ADD CONSTRAINT chk_machine_class_required
  CHECK (
    is_active = false
    OR machine_class IS NOT NULL
    OR process_route = 'Raw Material'
    OR process_route = 'Material Usage'
    OR process_group = 'Packing & Delivery'
    OR (process_route = 'General' AND operation = 'General')
    OR (process_group = 'Machining' AND operation IN ('No Cost Feature', 'Perimeter Cut', 'Use Stock Machining'))
  );

UPDATE process_calculator_mappings
SET is_active = true, updated_at = NOW()
WHERE process_group = 'Machining'
  AND operation IN ('No Cost Feature', 'Perimeter Cut', 'Use Stock Machining');

UPDATE process_taxonomy
SET roadmap_status = 'non_mfg'
WHERE process_group = 'Machining'
  AND process_name IN ('No Cost Feature', 'Perimeter Cut', 'Use Stock Machining');

COMMIT;

-- ── Verification (run manually after) ───────────────────────────────────────
-- SELECT process_route, is_active, machine_class FROM process_calculator_mappings
--   WHERE process_group = 'Machining' AND operation IN ('No Cost Feature', 'Perimeter Cut', 'Use Stock Machining');
-- -- Expect: all 3 rows is_active = true, machine_class NULL
-- SELECT count(*) FROM process_calculator_mappings WHERE process_group = 'Machining' AND is_active = true;
-- -- Expect: 41 (38 from migration 753 + these 3)
-- SELECT process_route, is_active FROM process_calculator_mappings
--   WHERE process_group = 'Machining' AND is_active = false;
-- -- Expect exactly: Jig Bore, Shaver

NOTIFY pgrst, 'reload schema';
