-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 404: Hole Extrusion (Burring) process identity (2026-08-05)
--
-- cost-engine.ts / bom-items.service.ts now emit a real, feature-gated "Hole
-- Extrusion (Burring)" process line (extruded/burled hole flange formed before
-- tapping — e.g. drawing callout "2X M3 BURLING BACK CONVEX"), on a new generic
-- machine_class 'hole_forming' (deliberately not an alias for turret_punch —
-- driven by whatever real machine a shop tags this way, per user feedback).
--
-- Without a process_calculator_mappings row for 'hole_forming',
-- bom-items.controller.ts::applyRoute() falls back to slugifying the process
-- name into `operation` (a real, documented, disclosed fallback — see its
-- comment at controller.ts:1509-1520) — which is what actually happened:
-- persisted rows showed "▾ hole_extrusion_burring" instead of the pretty name.
-- This migration adds the missing identity row, same pattern as migration 381's
-- Counterboring/Countersinking/PEM Insertion rows (no interactive calculator —
-- purely a formula-driven op, calculator_name is descriptive only).
--
-- process_group is 'Sheet Metal', not 'Machining' — corrected before first run.
-- Burring is a sheet-metal forming op, the same labor-skill group as Press
-- Brake/Turret Punch/Deburring/Waterjet (see LHR_GROUP in bom-items.service.ts's
-- resolveLHRRates()), not the drilling/tapping-adjacent 'Machining' group.
-- ════════════════════════════════════════════════════════════════════════════════

INSERT INTO process_calculator_mappings (process_group, process_route, operation, calculator_name, machine_class, display_order)
VALUES
    ('Sheet Metal', 'Forming', 'Hole Extrusion (Burring)', 'Hole Extrusion (Burring) — formula-driven, no interactive calculator', 'hole_forming', 53)
ON CONFLICT (process_group, process_route, operation) DO NOTHING;

-- ── Verification ───────────────────────────────────────────────────────────────
-- SELECT process_group, process_route, operation, machine_class, display_order
--   FROM process_calculator_mappings WHERE machine_class = 'hole_forming';
