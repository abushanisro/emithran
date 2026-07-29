-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 368: Add machine_class to process_calculator_mappings (2026-07-22)
--
-- Problem: process_calculator_mappings only has process_group/process_route/operation.
-- There is no link from a specific operation (e.g. 'Fiber laser Cutting') to the
-- machine class key ('fiber_laser') used by mhr_records, MACHINE_REGISTRY, and the
-- cost engine. The dialog was forced to pass the process GROUP ('Sheet Metal') as
-- machineClass, which never matched anything in mhr_records.machine_class.
--
-- Fix: add machine_class column; populate it per operation. The dialog can now
-- derive selectedMachineClass from the selected operation's mapping and pass it
-- directly as the MHR filter — no heuristics, no keyword guessing.
--
-- Also add machine_class to process_cost_records so every saved operation carries
-- the machine class used, making cross-op analysis and re-costing deterministic.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; plain UPDATEs with exact WHERE clauses.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 1. Add column to process_calculator_mappings ─────────────────────────────
ALTER TABLE process_calculator_mappings
  ADD COLUMN IF NOT EXISTS machine_class VARCHAR(100);

-- ── 2. Add column to process_cost_records ─────────────────────────────────────
ALTER TABLE process_cost_records
  ADD COLUMN IF NOT EXISTS machine_class VARCHAR(100);

-- ── 3. Populate machine_class per operation ────────────────────────────────────
-- Sheet Metal / Sheet Cutting
UPDATE process_calculator_mappings
  SET machine_class = 'fiber_laser'
  WHERE process_group = 'Sheet Metal'
    AND operation IN ('Fiber laser Cutting', '3D Laser Cut');

UPDATE process_calculator_mappings
  SET machine_class = 'co2_laser'
  WHERE process_group = 'Sheet Metal'
    AND operation = 'Co2 Laser Cutting';

UPDATE process_calculator_mappings
  SET machine_class = 'waterjet'
  WHERE process_group = 'Sheet Metal'
    AND operation = 'Water jet Cutting';

UPDATE process_calculator_mappings
  SET machine_class = 'press_brake'
  WHERE process_group = 'Sheet Metal'
    AND operation IN ('Shearning', 'Blanking');

UPDATE process_calculator_mappings
  SET machine_class = 'turret_punch'
  WHERE process_group = 'Sheet Metal'
    AND operation IN ('Turret Press', 'Laser Puch');

-- Sheet Metal / Bending/Floating/Forming
UPDATE process_calculator_mappings
  SET machine_class = 'press_brake'
  WHERE process_group = 'Sheet Metal'
    AND process_route = 'Bending/Floating /Forming'
    AND operation IN (
      'Bend Brake', 'Stage Tool Bending', 'Stage Tool Forming',
      'Progressive die', 'Offline Blank', 'Stretch forming'
    );

UPDATE process_calculator_mappings
  SET machine_class = 'roll_forming'
  WHERE process_group = 'Sheet Metal'
    AND operation = 'Roll Forming';

UPDATE process_calculator_mappings
  SET machine_class = 'deep_draw'
  WHERE process_group = 'Sheet Metal'
    AND operation = 'Deep Draw';

-- Machining
UPDATE process_calculator_mappings
  SET machine_class = 'cnc_lathe'
  WHERE process_group = 'Machining'
    AND process_route = 'Turning Center';

UPDATE process_calculator_mappings
  SET machine_class = 'cnc_3ax_vmc'
  WHERE process_group = 'Machining'
    AND process_route = 'Milling  Center';

UPDATE process_calculator_mappings
  SET machine_class = 'cnc_3ax_vmc'
  WHERE process_group = 'Machining'
    AND process_route IN ('Gear Cutting', 'Broach');

UPDATE process_calculator_mappings
  SET machine_class = 'grinding'
  WHERE process_group = 'Machining'
    AND process_route = 'Grinding';

UPDATE process_calculator_mappings
  SET machine_class = 'drill_press'
  WHERE process_group = 'Machining'
    AND process_route = 'Drilling'
    AND operation IN ('Drilling', 'Gun Drilling', 'Boring', 'Reaming');

UPDATE process_calculator_mappings
  SET machine_class = 'tapping'
  WHERE process_group = 'Machining'
    AND operation = 'Tapping';

UPDATE process_calculator_mappings
  SET machine_class = 'edm'
  WHERE process_group = 'Machining'
    AND process_route = 'EDM';

-- Plastic & Rubber
UPDATE process_calculator_mappings
  SET machine_class = 'injection_molding'
  WHERE process_group = 'Plastic & Rubber'
    AND process_route = 'Injection Molding';

-- Assembly
UPDATE process_calculator_mappings
  SET machine_class = 'welding'
  WHERE process_group = 'Assembly'
    AND process_route = 'Welding';

UPDATE process_calculator_mappings
  SET machine_class = 'deburring'
  WHERE process_group = 'Assembly'
    AND process_route = 'Debur';

UPDATE process_calculator_mappings
  SET machine_class = 'manual_assembly'
  WHERE process_group = 'Assembly'
    AND process_route IN ('Pick & Place', 'Screwing', 'Bolt Nut Assy', 'Weld Cleaning');

-- Post Processing
UPDATE process_calculator_mappings
  SET machine_class = 'cmm'
  WHERE process_group = 'Post Processing'
    AND operation = 'CMM Inspection';

UPDATE process_calculator_mappings
  SET machine_class = 'anodize'
  WHERE process_group = 'Post Processing'
    AND operation ILIKE '%Anodiz%';

UPDATE process_calculator_mappings
  SET machine_class = 'powder_coat'
  WHERE process_group = 'Post Processing'
    AND operation = 'Powder Coating';

UPDATE process_calculator_mappings
  SET machine_class = 'plating'
  WHERE process_group = 'Post Processing'
    AND operation ILIKE '%Plat%';

-- ── 4. Index for fast lookup from dialog ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pcm_machine_class
  ON process_calculator_mappings (machine_class);

-- ── Verification ──────────────────────────────────────────────────────────────
-- SELECT process_group, process_route, operation, machine_class
-- FROM process_calculator_mappings
-- WHERE machine_class IS NOT NULL
-- ORDER BY process_group, process_route, display_order;
