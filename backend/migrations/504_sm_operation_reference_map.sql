-- ============================================================================
-- Migration: Cross-reference real Sheet Metal operations to the staged
--            reconciliation export's process-level names
-- Purpose: The admin Process page shows this app's real operations (from
--          process_calculator_mappings); the staged reconciliation export
--          (migration 500, 25 rows) separately carries a "default/example
--          machine" name per its OWN process-level taxonomy. Neither table
--          knew about the other. This mapping table is the join: for every
--          operation where this app's name and the export's process name are
--          the SAME physical process (either an exact string match, or the
--          same machine under a different name with a precedent already
--          documented elsewhere in this codebase — see each row's comment
--          below), record the cross-reference. Used by
--          getOperationReferenceHints() in processes.service.ts to attach a
--          real, sourced "example machine" hint to the admin UI — informational
--          only, never a live cost-engine input (the actual machine used for
--          costing always comes from mhr_records, unaffected by this table).
--
--          Deliberately NOT exhaustive: most of this app's operations
--          (Deburr, Inspect, Powder Coat, all 9 Raw Material shapes, Stage
--          Tool Bending/Forming, Deep Draw, Offline Blank, Stretch Forming,
--          Hemming, Flanging, Roll Forming, Hole Extrusion, Tapping...) have
--          no clean process-level match in the export's 25-row taxonomy —
--          left unmapped rather than forced onto a loosely-related name.
--          An operation with no row here just shows no hint; that's an
--          honest "no reference cross-check available", not a bug.
-- Author: Principal Engineering Team
-- Date: 2026-08-19
-- Version: 1.0.0
-- ============================================================================

CREATE TABLE IF NOT EXISTS sm_operation_reference_map (
    id                    SERIAL PRIMARY KEY,
    process_group         VARCHAR(50) NOT NULL,
    process_route         VARCHAR(100) NOT NULL,
    operation             VARCHAR(150) NOT NULL,
    source_process_name   TEXT NOT NULL,  -- matches sm_reference_data key 'processDefaultMachine:<this>'
    notes                 TEXT,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (process_group, process_route, operation)
);

ALTER TABLE sm_operation_reference_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read" ON sm_operation_reference_map;
CREATE POLICY "Public read" ON sm_operation_reference_map FOR SELECT USING (true);

COMMENT ON TABLE sm_operation_reference_map IS 'Cross-reference from this app''s real process_calculator_mappings operations to the staged reconciliation export''s process-level names (sm_reference_data category=process/operation) -- informational only, feeds the admin UI''s reference hint, never a live cost input.';

INSERT INTO sm_operation_reference_map (process_group, process_route, operation, source_process_name, notes) VALUES
  -- Exact name matches
  ('Sheet Metal', 'Bending/Floating /Forming', 'Bend Brake',            'Bend Brake',            'Exact name match'),
  ('Sheet Metal', 'Laser Cutting',             'Laser Cut',             'Laser Cut',             'Exact name match'),
  ('Sheet Metal', 'Laser Cutting',             'Fiber Laser Cut',       'Fiber Laser Cut',       'Exact name match'),

  -- Same physical process, different route naming -- migration 369 already
  -- maps both 'Press Brake' route ops and 'Bending/Floating /Forming' route's
  -- Bend Brake op onto the SAME machine_class='press_brake' (see
  -- sm-lookup-bridge.config.ts's own comment on the 'Press Brake' route).
  ('Sheet Metal', 'Press Brake', 'Bend',              'Bend Brake', 'Same physical process as Bend Brake -- both routes share machine_class=press_brake (migration 369)'),
  ('Sheet Metal', 'Press Brake', 'Form',              'Bend Brake', 'Same physical process as Bend Brake -- both routes share machine_class=press_brake (migration 369)'),
  ('Sheet Metal', 'Press Brake', 'Press Brake Bend',  'Bend Brake', 'Same physical process as Bend Brake -- both routes share machine_class=press_brake (migration 369)'),

  -- Same machine, different phrasing / abrasive variant
  ('Sheet Metal', 'Cutting', 'Waterjet Cutting',          'Waterjet Cut', 'Same machine, source uses "Waterjet Cut"'),
  ('Sheet Metal', 'Cutting', 'Abrasive Waterjet Cutting', 'Waterjet Cut', 'Same machine (abrasive is a waterjet cutting mode, not a separate machine)'),

  -- Same machine (Turret Press), our app splits its sub-operations into
  -- separate operation rows; source's own taxonomy lists Punching/Nibbling
  -- as sub-operations of the SAME 'Turret Press' process (see migration 501's
  -- 391-row taxonomy: "Turret Press:Punching...", "Turret Press:Nibbling...").
  ('Sheet Metal', 'Sheet Metal Fabrication', 'Turret Punching', 'Turret Press', 'Same machine -- source taxonomy lists Punching as a Turret Press sub-operation'),
  ('Sheet Metal', 'Sheet Metal Fabrication', 'Hole Punching',   'Turret Press', 'Same machine -- source taxonomy lists Punching as a Turret Press sub-operation'),
  ('Sheet Metal', 'Sheet Metal Fabrication', 'Nibbling',        'Turret Press', 'Same machine -- source taxonomy lists Nibbling as a Turret Press sub-operation'),

  -- Exact name matches -- these operations only exist once migration 503 is
  -- run (they don't exist in process_calculator_mappings yet as of this
  -- writing); harmless to pre-populate, the row simply won't be joined to
  -- anything until 503 lands.
  ('Sheet Metal', 'Bending/Floating /Forming', '2 Roll Bending', '2 Roll Bending', 'Exact name match (added by migration 503)'),
  ('Sheet Metal', 'Bending/Floating /Forming', '3 Roll Bending', '3 Roll Bending', 'Exact name match (added by migration 503)'),
  ('Sheet Metal', 'Bending/Floating /Forming', '4 Roll Bending', '4 Roll Bending', 'Exact name match (added by migration 503)'),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Generic Press',  'Generic Press',  'Exact name match (added by migration 503)'),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Std Press',      'Std Press',      'Exact name match (added by migration 503)'),
  ('Sheet Metal', 'Bending/Floating /Forming', 'Tandem Press',   'Tandem Press',   'Exact name match (added by migration 503)'),
  ('Sheet Metal', 'Finishing',                 'Deslag',         'Deslag',         'Exact name match (added by migration 503)'),
  ('Sheet Metal', 'Cutting',                   '2 Axis Router',  '2 Axis Router',  'Exact name match (added by migration 503)'),
  ('Sheet Metal', 'Cutting',                   'OxyFuel Cut',    'OxyFuel Cut',    'Exact name match (added by migration 503)'),
  ('Sheet Metal', 'Cutting',                   'Plasma Cut',     'Plasma Cut',     'Exact name match (added by migration 503)'),
  ('Sheet Metal', 'Laser Cutting',             '3D Laser',       '3D Laser',       'Exact name match (added by migration 503)'),
  ('Sheet Metal', 'Material Usage',            'Material Stock', 'Material Stock', 'Exact name match (added by migration 503)'),
  ('Sheet Metal', 'Material Usage',            'No Cost Feature','No Cost Feature','Exact name match (added by migration 503)'),
  ('Sheet Metal', 'Sheet Metal Fabrication',   'Laser Punch',    'Laser Punch',    'Exact name match (added by migration 503)'),
  ('Sheet Metal', 'Sheet Metal Fabrication',   'Plasma Punch',   'Plasma Punch',   'Exact name match (added by migration 503)')
ON CONFLICT (process_group, process_route, operation) DO NOTHING;
