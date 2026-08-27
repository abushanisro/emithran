-- ============================================================================
-- Migration 417: lhr_wage_benchmarks — Indian standard labour-grade wage
-- benchmarks, moved from code into a real, admin-editable table.
-- ============================================================================
-- Root cause: LHRService.importFromExcel's GRADE_DEFAULTS constant (an
-- 8-row, hardcoded Indian wage table by labour grade) is used to
-- auto-generate real lhr_records rows whenever an uploaded Excel workbook's
-- REF_SKILL_LEVELS sheet has grade+role data but no explicit wage column.
-- The generated rows are then used, indistinguishable from admin-entered
-- real data, in every downstream DLR/QAIR lookup — with the actual wage
-- table buried in code, un-editable and unauditable without a deploy.
--
-- This migration does not introduce new wage data: it moves the existing
-- 8 grade rows (sourced, per the pre-existing in-code comment, from
-- "lhr-db.csv" — Indian standard wages, 281 days x 1 shift x 8 hrs =
-- 2248 hrs/year) into a real table, seeded with the exact same values, so a
-- shop/admin can correct them from real local wage data without a deploy.
-- The code now queries this table at import time and falls back to the same
-- hardcoded values (disclosed via the import's returned `errors` array,
-- never silently) only if the table is ever emptied.
-- ============================================================================

CREATE TABLE IF NOT EXISTS lhr_wage_benchmarks (
    id              SERIAL PRIMARY KEY,
    grade           VARCHAR(10) NOT NULL,          -- eMithran-style labour grade, e.g. '1','3','5','7','9','11','13'
    labour_type     VARCHAR(30) NOT NULL,          -- 'Unskilled'|'Semi-Skilled'|'Skilled'|'Highly Skilled'
    wage_per_day    NUMERIC NOT NULL,
    wage_per_month  NUMERIC NOT NULL,
    dearness_allowance NUMERIC NOT NULL DEFAULT 0,
    perks_pct       NUMERIC NOT NULL DEFAULT 0,
    location        VARCHAR(60) NOT NULL DEFAULT 'India - Manufacturing Standard',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS lhr_wage_benchmarks_grade_location ON lhr_wage_benchmarks(grade, location);

ALTER TABLE lhr_wage_benchmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read" ON lhr_wage_benchmarks;
CREATE POLICY "Public read" ON lhr_wage_benchmarks FOR SELECT USING (true);

COMMENT ON TABLE lhr_wage_benchmarks IS 'Labour-grade wage benchmarks used to auto-generate lhr_records from a REF_SKILL_LEVELS Excel import with no explicit wage column — see migration 417; values migrated as-is from the prior in-code GRADE_DEFAULTS constant';

INSERT INTO lhr_wage_benchmarks (grade, labour_type, wage_per_day, wage_per_month, dearness_allowance, perks_pct) VALUES
  ('1',  'Unskilled',      500,   15000, 0, 30),
  ('2',  'Unskilled',      500,   15000, 0, 30),
  ('3',  'Semi-Skilled',   557.5, 16725, 0, 30),
  ('5',  'Skilled',        634.5, 19035, 0, 30),
  ('7',  'Skilled',        700,   21000, 0, 30),
  ('9',  'Highly Skilled', 800,   24000, 0, 30),
  ('11', 'Highly Skilled', 900,   27000, 0, 30),
  ('13', 'Highly Skilled', 1000,  30000, 0, 30)
ON CONFLICT (grade, location) DO NOTHING;

-- Verification:
-- SELECT grade, labour_type, wage_per_day, wage_per_month FROM lhr_wage_benchmarks ORDER BY grade::int;
-- Should return 8 rows.
