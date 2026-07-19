-- ============================================================================
-- MANUFACTURING RULES ENGINE — Schema
-- Migration: 324
-- Description: 9 new tables for deterministic physics-based costing engine.
--   Replaces LLM cycle time estimation (timingSource: 'ai_hint') with rules
--   driven by ISO 513 machining parameters, laser tables, and IM physics.
-- ============================================================================

-- ── 1. Material Group Mapping ─────────────────────────────────────────────────
-- Maps any material grade (IS / AISI / DIN / EN) to its ISO 513 group.
-- This is the first resolver in the pipeline: materialGrade → isoGroup.

CREATE TABLE IF NOT EXISTS machining_material_groups (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_grade      VARCHAR(100) NOT NULL,
  aliases             TEXT[]        DEFAULT '{}',
  iso_group           CHAR(1)       NOT NULL CHECK (iso_group IN ('P','M','K','N','S','H')),
  iso_subgroup        VARCHAR(10),
  aisi_equiv          VARCHAR(50),
  din_equiv           VARCHAR(50),
  en_equiv            VARCHAR(50),
  is_equiv            VARCHAR(50),
  hardness_min_hb     INTEGER,
  hardness_max_hb     INTEGER,
  uts_mpa             INTEGER,
  kc1_1_n_mm2         NUMERIC(8,1),
  mc_exponent         NUMERIC(4,3),
  material_family     VARCHAR(50),
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mmg_grade_lower
  ON machining_material_groups (LOWER(material_grade));
CREATE INDEX IF NOT EXISTS idx_mmg_iso_group
  ON machining_material_groups (iso_group);

-- RLS: system-wide read, no user ownership
ALTER TABLE machining_material_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone can read machining material groups" ON machining_material_groups;
CREATE POLICY "Everyone can read machining material groups"
  ON machining_material_groups FOR SELECT USING (true);

-- ── 2. Core Machining Parameters ─────────────────────────────────────────────
-- Primary lookup table: operation × ISO group × quality level → Vc, f, ap.
-- Rules resolver queries this; calculator plugins read Vc/f/ap from the result.

CREATE TABLE IF NOT EXISTS machining_parameters (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation           VARCHAR(50)   NOT NULL,
  iso_material_group  CHAR(1)       NOT NULL CHECK (iso_material_group IN ('P','M','K','N','S','H')),
  quality_level       VARCHAR(20)   NOT NULL CHECK (quality_level IN ('roughing','semi_finishing','finishing')),
  tool_material       VARCHAR(30)   NOT NULL CHECK (tool_material IN ('hss','hss_cobalt','carbide','ceramic','cbn','pcd')),
  -- Cutting parameters
  vc_min              NUMERIC(8,2),
  vc_recommended      NUMERIC(8,2)  NOT NULL,
  vc_max              NUMERIC(8,2),
  feed_min            NUMERIC(8,4),
  feed_recommended    NUMERIC(8,4)  NOT NULL,
  feed_max            NUMERIC(8,4),
  ap_min_mm           NUMERIC(8,3),
  ap_max_mm           NUMERIC(8,3),
  ae_pct_min          NUMERIC(5,1),
  ae_pct_max          NUMERIC(5,1),
  -- Tool life
  tool_life_minutes   NUMERIC(6,1),
  tool_life_holes     INTEGER,
  -- Tool spec
  insert_grade_iso    VARCHAR(30),
  insert_coating      VARCHAR(60),
  -- Diameter range (drilling / tapping / reaming only)
  drill_dia_min_mm    NUMERIC(6,2),
  drill_dia_max_mm    NUMERIC(6,2),
  -- Surface finish
  ra_achievable_um    NUMERIC(5,2),
  -- Citation
  source_reference    VARCHAR(200),
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mp_lookup
  ON machining_parameters (operation, iso_material_group, quality_level, tool_material);
CREATE INDEX IF NOT EXISTS idx_mp_drill_dia
  ON machining_parameters (operation, iso_material_group, drill_dia_min_mm, drill_dia_max_mm)
  WHERE drill_dia_min_mm IS NOT NULL;

ALTER TABLE machining_parameters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone can read machining parameters" ON machining_parameters;
CREATE POLICY "Everyone can read machining parameters"
  ON machining_parameters FOR SELECT USING (true);

-- ── 3. Laser Cutting Parameters ───────────────────────────────────────────────
-- Lookup: material × thickness × laser power → cutting speed + pierce time.

CREATE TABLE IF NOT EXISTS laser_cutting_parameters (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  iso_material_group      CHAR(1)     NOT NULL CHECK (iso_material_group IN ('P','M','K','N','S','H')),
  material_label          VARCHAR(50) NOT NULL,
  thickness_mm            NUMERIC(5,2) NOT NULL,
  laser_power_kw          NUMERIC(5,1) NOT NULL,
  cutting_speed_mm_min    INTEGER     NOT NULL,
  pierce_time_sec         NUMERIC(5,2) NOT NULL,
  kerf_width_mm           NUMERIC(5,3),
  assist_gas              VARCHAR(10),
  assist_gas_pressure_bar NUMERIC(5,1),
  source_reference        VARCHAR(200),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (iso_material_group, thickness_mm, laser_power_kw)
);

CREATE INDEX IF NOT EXISTS idx_lcp_lookup
  ON laser_cutting_parameters (iso_material_group, thickness_mm, laser_power_kw);

ALTER TABLE laser_cutting_parameters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone can read laser cutting parameters" ON laser_cutting_parameters;
CREATE POLICY "Everyone can read laser cutting parameters"
  ON laser_cutting_parameters FOR SELECT USING (true);

-- ── 4. Injection Molding Materials ───────────────────────────────────────────
-- Polymer thermal properties for physics-based cooling time calculation.
-- Formula: tc = (t²/(π²·α)) × ln[(4/π)·(Tm-Tc)/(Te-Tc)]

CREATE TABLE IF NOT EXISTS injection_molding_materials (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  polymer_name                VARCHAR(50) UNIQUE NOT NULL,
  polymer_family              VARCHAR(30),
  thermal_diffusivity_mm2_s   NUMERIC(8,5) NOT NULL,
  melt_temp_c                 INTEGER NOT NULL,
  ejection_temp_c             INTEGER NOT NULL,
  recommended_mold_temp_c     INTEGER NOT NULL,
  cavity_pressure_mpa         NUMERIC(5,1) NOT NULL,
  density_g_cm3               NUMERIC(5,3),
  notes                       TEXT,
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE injection_molding_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone can read injection molding materials" ON injection_molding_materials;
CREATE POLICY "Everyone can read injection molding materials"
  ON injection_molding_materials FOR SELECT USING (true);

-- ── 5. Machine Capabilities ───────────────────────────────────────────────────
-- machine_capabilities may already exist from an earlier migration without the
-- machine_category column. Use ADD COLUMN IF NOT EXISTS to avoid duplicate-column
-- errors, and CREATE TABLE IF NOT EXISTS to handle fresh installs.

DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS machine_capabilities (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mhr_id              UUID REFERENCES mhr_records(id) ON DELETE SET NULL,
    machine_category    VARCHAR(50),
    machine_name        VARCHAR(100),
    spindle_power_kw    NUMERIC(6,2),
    max_rpm             INTEGER,
    travel_x_mm         INTEGER,
    travel_y_mm         INTEGER,
    travel_z_mm         INTEGER,
    max_diameter_mm     INTEGER,
    max_length_mm       INTEGER,
    max_tonnage_kn      NUMERIC(8,2),
    max_thickness_mm    NUMERIC(5,2),
    laser_power_kw      NUMERIC(5,1),
    tool_capacity       INTEGER,
    rapid_feed_mpm      NUMERIC(6,2),
    table_load_kg       INTEGER,
    clamping_force_kn   NUMERIC(8,2),
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

ALTER TABLE machine_capabilities ADD COLUMN IF NOT EXISTS machine_category VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_mc_category
  ON machine_capabilities (machine_category);

ALTER TABLE machine_capabilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone can read machine capabilities" ON machine_capabilities;
CREATE POLICY "Everyone can read machine capabilities"
  ON machine_capabilities FOR SELECT USING (true);

-- ── 6. Tool Library ───────────────────────────────────────────────────────────
-- Common cutting tools with specs, coating, and life data.

CREATE TABLE IF NOT EXISTS tool_library (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_type           VARCHAR(50) NOT NULL,
  operation           VARCHAR(50) NOT NULL,
  iso_material_group  CHAR(1),
  diameter_mm         NUMERIC(7,3),
  length_mm           NUMERIC(7,2),
  flutes              INTEGER,
  tool_material       VARCHAR(30),
  coating             VARCHAR(30),
  insert_grade_iso    VARCHAR(20),
  manufacturer        VARCHAR(50),
  price_usd           NUMERIC(10,2),
  tool_life_minutes   NUMERIC(7,1),
  tool_life_holes     INTEGER,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tl_operation
  ON tool_library (operation, iso_material_group);

ALTER TABLE tool_library ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone can read tool library" ON tool_library;
CREATE POLICY "Everyone can read tool library"
  ON tool_library FOR SELECT USING (true);

-- ── 7. Machine–Tool Compatibility Matrix ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS machine_tool_matrix (
  machine_capability_id UUID NOT NULL REFERENCES machine_capabilities(id) ON DELETE CASCADE,
  tool_library_id       UUID NOT NULL REFERENCES tool_library(id) ON DELETE CASCADE,
  compatible            BOOLEAN DEFAULT TRUE,
  notes                 TEXT,
  PRIMARY KEY (machine_capability_id, tool_library_id)
);

ALTER TABLE machine_tool_matrix ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone can read machine tool matrix" ON machine_tool_matrix;
CREATE POLICY "Everyone can read machine tool matrix"
  ON machine_tool_matrix FOR SELECT USING (true);

-- ── 8. Inspection Rules ───────────────────────────────────────────────────────
-- Determines inspection method, time, and cost from feature type + tolerance.

CREATE TABLE IF NOT EXISTS inspection_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_type        VARCHAR(50) NOT NULL,
  tolerance_class     VARCHAR(20),
  tolerance_max_mm    NUMERIC(8,5),
  inspection_method   VARCHAR(50) NOT NULL CHECK (inspection_method IN ('visual','caliper','micrometer','cmm','plug_gauge','ring_gauge','thread_gauge','surface_roughness')),
  estimated_time_min  NUMERIC(6,2) NOT NULL,
  cost_per_part_inr   NUMERIC(10,2),
  sample_rate_pct     NUMERIC(5,1) DEFAULT 100,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE inspection_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone can read inspection rules" ON inspection_rules;
CREATE POLICY "Everyone can read inspection rules"
  ON inspection_rules FOR SELECT USING (true);

-- ── 9. Operation Results Audit (optional — for explainability storage) ────────
-- Stores the calculation steps so the UI can show "why this cost".

CREATE TABLE IF NOT EXISTS machining_rule_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_item_id         UUID REFERENCES bom_items(id) ON DELETE CASCADE,
  generation_id       UUID,
  operation           VARCHAR(50),
  timing_source       VARCHAR(30) DEFAULT 'machining_rules',
  iso_group           CHAR(1),
  total_cycle_time_sec NUMERIC(10,4),
  calculation_steps   JSONB,
  machine_requirements JSONB,
  tool_requirements   JSONB,
  validation_result   JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mrr_bom_item
  ON machining_rule_results (bom_item_id);

ALTER TABLE machining_rule_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read their machining results" ON machining_rule_results;
CREATE POLICY "Users can read their machining results"
  ON machining_rule_results FOR SELECT USING (
    bom_item_id IN (
      SELECT bi.id FROM bom_items bi
      JOIN boms b ON b.id = bi.bom_id
      JOIN projects p ON p.id = b.project_id
      WHERE p.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Users can insert their machining results" ON machining_rule_results;
CREATE POLICY "Users can insert their machining results"
  ON machining_rule_results FOR INSERT WITH CHECK (true);
