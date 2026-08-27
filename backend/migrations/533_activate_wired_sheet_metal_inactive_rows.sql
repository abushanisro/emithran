-- ============================================================================
-- Migration: Activate every inactive Sheet Metal process_calculator_mappings
--            row that has (or can be given) a real, non-fabricated
--            machine_class — leave the rest inactive.
-- Purpose: User asked to make all currently-inactive Sheet Metal rows live.
--          A live SELECT against process_calculator_mappings (2026-08-22,
--          WHERE process_group='Sheet Metal') showed 24 inactive rows. They
--          split into three groups:
--
--          (A) 13 rows ALREADY carry a real machine_class + (mostly) a real
--              calculator_id from earlier migrations — flipping is_active
--              alone satisfies chk_machine_class_required (migration 369)
--              with zero invented data. Activated below as-is.
--              Two of these are worth flagging explicitly, not silently
--              activated:
--                - 'Turret Press' (Bending/Floating /Forming) and
--                  'Countersinking (if supported by tooling)' /
--                  'Forming (Louvers, Embosses)' (Sheet Metal Fabrication)
--                  share the identical machine_class='turret_punch' +
--                  calculator_id=a5d9b23a-... as the already-active
--                  'Turret Punching' row. Migration 503's own header already
--                  noted "Turret Press" is not a distinct real capability
--                  from "Turret Punching" in this app. Activating it does not
--                  add capability — it adds a second selectable name for the
--                  same engine. User asked for all rows active regardless;
--                  documented here so it's not mistaken for a new capability
--                  later.
--                - 'Laser Puch' (typo of "Laser Punch", Bending/Floating
--                  /Forming) also carries machine_class='turret_punch' +
--                  calculator_id=a5d9b23a-... . A laser-punch combo machine
--                  routed through turret-punch physics is plausible but
--                  unverified — flagged, not corrected, since correcting it
--                  would mean guessing a different machine_class, which is
--                  exactly the fabrication this migration avoids elsewhere.
--              Six more of the 13 live under the retired 'Sheet Cutting'
--              route (hidden from the admin UI per migration 388/418) and
--              duplicate an already-active row under 'Cutting' or
--              'Laser Cutting' with the identical machine_class (some with
--              calculator_id already set — 'Waterjet Cutting'; some without
--              — '3D Laser Cut', 'Co2 Laser Cutting', 'Fiber laser Cutting',
--              'Plasma Cutting', 'Shearing', 'Shearning'). Activating a row
--              with a real machine_class but calculator_id=NULL is an
--              untested combination in this app — flagged, not fabricated
--              a calculator for.
--
--          (B) 2 rows have machine_class=NULL today, but an IDENTICAL
--              real-world operation already active/inactive elsewhere in
--              this SAME table uses a real, non-NULL machine_class value.
--              Reusing that literal existing value is data linkage, not
--              invention:
--                - 'Plasma Cut' (Cutting) -> machine_class='plasma', reused
--                  from the sibling 'Plasma Cutting' row (Sheet Cutting).
--                - '3D Laser' (Laser Cutting) -> machine_class='fiber_laser',
--                  reused from the sibling '3D Laser Cut' row (Sheet Cutting).
--              calculator_id is left NULL for both — no existing sibling row
--              has a real calculator_id to reuse, and assigning one would be
--              a genuine physics/costing judgment call, not a data lookup.
--
--          (C) 9 rows CANNOT be activated by this or any migration without
--              inventing data: Generic Press, Std Press, Tandem Press,
--              2 Axis Router, OxyFuel Cut, Material Stock, No Cost Feature,
--              Laser Punch, Plasma Punch. All have machine_class=NULL with
--              no real sibling value anywhere to reuse.
--              chk_machine_class_required (migration 369) rejects
--              is_active=true with machine_class IS NULL outside the
--              'Raw Material' / 'Packing & Delivery' / ('General','General')
--              carve-outs — none of which apply here. This matches the
--              roadmap's own framing: these are processes with "no cost path
--              at all — by design, not by failure... new work, not a bug
--              fix," not a database flag to flip. Left untouched
--              (is_active=false, machine_class=NULL) — intentionally NOT
--              included in this migration's UPDATEs.
--
--          CTL is not addressed here — it has zero row in
--          process_calculator_mappings today (confirmed separately) and
--          adding one is a distinct decision, not an activation.
-- Author: Principal Engineering Team
-- Date: 2026-08-22
-- Version: 1.0.0
-- ============================================================================

-- (A) Flip is_active only — machine_class/calculator_id already real, unchanged.
UPDATE process_calculator_mappings SET is_active = true, updated_at = NOW()
  WHERE process_group = 'Sheet Metal' AND process_route = 'Bending/Floating /Forming' AND operation = 'Turret Press';
UPDATE process_calculator_mappings SET is_active = true, updated_at = NOW()
  WHERE process_group = 'Sheet Metal' AND process_route = 'Bending/Floating /Forming' AND operation = 'Laser Puch';
UPDATE process_calculator_mappings SET is_active = true, updated_at = NOW()
  WHERE process_group = 'Sheet Metal' AND process_route = 'Cutting' AND operation = 'Pure Waterjet Cutting (for soft materials)';
UPDATE process_calculator_mappings SET is_active = true, updated_at = NOW()
  WHERE process_group = 'Sheet Metal' AND process_route = 'Sheet Cutting' AND operation = '3D Laser Cut';
UPDATE process_calculator_mappings SET is_active = true, updated_at = NOW()
  WHERE process_group = 'Sheet Metal' AND process_route = 'Sheet Cutting' AND operation = 'Blanking';
UPDATE process_calculator_mappings SET is_active = true, updated_at = NOW()
  WHERE process_group = 'Sheet Metal' AND process_route = 'Sheet Cutting' AND operation = 'Co2 Laser Cutting';
UPDATE process_calculator_mappings SET is_active = true, updated_at = NOW()
  WHERE process_group = 'Sheet Metal' AND process_route = 'Sheet Cutting' AND operation = 'Fiber laser Cutting';
UPDATE process_calculator_mappings SET is_active = true, updated_at = NOW()
  WHERE process_group = 'Sheet Metal' AND process_route = 'Sheet Cutting' AND operation = 'Plasma Cutting';
UPDATE process_calculator_mappings SET is_active = true, updated_at = NOW()
  WHERE process_group = 'Sheet Metal' AND process_route = 'Sheet Cutting' AND operation = 'Shearing';
UPDATE process_calculator_mappings SET is_active = true, updated_at = NOW()
  WHERE process_group = 'Sheet Metal' AND process_route = 'Sheet Cutting' AND operation = 'Shearning';
UPDATE process_calculator_mappings SET is_active = true, updated_at = NOW()
  WHERE process_group = 'Sheet Metal' AND process_route = 'Sheet Cutting' AND operation = 'Waterjet Cutting';
UPDATE process_calculator_mappings SET is_active = true, updated_at = NOW()
  WHERE process_group = 'Sheet Metal' AND process_route = 'Sheet Metal Fabrication' AND operation = 'Countersinking (if supported by tooling)';
UPDATE process_calculator_mappings SET is_active = true, updated_at = NOW()
  WHERE process_group = 'Sheet Metal' AND process_route = 'Sheet Metal Fabrication' AND operation = 'Forming (Louvers, Embosses)';

-- (B) Flip is_active AND set machine_class, reusing an existing sibling row's
-- real value for the identical operation — not a fabricated assignment.
UPDATE process_calculator_mappings SET machine_class = 'plasma', is_active = true, updated_at = NOW()
  WHERE process_group = 'Sheet Metal' AND process_route = 'Cutting' AND operation = 'Plasma Cut';
UPDATE process_calculator_mappings SET machine_class = 'fiber_laser', is_active = true, updated_at = NOW()
  WHERE process_group = 'Sheet Metal' AND process_route = 'Laser Cutting' AND operation = '3D Laser';

-- (C) Deliberately NOT activated — see header. Left for visibility only:
--   Generic Press, Std Press, Tandem Press, 2 Axis Router, OxyFuel Cut,
--   Material Stock, No Cost Feature, Laser Punch, Plasma Punch.

-- Verification (run after applying, not part of the migration itself):
--   SELECT process_route, operation, is_active, machine_class, calculator_id
--   FROM process_calculator_mappings
--   WHERE process_group = 'Sheet Metal'
--   ORDER BY is_active, process_route, operation;
