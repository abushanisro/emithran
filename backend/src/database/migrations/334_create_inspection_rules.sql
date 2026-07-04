-- Migration 334: inspection_rules — DB-backed GD&T → inspection-method selection
--
-- Layer-1 move (aPriori-style data layer): the tolerance→method matrix that
-- lived only in backend/src/modules/bom-items/costing/gdt-severity.ts becomes
-- data. The code matrix stays as the fallback when this table is empty or
-- unreachable — costing must never fail because a KB read failed.
--
-- Matching semantics (see resolveInspectionRule in gdt-severity.ts):
--   rules for the callout's normalized symbol (or '*' catch-all), sorted by
--   tol_max_mm ascending; first band where tolerance <= tol_max_mm wins.
--   tol_max_mm = 1e9 marks the unbounded loose band so every tolerance matches.

CREATE TABLE IF NOT EXISTS inspection_rules (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gdt_symbol             TEXT NOT NULL,           -- 'position', 'flatness', ... or '*'
  tol_max_mm             NUMERIC NOT NULL,        -- band upper bound (inclusive)
  severity               TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  inspection_method      TEXT NOT NULL CHECK (inspection_method IN ('visual','caliper','height_gauge','cmm')),
  inspection_time_min    NUMERIC NOT NULL,
  cost_impact_percent    NUMERIC NOT NULL DEFAULT 0,
  cost_impact_range      TEXT NOT NULL DEFAULT '',
  reason_codes           TEXT[] NOT NULL DEFAULT '{}',
  manufacturing_actions  TEXT[] NOT NULL DEFAULT '{}',
  is_system              BOOLEAN NOT NULL DEFAULT true,
  owner_id               UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspection_rules_symbol ON inspection_rules (gdt_symbol, tol_max_mm);

ALTER TABLE inspection_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "ir_read" ON inspection_rules
    FOR SELECT USING (is_system = true OR owner_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "ir_insert" ON inspection_rules
    FOR INSERT WITH CHECK (owner_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "ir_update" ON inspection_rules
    FOR UPDATE USING (owner_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── System seed — mirrors the gdt-severity.ts matrix exactly ─────────────────
-- Times per method: visual 1, caliper 2, height_gauge 4, cmm 8 (INSPECTION_TIME_MIN).
-- Delete-and-reinsert of system rows only (318 pattern).

DELETE FROM inspection_rules WHERE is_system = true;

INSERT INTO inspection_rules
  (gdt_symbol, tol_max_mm, severity, inspection_method, inspection_time_min,
   cost_impact_percent, cost_impact_range, reason_codes, manufacturing_actions) VALUES
-- position
('position', 0.05, 'high',   'cmm',          8, 12, '+10–15%',
  '{TIGHT_POSITION,CMM_REQUIRED,DATUM_DEPENDENT,FIXTURE_RECOMMENDED}',
  '{"CMM inspection required","Dedicated fixture recommended","Process capability validation required"}'),
('position', 0.2,  'medium', 'cmm',          8,  6, '+4–8%',
  '{TIGHT_POSITION,CMM_REQUIRED,DATUM_DEPENDENT}',
  '{"CMM inspection required","First-article inspection recommended"}'),
('position', 1e9,  'low',    'height_gauge', 4,  2, '+1–3%', '{}',
  '{"Height gauge inspection sufficient"}'),
-- flatness
('flatness', 0.1,  'high',   'cmm',          8, 12, '+10–15%',
  '{TIGHT_FLATNESS,CMM_REQUIRED,SURFACE_VERIFICATION_REQUIRED}',
  '{"Surface verification required","Datum-controlled inspection required"}'),
('flatness', 0.5,  'medium', 'height_gauge', 4,  6, '+4–8%',
  '{TIGHT_FLATNESS,SURFACE_VERIFICATION_REQUIRED}',
  '{"Height gauge inspection required","First-article inspection recommended"}'),
('flatness', 1e9,  'low',    'caliper',      2,  2, '+1–3%', '{}',
  '{"Caliper or visual inspection sufficient"}'),
-- parallelism
('parallelism', 0.05, 'high',   'cmm',          8, 12, '+10–15%',
  '{TIGHT_PARALLELISM,CMM_REQUIRED,DATUM_DEPENDENT}',
  '{"CMM inspection required","Datum-controlled setup required"}'),
('parallelism', 0.3,  'medium', 'height_gauge', 4,  6, '+4–8%',
  '{TIGHT_PARALLELISM,DATUM_DEPENDENT}',
  '{"Height gauge inspection required","First-article inspection recommended"}'),
('parallelism', 1e9,  'low',    'caliper',      2,  2, '+1–3%', '{}',
  '{"Caliper inspection sufficient"}'),
-- perpendicularity
('perpendicularity', 0.05, 'high',   'cmm',          8, 12, '+10–15%',
  '{TIGHT_PERPENDICULARITY,CMM_REQUIRED,DATUM_DEPENDENT}',
  '{"CMM inspection required","Datum-controlled setup required"}'),
('perpendicularity', 0.3,  'medium', 'height_gauge', 4,  6, '+4–8%',
  '{TIGHT_PERPENDICULARITY,DATUM_DEPENDENT}',
  '{"Height gauge inspection required","First-article inspection recommended"}'),
('perpendicularity', 1e9,  'low',    'caliper',      2,  2, '+1–3%', '{}',
  '{"Caliper inspection sufficient"}'),
-- profile (covers profile_line / profile_surface via symbol normalization)
('profile', 0.1,  'high',   'cmm',          8, 12, '+10–15%',
  '{TIGHT_PROFILE,CMM_REQUIRED,DATUM_DEPENDENT}',
  '{"CMM inspection required","Profile scanning fixture required"}'),
('profile', 0.5,  'medium', 'cmm',          8,  6, '+4–8%',
  '{TIGHT_PROFILE,CMM_REQUIRED}',
  '{"CMM inspection required","First-article inspection recommended"}'),
('profile', 1e9,  'low',    'height_gauge', 4,  2, '+1–3%', '{}',
  '{"Height gauge inspection sufficient"}'),
-- runout (covers total_runout / concentricity via symbol normalization)
('runout', 0.02, 'high',   'cmm',          8, 12, '+10–15%',
  '{TIGHT_RUNOUT,CMM_REQUIRED}',
  '{"CMM inspection required","Dynamic balancing check recommended"}'),
('runout', 0.1,  'medium', 'height_gauge', 4,  6, '+4–8%',
  '{TIGHT_RUNOUT}',
  '{"Height gauge / dial indicator required","First-article inspection recommended"}'),
('runout', 1e9,  'low',    'caliper',      2,  2, '+1–3%', '{}',
  '{"Caliper or dial indicator inspection sufficient"}'),
-- straightness
('straightness', 0.1,  'high',   'height_gauge', 4, 12, '+10–15%',
  '{TIGHT_STRAIGHTNESS,SURFACE_VERIFICATION_REQUIRED}',
  '{"Height gauge inspection required","Straightedge verification required"}'),
('straightness', 0.5,  'medium', 'caliper',      2,  6, '+4–8%',
  '{TIGHT_STRAIGHTNESS}',
  '{"Caliper inspection required","First-article inspection recommended"}'),
('straightness', 1e9,  'low',    'visual',       1,  2, '+1–3%', '{}',
  '{"Visual inspection sufficient"}'),
-- circularity / cylindricity
('circularity', 0.02, 'high',   'cmm',     8, 12, '+10–15%',
  '{TIGHT_FORM,CMM_REQUIRED}',
  '{"CMM inspection required","Roundness measurement required"}'),
('circularity', 0.1,  'medium', 'caliper', 2,  6, '+4–8%',
  '{TIGHT_FORM}',
  '{"Caliper measurement required","First-article inspection recommended"}'),
('circularity', 1e9,  'low',    'visual',  1,  2, '+1–3%', '{}',
  '{"Visual inspection sufficient"}'),
('cylindricity', 0.02, 'high',   'cmm',     8, 12, '+10–15%',
  '{TIGHT_FORM,CMM_REQUIRED}',
  '{"CMM inspection required","Roundness measurement required"}'),
('cylindricity', 0.1,  'medium', 'caliper', 2,  6, '+4–8%',
  '{TIGHT_FORM}',
  '{"Caliper measurement required","First-article inspection recommended"}'),
('cylindricity', 1e9,  'low',    'visual',  1,  2, '+1–3%', '{}',
  '{"Visual inspection sufficient"}'),
-- angularity
('angularity', 0.1,  'high',   'cmm',          8, 12, '+10–15%',
  '{TIGHT_ANGULARITY,CMM_REQUIRED,DATUM_DEPENDENT}',
  '{"CMM inspection required","Angle gauge or sine bar required"}'),
('angularity', 0.5,  'medium', 'height_gauge', 4,  6, '+4–8%',
  '{TIGHT_ANGULARITY,DATUM_DEPENDENT}',
  '{"Height gauge inspection required","First-article inspection recommended"}'),
('angularity', 1e9,  'low',    'caliper',      2,  2, '+1–3%', '{}',
  '{"Caliper inspection sufficient"}'),
-- catch-all for unknown symbols
('*', 0.1, 'medium', 'caliper', 2, 6, '+4–8%', '{UNKNOWN_TYPE}',
  '{"Caliper inspection recommended","Verify tolerance type with engineering"}'),
('*', 1e9, 'low',    'visual',  1, 2, '+1–3%', '{UNKNOWN_TYPE}',
  '{"Visual inspection — verify tolerance type with engineering"}');
