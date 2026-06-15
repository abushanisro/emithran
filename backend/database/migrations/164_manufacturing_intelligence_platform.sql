-- Migration 164: Manufacturing Intelligence Platform
--
-- Creates and seeds:
--   1. material_process_compatibility  — knowledge graph: material × process score matrix
--   2. feature_cost_rules              — CAD→Cost: time/cost per geometric feature
--   3. dfm_rules_library               — DFM rules: violations, severity, recommendations
--   4. supplier_kpi_benchmarks         — global KPI benchmarks by industry segment
--   5. supplier_performance_records    — user-specific supplier data (RLS by user_id)
--   6. commodity_price_history         — LME/market prices time series
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE CREATION
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS material_process_compatibility (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  material_category     TEXT         NOT NULL,
  material_name         TEXT         NOT NULL,
  process_group         TEXT         NOT NULL,
  process_name          TEXT         NOT NULL,
  compatibility_score   INTEGER      NOT NULL CHECK (compatibility_score BETWEEN 1 AND 10),
  suitability           TEXT         NOT NULL,  -- Ideal / Good / Acceptable / Challenging / Incompatible
  relative_cost_index   NUMERIC(5,2) DEFAULT 1.00,  -- 1.0 = baseline; higher = more expensive per kg
  key_considerations    TEXT,
  common_applications   TEXT,
  created_at            TIMESTAMPTZ  DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mat_proc_compat
  ON material_process_compatibility (material_name, process_name);
CREATE INDEX IF NOT EXISTS idx_mat_proc_score
  ON material_process_compatibility (process_name, compatibility_score DESC);

CREATE TABLE IF NOT EXISTS feature_cost_rules (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  process_group         TEXT         NOT NULL,
  process_name          TEXT         NOT NULL,
  feature_type          TEXT         NOT NULL,
  cost_driver           TEXT         NOT NULL,   -- 'diameter_mm', 'depth_mm', 'volume_cm3', 'length_mm', 'count'
  driver_value          NUMERIC,                 -- specific driver value this row applies to
  driver_unit           TEXT,
  machining_time_min    NUMERIC      NOT NULL,   -- additional machine time in minutes at this driver value
  complexity_multiplier NUMERIC(5,2) DEFAULT 1.00,  -- apply to machining_time for complexity
  reference_rate_usd_hr NUMERIC(7,2) DEFAULT 60.00, -- the $/hr this time estimate assumes
  notes                 TEXT,
  created_at            TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fcr_process ON feature_cost_rules (process_name, feature_type);

CREATE TABLE IF NOT EXISTS dfm_rules_library (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  process_group       TEXT         NOT NULL,
  process_name        TEXT         NOT NULL,
  rule_category       TEXT         NOT NULL,   -- wall, draft, hole, radius, tolerance, clearance, thread
  rule_name           TEXT         NOT NULL,
  min_value           NUMERIC,
  recommended_value   NUMERIC,
  max_value           NUMERIC,
  unit                TEXT,
  violation_severity  TEXT         NOT NULL,   -- Critical / Warning / Advisory
  violation_impact    TEXT         NOT NULL,
  recommendation      TEXT         NOT NULL,
  cost_impact         TEXT,                    -- Low / Medium / High / Very High
  created_at          TIMESTAMPTZ  DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_kpi_benchmarks (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_segment    TEXT         NOT NULL,
  supplier_tier       TEXT         NOT NULL,   -- Tier 1 / Tier 2 / Job Shop
  kpi_name            TEXT         NOT NULL,
  kpi_unit            TEXT         NOT NULL,
  world_class_value   NUMERIC,
  target_value        NUMERIC,
  acceptable_value    NUMERIC,
  poor_value          NUMERIC,
  direction           TEXT         NOT NULL,   -- higher_better / lower_better
  notes               TEXT,
  created_at          TIMESTAMPTZ  DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_performance_records (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supplier_name       TEXT         NOT NULL,
  supplier_country    TEXT,
  process_group       TEXT,
  evaluation_period   TEXT,        -- e.g. 'Q1 2024', '2024 H1'
  otd_pct             NUMERIC(5,2),
  ppm_defects         NUMERIC(9,1),
  response_time_days  NUMERIC(5,1),
  lead_time_days      NUMERIC(6,1),
  price_competitiveness_score INTEGER CHECK (price_competitiveness_score BETWEEN 1 AND 10),
  quality_score       INTEGER      CHECK (quality_score BETWEEN 1 AND 10),
  communication_score INTEGER      CHECK (communication_score BETWEEN 1 AND 10),
  capacity_pct        NUMERIC(5,2),
  notes               TEXT,
  created_at          TIMESTAMPTZ  DEFAULT now(),
  updated_at          TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_spr_user ON supplier_performance_records (user_id);

CREATE TABLE IF NOT EXISTS commodity_price_history (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_name      TEXT         NOT NULL,
  commodity_code      TEXT         NOT NULL,
  exchange            TEXT         NOT NULL,   -- LME / CME / SHFE / Platts
  price_date          DATE         NOT NULL,
  price_usd_per_tonne NUMERIC(12,2) NOT NULL,
  price_usd_per_kg    NUMERIC(10,4) GENERATED ALWAYS AS (price_usd_per_tonne / 1000) STORED,
  notes               TEXT,
  created_at          TIMESTAMPTZ  DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commodity_date
  ON commodity_price_history (commodity_code, price_date);
CREATE INDEX IF NOT EXISTS idx_commodity_code ON commodity_price_history (commodity_code, price_date DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- RLS
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl TEXT;
  rec RECORD;
BEGIN
  -- Global lookup tables: SELECT USING (true)
  FOREACH tbl IN ARRAY ARRAY[
    'material_process_compatibility','feature_cost_rules','dfm_rules_library',
    'supplier_kpi_benchmarks','commodity_price_history'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    FOR rec IN SELECT policyname FROM pg_policies WHERE tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', rec.policyname, tbl);
    END LOOP;
    EXECUTE format('CREATE POLICY "global_select" ON %I FOR SELECT USING (true)', tbl);
  END LOOP;
END $$;

-- supplier_performance_records: owner-only CRUD
ALTER TABLE supplier_performance_records ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN SELECT policyname FROM pg_policies WHERE tablename = 'supplier_performance_records'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON supplier_performance_records', rec.policyname);
  END LOOP;
END $$;

CREATE POLICY "spr_select_own" ON supplier_performance_records
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "spr_insert_own" ON supplier_performance_records
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "spr_update_own" ON supplier_performance_records
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "spr_delete_own" ON supplier_performance_records
  FOR DELETE USING (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════════
-- SEED: 1. MATERIAL × PROCESS COMPATIBILITY KNOWLEDGE GRAPH
-- ══════════════════════════════════════════════════════════════════════════════
-- score 10=Ideal, 8-9=Good, 6-7=Acceptable, 4-5=Challenging, 1-3=Incompatible
-- cost_index: 1.0=baseline, >1.0=more expensive per unit vs primary process

INSERT INTO material_process_compatibility
  (material_category, material_name, process_group, process_name,
   compatibility_score, suitability, relative_cost_index,
   key_considerations, common_applications)
VALUES

-- ── MILD STEEL ───────────────────────────────────────────────────────────────
('Carbon Steel','Mild Steel','Machining',    'CNC Milling',           8,'Good',        1.00, 'Free-cutting grades ideal; standard carbide tooling; good surface finish achievable','Brackets, fixtures, housings, frames'),
('Carbon Steel','Mild Steel','Machining',    'CNC Turning',           9,'Good',        0.95, 'Bar stock; high productivity; excellent chip control with EN1A/EN8','Shafts, pins, bushings, fasteners'),
('Carbon Steel','Mild Steel','Casting',      'Sand Casting',          8,'Good',        1.10, 'Good castability; mild shrinkage; widely available foundry capability','Engine blocks, pump bodies, counterweights'),
('Carbon Steel','Mild Steel','Casting',      'Investment Casting',    6,'Acceptable',  1.40, 'Possible but SS and Inconel are more common; higher cost vs sand','Small complex steel parts'),
('Carbon Steel','Mild Steel','Sheet Metal',  'Laser Cutting',        10,'Ideal',       1.00, 'Primary process; fibre laser; excellent speed and edge quality on 1-20mm','Enclosures, panels, structural sections'),
('Carbon Steel','Mild Steel','Sheet Metal',  'Sheet Metal Bending',  10,'Ideal',       1.00, 'Primary; predictable springback; low force vs SS; excellent formability','Brackets, chassis, enclosures'),
('Carbon Steel','Mild Steel','Welding',      'MIG Welding',          10,'Ideal',       1.00, 'Primary process; ER70S-6 filler; no preheat <25mm; fast and economic','Structural steel, frames, tanks'),
('Carbon Steel','Mild Steel','Welding',      'TIG Welding',           7,'Acceptable',  1.50, 'Possible; MIG preferred for productivity; TIG used for thin sheet <3mm','Precision fabrication, exhaust systems'),
('Carbon Steel','Mild Steel','Welding',      'Spot Welding',          9,'Good',        1.00, 'Excellent; low contact resistance; standard automotive process','Auto body panels, sheet assemblies'),
('Carbon Steel','Mild Steel','Forging',      'Hot Forging',          10,'Ideal',       1.00, 'Primary process; excellent grain flow; superior fatigue life vs casting','Gears, crankshafts, connecting rods, flanges'),
('Carbon Steel','Mild Steel','Surface',      'Powder Coating',       10,'Ideal',       1.00, 'Primary decorative/corrosion finish; excellent adhesion on blasted steel','All mild steel fabrications'),
('Carbon Steel','Mild Steel','Surface',      'Electroplating',        9,'Good',        1.10, 'Zinc, nickel, chrome all deposit excellently on MS','Fasteners, stampings, automotive components'),
('Carbon Steel','Mild Steel','Surface',      'Heat Treatment',        9,'Good',        1.00, 'Case hardening, through hardening, normalising all applicable','Gears, shafts, wear parts'),
('Carbon Steel','Mild Steel','Machining',    'Grinding / Honing',     8,'Good',        1.00, 'Conventional Al2O3 wheels; good surface finish; standard process','Precision ground bars, finished bearing surfaces'),

-- ── ALLOY STEEL 4140 ─────────────────────────────────────────────────────────
('Alloy Steel','Alloy Steel 4140','Machining','CNC Milling',          7,'Acceptable',  1.20, 'Carbide essential; shorter tool life than MS; HSM strategy recommended','Dies, tooling, high-strength brackets'),
('Alloy Steel','Alloy Steel 4140','Machining','CNC Turning',          8,'Good',        1.10, 'Bar stock; good machinability in annealed state; harden after machining','High-strength shafts, hydraulic piston rods'),
('Alloy Steel','Alloy Steel 4140','Forging',  'Hot Forging',         10,'Ideal',       1.00, 'Primary; designed for forging; excellent hardenability','Crankshafts, gear blanks, axles'),
('Alloy Steel','Alloy Steel 4140','Welding',  'MIG Welding',          6,'Acceptable',  1.30, 'Preheat 150-200°C; low-hydrogen filler; PWHT recommended to avoid cracking','Structural weldments, heavy fabrication'),
('Alloy Steel','Alloy Steel 4140','Welding',  'TIG Welding',          7,'Acceptable',  1.40, 'Better control than MIG; preheat + PWHT essential; filler ER80S-D2','Precision repair, critical joints'),
('Alloy Steel','Alloy Steel 4140','Surface',  'Heat Treatment',      10,'Ideal',       1.00, 'Designed for Q&T; 900-1050°C austenitise + oil quench + temper; 250-550HB range','All hardened structural applications'),
('Alloy Steel','Alloy Steel 4140','Machining','Grinding / Honing',    9,'Good',        1.00, 'CBN preferred on hardened 4140; excellent results; grinding is finishing op','Hardened shafts, precision bores'),

-- ── STAINLESS STEEL 304 ───────────────────────────────────────────────────────
('Stainless Steel','SS 304','Machining',   'CNC Milling',             6,'Acceptable',  1.40, 'Work-hardening tendency; maintain feed rate; positive rake carbide; coolant','Valve bodies, medical instruments, food equipment'),
('Stainless Steel','SS 304','Machining',   'CNC Turning',             7,'Acceptable',  1.30, 'Free-machining 303 preferred if finish not critical; 304 is harder to turn','Fittings, shafts, couplings'),
('Stainless Steel','SS 304','Casting',     'Investment Casting',      9,'Good',        1.20, 'Excellent; complex SS parts; valves, impellers, pump casings','Valves, impellers, marine hardware'),
('Stainless Steel','SS 304','Sheet Metal', 'Laser Cutting',           9,'Good',        1.10, 'N2 assist for bright, dross-free edge; slightly slower than MS','Enclosures, architectural panels, food equipment'),
('Stainless Steel','SS 304','Sheet Metal', 'Sheet Metal Bending',     8,'Good',        1.15, 'Higher springback (~30% more than MS); over-bend compensation needed','Food processing equipment, catering, enclosures'),
('Stainless Steel','SS 304','Welding',     'MIG Welding',             7,'Acceptable',  1.20, '308L filler; sensitization risk; back purge for food/pharma','Tanks, vessels, structural SS'),
('Stainless Steel','SS 304','Welding',     'TIG Welding',             9,'Good',        1.00, 'Primary; 308L filler; back purge; excellent joint quality','High-purity pipework, food, pharmaceutical, marine'),
('Stainless Steel','SS 304','Welding',     'Spot Welding',            6,'Acceptable',  1.20, 'Higher current and longer weld time vs MS; electrode contamination risk','Ss sheet assemblies'),
('Stainless Steel','SS 304','Surface',     'Electroplating',          6,'Acceptable',  1.50, 'Needs activation etch before plating; adhesion can be unreliable','Decorative chrome, selective plating'),
('Stainless Steel','SS 304','Surface',     'Heat Treatment',          3,'Challenging', 2.00, 'Austenitic; cannot be through-hardened; solution anneal + water quench only','Stress relief of weldments, softening cold-worked SS'),
('Stainless Steel','SS 304','Machining',   'Grinding / Honing',       8,'Good',        1.10, 'Al2O3 or CBN; risk of work hardening at low feed — maintain aggressive cut','Precision SS components, bore finishing'),

-- ── ALUMINIUM 6061 ───────────────────────────────────────────────────────────
('Aluminium','Al 6061','Machining',   'CNC Milling',                 10,'Ideal',       1.00, 'Best machinability; 800+ cm³/min MRR; long tool life; excellent finish','Aerospace brackets, electronic enclosures, automotive'),
('Aluminium','Al 6061','Machining',   'CNC Turning',                 10,'Ideal',       1.00, 'High speed; excellent bar stock; smooth finish with PCD or carbide','Pistons, fittings, valve bodies, connectors'),
('Aluminium','Al 6061','Casting',     'Sand Casting',                 6,'Acceptable',  1.30, 'A356 preferred for casting; 6061 has lower castability','Prototype castings, simple shapes'),
('Aluminium','Al 6061','Sheet Metal', 'Laser Cutting',                9,'Good',        1.05, 'Fibre laser; N2 assist; slightly slower than MS; clean edge','Enclosures, heat sinks, structural panels'),
('Aluminium','Al 6061','Sheet Metal', 'Sheet Metal Bending',          9,'Good',        1.00, 'Excellent formability; springback moderate; O/H32 temper better than T6 for bending','Chassis, panels, covers'),
('Aluminium','Al 6061','Welding',     'MIG Welding',                  7,'Acceptable',  1.10, 'Filler 5356 or 4043; HAZ softening 30-40% strength loss; anodise affected in weld zone','Structural Al weldments, marine'),
('Aluminium','Al 6061','Welding',     'TIG Welding',                  8,'Good',        1.00, 'AC TIG; 4043 filler; excellent for thinner gauges; cleaner than MIG','Precise Al fabrication, aerospace sub-assemblies'),
('Aluminium','Al 6061','Forging',     'Hot Forging',                  9,'Good',        1.10, 'Excellent; automotive wheels, aerospace forgings; near-net shape possible','Wheels, aircraft structural, suspension arms'),
('Aluminium','Al 6061','Surface',     'Powder Coating',               9,'Good',        1.05, 'Chromate conversion primer; excellent adhesion; architectural standard','Architectural extrusions, automotive, outdoor'),
('Aluminium','Al 6061','Surface',     'Anodising',                   10,'Ideal',       1.00, 'Primary surface treatment; Type II for corrosion; Type III for wear','Electronics, aerospace, automotive, consumer'),
('Aluminium','Al 6061','Surface',     'Heat Treatment',               9,'Good',        1.00, 'T4→T6 precipitation hardening; 160-180°C × 8-12hr; +30% yield strength','All structural 6061 applications'),
('Aluminium','Al 6061','Machining',   'Grinding / Honing',            5,'Challenging', 1.50, 'Soft; wheel loading/glazing common; silicon carbide or diamond wheels; MQL essential','Precision flat surfaces, bearing bores'),

-- ── ALUMINIUM 7075 ───────────────────────────────────────────────────────────
('Aluminium','Al 7075','Machining',   'CNC Milling',                  9,'Good',        1.10, 'Excellent machinability; slightly more abrasive than 6061 due to Zn/Mg; PCD recommended at volume','Aerospace structural, drone frames, tooling plate'),
('Aluminium','Al 7075','Machining',   'CNC Turning',                  9,'Good',        1.10, 'High-speed turning excellent; sharp tools; good finish','Precision aerospace fasteners, shafts'),
('Aluminium','Al 7075','Welding',     'MIG Welding',                  3,'Challenging', 2.50, 'HAZ strength severely degraded; stress corrosion cracking risk; avoid if possible','Emergency repair only; not for structural use'),
('Aluminium','Al 7075','Welding',     'TIG Welding',                  4,'Challenging', 2.00, 'Possible with care; 4043 filler; SCC risk; post-weld temper required','Limited structural use; avoid for fatigue-critical parts'),
('Aluminium','Al 7075','Forging',     'Hot Forging',                  9,'Good',        1.15, 'Aerospace primary; isothermal forging for precision; die life shorter','Aircraft wing spars, structural bulkheads'),
('Aluminium','Al 7075','Surface',     'Anodising',                    9,'Good',        1.00, 'Excellent; Type II and III; slightly darker than 6061 due to Cu content','Aerospace, sporting goods, consumer electronics'),
('Aluminium','Al 7075','Surface',     'Heat Treatment',              10,'Ideal',       1.00, 'T6, T73, T7351; critical for strength; SCC resistance governed by temper choice','All 7075 structural applications'),

-- ── ALUMINIUM A380 (DIE CASTING) ─────────────────────────────────────────────
('Aluminium','Al A380','Casting',     'Die Casting',                 10,'Ideal',       1.00, 'Designed for die casting; best fluidity + die life of Al alloys; primary choice','Auto housings, electronic enclosures, power tools'),
('Aluminium','Al A380','Machining',   'CNC Milling',                  6,'Acceptable',  1.20, 'As-cast + machine; high Si wears tools faster; PCD or uncoated carbide','Post-cast machining of functional surfaces'),
('Aluminium','Al A380','Casting',     'Sand Casting',                 5,'Challenging', 1.50, 'A356 is better for sand; A380 used when only alloy available','Low-volume prototypes'),
('Aluminium','Al A380','Surface',     'Powder Coating',               9,'Good',        1.00, 'Excellent with chromate primer; common for automotive/consumer die castings','Automotive, power tools, white goods'),
('Aluminium','Al A380','Surface',     'Anodising',                    5,'Challenging', 1.60, 'High Si reduces anodise quality; black or dark grey only; cosmetic use limited','Functional protection only; not decorative'),
('Aluminium','Al A380','Welding',     'MIG Welding',                  3,'Challenging', 2.50, 'High Si causes cracking; porosity in weld zone; avoid welding die castings','Emergency repair only'),

-- ── TITANIUM TI-6AL-4V ───────────────────────────────────────────────────────
('Titanium','Ti-6Al-4V','Machining',  'CNC Milling',                  5,'Challenging', 2.50, 'Low MRR 20-50 cm³/min; chemical reactivity with tool; sharp PCD/uncoated carbide; flood coolant essential','Aerospace brackets, medical implants, racing components'),
('Titanium','Ti-6Al-4V','Machining',  'CNC Turning',                  5,'Challenging', 2.50, 'Same challenges as milling; bar turning feasible with correct speeds/feeds','Aerospace fasteners, surgical instruments'),
('Titanium','Ti-6Al-4V','Casting',    'Investment Casting',           8,'Good',        1.30, 'Vacuum investment casting; complex near-net shapes; less machining than billet','Aerospace structural castings, medical implants'),
('Titanium','Ti-6Al-4V','Sheet Metal','Laser Cutting',                7,'Acceptable',  1.60, 'Ar/N2 assist; slower than Al; edge quality acceptable; HAZ needs management','Aerospace sheet brackets, medical plates'),
('Titanium','Ti-6Al-4V','Sheet Metal','Sheet Metal Bending',          6,'Acceptable',  1.80, 'High springback (2-3× MS); heated forming above 300°C reduces springback','Aerospace sheet metal, armour plate'),
('Titanium','Ti-6Al-4V','Welding',    'TIG Welding',                 10,'Ideal',       1.00, 'Full Ar purge back shielding essential; titanium oxidises readily; produces purple/gold oxide colors','Aerospace structures, exhaust systems, medical'),
('Titanium','Ti-6Al-4V','Welding',    'MIG Welding',                  1,'Incompatible',5.00, 'Contamination risk too high; oxygen embrittlement; TIG or electron beam only','Not used'),
('Titanium','Ti-6Al-4V','Forging',    'Hot Forging',                  9,'Good',        1.50, 'Isothermal or conventional hot forging at 900-950°C; excellent fatigue life','Aerospace discs, blades, landing gear'),
('Titanium','Ti-6Al-4V','Surface',    'Anodising',                    7,'Acceptable',  1.20, 'Titanium anodising = colour by oxide thickness (not protective); decorative and ID','Medical implants (colour coding), aerospace hardware'),
('Titanium','Ti-6Al-4V','Surface',    'Heat Treatment',               8,'Good',        1.00, 'Stress relief + anneal at 700-800°C; age hardening for beta alloys','All critical Ti structural components'),
('Titanium','Ti-6Al-4V','Machining',  'Grinding / Honing',            7,'Acceptable',  1.80, 'CBN or diamond wheels; flood coolant critical; risk of fire with dry grinding','Precision aerospace surfaces, implant finishing'),

-- ── INCONEL 718 ─────────────────────────────────────────────────────────────
('Superalloy','Inconel 718','Machining','CNC Milling',                3,'Challenging', 4.00, 'Very low MRR 5-20 cm³/min; rapid tool wear; ceramic or uncoated carbide; HSM not effective','Hot-section turbine components, seals, casings'),
('Superalloy','Inconel 718','Machining','CNC Turning',                3,'Challenging', 4.00, 'Same issues as milling; tool life measured in minutes; CBN for finishing','Turbine shafts, rings, discs'),
('Superalloy','Inconel 718','Casting', 'Investment Casting',         10,'Ideal',       1.00, 'Primary process for IN718; vacuum investment; equiaxed, DS or SX structures','Turbine blades, vanes, nozzle guide vanes, combustors'),
('Superalloy','Inconel 718','Welding', 'TIG Welding',                 8,'Good',        1.50, 'IN625 filler; strain-age cracking risk; controlled heat input; PWHT required','Casing repair, combustor fabrication, seal welding'),
('Superalloy','Inconel 718','Welding', 'MIG Welding',                 5,'Challenging', 2.50, 'Possible but TIG gives better control; pore risk; spatter hard to remove','Less critical structural welds only'),
('Superalloy','Inconel 718','Forging', 'Hot Forging',                 8,'Good',        1.80, 'Isothermal forging at 900-1000°C; narrow processing window; press forging preferred','Turbine discs, compressor discs, shafts'),
('Superalloy','Inconel 718','Surface', 'Heat Treatment',              9,'Good',        1.00, 'Solution + double age (718°C + 621°C); critical for precipitation hardening; gives full strength','All IN718 structural applications'),
('Superalloy','Inconel 718','Machining','Grinding / Honing',          8,'Good',        1.50, 'CBN grinding preferred; excellent results for finishing castings/forgings','Final dimension control on turbine parts'),

-- ── COPPER / BRASS ───────────────────────────────────────────────────────────
('Copper','Copper / Brass','Machining','CNC Milling',                  7,'Acceptable',  1.10, 'Pure copper is gummy; free-machining brass CuZn37 is excellent; >200m/min possible','Electrical connectors, heat exchangers, decorative'),
('Copper','Copper / Brass','Machining','CNC Turning',                  9,'Good',        0.90, 'Free-machining brass ideal for high-volume turning; excellent surface finish','Fittings, valves, plumbing, electrical terminals'),
('Copper','Copper / Brass','Casting',  'Sand Casting',                 9,'Good',        1.00, 'Bronze/brass sand casting traditional; excellent fill; art, plumbing, marine','Bronze bearings, valves, propellers, art'),
('Copper','Copper / Brass','Casting',  'Investment Casting',           7,'Acceptable',  1.30, 'Possible; intricate decorative or technical parts','Architectural hardware, precision valves'),
('Copper','Copper / Brass','Sheet Metal','Laser Cutting',              6,'Acceptable',  1.60, 'High reflectivity; fibre laser essential; higher power needed; slower than MS','Electrical bus bars, heat exchanger fins'),
('Copper','Copper / Brass','Sheet Metal','Sheet Metal Bending',        8,'Good',        1.00, 'Copper/brass sheet bends well; low springback; O-temper most formable','Electrical components, decorative metalwork'),
('Copper','Copper / Brass','Welding',  'TIG Welding',                  8,'Good',        1.10, 'CuSn filler for bronze; deoxidised Cu filler for copper; preheat needed for thick','Plumbing, electrical, marine repairs'),
('Copper','Copper / Brass','Surface',  'Electroplating',              10,'Ideal',       1.00, 'Best basis metal for decorative/functional plating; Au, Ag, Sn, Ni, Cr all ideal','PCB pads, connectors, decorative hardware'),

-- ── CAST IRON ────────────────────────────────────────────────────────────────
('Cast Iron','Grey Cast Iron','Machining','CNC Milling',               8,'Good',        0.90, 'Abrasive but graphite lubricates; dry machining common; good chip control','Machine bases, brake discs, engine blocks'),
('Cast Iron','Grey Cast Iron','Machining','CNC Turning',               8,'Good',        0.90, 'Dry turning standard; Al2O3 inserts; high cutting speeds possible','Brake drums, cylinder liners, pulley grooves'),
('Cast Iron','Grey Cast Iron','Casting', 'Sand Casting',              10,'Ideal',       1.00, 'Primary process; excellent castability; low cost; vibration damping','Engine blocks, machine beds, counterweights'),
('Cast Iron','Grey Cast Iron','Welding', 'MIG Welding',                4,'Challenging', 2.50, 'High carbon content = crack risk; preheat 300°C+; Ni-Fe filler; PWHT','Repair work only; new designs avoid welding CI'),
('Cast Iron','Grey Cast Iron','Surface', 'Heat Treatment',             7,'Acceptable',  1.00, 'Stress relief anneal; surface induction hardening; flame hardening possible','Brake discs, wear-resistant surfaces'),
('Cast Iron','Grey Cast Iron','Machining','Grinding / Honing',         9,'Good',        0.90, 'Excellent; dry grinding; Al2O3 or SiC wheels; used for engine bore finishing','Cylinder bores, brake drum surfaces'),
('Cast Iron','Grey Cast Iron','Surface', 'Powder Coating',             8,'Good',        1.00, 'Shot blast preparation essential; excellent adhesion','Machine castings, automotive parts'),

-- ── ABS ──────────────────────────────────────────────────────────────────────
('Engineering Plastic','ABS','Plastic',    'Injection Moulding',      10,'Ideal',       1.00, 'Primary process; excellent flow; wide processing window; T mold 60-80°C','Consumer electronics, automotive interior, appliances'),
('Engineering Plastic','ABS','Plastic',    'Thermoforming',            9,'Good',        1.10, 'Sheet ABS thermoforms excellently; low force; temperature window 150-190°C','Packaging, vehicle interior panels, enclosures'),
('Engineering Plastic','ABS','Machining',  'CNC Milling',              6,'Acceptable',  2.00, 'Prototype quantities; thermal softening risk; sharp tools; no coolant','Prototypes, jigs, fixtures (low qty only)'),
('Engineering Plastic','ABS','Sheet Metal','Laser Cutting',            4,'Challenging', 2.50, 'HCN fume risk; requires extraction; charring on edge; limited cosmetic use','Limited; jigs and fixturing only with proper extraction'),
('Engineering Plastic','ABS','Surface',    'Electroplating',           8,'Good',        1.30, 'ABS plating is a defined process (etch + Pd activation); excellent chrome','Decorative chrome components, automotive trim'),

-- ── NYLON PA6/PA66 ───────────────────────────────────────────────────────────
('Engineering Plastic','Nylon PA6','Plastic','Injection Moulding',    10,'Ideal',       1.00, 'Primary; hygroscopic — must dry before moulding; shrinkage ~1.5-2%','Gears, bearings, cable ties, automotive components'),
('Engineering Plastic','Nylon PA6','Machining','CNC Milling',          6,'Acceptable',  1.80, 'Hygroscopic = dimensional drift; prototype quantities; sharp tools essential','Low-qty precision nylon parts'),
('Engineering Plastic','Nylon PA6','Plastic','Extrusion',              9,'Good',        1.00, 'Rod, sheet, tube for subsequent machining; nylon profiles','Bearing stock, sheet for machined parts'),

-- ── PEEK ─────────────────────────────────────────────────────────────────────
('Engineering Plastic','PEEK','Machining', 'CNC Milling',              8,'Good',        1.50, 'Machines well; carbide tools; low cutting speed vs metal; very low qty vs IM','Medical implants, aerospace bushings, valve seats'),
('Engineering Plastic','PEEK','Machining', 'CNC Turning',              8,'Good',        1.50, 'Excellent for machined PEEK rod/tube stock','Surgical guides, pump components, seals'),
('Engineering Plastic','PEEK','Plastic',   'Injection Moulding',       7,'Acceptable',  1.80, 'High melt temp 380°C; tool temp 160-200°C; specialist equipment required','High-volume PEEK components for medical/aerospace'),

-- ── POLYPROPYLENE PP ─────────────────────────────────────────────────────────
('Engineering Plastic','PP','Plastic','Injection Moulding',           10,'Ideal',       1.00, 'Primary; excellent; living hinge capability; low tool temp 20-40°C','Packaging, automotive, medical disposables, caps'),
('Engineering Plastic','PP','Plastic','Thermoforming',                 9,'Good',        1.00, 'Excellent sheet thermoforming; low force; 150-170°C window','Trays, packaging, automotive liners'),
('Engineering Plastic','PP','Plastic','Extrusion',                    10,'Ideal',       1.00, 'Primary for PP profiles, sheet, pipe, fibre','Pipe, sheet, profiles, fibre, strapping')

ON CONFLICT (material_name, process_name) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- SEED: 2. FEATURE COST RULES  (reference machine rate = $60/hr = $1.00/min)
-- ══════════════════════════════════════════════════════════════════════════════
-- machining_time_min = additional cycle time for this feature
-- total_feature_cost_usd ≈ machining_time_min × (machine_rate/60)

INSERT INTO feature_cost_rules
  (process_group, process_name, feature_type, cost_driver,
   driver_value, driver_unit, machining_time_min, complexity_multiplier,
   reference_rate_usd_hr, notes)
VALUES
  -- ── CNC Through Holes (Aluminium baseline) ─────────────────────────────────
  ('Machining','CNC Milling','Through Hole','diameter_mm',  3,  'mm', 0.15, 1.00, 60, 'Spot + drill Ø3mm, 10mm deep; Al'),
  ('Machining','CNC Milling','Through Hole','diameter_mm',  5,  'mm', 0.20, 1.00, 60, 'Spot + drill Ø5mm'),
  ('Machining','CNC Milling','Through Hole','diameter_mm',  8,  'mm', 0.30, 1.00, 60, NULL),
  ('Machining','CNC Milling','Through Hole','diameter_mm', 10,  'mm', 0.40, 1.00, 60, NULL),
  ('Machining','CNC Milling','Through Hole','diameter_mm', 16,  'mm', 0.60, 1.00, 60, 'Spot + drill + bore or ream'),
  ('Machining','CNC Milling','Through Hole','diameter_mm', 20,  'mm', 0.80, 1.00, 60, NULL),
  ('Machining','CNC Milling','Through Hole','diameter_mm', 30,  'mm', 1.20, 1.00, 60, 'Spot + rough bore + finish bore'),
  ('Machining','CNC Milling','Through Hole','diameter_mm', 50,  'mm', 2.00, 1.00, 60, 'Boring bar required'),
  -- Blind holes add ~50% vs through hole at same diameter (peck drilling + chip evacuation)
  ('Machining','CNC Milling','Blind Hole',  'diameter_mm',  5,  'mm', 0.30, 1.00, 60, 'Peck drill; depth = 2×D'),
  ('Machining','CNC Milling','Blind Hole',  'diameter_mm', 10,  'mm', 0.55, 1.00, 60, NULL),
  ('Machining','CNC Milling','Blind Hole',  'diameter_mm', 16,  'mm', 0.85, 1.00, 60, NULL),
  ('Machining','CNC Milling','Blind Hole',  'diameter_mm', 20,  'mm', 1.10, 1.00, 60, NULL),
  -- Deep holes >5×D: multiply base time by (depth/diameter / 3) factor
  ('Machining','CNC Milling','Deep Hole',   'diameter_mm',  8,  'mm', 1.20, 1.00, 60, 'Depth = 8×D; peck cycle; chip flush'),
  ('Machining','CNC Milling','Deep Hole',   'diameter_mm', 10,  'mm', 1.80, 1.00, 60, 'Depth = 10×D'),

  -- ── Tapped Holes (add to drill time above) ────────────────────────────────
  ('Machining','CNC Milling','Tapped Hole','thread_size_m',  3, 'M', 0.12, 1.00, 60, 'M3 rigid tap; add to drill time'),
  ('Machining','CNC Milling','Tapped Hole','thread_size_m',  5, 'M', 0.15, 1.00, 60, 'M5'),
  ('Machining','CNC Milling','Tapped Hole','thread_size_m',  6, 'M', 0.18, 1.00, 60, 'M6'),
  ('Machining','CNC Milling','Tapped Hole','thread_size_m',  8, 'M', 0.22, 1.00, 60, 'M8'),
  ('Machining','CNC Milling','Tapped Hole','thread_size_m', 10, 'M', 0.28, 1.00, 60, 'M10'),
  ('Machining','CNC Milling','Tapped Hole','thread_size_m', 12, 'M', 0.35, 1.00, 60, 'M12'),
  ('Machining','CNC Milling','Tapped Hole','thread_size_m', 16, 'M', 0.45, 1.00, 60, 'M16; spiral flute tap or forming tap'),
  ('Machining','CNC Milling','Tapped Hole','thread_size_m', 20, 'M', 0.60, 1.00, 60, 'M20; high torque; rigid tapping essential'),

  -- ── Milled Pockets (volume-based, Aluminium) ────────────────────────────────
  ('Machining','CNC Milling','Pocket','volume_cm3',   2, 'cm3', 0.50, 1.00, 60, '10×10×20mm; simple 4-wall pocket'),
  ('Machining','CNC Milling','Pocket','volume_cm3',   5, 'cm3', 1.00, 1.00, 60, NULL),
  ('Machining','CNC Milling','Pocket','volume_cm3',  10, 'cm3', 1.80, 1.00, 60, NULL),
  ('Machining','CNC Milling','Pocket','volume_cm3',  25, 'cm3', 4.00, 1.00, 60, '50×50×10mm reference'),
  ('Machining','CNC Milling','Pocket','volume_cm3',  50, 'cm3', 7.00, 1.00, 60, NULL),
  ('Machining','CNC Milling','Pocket','volume_cm3', 100, 'cm3',12.00, 1.00, 60, NULL),
  ('Machining','CNC Milling','Pocket','volume_cm3', 200, 'cm3',22.00, 1.00, 60, 'Multi-pass; depth-dependent'),
  -- Apply complexity multiplier for non-standard pockets:
  -- 4-wall open: ×1.0 | 4-wall closed: ×1.0 | islands: ×1.3 | curved walls: ×1.5 | undercuts: ×2.5-4.0

  -- ── Slots ─────────────────────────────────────────────────────────────────
  ('Machining','CNC Milling','Slot','length_mm',  20, 'mm', 0.30, 1.00, 60, 'Width = tool dia; depth = 1×W'),
  ('Machining','CNC Milling','Slot','length_mm',  50, 'mm', 0.60, 1.00, 60, NULL),
  ('Machining','CNC Milling','Slot','length_mm', 100, 'mm', 1.00, 1.00, 60, NULL),
  ('Machining','CNC Milling','Slot','length_mm', 200, 'mm', 1.80, 1.00, 60, NULL),

  -- ── Special Features (cost multipliers encoded as absolute time additions) ──
  ('Machining','CNC Milling','Undercut (simple)',    'count', 1,'feature', 5.00, 1.00, 60, 'Requires undercut mill or 5-axis reposition; +5min setup per undercut'),
  ('Machining','CNC Milling','Undercut (complex)',   'count', 1,'feature',15.00, 1.00, 60, 'Multiple sides; 5-axis required; +15min per complex undercut'),
  ('Machining','CNC Milling','Surface Finish Ra0.4', 'count', 1,'surface', 3.00, 1.00, 60, 'Additional finish pass; insert/tool change; gauging'),
  ('Machining','CNC Milling','Surface Finish Ra0.1', 'count', 1,'surface', 8.00, 1.00, 60, 'Fine finish + manual polish/stone'),
  ('Machining','CNC Milling','Setup (First Op)',     'count', 1,'setup',  20.00, 1.00, 60, 'Base setup: program load, datum set, first-off inspection'),
  ('Machining','CNC Milling','Setup (Additional Op)','count', 1,'setup',  12.00, 1.00, 60, 'Flip or re-fixture; re-datum'),
  ('Machining','CNC Milling','Precision Bore H7',    'diameter_mm',10,'mm', 1.50, 1.00, 60, 'Bore + fine bore + gauging for H7 tolerance'),
  ('Machining','CNC Milling','Precision Bore H7',    'diameter_mm',20,'mm', 2.00, 1.00, 60, NULL),
  ('Machining','CNC Milling','Precision Bore H7',    'diameter_mm',50,'mm', 3.00, 1.00, 60, NULL),

  -- ── CNC Turning Features ──────────────────────────────────────────────────
  ('Machining','CNC Turning','Turned Diameter','length_mm',  20,'mm', 0.20, 1.00, 60, 'Rough + finish turn; Ø<30mm; Al'),
  ('Machining','CNC Turning','Turned Diameter','length_mm',  50,'mm', 0.40, 1.00, 60, NULL),
  ('Machining','CNC Turning','Turned Diameter','length_mm', 100,'mm', 0.70, 1.00, 60, NULL),
  ('Machining','CNC Turning','Turned Diameter','length_mm', 200,'mm', 1.30, 1.00, 60, NULL),
  ('Machining','CNC Turning','External Thread','thread_size_m',  8,'M',  0.40, 1.00, 60, 'Single-point turn; M8; Al'),
  ('Machining','CNC Turning','External Thread','thread_size_m', 16,'M',  0.60, 1.00, 60, NULL),
  ('Machining','CNC Turning','External Thread','thread_size_m', 24,'M',  0.90, 1.00, 60, NULL),
  ('Machining','CNC Turning','Groove / Recess','depth_mm',  2,'mm',  0.25, 1.00, 60, 'O-ring groove, retaining ring groove'),
  ('Machining','CNC Turning','Groove / Recess','depth_mm',  5,'mm',  0.35, 1.00, 60, NULL),
  ('Machining','CNC Turning','Knurl',           'length_mm',20,'mm',  0.40, 1.00, 60, 'Diamond or straight knurl'),
  ('Machining','CNC Turning','Parting Off',     'diameter_mm',30,'mm', 0.30, 1.00, 60, 'Parting blade; adds to end of cycle'),
  ('Machining','CNC Turning','Parting Off',     'diameter_mm',60,'mm', 0.55, 1.00, 60, NULL),

  -- ── Sheet Metal Features (at $50/hr laser ref rate) ─────────────────────
  ('Sheet Metal','Laser Cutting','Pierce Hole','diameter_mm',  5,'mm', 0.008, 1.00, 50, 'Pierce + cut circle Ø5mm, MS 3mm; inc pierce time'),
  ('Sheet Metal','Laser Cutting','Pierce Hole','diameter_mm', 10,'mm', 0.012, 1.00, 50, NULL),
  ('Sheet Metal','Laser Cutting','Pierce Hole','diameter_mm', 20,'mm', 0.018, 1.00, 50, NULL),
  ('Sheet Metal','Laser Cutting','Pierce Hole','diameter_mm', 50,'mm', 0.040, 1.00, 50, NULL),
  ('Sheet Metal','Laser Cutting','Profile Cut','perimeter_mm',100,'mm', 0.018, 1.00, 50, 'MS 3mm, 6kW; 100mm profile length'),
  ('Sheet Metal','Laser Cutting','Profile Cut','perimeter_mm',500,'mm', 0.090, 1.00, 50, NULL),
  ('Sheet Metal','Laser Cutting','Nesting Setup','count',1,'sheet',  8.00, 1.00, 50, 'Program nesting + machine setup per sheet'),
  ('Sheet Metal','Sheet Metal Bending','Single Bend','count',  1,'bend', 0.15, 1.00, 50, 'Load + position + bend + measure; simple part <500mm'),
  ('Sheet Metal','Sheet Metal Bending','Complex Bend','count', 1,'bend', 0.35, 1.00, 50, 'Re-position + backgauge change; panel >1m or precision ±0.5°'),
  ('Sheet Metal','Sheet Metal Bending','Bend Setup', 'count', 1,'setup',15.00, 1.00, 50, 'Tooling selection + first article bend check'),

  -- ── Welding Features ───────────────────────────────────────────────────────
  ('Welding','MIG Welding','Fillet Weld', 'length_mm', 100,'mm', 0.20, 1.00, 55, 'MS 3mm fillet; 500mm/min travel; inc 20% non-arc time'),
  ('Welding','MIG Welding','Fillet Weld', 'length_mm', 500,'mm', 1.00, 1.00, 55, NULL),
  ('Welding','MIG Welding','Fillet Weld', 'length_mm',1000,'mm', 2.00, 1.00, 55, NULL),
  ('Welding','MIG Welding','Tack Weld',   'count',      1,'tack', 0.10, 1.00, 55, '10mm tack; position + weld + release'),
  ('Welding','MIG Welding','Weld Setup',  'count',      1,'setup',5.00, 1.00, 55, 'Fixture load, tack up, set parameters'),
  ('Welding','TIG Welding','Butt Weld',   'length_mm', 100,'mm', 0.70, 1.00, 55, 'SS304 3mm; 100mm/min; purge included'),
  ('Welding','TIG Welding','Butt Weld',   'length_mm', 500,'mm', 3.50, 1.00, 55, NULL),
  ('Welding','Spot Welding','Spot Weld',  'count',      1,'spot', 0.08, 1.00, 50, 'MS 1.5+1.5mm; inc electrode dress every 50 spots'),

  -- ── Injection Moulding Features ────────────────────────────────────────────
  ('Plastic','Injection Moulding','Boss',        'count',  1,'feature', 0.00, 1.05, 60, 'Each boss adds ~5% to tool cost; minimal cycle time impact'),
  ('Plastic','Injection Moulding','Rib',         'count',  1,'feature', 0.00, 1.03, 60, 'Each rib adds ~3% to tool cost; flow analysis recommended'),
  ('Plastic','Injection Moulding','Side Core',   'count',  1,'feature', 0.00, 1.35, 60, 'Each side action adds ~35% to tool cost; cycle +2-5s'),
  ('Plastic','Injection Moulding','Lifter',      'count',  1,'feature', 0.00, 1.25, 60, 'Internal undercut; adds ~25% to tool cost'),
  ('Plastic','Injection Moulding','Thread (moulded)','count',1,'feature',0.00, 1.20, 60, 'Rotating core or collapsible; +20% tool cost; avoid if possible'),
  ('Plastic','Injection Moulding','Insert (moulded)','count',1,'feature',0.05,1.15, 60, 'Brass insert: +0.05 min per insert for loading; +15% tool cost for locating feature'),
  ('Plastic','Injection Moulding','Texture (ET)',  'count', 1,'surface',0.00, 1.10, 60, 'Spark erosion texture; add to tool cost; +0.5° draft per 0.025mm depth')

ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- SEED: 3. DFM RULES LIBRARY
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO dfm_rules_library
  (process_group, process_name, rule_category, rule_name,
   min_value, recommended_value, max_value, unit,
   violation_severity, violation_impact, recommendation, cost_impact)
VALUES
  -- ── Injection Moulding ────────────────────────────────────────────────────
  ('Plastic','Injection Moulding','wall','Nominal Wall Thickness',              0.8, 2.5,  6.0,'mm',    'Critical', 'Below 0.8mm: incomplete fill, short shots. Above 6mm: sink marks, voids, excessive cycle time','Keep wall 1.5-3.5mm for best quality/cycle balance','High'),
  ('Plastic','Injection Moulding','wall','Wall Thickness Variation',           NULL, 0.25, 0.5,'ratio', 'Warning',  'Abrupt thickness changes cause sink marks, weld lines, residual stress and warpage','Taper transitions; max variation = 25% of nominal wall per step','Medium'),
  ('Plastic','Injection Moulding','draft','External Draft Angle (smooth)',       0.5,  1.5, NULL,'degrees','Critical','Zero draft causes part to stick in mould; ejection damage; tool wear','Min 0.5°; use 1.5° for textured surfaces + 0.025° per 0.025mm texture depth','High'),
  ('Plastic','Injection Moulding','draft','Internal Draft Angle',               0.5,  2.0, NULL,'degrees','Critical','Internal zero-draft features lock onto core; ejection damage','Internal features need more draft than external; 2° recommended','High'),
  ('Plastic','Injection Moulding','radius','Internal Corner Radius',            0.5,  1.0, NULL,'mm',    'Warning',  'Sharp internal corners create stress concentration; part cracking; tool stress','Min radius = 0.5mm; recommended 50% of wall thickness','Medium'),
  ('Plastic','Injection Moulding','hole','Minimum Hole Diameter',               0.8,  1.5, NULL,'mm',    'Warning',  'Very small holes need fragile pins; breakage in production; flash risk','Min hole = 1.5mm; smaller holes drill post-mould','Medium'),
  ('Plastic','Injection Moulding','hole','Hole Depth-to-Diameter Ratio',       NULL,  2.0,  3.0,'ratio', 'Warning',  'Deep holes with small diameter need long thin pins; deflection; flash at pin base','Blind hole depth max 3×D (through) or 2×D (blind); deep holes = stepped pin design','Medium'),
  ('Plastic','Injection Moulding','boss','Boss Height-to-Diameter Ratio',      NULL,  2.5,  3.0,'ratio', 'Advisory', 'Tall narrow bosses cause sink on opposite face; wobble during moulding','Boss height ≤ 3× outer diameter; reinforce with gussets if taller','Low'),
  ('Plastic','Injection Moulding','boss','Boss Wall to Nominal Wall Ratio',     NULL,  0.6,  0.7,'ratio', 'Warning',  'Boss wall > 70% of nominal = sink marks on opposite A-surface','Boss outer dia ≈ 2× screw dia; wall = 60% of nominal wall','Medium'),
  ('Plastic','Injection Moulding','rib','Rib Thickness to Wall Ratio',         NULL,  0.6,  0.7,'ratio', 'Warning',  'Rib > 70% of nominal wall = sink marks on opposite face','Rib thickness = 50-60% of nominal wall','Medium'),
  ('Plastic','Injection Moulding','rib','Rib Height to Thickness Ratio',       NULL,  3.0,  5.0,'ratio', 'Advisory', 'Tall ribs trap air; difficult to fill; draft required on each side','Rib height ≤ 3× rib base thickness; add radii at base','Low'),
  ('Plastic','Injection Moulding','tolerance','Achievable Positional Tolerance',0.05,  0.15, 0.30,'mm', 'Advisory', 'Tighter than ±0.10mm may require post-mould machining','Design to ±0.15mm for standard tooling; specify ±0.10mm only where functionally required','Medium'),
  ('Plastic','Injection Moulding','undercut','Undercut — Side Action Required','0',NULL,NULL,'count','Warning','Each undercut adds a slide/lifter to tool cost (+25-40% per action) and extends cycle','Redesign to eliminate undercuts; use split parting line; assembly after moulding','Very High'),
  ('Plastic','Injection Moulding','gate','Gate-to-Weld Line Location',        NULL, NULL, NULL,NULL,   'Warning',  'Weld lines form where two flow fronts meet; weakness + visible line','Place gate to push weld lines to non-critical/low-stress zones','Medium'),

  -- ── CNC Machining ─────────────────────────────────────────────────────────
  ('Machining','CNC Milling','hole','Hole Depth-to-Diameter Ratio',            NULL,  3.0,  5.0,'ratio', 'Warning',  'Deep holes require peck drilling, chip evacuation; tool deflection; longer cycle','Keep depth < 5×D for standard drills; use deep-hole strategy (gun drill) for >10×D','Medium'),
  ('Machining','CNC Milling','wall','Minimum Wall Thickness',                  0.5,  1.5, NULL,'mm',    'Critical', 'Thin walls deflect during cutting; chatter; dimensional error; breakage','Min wall 0.8mm Al; 1.2mm steel; reinforce with gussets or machine last','High'),
  ('Machining','CNC Milling','radius','Minimum Internal Corner Radius',        0.2,  0.5, NULL,'mm',    'Warning',  'Radius must match or exceed smallest end mill radius; sharp corners need EDM','Internal radius ≥ tool radius + 20% clearance; specify as R3, R5, R6 standard sizes','Medium'),
  ('Machining','CNC Milling','radius','Internal Corner Radius (cost impact)',  NULL,  3.0, NULL,'mm',    'Advisory', 'Very small radii need small end mills = slower MRR = higher cost','Use R3mm or larger internal radii; each 1mm reduction ~15% machining time increase','Low'),
  ('Machining','CNC Milling','thread','Thread Length (tapped holes)',          NULL,  1.5,  3.0,'× dia', 'Advisory', 'Very long threads give no extra strength; added time and chip evacuation risk','Thread engagement = 1.0-1.5×D for steel; 1.5-2×D for Al (weaker matrix)','Low'),
  ('Machining','CNC Milling','undercut','Undercut / Reverse Angle Feature',   NULL, NULL, NULL,NULL,   'Critical', 'Standard 3-axis cannot reach undercuts; 5-axis or EDM required; cost 3-5×','Redesign to eliminate undercuts; split part; use 5-axis only when unavoidable','Very High'),
  ('Machining','CNC Milling','tolerance','Tolerance Tighter than ±0.025mm',   NULL, NULL, NULL,'mm',  'Warning',  'Sub-0.025mm requires jig boring or grinding after milling; major cost increase','Reserve tight tolerances for functional surfaces only; specify IT6-7 for mating bores only','High'),
  ('Machining','CNC Milling','tolerance','Standard tolerance (general dims)', NULL,  0.1, NULL,'mm',   'Advisory', 'Default CNC tolerance ±0.1mm sufficient for most non-mating features','Add tolerances to drawing only where functionally required; untoleranced = ±0.1mm','Low'),
  ('Machining','CNC Milling','hole','Hole Entry/Exit Angle',                  NULL,  90,  NULL,'degrees','Warning', 'Drilling at angle to surface: drill wanders on entry; oversized hole; breakage','Add a pad/boss for perpendicular entry; use interpolated bore for angled features','Medium'),
  ('Machining','CNC Milling','feature','Multiple Setups (>2 ops)',            NULL,   2,  NULL,'count', 'Advisory', 'Each setup adds 20-45 min setup time + re-datum error accumulation','Consolidate features to 2 ops; use 5-axis for complex parts in 1 setup','Medium'),
  ('Machining','CNC Milling','thread','Thread Near Edge',                     2.0,   3.0, NULL,'× dia', 'Warning',  'Thread too close to edge: material breakout; insert pull-out','Edge distance ≥ 2× thread dia; use Helicoil inserts near edges','Medium'),

  -- ── Sheet Metal ───────────────────────────────────────────────────────────
  ('Sheet Metal','Laser Cutting','hole','Minimum Hole Diameter',              NULL,  1.2, NULL,'× thickness','Critical','Smaller holes: burnout, dross accumulation, oversize result','Minimum hole diameter = material thickness; recommend 1.5×thickness','High'),
  ('Sheet Metal','Laser Cutting','hole','Hole to Edge Distance',             NULL,  1.5, NULL,'× thickness','Warning', 'Too close to edge: material distortion; edge blow-out','Hole edge to sheet edge ≥ 1.5× material thickness','Medium'),
  ('Sheet Metal','Laser Cutting','hole','Hole to Hole Spacing',              NULL,  2.0, NULL,'× thickness','Warning', 'Adjacent cuts too close: heat accumulation; warping; oversize holes','Hole-to-hole spacing ≥ 2× material thickness','Medium'),
  ('Sheet Metal','Sheet Metal Bending','radius','Minimum Bend Radius (MS)',   NULL,  1.0, NULL,'× thickness','Critical','Below minimum: outside cracking; inside wrinkling; work hardening fracture','Minimum bend radius = 1× thickness for MS; 1.5× for SS; 0.5× for Al O-temper','High'),
  ('Sheet Metal','Sheet Metal Bending','flange','Minimum Flange Length',      NULL,  4.0, NULL,'× thickness','Critical','Short flange: cannot clamp in press brake; tool marks on adjacent face','Minimum flange = 4× material thickness; or use hemmed edge for shorter flanges','High'),
  ('Sheet Metal','Sheet Metal Bending','relief','Bend Relief at Notch Corner',NULL, NULL, NULL,NULL,   'Warning',  'No relief: tearing at notch corner during bending; part distortion','Add bend relief slot: width ≥ material thickness; depth ≥ bend radius','Medium'),
  ('Sheet Metal','Sheet Metal Bending','hole','Hole in Bend Zone',            NULL,  2.0, NULL,'× thickness','Warning', 'Holes within 2×t of bend: hole elongation/distortion during bending','Keep holes ≥ 2×t from bend line; or move hole after bending (adds operation)','Medium'),
  ('Sheet Metal','Sheet Metal Bending','tolerance','Bend Angle Tolerance',    NULL,  0.5, NULL,'degrees',  'Advisory', 'Tighter than ±0.5° requires multiple hits and measurement; adds time','Standard ±1°; if ±0.5° needed, specify and expect 30% time surcharge','Medium'),

  -- ── Die Casting ───────────────────────────────────────────────────────────
  ('Casting','Die Casting','wall','Minimum Wall Thickness (Al)',              1.0,  2.0, NULL,'mm',    'Critical', 'Below 1mm: incomplete fill; cold shut; porosity at thin sections','Min 1.5mm for simple shapes; 2.0mm recommended; uniform wall = better quality','High'),
  ('Casting','Die Casting','draft','External Draft Angle',                    0.5,  1.0, NULL,'degrees','Critical','Zero draft: part sticks in die; ejection damage; reduced die life','All surfaces in draw direction need ≥0.5° draft; 1° recommended; textured +1-2°','High'),
  ('Casting','Die Casting','undercut','Undercut (requires slide)',            NULL, NULL, NULL,NULL,   'Warning',  'Each slide adds 25-40% to die cost; increases cycle time 2-5 seconds','Redesign to parting line; accept flash line vs slide cost; or use 2-shot assembly','Very High'),
  ('Casting','Die Casting','radius','Internal Corner Radius',                 0.5,  1.5, NULL,'mm',    'Warning',  'Sharp corners: die cracking over time; stress concentration in part','Minimum R0.5mm; recommended R1.5mm at wall junctions; generous radii extend die life','Medium'),
  ('Casting','Die Casting','thread','Moulded Threads',                       NULL, NULL, NULL,NULL,   'Warning',  'Moulded threads require rotating cores (+30-50% die cost) and extend cycle','Tap threads post-cast for cost-efficiency; use thread inserts for loaded fasteners','High'),
  ('Casting','Die Casting','porosity','Critical Pressure/Seal Surfaces',     NULL, NULL, NULL,NULL,   'Warning',  'Porosity in sealing faces: leak paths; reject rate spikes under pressure test','Flag sealing surfaces; specify vacuum die casting or impregnation sealing','High'),

  -- ── Welding ───────────────────────────────────────────────────────────────
  ('Welding','MIG Welding','access','Weld Access Clearance',                  15, 25, NULL,'mm',    'Critical', 'Insufficient access: welder cannot achieve correct torch angle; poor fusion; defects','Min 15mm clearance each side of weld joint; 25mm preferred for MIG torch','High'),
  ('Welding','MIG Welding','distortion','Weld Sequence Planning',             NULL,NULL,NULL,NULL,  'Warning',  'Unsymmetrical welds cause significant distortion; straightening adds cost','Balance welds around neutral axis; backstep technique; weld short runs alternately','Medium'),
  ('Welding','MIG Welding','material','Minimum Weldable Thickness',           1.0,  1.5,NULL,'mm',  'Warning',  'Sheet < 1mm: burn-through risk; pulsed MIG or TIG required','Use TIG or pulsed MIG for <1.5mm; back copper for thin sheet welding','Medium'),
  ('Welding','TIG Welding','tolerance','Post-Weld Distortion (SS/Al)',        NULL,NULL,NULL,NULL,  'Advisory', 'Thin SS and Al distort significantly; expect 1-3mm per 500mm weld run','Design for welding sequence; allow for straightening; weld to tooling fixture','Medium'),
  ('Welding','MIG Welding','inspection','NDT Access for Critical Welds',       NULL,NULL,NULL,NULL, 'Warning',  'Welds not accessible for UT or RT cannot be validated; structural risk','Ensure access for inspection probe; note on drawing if NDT required','Medium')

ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- SEED: 4. SUPPLIER KPI BENCHMARKS
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO supplier_kpi_benchmarks
  (industry_segment, supplier_tier, kpi_name, kpi_unit,
   world_class_value, target_value, acceptable_value, poor_value,
   direction, notes)
VALUES
  -- ── Delivery ─────────────────────────────────────────────────────────────
  ('General Engineering', 'Tier 2',       'On-Time Delivery (OTD)',           '%',       98.0,  95.0,  90.0,  80.0, 'higher_better','Measured against agreed PO delivery date'),
  ('Automotive OEM',      'Tier 1',       'On-Time Delivery (OTD)',           '%',       99.5,  99.0,  97.0,  95.0, 'higher_better','AIAG standard; JIT supply = zero tolerance'),
  ('Aerospace',           'Tier 1',       'On-Time Delivery (OTD)',           '%',       98.0,  95.0,  90.0,  85.0, 'higher_better','Schedule recovery plans required below 95%'),
  ('Medical Device',      'Tier 2',       'On-Time Delivery (OTD)',           '%',       99.0,  97.0,  93.0,  88.0, 'higher_better','Validated delivery schedules'),
  ('General Engineering', 'Job Shop',     'On-Time Delivery (OTD)',           '%',       95.0,  90.0,  80.0,  70.0, 'higher_better','Job shops typically have lower OTD'),

  -- ── Quality ───────────────────────────────────────────────────────────────
  ('General Engineering', 'Tier 2',       'Parts Per Million Defects (PPM)',  'PPM',     100,   500,  2000,  5000, 'lower_better', 'Incoming inspection AQL 2.5'),
  ('Automotive OEM',      'Tier 1',       'Parts Per Million Defects (PPM)',  'PPM',      10,    50,   200,   500, 'lower_better', 'Zero defect targets; 10 PPM = world class auto'),
  ('Aerospace',           'Tier 1',       'Parts Per Million Defects (PPM)',  'PPM',      10,    50,   100,   250, 'lower_better', '100% inspection often required'),
  ('Medical Device',      'Tier 2',       'Parts Per Million Defects (PPM)',  'PPM',       1,    10,    50,   100, 'lower_better', 'FDA regulated; lot traceability mandatory'),
  ('General Engineering', 'Tier 2',       'First Pass Yield (FPY)',           '%',       98.0,  95.0,  90.0,  80.0, 'higher_better','% of parts accepted at first inspection'),
  ('Automotive OEM',      'Tier 1',       'First Pass Yield (FPY)',           '%',       99.5,  99.0,  97.0,  95.0, 'higher_better',NULL),

  -- ── Responsiveness ────────────────────────────────────────────────────────
  ('General Engineering', 'Tier 2',       'Quote Response Time',             'working days',2, 3,   5,  10, 'lower_better', 'From RFQ receipt to formal quotation'),
  ('Automotive OEM',      'Tier 1',       'Quote Response Time',             'working days',1, 2,   3,   5, 'lower_better', 'Rapid response critical for design iteration'),
  ('General Engineering', 'Job Shop',     'Quote Response Time',             'working days',3, 5,   7,  14, 'lower_better', NULL),
  ('General Engineering', 'Tier 2',       'Engineering Change Response',     'working days',2, 3,   5,   7, 'lower_better', 'Time to confirm ECR impact + revised pricing'),
  ('General Engineering', 'Tier 2',       'NCR Response Time',               'working days',1, 2,   3,   5, 'lower_better', 'Non-conformance report initial response'),

  -- ── Capacity & Lead Time ──────────────────────────────────────────────────
  ('General Engineering', 'Tier 2',       'Standard Lead Time (machining)',   'weeks',   2,  4,   6,  10, 'lower_better', 'From PO to despatch; 1-50 parts'),
  ('Automotive OEM',      'Tier 1',       'Standard Lead Time (stamping)',    'weeks',   1,  2,   3,   5, 'lower_better', 'High-volume; dedicated lines'),
  ('Aerospace',           'Tier 1',       'Standard Lead Time (casting)',     'weeks',   8, 12,  18,  26, 'lower_better', 'Investment casting or forging'),
  ('General Engineering', 'Job Shop',     'Standard Lead Time (sheet metal)', 'weeks',   1,  2,   3,   5, 'lower_better', NULL),
  ('General Engineering', 'Tier 2',       'Capacity Headroom Available',      '%',      30, 20,  10,   5, 'higher_better','Spare capacity for demand spikes'),

  -- ── Financial Health ──────────────────────────────────────────────────────
  ('General Engineering', 'Tier 2',       'Payment Terms Offered',           'net days', 60, 45,  30,  15, 'higher_better','Longer terms = better working capital for buyer'),
  ('General Engineering', 'Tier 2',       'Price Competitiveness (vs market)','% vs benchmark',0,-5,-10,-20,'lower_better','% above or below market benchmark price'),
  ('General Engineering', 'Tier 2',       'Annual Price Reduction Target',    '%/yr',   -3, -2,  -1,   0, 'lower_better','Continuous improvement expectation'),

  -- ── Risk & Compliance ─────────────────────────────────────────────────────
  ('General Engineering', 'Tier 2',       'Supplier Risk Score',             '1-10',     1,  3,   5,   8, 'lower_better','1=low risk; 10=critical risk; single source + no alternatives = high'),
  ('Automotive OEM',      'Tier 1',       'IATF 16949 Certification',        'boolean',  1,  1,   0,   0, 'higher_better','Mandatory for most OEM Tier-1 supply'),
  ('Aerospace',           'Tier 1',       'AS9100 Rev D Certification',      'boolean',  1,  1,   0,   0, 'higher_better','Required for aerospace supply chain'),
  ('Medical Device',      'Tier 2',       'ISO 13485 Certification',         'boolean',  1,  1,   0,   0, 'higher_better','Mandatory for medical device components'),
  ('General Engineering', 'Tier 2',       'ISO 9001 Certification',          'boolean',  1,  1,   0,   0, 'higher_better','Minimum quality system expectation')

ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- SEED: 5. COMMODITY PRICE HISTORY  (quarterly spot prices 2021-2024)
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO commodity_price_history
  (commodity_name, commodity_code, exchange, price_date, price_usd_per_tonne, notes)
VALUES
  -- ── LME Aluminium (USD/tonne) ─────────────────────────────────────────────
  ('LME Aluminium',  'LME_AL', 'LME', '2021-01-01',  1985, '3-month cash settlement avg'),
  ('LME Aluminium',  'LME_AL', 'LME', '2021-04-01',  2290, NULL),
  ('LME Aluminium',  'LME_AL', 'LME', '2021-07-01',  2490, NULL),
  ('LME Aluminium',  'LME_AL', 'LME', '2021-10-01',  2900, 'Energy crisis drives Al higher'),
  ('LME Aluminium',  'LME_AL', 'LME', '2022-01-01',  3050, NULL),
  ('LME Aluminium',  'LME_AL', 'LME', '2022-03-07',  3850, 'Ukraine war peak — supply shock'),
  ('LME Aluminium',  'LME_AL', 'LME', '2022-07-01',  2510, 'Correction; demand concerns'),
  ('LME Aluminium',  'LME_AL', 'LME', '2022-10-01',  2210, NULL),
  ('LME Aluminium',  'LME_AL', 'LME', '2023-01-01',  2350, NULL),
  ('LME Aluminium',  'LME_AL', 'LME', '2023-04-01',  2390, NULL),
  ('LME Aluminium',  'LME_AL', 'LME', '2023-07-01',  2200, NULL),
  ('LME Aluminium',  'LME_AL', 'LME', '2023-10-01',  2170, NULL),
  ('LME Aluminium',  'LME_AL', 'LME', '2024-01-01',  2220, NULL),
  ('LME Aluminium',  'LME_AL', 'LME', '2024-04-01',  2580, 'Supply tightness + China demand'),
  ('LME Aluminium',  'LME_AL', 'LME', '2024-07-01',  2430, NULL),
  ('LME Aluminium',  'LME_AL', 'LME', '2024-10-01',  2610, NULL),

  -- ── LME Copper (USD/tonne) ────────────────────────────────────────────────
  ('LME Copper',     'LME_CU', 'LME', '2021-01-01',  7730, NULL),
  ('LME Copper',     'LME_CU', 'LME', '2021-04-01',  9380, NULL),
  ('LME Copper',     'LME_CU', 'LME', '2021-07-01',  9440, NULL),
  ('LME Copper',     'LME_CU', 'LME', '2021-10-01',  9700, NULL),
  ('LME Copper',     'LME_CU', 'LME', '2022-01-01',  9760, NULL),
  ('LME Copper',     'LME_CU', 'LME', '2022-03-07', 10700, 'Ukraine war peak'),
  ('LME Copper',     'LME_CU', 'LME', '2022-07-01',  7590, 'Fed rate hike = recession fear'),
  ('LME Copper',     'LME_CU', 'LME', '2022-10-01',  7550, NULL),
  ('LME Copper',     'LME_CU', 'LME', '2023-01-01',  8380, 'China reopening optimism'),
  ('LME Copper',     'LME_CU', 'LME', '2023-04-01',  8760, NULL),
  ('LME Copper',     'LME_CU', 'LME', '2023-07-01',  8420, NULL),
  ('LME Copper',     'LME_CU', 'LME', '2023-10-01',  8120, NULL),
  ('LME Copper',     'LME_CU', 'LME', '2024-01-01',  8560, NULL),
  ('LME Copper',     'LME_CU', 'LME', '2024-05-20', 11000, 'Supply squeeze + green energy demand peak'),
  ('LME Copper',     'LME_CU', 'LME', '2024-07-01',  9400, 'Correction from peak'),
  ('LME Copper',     'LME_CU', 'LME', '2024-10-01',  9750, NULL),

  -- ── LME Nickel (USD/tonne) ────────────────────────────────────────────────
  ('LME Nickel',     'LME_NI', 'LME', '2021-01-01', 16550, NULL),
  ('LME Nickel',     'LME_NI', 'LME', '2021-04-01', 16200, NULL),
  ('LME Nickel',     'LME_NI', 'LME', '2021-10-01', 19800, 'EV battery demand narrative'),
  ('LME Nickel',     'LME_NI', 'LME', '2022-01-01', 22200, NULL),
  ('LME Nickel',     'LME_NI', 'LME', '2022-03-08',101000, 'Short squeeze — LME halted trading'),
  ('LME Nickel',     'LME_NI', 'LME', '2022-04-01', 32000, 'Post-squeeze normalisation'),
  ('LME Nickel',     'LME_NI', 'LME', '2022-07-01', 23500, NULL),
  ('LME Nickel',     'LME_NI', 'LME', '2022-10-01', 22800, NULL),
  ('LME Nickel',     'LME_NI', 'LME', '2023-01-01', 28000, NULL),
  ('LME Nickel',     'LME_NI', 'LME', '2023-04-01', 24500, NULL),
  ('LME Nickel',     'LME_NI', 'LME', '2023-07-01', 20000, 'Indonesian supply surplus'),
  ('LME Nickel',     'LME_NI', 'LME', '2023-10-01', 17500, NULL),
  ('LME Nickel',     'LME_NI', 'LME', '2024-01-01', 15500, NULL),
  ('LME Nickel',     'LME_NI', 'LME', '2024-04-01', 18200, NULL),
  ('LME Nickel',     'LME_NI', 'LME', '2024-07-01', 16800, NULL),
  ('LME Nickel',     'LME_NI', 'LME', '2024-10-01', 15900, NULL),

  -- ── Steel HRC (Hot-Rolled Coil, USD/tonne — Platts CIS export) ────────────
  ('Steel HRC',      'STL_HRC','Platts','2021-01-01',  590, 'CIS export FOB Black Sea'),
  ('Steel HRC',      'STL_HRC','Platts','2021-04-01',  770, NULL),
  ('Steel HRC',      'STL_HRC','Platts','2021-07-01',  920, 'Post-COVID demand surge peak'),
  ('Steel HRC',      'STL_HRC','Platts','2021-10-01',  850, NULL),
  ('Steel HRC',      'STL_HRC','Platts','2022-01-01', 1020, NULL),
  ('Steel HRC',      'STL_HRC','Platts','2022-04-01', 1180, 'Ukraine war — CIS supply disrupted'),
  ('Steel HRC',      'STL_HRC','Platts','2022-07-01',  790, 'Rapid correction; demand fears'),
  ('Steel HRC',      'STL_HRC','Platts','2022-10-01',  620, NULL),
  ('Steel HRC',      'STL_HRC','Platts','2023-01-01',  640, NULL),
  ('Steel HRC',      'STL_HRC','Platts','2023-04-01',  680, NULL),
  ('Steel HRC',      'STL_HRC','Platts','2023-07-01',  650, 'China overcapacity; export pressure'),
  ('Steel HRC',      'STL_HRC','Platts','2023-10-01',  580, NULL),
  ('Steel HRC',      'STL_HRC','Platts','2024-01-01',  620, NULL),
  ('Steel HRC',      'STL_HRC','Platts','2024-04-01',  680, NULL),
  ('Steel HRC',      'STL_HRC','Platts','2024-07-01',  590, NULL),
  ('Steel HRC',      'STL_HRC','Platts','2024-10-01',  550, 'China demand weak; export dumping concern'),

  -- ── LME Zinc (USD/tonne) ─────────────────────────────────────────────────
  ('LME Zinc',       'LME_ZN', 'LME', '2021-01-01',  2700, 'Galvanising + die casting demand'),
  ('LME Zinc',       'LME_ZN', 'LME', '2022-01-01',  3530, NULL),
  ('LME Zinc',       'LME_ZN', 'LME', '2022-10-01',  2880, NULL),
  ('LME Zinc',       'LME_ZN', 'LME', '2023-04-01',  2800, NULL),
  ('LME Zinc',       'LME_ZN', 'LME', '2023-10-01',  2450, NULL),
  ('LME Zinc',       'LME_ZN', 'LME', '2024-01-01',  2550, NULL),
  ('LME Zinc',       'LME_ZN', 'LME', '2024-07-01',  2750, NULL),
  ('LME Zinc',       'LME_ZN', 'LME', '2024-10-01',  3050, 'Mine supply tightness'),

  -- ── Titanium Sponge (USD/tonne — Platts) ──────────────────────────────────
  ('Titanium Sponge','TI_SPG', 'Platts','2021-01-01', 10500, 'Aerospace demand recovery'),
  ('Titanium Sponge','TI_SPG', 'Platts','2022-01-01', 11800, NULL),
  ('Titanium Sponge','TI_SPG', 'Platts','2022-07-01', 13500, 'Russia supply sanctions (VSMPO)'),
  ('Titanium Sponge','TI_SPG', 'Platts','2023-01-01', 13000, 'Supply chain diversification ongoing'),
  ('Titanium Sponge','TI_SPG', 'Platts','2023-07-01', 12500, NULL),
  ('Titanium Sponge','TI_SPG', 'Platts','2024-01-01', 12800, NULL),
  ('Titanium Sponge','TI_SPG', 'Platts','2024-07-01', 13200, 'Aerospace delivery backlog keeps demand firm'),

  -- ── PP Resin (USD/tonne — Chemical Data / ICIS) ───────────────────────────
  ('PP Homopolymer Resin','PP_HOMO','ICIS','2021-01-01', 1150, 'Asia contract price'),
  ('PP Homopolymer Resin','PP_HOMO','ICIS','2021-07-01', 1580, 'Post-COVID supply crunch'),
  ('PP Homopolymer Resin','PP_HOMO','ICIS','2022-01-01', 1450, NULL),
  ('PP Homopolymer Resin','PP_HOMO','ICIS','2022-07-01', 1280, NULL),
  ('PP Homopolymer Resin','PP_HOMO','ICIS','2023-01-01', 1080, 'Feedstock propylene falls'),
  ('PP Homopolymer Resin','PP_HOMO','ICIS','2023-07-01', 1050, NULL),
  ('PP Homopolymer Resin','PP_HOMO','ICIS','2024-01-01', 1100, NULL),
  ('PP Homopolymer Resin','PP_HOMO','ICIS','2024-07-01', 1150, NULL),

  -- ── ABS Resin (USD/tonne — ICIS Asia) ────────────────────────────────────
  ('ABS Resin',      'ABS_RESIN','ICIS','2021-01-01', 1850, NULL),
  ('ABS Resin',      'ABS_RESIN','ICIS','2021-07-01', 2400, 'Butadiene spike'),
  ('ABS Resin',      'ABS_RESIN','ICIS','2022-01-01', 2100, NULL),
  ('ABS Resin',      'ABS_RESIN','ICIS','2022-07-01', 1750, NULL),
  ('ABS Resin',      'ABS_RESIN','ICIS','2023-01-01', 1650, NULL),
  ('ABS Resin',      'ABS_RESIN','ICIS','2023-07-01', 1600, NULL),
  ('ABS Resin',      'ABS_RESIN','ICIS','2024-01-01', 1700, NULL),
  ('ABS Resin',      'ABS_RESIN','ICIS','2024-07-01', 1750, NULL)

ON CONFLICT (commodity_code, price_date) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r_compat   INTEGER;
  r_fcr      INTEGER;
  r_dfm      INTEGER;
  r_kpi      INTEGER;
  r_spr      INTEGER;
  r_commodity INTEGER;
BEGIN
  SELECT COUNT(*) INTO r_compat    FROM material_process_compatibility;
  SELECT COUNT(*) INTO r_fcr       FROM feature_cost_rules;
  SELECT COUNT(*) INTO r_dfm       FROM dfm_rules_library;
  SELECT COUNT(*) INTO r_kpi       FROM supplier_kpi_benchmarks;
  SELECT COUNT(*) INTO r_spr       FROM supplier_performance_records;
  SELECT COUNT(*) INTO r_commodity FROM commodity_price_history;

  RAISE NOTICE '=== Migration 164 — Manufacturing Intelligence Platform ===';
  RAISE NOTICE 'material_process_compatibility:  % rows', r_compat;
  RAISE NOTICE 'feature_cost_rules:              % rows', r_fcr;
  RAISE NOTICE 'dfm_rules_library:               % rows', r_dfm;
  RAISE NOTICE 'supplier_kpi_benchmarks:         % rows', r_kpi;
  RAISE NOTICE 'supplier_performance_records:    % rows (user data)', r_spr;
  RAISE NOTICE 'commodity_price_history:         % rows', r_commodity;
  RAISE NOTICE '=========================================================';
END $$;
