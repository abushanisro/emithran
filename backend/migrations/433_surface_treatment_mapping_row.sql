-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 433: process_calculator_mappings row for machine_class='surface_treatment'
-- (2026-08-08)
--
-- Closes task #115 (Manufacturing Physics Calculator architecture). Every
-- migrated Surface Treatment ProcessLineCost has always carried the literal
-- machineClass string 'surface_treatment' (cost-surface-treatment.ts), but no
-- process_calculator_mappings row with that machine_class ever existed —
-- real anodize/powder_coat/plating/chem_treatment operations already have
-- their OWN distinct machine_class rows (migrations 368/369), each covering
-- several named operations under that family. This migration does NOT touch
-- those — they're a separate, wider cleanup (unifying 4 machine classes onto
-- one calculator) out of scope here. Instead it gives the label
-- computeSurfaceTreatmentLine already uses a real, resolvable place in the
-- registry, so resolvePhysicsQuantity('surface_treatment') has something to
-- find rather than a permanent, guaranteed unsupported_operation gap.
--
-- See migrations/calculators/055_post_processing_surface_treatment_calculator.sql
-- for the actual calculator (real area/rate/cost formula — no cycle time,
-- per the architecture's own explicit rule that Surface Treatment must not
-- be forced into a cycle-time model).
-- ════════════════════════════════════════════════════════════════════════════════

INSERT INTO process_calculator_mappings (process_group, process_route, operation, machine_class, is_active, display_order)
VALUES ('Post Processing', 'Surface Treatment', 'Surface Treatment', 'surface_treatment', true, 434)
ON CONFLICT DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT * FROM process_calculator_mappings WHERE machine_class = 'surface_treatment';
