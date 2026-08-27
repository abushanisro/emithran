-- ============================================================================
-- Migration: Sheet Metal Wage Grade Associations — staging seed
-- Purpose: Lands the Sheet Metal "Wage Grade Associations" reference data
--          (process -> required labour grade, USA region) into the same
--          lossless staging table migration 479 created for Variables. See
--          that migration's header for the staging/promotion architecture.
--          NOT promoted into any live table here — see project memory
--          project_manufacturing_intelligence_data_reconciliation.md for why:
--          this source's grade scale ('0'/'2'/'3'/'4' + '-Metal' suffix) is a
--          DIFFERENT, incompatible numbering from this app's own
--          lhr_wage_benchmarks grade scale ('1'-'13' odd, interpreted by
--          lhr.service.ts's wageGradeToType()) — a naive numeric promotion
--          would silently corrupt meaning (their '3-Metal' means a mid-tier
--          skilled operator; our wageGradeToType('3') resolves to
--          'Unskilled'). Also, only ~7 of these 23 processes match a
--          machine_class this app actually supports today; the rest
--          (Progressive Die, Roll Bending, Oxyfuel/Plasma Cut, Tandem/Slit
--          Press, CTL, 2 Axis Router, Generic/User-Defined Process) have no
--          real consumer here.
-- Author: Principal Engineering Team
-- Date: 2026-08-19
-- Version: 1.0.0
-- ============================================================================

INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
('wage_grade', 'USA', '2026-03', '2 Axis Router',       '3-Metal', NULL, 'Process -> required labour grade', '{"process": "2 Axis Router", "wageGrade": "3-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', '2 Roll Bending',      '4-Metal', NULL, 'Process -> required labour grade', '{"process": "2 Roll Bending", "wageGrade": "4-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', '3 Roll Bending',      '4-Metal', NULL, 'Process -> required labour grade', '{"process": "3 Roll Bending", "wageGrade": "4-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'CO Laser',            '4-Metal', NULL, 'Process -> required labour grade', '{"process": "CO Laser", "wageGrade": "4-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', '4 Roll Bending',      '4-Metal', NULL, 'Process -> required labour grade', '{"process": "4 Roll Bending", "wageGrade": "4-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Bend Brake',          '3-Metal', NULL, 'Process -> required labour grade', '{"process": "Bend Brake", "wageGrade": "3-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'CTL',                 '2-Metal', NULL, 'Process -> required labour grade', '{"process": "CTL", "wageGrade": "2-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Deburr',              '2-Metal', NULL, 'Process -> required labour grade', '{"process": "Deburr", "wageGrade": "2-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Fiber Laser Cut',     '3-Metal', NULL, 'Process -> required labour grade', '{"process": "Fiber Laser Cut", "wageGrade": "3-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Generic Press',       '3-Metal', NULL, 'Process -> required labour grade', '{"process": "Generic Press", "wageGrade": "3-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Laser Cut',           '3-Metal', NULL, 'Process -> required labour grade', '{"process": "Laser Cut", "wageGrade": "3-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Laser Punch',         '3-Metal', NULL, 'Process -> required labour grade', '{"process": "Laser Punch", "wageGrade": "3-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Material Stock',      '0-Metal', NULL, 'Process -> required labour grade', '{"process": "Material Stock", "wageGrade": "0-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Oxyfuel Cut',         '3-Metal', NULL, 'Process -> required labour grade', '{"process": "Oxyfuel Cut", "wageGrade": "3-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Plasma Cut',          '3-Metal', NULL, 'Process -> required labour grade', '{"process": "Plasma Cut", "wageGrade": "3-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Plasma Punch',        '3-Metal', NULL, 'Process -> required labour grade', '{"process": "Plasma Punch", "wageGrade": "3-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Progressive Die',     '3-Metal', NULL, 'Process -> required labour grade', '{"process": "Progressive Die", "wageGrade": "3-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Shear',               '3-Metal', NULL, 'Process -> required labour grade', '{"process": "Shear", "wageGrade": "3-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Slit Press',          '3-Metal', NULL, 'Process -> required labour grade', '{"process": "Slit Press", "wageGrade": "3-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Tandem Press',        '3-Metal', NULL, 'Process -> required labour grade', '{"process": "Tandem Press", "wageGrade": "3-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Turret Press',        '3-Metal', NULL, 'Process -> required labour grade', '{"process": "Turret Press", "wageGrade": "3-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'User-Defined Process','3-Metal', NULL, 'Process -> required labour grade', '{"process": "User-Defined Process", "wageGrade": "3-Metal"}'::jsonb),
('wage_grade', 'USA', '2026-03', 'Waterjet Cut',        '3-Metal', NULL, 'Process -> required labour grade', '{"process": "Waterjet Cut", "wageGrade": "3-Metal"}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;
