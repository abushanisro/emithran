-- ============================================================================
-- Migration: Add genuinely-missing Sheet Metal operations to
--            process_calculator_mappings
-- Purpose: User asked to import the "process_operations" reference export
--          (migration 501, 391 rows) into the LIVE process_calculator_mappings
--          table, not just the internal sm_reference_data staging table.
--          Correcting course from an imprecise premise first: those 391 rows
--          are fine-grained "operation//CAD-feature-type" combinations (e.g.
--          35 sub-combos just for "Turret Press"), a finer granularity than
--          this table models (one row per operation NAME). Cross-checked
--          the export's 22 distinct top-level operation names against BOTH
--          this app's 40 ACTIVE Sheet Metal rows and its inactive/legacy
--          ones (a retired "Sheet Cutting" route, migration 388/418
--          cleanup, hidden from the admin UI by design) to find what is
--          genuinely new. Result: 15 operations exist nowhere in this table
--          at all (active or inactive):
--            2 Axis Router, 2/3/4 Roll Bending, 3D Laser, Deslag, Generic
--            Press, Laser Punch, Material Stock, No Cost Feature, OxyFuel
--            Cut, Plasma Cut, Plasma Punch, Std Press, Tandem Press
--          ("Turret Press" and "Waterjet Cut" from the export are NOT new —
--          this app already has their real equivalents active under
--          different names: Turret Punching/Hole Punching/Nibbling and
--          Waterjet Cutting/Abrasive Waterjet Cutting.)
--
--          Of the 15, only 4 get REAL machine_class/calculator_id — reusing
--          an EXISTING real calculator for the SAME physical process this
--          app already models, never a new guessed formula:
--            - 2/3/4 Roll Bending -> machine_class='roll_forming',
--              calculator_id=9cbf2166-... (same "Roll Forming Calculator"
--              already active for "Roll Forming" — multi-roll bending is
--              the same real process at different roll counts).
--            - Deslag -> machine_class='deburring',
--              calculator_id=cc4291f1-... (same "Sheet Metal - Deburring"
--              calculator already active for Deburr/Edge Finish —
--              MACHINE_REGISTRY's own processGroupKeywords for 'deburring'
--              already lists 'Deslag' explicitly, so this reuses an
--              existing, real mapping decision, not a new one).
--          The other 11 have no real cost engine in this app (same
--          confirmed-repeatedly finding all session for router/3D-laser/
--          plasma/oxyfuel/generic-press-family/laser-punch-combo) — added
--          as unwired placeholder rows (machine_class=NULL, calculator_id=
--          NULL, is_active=false), so they're visible in the admin UI (as
--          inactive) as a real checklist of unsupported operations rather
--          than invisible. Route assignment for these 11 has zero functional
--          effect (no calculator behind them either way) — grouped by
--          topical fit with existing routes (Cutting, Laser Cutting,
--          Bending/Floating /Forming, Sheet Metal Fabrication, Material
--          Usage).
--
--          CORRECTION (same day): originally set is_active=true on these 11,
--          citing the existing 9 active "Raw Material" stub rows as
--          precedent. That precedent doesn't actually apply here —
--          process_calculator_mappings has a real check constraint
--          (chk_machine_class_required, migration 369) requiring
--          machine_class IS NOT NULL for any row with is_active=true, UNLESS
--          process_route='Raw Material' (or a couple other named carve-outs)
--          — an exemption that only covers the Raw Material route, not
--          these 11 (Cutting/Laser Cutting/Bending/Sheet Metal Fabrication/
--          Material Usage). The live INSERT failed with exactly this
--          constraint violation. The correct, ALREADY-ESTABLISHED precedent
--          for "no real engine" stub rows outside Raw Material is actually
--          the other inactive stubs already in this same table (e.g.
--          "Turret Press"/"Laser Puch" under Bending, "Pure Waterjet
--          Cutting" under Cutting, "Forming (Louvers, Embosses)"/
--          "Countersinking (if supported by tooling)" under Sheet Metal
--          Fabrication) — every one of which is is_active=false with
--          machine_class=NULL. Changed these 11 to is_active=false to match.
-- Author: Principal Engineering Team
-- Date: 2026-08-19
-- Version: 1.1.0
-- ============================================================================

INSERT INTO process_calculator_mappings (id, process_group, process_route, operation, calculator_id, calculator_name, is_active, display_order, machine_class, lhr_process_group)
VALUES
  -- Real, wired: reuse existing real calculators for the same physical process
  (gen_random_uuid(), 'Sheet Metal', 'Bending/Floating /Forming', '2 Roll Bending', '9cbf2166-07be-4070-8e00-0b6c5075f71e', 'Roll Forming Calculator', true, 332, 'roll_forming', NULL),
  (gen_random_uuid(), 'Sheet Metal', 'Bending/Floating /Forming', '3 Roll Bending', '9cbf2166-07be-4070-8e00-0b6c5075f71e', 'Roll Forming Calculator', true, 333, 'roll_forming', NULL),
  (gen_random_uuid(), 'Sheet Metal', 'Bending/Floating /Forming', '4 Roll Bending', '9cbf2166-07be-4070-8e00-0b6c5075f71e', 'Roll Forming Calculator', true, 334, 'roll_forming', NULL),
  (gen_random_uuid(), 'Sheet Metal', 'Finishing', 'Deslag', 'cc4291f1-15fc-4038-88bc-c74c3480f168', 'Sheet Metal - Deburring', true, 335, 'deburring', 'Deburr'),

  -- Unwired placeholders: no real cost engine exists for these in this app.
  -- is_active=false — required by chk_machine_class_required (an active row
  -- outside 'Raw Material' must have a real machine_class); also matches the
  -- existing convention for every other unwired stub already in this table.
  (gen_random_uuid(), 'Sheet Metal', 'Cutting', '2 Axis Router', NULL, '2 Axis Router Calculator', false, 336, NULL, NULL),
  (gen_random_uuid(), 'Sheet Metal', 'Laser Cutting', '3D Laser', NULL, '3D Laser Calculator', false, 337, NULL, NULL),
  (gen_random_uuid(), 'Sheet Metal', 'Bending/Floating /Forming', 'Generic Press', NULL, 'Generic Press Calculator', false, 338, NULL, NULL),
  (gen_random_uuid(), 'Sheet Metal', 'Sheet Metal Fabrication', 'Laser Punch', NULL, 'Laser Punch Calculator', false, 339, NULL, NULL),
  (gen_random_uuid(), 'Sheet Metal', 'Material Usage', 'Material Stock', NULL, 'Material Stock Calculator', false, 340, NULL, NULL),
  (gen_random_uuid(), 'Sheet Metal', 'Material Usage', 'No Cost Feature', NULL, 'No Cost Feature', false, 341, NULL, NULL),
  (gen_random_uuid(), 'Sheet Metal', 'Cutting', 'OxyFuel Cut', NULL, 'OxyFuel Cutting Calculator', false, 342, NULL, NULL),
  (gen_random_uuid(), 'Sheet Metal', 'Cutting', 'Plasma Cut', NULL, 'Plasma Cutting Calculator', false, 343, NULL, NULL),
  (gen_random_uuid(), 'Sheet Metal', 'Sheet Metal Fabrication', 'Plasma Punch', NULL, 'Plasma Punch Calculator', false, 344, NULL, NULL),
  (gen_random_uuid(), 'Sheet Metal', 'Bending/Floating /Forming', 'Std Press', NULL, 'Standard Press Calculator', false, 345, NULL, NULL),
  (gen_random_uuid(), 'Sheet Metal', 'Bending/Floating /Forming', 'Tandem Press', NULL, 'Tandem Press Calculator', false, 346, NULL, NULL)
ON CONFLICT DO NOTHING;
