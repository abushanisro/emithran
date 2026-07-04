-- Migration 324: Machine capability, availability, and versioning columns on mhr_records
-- All columns nullable — backwards-compatible. Populated by migration 325 seed,
-- then by Excel re-import (capability_source = 'imported').

ALTER TABLE mhr_records
  -- Physical capability envelope
  ADD COLUMN IF NOT EXISTS max_x_mm                 NUMERIC(10,2),  -- CNC envelope X, laser/waterjet bed length
  ADD COLUMN IF NOT EXISTS max_y_mm                 NUMERIC(10,2),  -- envelope Y, bed width
  ADD COLUMN IF NOT EXISTS max_z_mm                 NUMERIC(10,2),  -- envelope Z
  ADD COLUMN IF NOT EXISTS max_diameter_mm          NUMERIC(10,2),  -- lathe swing over bed
  ADD COLUMN IF NOT EXISTS max_length_mm            NUMERIC(10,2),  -- lathe between-centres, press brake bend length
  ADD COLUMN IF NOT EXISTS max_tonnage              NUMERIC(10,2),  -- press brake / punch force
  ADD COLUMN IF NOT EXISTS max_thickness_mm         NUMERIC(10,2),  -- generic thickness limit (waterjet, turret, press brake)
  ADD COLUMN IF NOT EXISTS max_workpiece_weight_kg  NUMERIC(10,2),  -- table load
  ADD COLUMN IF NOT EXISTS power_kw                 NUMERIC(10,2),  -- laser power / spindle power
  ADD COLUMN IF NOT EXISTS capability_source        VARCHAR(24),    -- 'imported' | 'seed' | 'default_class'

  -- Material-specific laser thickness limits (differ dramatically by material)
  ADD COLUMN IF NOT EXISTS max_thickness_ms_mm      NUMERIC(10,2),  -- mild steel   (e.g. 6kW = 25 mm)
  ADD COLUMN IF NOT EXISTS max_thickness_ss_mm      NUMERIC(10,2),  -- stainless    (e.g. 6kW = 12 mm)
  ADD COLUMN IF NOT EXISTS max_thickness_al_mm      NUMERIC(10,2),  -- aluminium    (e.g. 6kW = 8 mm)
  ADD COLUMN IF NOT EXISTS max_thickness_cu_mm      NUMERIC(10,2),  -- copper/brass (reflective, ~4 mm at 6kW)
  ADD COLUMN IF NOT EXISTS cuttable_materials       TEXT[],         -- ISO grades this machine can process (NULL = all)

  -- Availability + scheduling (informational inputs to selection; MES fills these later)
  ADD COLUMN IF NOT EXISTS availability_status      VARCHAR(24) DEFAULT 'available',
    -- 'available' | 'maintenance' | 'down' | 'retired' | 'commissioning'
  ADD COLUMN IF NOT EXISTS next_available_at        TIMESTAMPTZ,    -- earliest usable slot (NULL = available now)
  ADD COLUMN IF NOT EXISTS scheduled_load_pct       NUMERIC(5,2),   -- committed load 0-100 for next 30 days
  ADD COLUMN IF NOT EXISTS maintenance_window_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS maintenance_window_end   TIMESTAMPTZ,

  -- Capability versioning — audit who changed machine capabilities and when,
  -- so historical quotes can be reproduced against the definitions in force at the time
  ADD COLUMN IF NOT EXISTS capability_version       INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS capability_updated_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capability_updated_by    UUID;

CREATE INDEX IF NOT EXISTS idx_mhr_records_capability
  ON mhr_records (location, machine_class, availability_status, capability_source)
  WHERE availability_status = 'available';

CREATE INDEX IF NOT EXISTS idx_mhr_records_available_by_class
  ON mhr_records (location, machine_class)
  WHERE availability_status = 'available' AND next_available_at IS NULL;
