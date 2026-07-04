-- Migration 325: Seed capability specs for known machine models.
-- UPDATE-by-machine-name — no new rows. Only fills rows whose capability is still
-- NULL so re-imported ('imported') values are never overwritten.
-- Mirror of backend/src/modules/bom-items/costing/machine-selection/seed-registry.ts —
-- keep both in sync.

-- ── Fiber lasers ──────────────────────────────────────────────────────────────
UPDATE mhr_records SET
  max_x_mm = 3050, max_y_mm = 1525, power_kw = 4,
  max_thickness_ms_mm = 20, max_thickness_ss_mm = 12, max_thickness_al_mm = 10, max_thickness_cu_mm = 6,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'amada.*(lc|ensis|ventis).*30\s*15|lc-?3015' AND capability_source IS NULL;

UPDATE mhr_records SET
  max_x_mm = 3000, max_y_mm = 1500, power_kw = 6,
  max_thickness_ms_mm = 25, max_thickness_ss_mm = 12, max_thickness_al_mm = 8, max_thickness_cu_mm = 4,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'trumpf.*(trulaser|tru laser).*(30|50)30|trulaser' AND capability_source IS NULL;

UPDATE mhr_records SET
  max_x_mm = 6500, max_y_mm = 2000, power_kw = 10,
  max_thickness_ms_mm = 30, max_thickness_ss_mm = 25, max_thickness_al_mm = 20, max_thickness_cu_mm = 10,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'bystronic.*(bystar|by star)' AND capability_source IS NULL;

-- Generic fiber laser rows (unknown model): conservative 4 kW class spec
UPDATE mhr_records SET
  max_x_mm = 3000, max_y_mm = 1500, power_kw = 4,
  max_thickness_ms_mm = 16, max_thickness_ss_mm = 10, max_thickness_al_mm = 8, max_thickness_cu_mm = 4,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'fiber\s*laser|laser\s*cut' AND max_thickness_ms_mm IS NULL AND capability_source IS NULL;

-- ── Press brakes ──────────────────────────────────────────────────────────────
UPDATE mhr_records SET
  max_tonnage = 40, max_length_mm = 2050, max_thickness_mm = 4,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'accurl.*hbp-?40|hbp-?40' AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 100, max_length_mm = 3100, max_thickness_mm = 8,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'amada.*(hfe|hg|hrb).*100|hfe-?100' AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 170, max_length_mm = 3060, max_thickness_mm = 12,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'trumpf.*trubend.*(5170|170)' AND capability_source IS NULL;

-- Generic press brake rows: 80T mid-class
UPDATE mhr_records SET
  max_tonnage = 80, max_length_mm = 2500, max_thickness_mm = 6,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'press\s*brake|bending' AND max_tonnage IS NULL AND capability_source IS NULL;

-- ── CNC vertical machining centres ───────────────────────────────────────────
UPDATE mhr_records SET
  max_x_mm = 762, max_y_mm = 406, max_z_mm = 508, max_workpiece_weight_kg = 1361, power_kw = 22.4,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'haas.*vf-?2' AND capability_source IS NULL;

UPDATE mhr_records SET
  max_x_mm = 1016, max_y_mm = 508, max_z_mm = 635, max_workpiece_weight_kg = 1814, power_kw = 22.4,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'haas.*vf-?4' AND capability_source IS NULL;

UPDATE mhr_records SET
  max_x_mm = 500, max_y_mm = 400, max_z_mm = 300, max_workpiece_weight_kg = 500, power_kw = 15,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'vmc[-\s]?540|540' AND machine_name ~* 'vmc' AND capability_source IS NULL;

UPDATE mhr_records SET
  max_x_mm = 850, max_y_mm = 500, max_z_mm = 500, max_workpiece_weight_kg = 800, power_kw = 18.5,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'vmc[-\s]?850' AND capability_source IS NULL;

UPDATE mhr_records SET
  max_x_mm = 730, max_y_mm = 730, max_z_mm = 880, max_workpiece_weight_kg = 1000, power_kw = 37,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'dmg\s*mori.*nhx-?5000|nhx-?5000' AND capability_source IS NULL;

-- ── CNC lathes ────────────────────────────────────────────────────────────────
-- Miyano BNC-20: sliding-head, max bar dia 20 mm — must NOT win for larger parts
UPDATE mhr_records SET
  max_diameter_mm = 20, max_length_mm = 320, power_kw = 3.7,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'miyano.*bnc-?20|bnc-?20' AND capability_source IS NULL;

UPDATE mhr_records SET
  max_diameter_mm = 356, max_length_mm = 533, power_kw = 22.4,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'haas.*st-?20' AND capability_source IS NULL;

UPDATE mhr_records SET
  max_diameter_mm = 366, max_length_mm = 649, power_kw = 18.5,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'dmg\s*mori.*(nlx|clx).*2500|nlx-?2500' AND capability_source IS NULL;

-- ── Waterjet ──────────────────────────────────────────────────────────────────
UPDATE mhr_records SET
  max_x_mm = 3000, max_y_mm = 1500, max_thickness_mm = 100,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'waterjet|water\s*jet|omax|flow\b' AND max_thickness_mm IS NULL AND capability_source IS NULL;

-- ── Turret punch ──────────────────────────────────────────────────────────────
UPDATE mhr_records SET
  max_x_mm = 2500, max_y_mm = 1250, max_thickness_mm = 6, max_tonnage = 20,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'turret|punch' AND max_thickness_mm IS NULL AND capability_source IS NULL;
