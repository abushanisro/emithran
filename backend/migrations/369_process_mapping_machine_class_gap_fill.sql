-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 369: Fill remaining machine_class gaps in process_calculator_mappings
--
-- Migration 368 populated machine_class for the OLD (migration-024-style) operation
-- name strings only. Migrations 316/344 introduced newer routes/operations (Laser
-- Cutting, Waterjet Cutting, VMC, Sawing, Heat Treatment, Testing, Electrical
-- Connection, Adhesive Bonding, Thermoforming, Blow Molding, Extrusion, Rotational
-- Molding, Rubber Molding, Injection Molding/Plastics groups) that never matched
-- 368's WHERE clauses, so they are still NULL. This migration:
--   1. Fills those gaps with a pattern cascade (mirrors 367/368's style).
--   2. Hard-fails (RAISE EXCEPTION) if any is_active row that ISN'T a legitimate
--      non-machine row (Raw Material / Packing & Delivery / unfilled placeholder)
--      still has machine_class IS NULL after the backfill — no silent gaps.
--   3. Adds a CHECK constraint enforcing the same rule going forward for new rows.
--
-- Idempotent: every UPDATE below is scoped WHERE machine_class IS NULL, so
-- re-running this migration is a no-op after the first successful run.
--
-- NOTE: this cascade was built by reading every migration that inserts into this
-- table (024, 026, 302, 303, 316, 317, 318, 319, 340, 344, 363, plus
-- database/migrations/158,159) and cross-checked twice, but there is no live-DB
-- access available to execute/verify it ahead of time. If the assertion below
-- fires, it names the exact (process_group / process_route / operation) triples
-- still NULL — add one more targeted UPDATE for those and re-run. That is the
-- designed recovery path, not a sign this migration is broken.
--
-- ALSO NOTE: process_calculator_mappings.machine_class uses slug-style values
-- (fiber_laser, cnc_3ax_vmc) to match mhr_records.machine_class by exact string
-- equality in ProcessCostDialog.tsx. If real seeded mhr_records rows use
-- human-readable values instead, that's a separate, pre-existing semantic-mismatch
-- bug between the two tables — check with:
--   SELECT DISTINCT machine_class FROM mhr_records ORDER BY 1;
-- and file it separately; do not patch it inside this migration.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── Sheet Metal — newer/typo'd operations under 'Sheet Cutting' and the 'Laser
-- Cutting'/'Waterjet Cutting' routes that 368 never matched ────────────────────
UPDATE process_calculator_mappings SET machine_class = 'fiber_laser'
  WHERE process_group = 'Sheet Metal'
    AND ((process_route = 'Laser Cutting' AND operation IN ('Fiber Laser Cut','Laser Cut','3D Laser Cut'))
         OR (process_route = 'Sheet Cutting' AND operation ILIKE '%fiber laser%'))
    AND machine_class IS NULL;

UPDATE process_calculator_mappings SET machine_class = 'co2_laser'
  WHERE process_group = 'Sheet Metal' AND process_route = 'Laser Cutting'
    AND operation = 'CO2 Laser Cut' AND machine_class IS NULL;

UPDATE process_calculator_mappings SET machine_class = 'plasma'
  WHERE process_group = 'Sheet Metal' AND operation = 'Plasma Cutting' AND machine_class IS NULL;

UPDATE process_calculator_mappings SET machine_class = 'press_brake'
  WHERE process_group = 'Sheet Metal' AND process_route = 'Sheet Cutting'
    AND operation = 'Shearing' AND machine_class IS NULL;   -- 368 only covered 'Shearning' (typo variant)

UPDATE process_calculator_mappings SET machine_class = 'waterjet'
  WHERE process_group = 'Sheet Metal'
    AND ((process_route = 'Waterjet Cutting' AND operation IN ('Waterjet Cutting','Water Jet Cutting','Abrasive Waterjet'))
         OR (process_route = 'Sheet Cutting' AND operation = 'Waterjet Cutting'))  -- distinct row from the route-level one
    AND machine_class IS NULL;

UPDATE process_calculator_mappings SET machine_class = 'turret_punch'
  WHERE process_group = 'Sheet Metal' AND operation = 'Nibbling' AND machine_class IS NULL;

UPDATE process_calculator_mappings SET machine_class = 'press_brake'
  WHERE process_group = 'Sheet Metal' AND process_route = 'Bending/Floating /Forming'
    AND operation IN ('Hemming','Flanging') AND machine_class IS NULL;

-- Migration 344 also added a separate 'Press Brake' ROUTE (distinct from the
-- 'Bending/Floating /Forming' route above) with its own operations — never
-- matched by 368 or by the rule above. Found via the migration's own hard-fail
-- assertion on first apply.
UPDATE process_calculator_mappings SET machine_class = 'press_brake'
  WHERE process_group = 'Sheet Metal' AND process_route = 'Press Brake'
    AND operation IN ('Press Brake Bend','Bend','Form') AND machine_class IS NULL;

-- ── Sheet Metal's own Finishing/Inspection/Surface Treatment routes (368 only
-- handled Post Processing's/Assembly's versions of these route names) ─────────
UPDATE process_calculator_mappings SET machine_class = 'deburring'
  WHERE process_group = 'Sheet Metal' AND process_route = 'Finishing' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'cmm'
  WHERE process_group = 'Sheet Metal' AND process_route = 'Inspection' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'powder_coat'
  WHERE process_group = 'Sheet Metal' AND process_route = 'Surface Treatment' AND operation = 'Powder Coat' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'anodize'
  WHERE process_group = 'Sheet Metal' AND process_route = 'Surface Treatment' AND operation = 'Anodize' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'plating'
  WHERE process_group = 'Sheet Metal' AND process_route = 'Surface Treatment' AND operation = 'Zinc Plating' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'chem_treatment'
  WHERE process_group = 'Sheet Metal' AND process_route = 'Surface Treatment'
    AND operation IN ('Paint','E-Coat','Passivation') AND machine_class IS NULL;

-- ── Machining — Sawing/Cutting/VMC routes, and the 'Waterjet' route (316 adds
-- this as a distinct route from Sheet Metal's), never covered by 368 ──────────
UPDATE process_calculator_mappings SET machine_class = 'band_saw'
  WHERE process_group = 'Machining' AND process_route IN ('Sawing','Cutting') AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'waterjet'
  WHERE process_group = 'Machining' AND process_route = 'Waterjet' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'tapping'
  WHERE process_group = 'Machining' AND process_route = 'VMC' AND operation = 'Tapping' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'cnc_3ax_vmc'
  WHERE process_group = 'Machining' AND process_route = 'VMC' AND machine_class IS NULL;

-- ── Machining/Drilling — 368's rule only covered ('Drilling','Gun Drilling',
-- 'Boring','Reaming'); 'Counterboring'/'Counterbore'/'Countersink'/'Countersinking'
-- variants (from migrations 316 and 344) were never matched ───────────────────
UPDATE process_calculator_mappings SET machine_class = 'drill_press'
  WHERE process_group = 'Machining' AND process_route = 'Drilling'
    AND operation IN ('Counterboring','Counterbore','Countersink','Countersinking')
    AND machine_class IS NULL;

-- ── Assembly — Electrical Connection / Adhesive Bonding routes (new classes) ──
UPDATE process_calculator_mappings SET machine_class = 'electrical_assembly'
  WHERE process_group = 'Assembly' AND process_route = 'Electrical Connection' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'adhesive_bonding'
  WHERE process_group = 'Assembly' AND process_route = 'Adhesive Bonding' AND machine_class IS NULL;

-- ── Post Processing — broaden Surface Protection matching (368 only caught a
-- subset via ILIKE '%Plat%'/'%Anodiz%', which misses 'Anodising'/'Hard Anodising'
-- (z→s spelling), 'Electroless Nickel', 'Passivation', paint/masking ops, etc.) ─
UPDATE process_calculator_mappings SET machine_class = 'anodize'
  WHERE process_group = 'Post Processing' AND (operation ILIKE '%anodis%' OR operation = 'Type III Hardcoat') AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'plating'
  WHERE process_group = 'Post Processing' AND operation IN ('Electroless Nickel','PVD Coating','CVD Coating') AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'chem_treatment'
  WHERE process_group = 'Post Processing'
    AND operation IN ('Degrease','Phosphating','Blackning','Black Oxide','Passivation',
                       'Manual Paint primer','Manual Paint finish Coat','Manual Paint hand Cleaning',
                       'Manual Paint hand Sanding','Masking','ED Coating')
    AND machine_class IS NULL;

-- ── Post Processing — Heat Treatment / Deburring / Inspection / Testing routes
-- (whole-route matches, entirely new — 368 never touched these routes at all) ──
UPDATE process_calculator_mappings SET machine_class = 'heat_treat_furnace'
  WHERE process_group = 'Post Processing' AND process_route = 'Heat Treatment' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'deburring'
  WHERE process_group = 'Post Processing' AND process_route = 'Deburring' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'cmm'
  WHERE process_group = 'Post Processing' AND process_route = 'Inspection' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'ndt_test'
  WHERE process_group = 'Post Processing' AND process_route = 'Testing' AND machine_class IS NULL;

-- ── Plastic & Rubber — routes beyond the 'Injection Molding' route 368 already
-- covers ────────────────────────────────────────────────────────────────────────
UPDATE process_calculator_mappings SET machine_class = 'compression_molding'
  WHERE process_group = 'Plastic & Rubber' AND process_route IN ('Compression Molding','Structural foam molding','Reaction Foam Molding') AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'thermoforming'
  WHERE process_group = 'Plastic & Rubber' AND process_route = 'Thermoforming' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'blow_molding'
  WHERE process_group = 'Plastic & Rubber' AND process_route = 'Blow Molding' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'extrusion'
  WHERE process_group = 'Plastic & Rubber' AND process_route = 'Extrusion' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'rotational_molding'
  WHERE process_group = 'Plastic & Rubber' AND process_route = 'Rotational Molding' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'rubber_molding'
  WHERE process_group = 'Plastic & Rubber' AND process_route = 'Rubber Molding' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'manual_assembly'
  WHERE process_group = 'Plastic & Rubber' AND process_route = 'Trimming / Degating' AND machine_class IS NULL;

-- ── 'Injection Molding' / 'Plastics' groups (migration 344 — distinct from the
-- older 'Plastic & Rubber' group that 368 already covers for the Injection
-- Molding route) ────────────────────────────────────────────────────────────────
UPDATE process_calculator_mappings SET machine_class = 'injection_molding'
  WHERE process_group IN ('Injection Molding','Plastics') AND process_route IN ('Material Prep','Injection','Gate Trim','Finishing') AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'welding'
  WHERE process_group = 'Injection Molding' AND process_route = 'Assembly' AND operation IN ('Ultrasonic Welding','Spin Welding') AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'manual_assembly'
  WHERE process_group = 'Injection Molding' AND process_route = 'Assembly' AND operation IN ('Insert Press-In','Pad Printing','Hot Stamping') AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'plating'
  WHERE process_group = 'Injection Molding' AND process_route = 'Surface Treatment' AND operation = 'Plating' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'anodize'
  WHERE process_group = 'Injection Molding' AND process_route = 'Surface Treatment' AND operation = 'Anodizing' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'chem_treatment'
  WHERE process_group = 'Injection Molding' AND process_route = 'Surface Treatment' AND operation = 'Painting' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'laser_marking'
  WHERE process_group = 'Injection Molding' AND process_route = 'Surface Treatment' AND operation = 'Laser Marking' AND machine_class IS NULL;
UPDATE process_calculator_mappings SET machine_class = 'cmm'
  WHERE process_group = 'Injection Molding' AND process_route = 'Inspection' AND machine_class IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- Non-machine rows: explicitly excluded from the "must have machine_class" rule.
--   - process_route = 'Raw Material'        → material stock entry, no machine
--   - process_group  = 'Packing & Delivery'  → logistics, not a machine operation
--   - process_route = 'General' AND operation = 'General' → migration-302
--     placeholder rows seeded per process group, never filled in with a real
--     operation.
--
-- These are deliberately left machine_class = NULL rather than forced into a
-- fake class, because NULL correctly means "not applicable" — inventing a
-- sentinel value would just push the "is this a real machine op?" branch into
-- every consumer (ProcessCostDialog, MHR filtering, cost engine) instead of
-- enforcing it once, centrally, here.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Hard-fail assertion: no active, non-excluded row may still be NULL ─────────
DO $$
DECLARE
  gap_count INTEGER;
  gap_list  TEXT;
BEGIN
  SELECT COUNT(*), string_agg(DISTINCT process_group || ' / ' || process_route || ' / ' || operation, '; ')
    INTO gap_count, gap_list
  FROM process_calculator_mappings
  WHERE is_active = true
    AND machine_class IS NULL
    AND process_route <> 'Raw Material'
    AND process_group <> 'Packing & Delivery'
    AND NOT (process_route = 'General' AND operation = 'General');

  IF gap_count > 0 THEN
    RAISE EXCEPTION
      'Migration 369 incomplete: % active process_calculator_mappings row(s) still have NULL machine_class: %',
      gap_count, gap_list;
  END IF;
END $$;

-- ── Enforce the same rule for all future rows ──────────────────────────────────
ALTER TABLE process_calculator_mappings
  ADD CONSTRAINT chk_machine_class_required
  CHECK (
    is_active = false
    OR machine_class IS NOT NULL
    OR process_route = 'Raw Material'
    OR process_group = 'Packing & Delivery'
    OR (process_route = 'General' AND operation = 'General')
  );

-- ── Verification (informational) ───────────────────────────────────────────────
-- SELECT machine_class, COUNT(*) FROM process_calculator_mappings
-- WHERE is_active = true GROUP BY machine_class ORDER BY 1;
