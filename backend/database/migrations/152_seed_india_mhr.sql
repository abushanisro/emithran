-- Migration 152: Seed India Machine Hour Rate (MHR) library
--
-- IMPORTANT: Run the ALTER TABLE block below in Supabase SQL editor FIRST (Part A),
-- then run the INSERT block (Part B). Or run this entire file — it is safe to run
-- the ALTERs again (IF NOT EXISTS). If migration 151 is already applied, the
-- country_code column already exists.
--
-- mhr_records is a cost-engineering calculator table. It requires:
--   landed_machine_cost > 0   (machine purchase / landed price, INR)
--   total_machine_hour_rate   (benchmark rate we override directly, INR/hr)
--
-- For benchmark seed rows we insert both: the landed_machine_cost is an
-- approximate India market price; the total_machine_hour_rate is our benchmark
-- rate. The per-component breakdown (depreciation, interest, etc.) is not
-- filled — this is correct for BENCHMARK-source records. Customer-specific rows
-- entered via the UI will have the full breakdown.

-- ──────────────────────────────────────────────────────────────────────────────
-- PART A — Add metadata columns (idempotent — safe to re-run)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS source_type    VARCHAR(20)  DEFAULT 'BENCHMARK',
  ADD COLUMN IF NOT EXISTS process_family VARCHAR(30)  NULL,
  ADD COLUMN IF NOT EXISTS industry       VARCHAR(50)  NULL,
  ADD COLUMN IF NOT EXISTS data_version   VARCHAR(20)  DEFAULT 'FY2025-26';

ALTER TABLE lsr_records
  ADD COLUMN IF NOT EXISTS labour_family  VARCHAR(30)  NULL,
  ADD COLUMN IF NOT EXISTS skill_level    SMALLINT     NULL;

ALTER TABLE raw_materials
  ADD COLUMN IF NOT EXISTS material_form   VARCHAR(30)  NULL,
  ADD COLUMN IF NOT EXISTS material_family VARCHAR(30)  NULL,
  ADD COLUMN IF NOT EXISTS price_source    VARCHAR(20)  DEFAULT 'BENCHMARK',
  ADD COLUMN IF NOT EXISTS price_version   VARCHAR(20)  DEFAULT 'Q1-2025';

-- Label existing Atulay/imported records so AI can distinguish source
UPDATE mhr_records
  SET source_type = 'ATULAY', data_version = 'FY2024-25'
  WHERE source_type IS NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- PART B — India MHR benchmark seed (43 machines)
--
-- landed_machine_cost = approximate India market purchase price (INR).
-- total_machine_hour_rate = benchmark INR/hr rate (directly set — this is the
--   number the AI uses for cost calculation and is the key ranking field).
-- All other cost-component columns use table defaults (shifts=3, hrs=8, etc.)
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO mhr_records
  (machine_name, machine_description, commodity_code,
   landed_machine_cost, total_machine_hour_rate,
   currency_code, country_code, location,
   source_type, process_family, industry, data_version)
VALUES

-- ── CNC TURNING ─────────────────────────────────────────────────────────────
('CNC Lathe - 2-Axis (Small, ⌀200×500L)',
 'Slant-bed 2-axis CNC lathe. Shafts, bushings, pins, small flanges.',
 'CNC-TURN-SM',    1800000,  1050, 'INR', 'IN', 'India',
 'BENCHMARK', 'cnc_turned', 'General Manufacturing', 'FY2025-26'),

('CNC Lathe - 2-Axis (Medium, ⌀300×750L)',
 'Medium-capacity slant-bed CNC lathe. Stepped components, sleeves, medium shafts.',
 'CNC-TURN-MD',    3000000,  1400, 'INR', 'IN', 'India',
 'BENCHMARK', 'cnc_turned', 'General Manufacturing', 'FY2025-26'),

('CNC Lathe - 2-Axis (Heavy Duty, ⌀500×1500L)',
 'Heavy-duty CNC lathe. Large-diameter rolls, spindles, heavy flanges.',
 'CNC-TURN-HD',    7500000,  2200, 'INR', 'IN', 'India',
 'BENCHMARK', 'cnc_turned', 'General Manufacturing', 'FY2025-26'),

('CNC Turn-Mill Center (Y-Axis, Live Tooling)',
 'Multi-tasking turn-mill with Y-axis. Reduces setups for complex rotational parts.',
 'CNC-TURNMILL',  18000000,  3200, 'INR', 'IN', 'India',
 'BENCHMARK', 'cnc_turned', 'Aerospace, Automotive', 'FY2025-26'),

('Swiss-Type CNC Lathe (Bar-Feed, ⌀32 max)',
 'Guide-bushing swiss lathe for small-diameter precision parts from bar stock.',
 'CNC-SWISS',     22000000,  3800, 'INR', 'IN', 'India',
 'BENCHMARK', 'cnc_turned', 'Aerospace, Medical', 'FY2025-26'),

('CNC Lathe - Twin Spindle (Sub-Spindle)',
 'Twin-spindle CNC lathe for complete machining in one chucking.',
 'CNC-TURN-TWIN', 14000000,  2600, 'INR', 'IN', 'India',
 'BENCHMARK', 'cnc_turned', 'Automotive, General Manufacturing', 'FY2025-26'),

-- ── CNC MILLING ─────────────────────────────────────────────────────────────
('VMC - 3-Axis BT40 (Table 800×500)',
 'Vertical machining center, BT40 spindle. Prismatic components, brackets, plates.',
 'CNC-VMC-SM',     6000000,  1850, 'INR', 'IN', 'India',
 'BENCHMARK', 'cnc_milled', 'General Manufacturing', 'FY2025-26'),

('VMC - 3-Axis BT50 (Table 1200×600)',
 'Vertical machining center, BT50 spindle. Large housings, fixtures, heavier cuts.',
 'CNC-VMC-MD',     9500000,  2600, 'INR', 'IN', 'India',
 'BENCHMARK', 'cnc_milled', 'General Manufacturing', 'FY2025-26'),

('VMC - 4-Axis (Rotary Table)',
 '4-axis VMC with integrated rotary table. Machines multiple faces in one setup.',
 'CNC-VMC-4AX',   16000000,  3500, 'INR', 'IN', 'India',
 'BENCHMARK', 'cnc_milled', 'Aerospace, Automotive', 'FY2025-26'),

('VMC - 5-Axis Simultaneous',
 '5-axis simultaneous machining center. Complex aerospace, medical, die components.',
 'CNC-VMC-5AX',   45000000,  6200, 'INR', 'IN', 'India',
 'BENCHMARK', 'cnc_milled', 'Aerospace, Defence, Medical', 'FY2025-26'),

('HMC - 4-Axis (Horizontal Machining Center)',
 'Horizontal MC, pallet changer. Large prismatic and box-type components.',
 'CNC-HMC-4AX',   28000000,  4800, 'INR', 'IN', 'India',
 'BENCHMARK', 'cnc_milled', 'Aerospace, Automotive', 'FY2025-26'),

('CNC Boring Mill (Floor Type)',
 'Floor-type boring mill. Large structural components, heavy housings.',
 'CNC-BORE',      20000000,  3800, 'INR', 'IN', 'India',
 'BENCHMARK', 'cnc_milled', 'Heavy Engineering', 'FY2025-26'),

('CNC Router - 3-Axis (2500×1300)',
 'Large-format CNC router. Aluminium sheet profiling, composite panels, non-metallic.',
 'CNC-ROUTER',     4000000,  1400, 'INR', 'IN', 'India',
 'BENCHMARK', 'cnc_milled', 'General Manufacturing', 'FY2025-26'),

-- ── SHEET METAL ─────────────────────────────────────────────────────────────
('Fiber Laser Cutter - 2kW (1500×3000)',
 '2kW fiber laser. MS up to 8mm, SS up to 5mm, Al up to 4mm.',
 'SM-LASER-2K',    7000000,  2400, 'INR', 'IN', 'India',
 'BENCHMARK', 'sheet_metal', 'General Manufacturing', 'FY2025-26'),

('Fiber Laser Cutter - 4kW (2000×4000)',
 '4kW fiber laser. MS up to 16mm, SS up to 10mm, Al up to 8mm.',
 'SM-LASER-4K',   13000000,  3500, 'INR', 'IN', 'India',
 'BENCHMARK', 'sheet_metal', 'General Manufacturing', 'FY2025-26'),

('Fiber Laser Cutter - 6kW (2000×6000)',
 '6kW fiber laser. Heavy plate. MS up to 25mm, SS up to 16mm.',
 'SM-LASER-6K',   22000000,  4800, 'INR', 'IN', 'India',
 'BENCHMARK', 'sheet_metal', 'Heavy Engineering, Defence', 'FY2025-26'),

('CO2 Laser Cutter (1500×3000)',
 'CO2 laser cutter. Non-metals, acrylic, plastics, thin metals.',
 'SM-LASER-CO2',   5500000,  1700, 'INR', 'IN', 'India',
 'BENCHMARK', 'sheet_metal', 'General Manufacturing', 'FY2025-26'),

('CNC Press Brake - 80 Ton (2500mm)',
 '80T hydraulic press brake. Light to medium sheet bending up to 2500mm.',
 'SM-BRAKE-80T',   3800000,   980, 'INR', 'IN', 'India',
 'BENCHMARK', 'sheet_metal', 'General Manufacturing', 'FY2025-26'),

('CNC Press Brake - 160 Ton (3200mm)',
 '160T press brake. Medium gauge sheet, bending up to 3200mm.',
 'SM-BRAKE-160T',  7000000,  1400, 'INR', 'IN', 'India',
 'BENCHMARK', 'sheet_metal', 'General Manufacturing', 'FY2025-26'),

('CNC Press Brake - 320 Ton (4000mm)',
 '320T press brake. Heavy plate forming and structural steel bending.',
 'SM-BRAKE-320T', 13000000,  2100, 'INR', 'IN', 'India',
 'BENCHMARK', 'sheet_metal', 'Heavy Engineering', 'FY2025-26'),

('Hydraulic Guillotine Shear (6mm × 3200mm)',
 'Guillotine shear for sheet up to 6mm × 3200mm width.',
 'SM-SHEAR-6',     2800000,   750, 'INR', 'IN', 'India',
 'BENCHMARK', 'sheet_metal', 'General Manufacturing', 'FY2025-26'),

('CNC Turret Punch Press',
 'CNC turret punch press with auto-index. Punching, nibbling, forming.',
 'SM-PUNCH-CNC',   5500000,  1350, 'INR', 'IN', 'India',
 'BENCHMARK', 'sheet_metal', 'General Manufacturing', 'FY2025-26'),

('Hydraulic Press - 100 Ton',
 'General-purpose 100T hydraulic press. Blanking, forming, straightening, assembly.',
 'SM-HPRESS-100',  3200000,  1100, 'INR', 'IN', 'India',
 'BENCHMARK', 'sheet_metal', 'General Manufacturing', 'FY2025-26'),

('Hydraulic Press - 250 Ton',
 '250T hydraulic press. Deep drawing, coining, heavy blanking.',
 'SM-HPRESS-250',  6500000,  1850, 'INR', 'IN', 'India',
 'BENCHMARK', 'sheet_metal', 'Automotive, General Manufacturing', 'FY2025-26'),

('CNC Roll Forming Line',
 'CNC roll forming for profiles, channels, tubes from coil strip.',
 'SM-ROLLFORM',    9000000,  2200, 'INR', 'IN', 'India',
 'BENCHMARK', 'sheet_metal', 'Automotive, Construction', 'FY2025-26'),

-- ── GRINDING ────────────────────────────────────────────────────────────────
('CNC Cylindrical Grinder (OD/ID)',
 'CNC cylindrical grinder. OD and ID grinding of shafts, bores, precision cylinders.',
 'GRIND-CYL',      4500000,  1700, 'INR', 'IN', 'India',
 'BENCHMARK', 'grinding', 'General Manufacturing', 'FY2025-26'),

('CNC Surface Grinder (600×300)',
 'Surface grinder. Flat grinding of plates, tools, precision components.',
 'GRIND-SURF',     2200000,  1250, 'INR', 'IN', 'India',
 'BENCHMARK', 'grinding', 'General Manufacturing', 'FY2025-26'),

('Centerless Grinder',
 'High-volume production of shafts, pins, cylindrical components.',
 'GRIND-CTLESS',   3500000,  1500, 'INR', 'IN', 'India',
 'BENCHMARK', 'grinding', 'Automotive, General Manufacturing', 'FY2025-26'),

('CNC Internal Grinder (ID)',
 'Internal grinding machine for bore finishing to tight tolerances.',
 'GRIND-ID',       5500000,  2000, 'INR', 'IN', 'India',
 'BENCHMARK', 'grinding', 'Aerospace, General Manufacturing', 'FY2025-26'),

-- ── WELDING ─────────────────────────────────────────────────────────────────
('MIG Welding Station (Semi-Auto)',
 'MIG/MAG welding for mild steel and SS fabrication. Machine rate only — add labour separately.',
 'WELD-MIG',        180000,   650, 'INR', 'IN', 'India',
 'BENCHMARK', 'welding', 'General Manufacturing', 'FY2025-26'),

('TIG Welding Station',
 'TIG/GTAW welding. Precision joins, thin materials, SS, aluminium. Machine rate only.',
 'WELD-TIG',        250000,   850, 'INR', 'IN', 'India',
 'BENCHMARK', 'welding', 'General Manufacturing, Aerospace', 'FY2025-26'),

('Spot Welding Machine',
 'Resistance spot welding for sheet metal assemblies.',
 'WELD-SPOT',       350000,   700, 'INR', 'IN', 'India',
 'BENCHMARK', 'welding', 'Automotive, General Manufacturing', 'FY2025-26'),

('Robotic MIG Welding Cell (6-Axis + Positioner)',
 '6-axis robotic MIG cell with positioner. High-volume repetitive weld sequences.',
 'WELD-ROBO-MIG',  9000000,  2500, 'INR', 'IN', 'India',
 'BENCHMARK', 'welding', 'Automotive, General Manufacturing', 'FY2025-26'),

('CNC Plasma Cutting Machine',
 'CNC plasma cutting. Thick plate up to 50mm MS at lower cost than laser.',
 'WELD-PLASMA',    2800000,  1200, 'INR', 'IN', 'India',
 'BENCHMARK', 'sheet_metal', 'Heavy Engineering, General Manufacturing', 'FY2025-26'),

-- ── EDM ─────────────────────────────────────────────────────────────────────
('Wire EDM (CNC)',
 'CNC wire-cut EDM. Complex profiles, dies, punch plates, hard material cutting.',
 'EDM-WIRE',       6500000,  2600, 'INR', 'IN', 'India',
 'BENCHMARK', 'edm', 'Tooling, Die-Mould', 'FY2025-26'),

('Die-Sink EDM (Ram EDM)',
 'Die-sink EDM. Cavities, ribs, complex 3D features in hardened steel.',
 'EDM-DIESINK',    4500000,  2100, 'INR', 'IN', 'India',
 'BENCHMARK', 'edm', 'Tooling, Die-Mould', 'FY2025-26'),

-- ── INJECTION MOULDING ───────────────────────────────────────────────────────
('Injection Moulding Machine - 100 Ton',
 'Small plastic components. Shot weight up to 200g.',
 'INJMOLD-100T',   4500000,  1900, 'INR', 'IN', 'India',
 'BENCHMARK', 'injection_moulding', 'General Manufacturing', 'FY2025-26'),

('Injection Moulding Machine - 250 Ton',
 'Medium components. Shot weight up to 600g.',
 'INJMOLD-250T',   9000000,  2900, 'INR', 'IN', 'India',
 'BENCHMARK', 'injection_moulding', 'General Manufacturing, Automotive', 'FY2025-26'),

('Injection Moulding Machine - 500 Ton',
 'Large structural parts. Shot weight up to 1500g.',
 'INJMOLD-500T',  20000000,  4800, 'INR', 'IN', 'India',
 'BENCHMARK', 'injection_moulding', 'Automotive, General Manufacturing', 'FY2025-26'),

-- ── SURFACE TREATMENT ────────────────────────────────────────────────────────
('Anodizing Line (Sulphuric / Hard Anodize)',
 'Aluminium anodizing. Sulphuric (Type II) and hard anodize (Type III). 200 kg/hr throughput.',
 'SURF-ANOD',      5500000,  1100, 'INR', 'IN', 'India',
 'BENCHMARK', 'surface_treatment', 'Aerospace, General Manufacturing', 'FY2025-26'),

('Electroplating Line (Zinc / Nickel)',
 'Barrel and rack plating. Zinc, nickel, chrome for corrosion protection.',
 'SURF-PLATE',     4500000,   950, 'INR', 'IN', 'India',
 'BENCHMARK', 'surface_treatment', 'Automotive, General Manufacturing', 'FY2025-26'),

('Powder Coating Line (Batch)',
 'Batch powder coating. Pre-treatment, application, curing oven.',
 'SURF-PWDCOAT',   2800000,   780, 'INR', 'IN', 'India',
 'BENCHMARK', 'surface_treatment', 'General Manufacturing', 'FY2025-26'),

('Heat Treatment Furnace (Batch)',
 'Batch heat treatment. Annealing, hardening, tempering, normalising.',
 'HEAT-TREAT',     2200000,   650, 'INR', 'IN', 'India',
 'BENCHMARK', 'surface_treatment', 'General Manufacturing', 'FY2025-26'),

('Black Oxide / Phosphating Line',
 'Chemical blackening and phosphating for mild steel corrosion protection.',
 'SURF-BLKOX',     1200000,   580, 'INR', 'IN', 'India',
 'BENCHMARK', 'surface_treatment', 'General Manufacturing', 'FY2025-26');
