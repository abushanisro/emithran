-- Migration 335: quality_plans — named inspection sampling policies (aPriori-style)
--
-- Customer quality requirements (AS9100, PPAP, ...) change inspection cost via
-- sampling, not via the measurement physics. A plan bundles the three stages:
--   FAI (first article, full measurement, once per batch)
--   in-process (1 of every N, full measurement)
--   final check (1 of every N, short visual/gauge check before pack)
--
-- Selected per BOM item via bom_items.validation_config.inspection.qualityPlan
-- (plan_key). No selection → INSPECTION_SAMPLING_DEFAULT in code ('general').

CREATE TABLE IF NOT EXISTS quality_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key          TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  fai               BOOLEAN NOT NULL DEFAULT true,
  in_process_per_n  INT NOT NULL CHECK (in_process_per_n >= 1),
  final_per_n       INT NOT NULL CHECK (final_per_n >= 1),
  final_check_min   NUMERIC NOT NULL,
  description       TEXT,
  is_system         BOOLEAN NOT NULL DEFAULT true,
  owner_id          UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE quality_plans ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "qp_read" ON quality_plans
    FOR SELECT USING (is_system = true OR owner_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "qp_insert" ON quality_plans
    FOR INSERT WITH CHECK (owner_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "qp_update" ON quality_plans
    FOR UPDATE USING (owner_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── System seed (delete-and-reinsert, system rows only) ─────────────────────

DELETE FROM quality_plans WHERE is_system = true;

INSERT INTO quality_plans
  (plan_key, display_name, fai, in_process_per_n, final_per_n, final_check_min, description) VALUES
('general',  'General Job Shop',      true, 10, 25, 2,
 'Default commercial machining: FAI + 1-per-10 in-process measurement + 1-per-25 final visual/gauge check'),
('as9100',   'Aerospace AS9100',      true, 20, 25, 3,
 'FAI (AS9102-style full measurement) + 5% in-process sampling + documented final check'),
('ppap_l3',  'Automotive PPAP L3',    true, 10,  1, 1,
 'FAI + 1-per-10 in-process measurement + 100% final visual check before pack'),
('full_cmm', 'Critical — 100% CMM',   true,  1,  1, 2,
 'Safety/critical characteristics: every part fully measured + final check');
