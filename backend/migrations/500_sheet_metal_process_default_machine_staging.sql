-- ============================================================================
-- Migration: Sheet Metal Process -- default machine per process (staging)
-- Purpose: Lands the "process_machine_data" export (25 rows, Process ->
--          default/example machine name) into the same lossless staging
--          table earlier migrations created. See migration 479's header for
--          the staging/promotion architecture.
--
--          Mostly placeholder/template naming from the source tool's own
--          "new part" wizard ("Default Bend Brake", "Default Turret Press",
--          etc.), not real machine specs -- not promotable as-is. A handful
--          name real machine models with no accompanying rate/capability
--          data (e.g. "OMAX 2626" for Waterjet Cut, a real waterjet brand --
--          this app DOES have a real waterjet cost engine, but adding a
--          machine with a name and no rate would be worse than not having
--          it, so NOT added to mhr_records). Staged for completeness only.
-- Author: Principal Engineering Team
-- Date: 2026-08-19
-- Version: 1.0.0
-- ============================================================================

INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
('process', 'USA', '2026-03', 'processDefaultMachine:2 Axis Router', 'Default Machine', NULL, 'tool_shop_name=''Default Tool Shop Name''', '{"process_name": "2 Axis Router", "tool_shop_name": "Default Tool Shop Name", "machine": "Default Machine"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:2 Axis Router', '2 Axis Router - 18,000 RPM', NULL, 'Default/example machine name for this process', '{"process_name": "2 Axis Router", "tool_shop_name": "", "machine": "2 Axis Router - 18,000 RPM"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:2 Roll Bending', 'Faccin HCU 300 X 1', NULL, 'Default/example machine name for this process', '{"process_name": "2 Roll Bending", "tool_shop_name": "", "machine": "Faccin HCU 300 X 1"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:3 Roll Bending', 'Faccin ASI/M 2513', NULL, 'Default/example machine name for this process', '{"process_name": "3 Roll Bending", "tool_shop_name": "", "machine": "Faccin ASI/M 2513"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:3D Laser', 'Default 3D Laser', NULL, 'Default/example machine name for this process', '{"process_name": "3D Laser", "tool_shop_name": "", "machine": "Default 3D Laser"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:4 Roll Bending', 'Knuth RBM 20/04 CNC', NULL, 'Default/example machine name for this process', '{"process_name": "4 Roll Bending", "tool_shop_name": "", "machine": "Knuth RBM 20/04 CNC"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:Bend Brake', 'Default Bend Brake', NULL, 'Default/example machine name for this process', '{"process_name": "Bend Brake", "tool_shop_name": "", "machine": "Default Bend Brake"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:CTL', 'Default CTL', NULL, 'Default/example machine name for this process', '{"process_name": "CTL", "tool_shop_name": "", "machine": "Default CTL"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:Deslag', 'Default Deslag', NULL, 'Default/example machine name for this process', '{"process_name": "Deslag", "tool_shop_name": "", "machine": "Default Deslag"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:Fiber Laser Cut', 'Laser Cutter - 4kW Fiber', NULL, 'tool_shop_name=''Default''', '{"process_name": "Fiber Laser Cut", "tool_shop_name": "Default", "machine": "Laser Cutter - 4kW Fiber"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:Generic Press', 'Default Press', NULL, 'tool_shop_name=''StageDiemaker1''', '{"process_name": "Generic Press", "tool_shop_name": "StageDiemaker1", "machine": "Default Press"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:Laser Cut', 'Default Laser', NULL, 'Default/example machine name for this process', '{"process_name": "Laser Cut", "tool_shop_name": "", "machine": "Default Laser"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:Laser Punch', 'Muratec Motorum Hybrid 2558 (2000W)', NULL, 'Default/example machine name for this process', '{"process_name": "Laser Punch", "tool_shop_name": "", "machine": "Muratec Motorum Hybrid 2558 (2000W)"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:Material Stock', 'Default Material Stock', NULL, 'Default/example machine name for this process', '{"process_name": "Material Stock", "tool_shop_name": "", "machine": "Default Material Stock"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:No Cost Feature', NULL, NULL, 'Default/example machine name for this process', '{"process_name": "No Cost Feature", "tool_shop_name": "", "machine": ""}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:OxyFuel Cut', 'Default Oxyfuel - 4 torch', NULL, 'Default/example machine name for this process', '{"process_name": "OxyFuel Cut", "tool_shop_name": "", "machine": "Default Oxyfuel - 4 torch"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:Plasma Cut', 'Default Plasma', NULL, 'Default/example machine name for this process', '{"process_name": "Plasma Cut", "tool_shop_name": "", "machine": "Default Plasma"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:Plasma Punch', 'Whitney 3700 SST', NULL, 'Default/example machine name for this process', '{"process_name": "Plasma Punch", "tool_shop_name": "", "machine": "Whitney 3700 SST"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:Progressive Die', 'Default Press', NULL, 'tool_shop_name=''Default''', '{"process_name": "Progressive Die", "tool_shop_name": "Default", "machine": "Default Press"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:Shear', 'Default Shear', NULL, 'Default/example machine name for this process', '{"process_name": "Shear", "tool_shop_name": "", "machine": "Default Shear"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:Std Press', 'Default Press', NULL, 'tool_shop_name=''Diemaker1''', '{"process_name": "Std Press", "tool_shop_name": "Diemaker1", "machine": "Default Press"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:Tandem Press', 'Default Press', NULL, 'tool_shop_name=''StageDiemaker1''', '{"process_name": "Tandem Press", "tool_shop_name": "StageDiemaker1", "machine": "Default Press"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:Turret Press', 'Default Turret Press', NULL, 'Default/example machine name for this process', '{"process_name": "Turret Press", "tool_shop_name": "", "machine": "Default Turret Press"}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:User-Defined Process', NULL, NULL, 'Default/example machine name for this process', '{"process_name": "User-Defined Process", "tool_shop_name": "", "machine": ""}'::jsonb),
('process', 'USA', '2026-03', 'processDefaultMachine:Waterjet Cut', 'OMAX 2626', NULL, 'Default/example machine name for this process', '{"process_name": "Waterjet Cut", "tool_shop_name": "", "machine": "OMAX 2626"}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;
