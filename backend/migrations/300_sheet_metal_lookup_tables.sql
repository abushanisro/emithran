-- ============================================================================
-- SHEET METAL LOOKUP TABLES
-- ============================================================================
-- 6 reference tables used by the sheet metal calculators.
-- These are shared reference data (no user_id / RLS write restrictions).
-- All users can SELECT; no client writes allowed.

-- ============================================================================
-- TABLE 1: Stroke Rate Efficiency Factors (Automatic Machines)
-- Lookup: given machine tonnage → efficiency multiplier per complexity tier
-- ============================================================================
CREATE TABLE IF NOT EXISTS sm_lookup_stroke_rate (
    id              SERIAL PRIMARY KEY,
    tonnage         NUMERIC NOT NULL,          -- machine tonnage (T)
    eff_simple      NUMERIC NOT NULL,          -- efficiency factor for Simple parts
    eff_inter       NUMERIC NOT NULL,          -- efficiency factor for Intermediate parts
    eff_complex     NUMERIC NOT NULL,          -- efficiency factor for Complex parts
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_stroke_rate_tonnage ON sm_lookup_stroke_rate(tonnage);

-- ============================================================================
-- TABLE 2: Handling Time (by part weight)
-- Lookup: given part weight (kg) → handling time (min)
-- Use the row where weight <= weight_max_kg
-- ============================================================================
CREATE TABLE IF NOT EXISTS sm_lookup_handling_time (
    id              SERIAL PRIMARY KEY,
    row_num         INTEGER NOT NULL,
    weight_max_kg   NUMERIC NOT NULL,          -- upper bound of weight bracket
    handling_min    NUMERIC NOT NULL,          -- handling time in minutes
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_handling_weight ON sm_lookup_handling_time(weight_max_kg);

-- ============================================================================
-- TABLE 3: Tool Setup Time
-- 3A: Press machine (by tonnage) → tool loading time (min)
-- 3B: Press brake (by tool length mm) → tool loading time (min)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sm_lookup_tool_setup (
    id              SERIAL PRIMARY KEY,
    setup_type      VARCHAR(10) NOT NULL,      -- 'press' or 'brake'
    key_value       NUMERIC NOT NULL,          -- tonnage (press) or tool_length_mm (brake)
    loading_time_min NUMERIC NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_tool_setup_key ON sm_lookup_tool_setup(setup_type, key_value);

-- ============================================================================
-- TABLE 4: Manual Stroke Time (per stroke, in seconds)
-- Lookup: thickness_mm × tonnage × complexity → stroke_time_sec
-- ============================================================================
CREATE TABLE IF NOT EXISTS sm_lookup_manual_stroke (
    id              SERIAL PRIMARY KEY,
    thickness_mm    NUMERIC NOT NULL,
    tonnage         NUMERIC NOT NULL,
    complexity      VARCHAR(10) NOT NULL,      -- 'simple' or 'complex'
    stroke_time_sec NUMERIC NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_manual_stroke_key ON sm_lookup_manual_stroke(thickness_mm, tonnage, complexity);

-- ============================================================================
-- TABLE 5: Laser Cutting Data
-- Lookup: material × thickness_mm × laser_power_w → cutting speed (m/min), kerf (mm)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sm_lookup_laser_cut (
    id                      SERIAL PRIMARY KEY,
    material                VARCHAR(50) NOT NULL,
    thickness_mm            NUMERIC NOT NULL,
    kerf_mm                 NUMERIC,
    laser_power_w           INTEGER NOT NULL,
    cutting_speed_m_per_min NUMERIC,           -- NULL = not achievable at this power
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_laser_cut_key ON sm_lookup_laser_cut(material, thickness_mm, laser_power_w);

-- ============================================================================
-- TABLE 6: Sampling Plan (AQL-style)
-- Lookup: batch size range × complexity level → sample_qty and sampling_pct
-- ============================================================================
CREATE TABLE IF NOT EXISTS sm_lookup_sampling_plan (
    id                  SERIAL PRIMARY KEY,
    batch_size_from     INTEGER NOT NULL,
    batch_size_to       INTEGER NOT NULL,
    sample_qty_l1       INTEGER,               -- sample qty for complexity level I
    sample_qty_l2       INTEGER,               -- sample qty for complexity level II
    sample_qty_l3       INTEGER,               -- sample qty for complexity level III
    sampling_pct_l1     NUMERIC,               -- sampling % for level I
    sampling_pct_l2     NUMERIC,               -- sampling % for level II
    sampling_pct_l3     NUMERIC,               -- sampling % for level III
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_sampling_plan_key ON sm_lookup_sampling_plan(batch_size_from, batch_size_to);

-- ============================================================================
-- ENABLE RLS (Row Level Security)
-- ============================================================================
ALTER TABLE sm_lookup_stroke_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_lookup_handling_time ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_lookup_tool_setup ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_lookup_manual_stroke ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_lookup_laser_cut ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_lookup_sampling_plan ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES: Public read, no client writes
-- ============================================================================
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'sm_lookup_stroke_rate',
        'sm_lookup_handling_time',
        'sm_lookup_tool_setup',
        'sm_lookup_manual_stroke',
        'sm_lookup_laser_cut',
        'sm_lookup_sampling_plan'
    ]
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Public read" ON %I', tbl);
        EXECUTE format('CREATE POLICY "Public read" ON %I FOR SELECT USING (true)', tbl);
    END LOOP;
END $$;

-- ============================================================================
-- TABLE COMMENTS
-- ============================================================================
COMMENT ON TABLE sm_lookup_stroke_rate    IS 'Table 1: SPM efficiency factors by machine tonnage and part complexity tier';
COMMENT ON TABLE sm_lookup_handling_time  IS 'Table 2: Part handling time (min) by weight bracket';
COMMENT ON TABLE sm_lookup_tool_setup     IS 'Table 3A/B: Press & brake tool loading times';
COMMENT ON TABLE sm_lookup_manual_stroke  IS 'Table 4: Manual stroke time (sec) by thickness, tonnage, and complexity';
COMMENT ON TABLE sm_lookup_laser_cut      IS 'Table 5: Laser cutting speed (m/min) by material, thickness, and laser power';
COMMENT ON TABLE sm_lookup_sampling_plan  IS 'Table 6: AQL-style inspection sampling plan by batch size and complexity level';
