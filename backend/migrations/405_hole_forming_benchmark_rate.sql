-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 405: Hole Extrusion (Burring) — real benchmark MHR rate (2026-08-05)
--
-- Migration 404 gave "Hole Extrusion (Burring)" a real process identity. This
-- migration gives its machine_class ('hole_forming' — see default-rates.ts's
-- MACHINE_REGISTRY) a real machine hour rate, so it stops showing $0/hr +
-- "Manual rate — not linked to a machine".
--
-- Research: no shop in mhr_records has a machine tagged for hole-forming yet,
-- and no reference file (memory/database/Combined_All_Countries_Database.json,
-- memory/sheetmetal/*.md) prices a dedicated hole-flanging/burring machine —
-- confirmed via keyword search when this feature was first built. Rather than
-- fabricate a number, this seeds mhr_benchmark_rates with the SAME real,
-- existing "CNC Turret Punch" benchmark figures already in migration 361,
-- under a machine_name that resolves to 'hole_forming' (not 'turret_punch') via
-- MACHINE_REGISTRY's keyword matching. This is an explicitly-labeled proxy, not
-- a new invented rate: hole-flanging/burring dies are a standard turret-punch
-- tool station in real shops (Amada/Trumpf/Murata tooling catalogs), so a
-- turret punch's real, in-use rate is the most defensible stand-in until a shop
-- adds its own actual hole-forming machine to mhr_records — which would then
-- take priority automatically (real DB row > benchmark > no_db_rate, unchanged).
--
-- machine_name deliberately avoids "Turret"/"Punch" so this benchmark resolves
-- ONLY into 'hole_forming's bucket, not also into 'turret_punch's (see
-- resolveMHRRates()'s per-class keyword bucketing in bom-items.service.ts).
-- ════════════════════════════════════════════════════════════════════════════════

INSERT INTO mhr_benchmark_rates (machine_name, process_group, location, mhr_usd, machine_ref) VALUES
('Hole Flanging / Burring Station', 'Sheet Metal', 'USA',        84.00, 'Proxy: CNC Turret Punch benchmark (migration 361) — Amada EM-3612 NT'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'UK',         73.00, 'Proxy: CNC Turret Punch benchmark (migration 361) — Trumpf TruPunch 3000'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'Germany',    88.00, 'Proxy: CNC Turret Punch benchmark (migration 361) — Trumpf TruPunch 5000'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'France',     78.00, 'Proxy: CNC Turret Punch benchmark (migration 361) — Amada EM-3612 NT'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'W. Europe',  80.00, 'Proxy: CNC Turret Punch benchmark (migration 361) — Amada EM-3612 NT'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'E. Europe',  38.00, 'Proxy: CNC Turret Punch benchmark (migration 361) — Trumpf TruPunch 3000'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'China',      20.00, 'Proxy: CNC Turret Punch benchmark (migration 361) — Amada EM-2510'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'India',      11.00, 'Proxy: CNC Turret Punch benchmark (migration 361) — Amada EM-2510'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'Vietnam',    16.00, 'Proxy: CNC Turret Punch benchmark (migration 361) — Amada EM-2510'),
('Hole Flanging / Burring Station', 'Sheet Metal', 'Mexico',     30.00, 'Proxy: CNC Turret Punch benchmark (migration 361) — Trumpf TruPunch 3000')
ON CONFLICT (machine_name, process_group, location) DO NOTHING;

-- ── Verification ───────────────────────────────────────────────────────────────
-- SELECT machine_name, location, mhr_usd, machine_ref FROM mhr_benchmark_rates
--   WHERE machine_name = 'Hole Flanging / Burring Station' ORDER BY location;
