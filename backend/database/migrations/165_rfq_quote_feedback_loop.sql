-- Migration 165: RFQ → Quote → Production Feedback Loop
--
-- These tables are the platform's proprietary moat. Every quote submitted,
-- every win/loss outcome, and every actual-vs-estimated variance trains the
-- should-cost engine to improve over time.
--
-- All tables are user-specific (user_id + RLS). No global seed data.
--
--   1. rfq_history              — incoming RFQs with part + process context
--   2. quote_line_items         — per-part cost breakdown inside a quote
--   3. quote_outcomes           — win/loss + quoted vs target price
--   4. actual_vs_estimated_cost — post-production variance (the learning loop)
--   5. bom_cost_snapshots       — assembly-level cost rollup header
--   6. assembly_cost_breakdown  — line-item BOM cost breakdown
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE CREATION
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. rfq_history — one row per incoming request for quotation
CREATE TABLE IF NOT EXISTS rfq_history (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rfq_number            TEXT,
  customer_name         TEXT,
  customer_industry     TEXT,
  rfq_date              DATE         NOT NULL DEFAULT CURRENT_DATE,
  required_by_date      DATE,
  part_name             TEXT         NOT NULL,
  part_number           TEXT,
  revision              TEXT,
  material_name         TEXT,
  material_grade        TEXT,
  process_group         TEXT,
  process_name          TEXT,
  annual_volume         INTEGER,
  rfq_quantity          INTEGER,
  drawing_available     BOOLEAN      DEFAULT FALSE,
  target_price_usd      NUMERIC(12,4),
  delivery_weeks        INTEGER,
  status                TEXT         NOT NULL DEFAULT 'Open',
    -- Open | Quoted | Won | Lost | No-bid | On Hold
  priority              TEXT         DEFAULT 'Normal',
    -- Low | Normal | High | Urgent
  source                TEXT,        -- Direct / Tender / Portal / Referral / Existing Customer
  notes                 TEXT,
  created_at            TIMESTAMPTZ  DEFAULT now(),
  updated_at            TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rfq_user       ON rfq_history (user_id, rfq_date DESC);
CREATE INDEX IF NOT EXISTS idx_rfq_status     ON rfq_history (user_id, status);
CREATE INDEX IF NOT EXISTS idx_rfq_customer   ON rfq_history (user_id, customer_name);

-- 2. quote_line_items — cost breakdown per part / operation within a quote
--    Multiple lines per rfq_history row (e.g., part + sub-operations + surface)
CREATE TABLE IF NOT EXISTS quote_line_items (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rfq_id                   UUID         NOT NULL REFERENCES rfq_history(id) ON DELETE CASCADE,
  line_number              INTEGER      NOT NULL DEFAULT 1,
  line_description         TEXT         NOT NULL,

  -- Cost components (all per-unit, USD)
  material_cost_usd        NUMERIC(12,4) DEFAULT 0,
  material_kg              NUMERIC(10,4),
  scrap_allowance_pct      NUMERIC(5,2),
  raw_material_kg          NUMERIC(10,4), -- = material_kg / (1 - scrap_pct/100)

  machining_time_min       NUMERIC(10,3),
  machine_rate_usd_hr      NUMERIC(8,2),
  machining_cost_usd       NUMERIC(12,4) DEFAULT 0,

  labour_time_min          NUMERIC(10,3),
  labour_rate_usd_hr       NUMERIC(8,2),
  labour_cost_usd          NUMERIC(12,4) DEFAULT 0,

  tooling_cost_usd         NUMERIC(12,4) DEFAULT 0,
  tooling_amortize_qty     INTEGER,      -- amortise over this many parts

  surface_finish_cost_usd  NUMERIC(12,4) DEFAULT 0,
  inspection_cost_usd      NUMERIC(12,4) DEFAULT 0,
  freight_cost_usd         NUMERIC(12,4) DEFAULT 0,

  overhead_pct             NUMERIC(5,2),
  overhead_cost_usd        NUMERIC(12,4) DEFAULT 0,

  total_cost_usd           NUMERIC(12,4) DEFAULT 0,
  margin_pct               NUMERIC(5,2),
  quoted_price_usd         NUMERIC(12,4),

  -- Which lookup tables were used to generate this line (audit trail)
  country_factor_applied   TEXT,
  overhead_profile_applied TEXT,
  scrap_rate_source        TEXT,
  cycle_time_source        TEXT,

  notes                    TEXT,
  created_at               TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qli_rfq ON quote_line_items (rfq_id);
CREATE INDEX IF NOT EXISTS idx_qli_user ON quote_line_items (user_id);

-- 3. quote_outcomes — win/loss result + market intelligence
CREATE TABLE IF NOT EXISTS quote_outcomes (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rfq_id                   UUID         NOT NULL REFERENCES rfq_history(id) ON DELETE CASCADE,
  quote_date               DATE         NOT NULL DEFAULT CURRENT_DATE,
  quote_number             TEXT,

  total_quoted_price_usd   NUMERIC(12,4),
  total_cost_usd           NUMERIC(12,4),
  gross_margin_pct         NUMERIC(5,2),
  customer_target_usd      NUMERIC(12,4),
  price_gap_pct            NUMERIC(7,2), -- (quoted - target) / target × 100

  outcome                  TEXT         NOT NULL DEFAULT 'Pending',
    -- Pending | Won | Lost | No-bid | Customer Cancelled | No Decision
  outcome_date             DATE,
  award_quantity           INTEGER,
  award_price_usd          NUMERIC(12,4),

  -- Loss intelligence
  loss_reason              TEXT,
    -- Price | Capacity | Technical Capability | Lead Time | Relationship |
    -- Quality Certification | Competitor | Specification Change | No Reason Given
  competitor_name          TEXT,
  competitor_price_usd     NUMERIC(12,4),
  price_to_win_usd         NUMERIC(12,4), -- what it would have taken to win

  -- Win intelligence
  key_win_factor           TEXT,
    -- Price | Lead Time | Quality | Relationship | Unique Capability | Service

  customer_feedback        TEXT,
  internal_notes           TEXT,
  follow_up_date           DATE,
  created_at               TIMESTAMPTZ  DEFAULT now(),
  updated_at               TIMESTAMPTZ  DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qo_rfq ON quote_outcomes (rfq_id);
CREATE INDEX IF NOT EXISTS idx_qo_user_outcome ON quote_outcomes (user_id, outcome, outcome_date DESC);

-- 4. actual_vs_estimated_cost — post-production variance (feeds the learning loop)
--    Fill this in after a won job completes production
CREATE TABLE IF NOT EXISTS actual_vs_estimated_cost (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rfq_id                      UUID         REFERENCES rfq_history(id) ON DELETE SET NULL,
  part_name                   TEXT         NOT NULL,
  part_number                 TEXT,
  production_date             DATE,
  production_quantity         INTEGER,
  process_name                TEXT,

  -- Material
  est_material_kg             NUMERIC(10,4),
  act_material_kg             NUMERIC(10,4),
  est_material_cost_usd       NUMERIC(12,4),
  act_material_cost_usd       NUMERIC(12,4),

  -- Scrap
  est_scrap_pct               NUMERIC(5,2),
  act_scrap_pct               NUMERIC(5,2),

  -- Cycle time
  est_cycle_time_min          NUMERIC(10,3),
  act_cycle_time_min          NUMERIC(10,3),

  -- Machine cost
  est_machining_cost_usd      NUMERIC(12,4),
  act_machining_cost_usd      NUMERIC(12,4),

  -- Labour
  est_labour_time_min         NUMERIC(10,3),
  act_labour_time_min         NUMERIC(10,3),
  est_labour_cost_usd         NUMERIC(12,4),
  act_labour_cost_usd         NUMERIC(12,4),

  -- Tooling
  est_tooling_cost_usd        NUMERIC(12,4),
  act_tooling_cost_usd        NUMERIC(12,4),

  -- Total
  est_total_cost_usd          NUMERIC(12,4),
  act_total_cost_usd          NUMERIC(12,4),
  total_variance_pct          NUMERIC(7,2)
    GENERATED ALWAYS AS (
      CASE WHEN est_total_cost_usd > 0
        THEN ROUND(((act_total_cost_usd - est_total_cost_usd) / est_total_cost_usd) * 100, 2)
        ELSE NULL
      END
    ) STORED,

  -- Root cause of variance
  variance_root_cause         TEXT,
    -- Material Price Change | Scrap Higher Than Estimated | Cycle Time Longer |
    -- Setup Time Underestimated | Rework | Tooling Failure | Operator Efficiency |
    -- Machine Breakdown | Design Change | Estimation Error
  corrective_action           TEXT,
  estimator_feedback          TEXT,
  created_at                  TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ave_user    ON actual_vs_estimated_cost (user_id, production_date DESC);
CREATE INDEX IF NOT EXISTS idx_ave_process ON actual_vs_estimated_cost (user_id, process_name);

-- 5. bom_cost_snapshots — assembly-level cost rollup header
CREATE TABLE IF NOT EXISTS bom_cost_snapshots (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_name         TEXT         NOT NULL,
  assembly_name         TEXT         NOT NULL,
  assembly_number       TEXT,
  revision              TEXT,
  snapshot_date         DATE         NOT NULL DEFAULT CURRENT_DATE,
  quantity              INTEGER      NOT NULL DEFAULT 1,
  country_of_manufacture TEXT,
  overhead_profile      TEXT,

  -- Rolled-up totals (auto-filled by app from line items)
  total_material_usd    NUMERIC(14,4) DEFAULT 0,
  total_machining_usd   NUMERIC(14,4) DEFAULT 0,
  total_labour_usd      NUMERIC(14,4) DEFAULT 0,
  total_tooling_usd     NUMERIC(14,4) DEFAULT 0,
  total_surface_usd     NUMERIC(14,4) DEFAULT 0,
  total_overhead_usd    NUMERIC(14,4) DEFAULT 0,
  total_freight_usd     NUMERIC(14,4) DEFAULT 0,
  total_cost_usd        NUMERIC(14,4) DEFAULT 0,
  cost_per_unit_usd     NUMERIC(14,4)
    GENERATED ALWAYS AS (
      CASE WHEN quantity > 0 THEN ROUND(total_cost_usd / quantity, 4) ELSE 0 END
    ) STORED,

  -- Comparison snapshot (for change tracking)
  baseline_snapshot_id  UUID         REFERENCES bom_cost_snapshots(id) ON DELETE SET NULL,
  change_vs_baseline_pct NUMERIC(7,2),

  status                TEXT         DEFAULT 'Draft',
    -- Draft | Under Review | Approved | Superseded
  notes                 TEXT,
  created_at            TIMESTAMPTZ  DEFAULT now(),
  updated_at            TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bcs_user     ON bom_cost_snapshots (user_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_bcs_assembly ON bom_cost_snapshots (user_id, assembly_number);

-- 6. assembly_cost_breakdown — line-item detail under each snapshot
CREATE TABLE IF NOT EXISTS assembly_cost_breakdown (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_id              UUID         NOT NULL REFERENCES bom_cost_snapshots(id) ON DELETE CASCADE,
  bom_level                INTEGER      NOT NULL DEFAULT 1,  -- 1 = top-level, 2 = sub-asm, 3 = purchased
  line_number              INTEGER      NOT NULL,
  parent_line_number       INTEGER,     -- NULL for top-level; points to parent line for sub-items

  part_name                TEXT         NOT NULL,
  part_number              TEXT,
  revision                 TEXT,
  item_type                TEXT,
    -- Manufactured | Purchased | Sub-Assembly | Raw Material | Fastener | Consumable

  qty_per_assembly         NUMERIC(10,4) NOT NULL DEFAULT 1,

  -- For manufactured parts
  material_name            TEXT,
  process_group            TEXT,
  process_name             TEXT,
  country_of_manufacture   TEXT,

  -- Per-unit costs (USD)
  unit_material_usd        NUMERIC(12,4) DEFAULT 0,
  unit_machining_usd       NUMERIC(12,4) DEFAULT 0,
  unit_labour_usd          NUMERIC(12,4) DEFAULT 0,
  unit_tooling_usd         NUMERIC(12,4) DEFAULT 0,
  unit_surface_usd         NUMERIC(12,4) DEFAULT 0,
  unit_overhead_usd        NUMERIC(12,4) DEFAULT 0,
  unit_total_usd           NUMERIC(12,4) DEFAULT 0,

  -- Extended (unit × qty_per_assembly)
  extended_total_usd       NUMERIC(14,4)
    GENERATED ALWAYS AS (
      ROUND(unit_total_usd * qty_per_assembly, 4)
    ) STORED,

  -- For purchased items
  supplier_name            TEXT,
  purchase_price_usd       NUMERIC(12,4),
  lead_time_weeks          NUMERIC(5,1),
  sole_source              BOOLEAN      DEFAULT FALSE,

  -- Flags
  cost_driver              BOOLEAN      DEFAULT FALSE,  -- top 20% contributors
  should_cost_opportunity  BOOLEAN      DEFAULT FALSE,  -- gap vs should-cost > threshold
  alternate_process_exists BOOLEAN      DEFAULT FALSE,

  notes                    TEXT,
  created_at               TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acb_snapshot ON assembly_cost_breakdown (snapshot_id, bom_level, line_number);
CREATE INDEX IF NOT EXISTS idx_acb_user     ON assembly_cost_breakdown (user_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- RLS — all user-specific; owner-only CRUD
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl TEXT;
  rec RECORD;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'rfq_history','quote_line_items','quote_outcomes',
    'actual_vs_estimated_cost','bom_cost_snapshots','assembly_cost_breakdown'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    FOR rec IN SELECT policyname FROM pg_policies WHERE tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', rec.policyname, tbl);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "owner_select" ON %I FOR SELECT USING (user_id = auth.uid())', tbl);
    EXECUTE format(
      'CREATE POLICY "owner_insert" ON %I FOR INSERT WITH CHECK (user_id = auth.uid())', tbl);
    EXECUTE format(
      'CREATE POLICY "owner_update" ON %I FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())', tbl);
    EXECUTE format(
      'CREATE POLICY "owner_delete" ON %I FOR DELETE USING (user_id = auth.uid())', tbl);
  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- ANALYTICS VIEWS (read-only; use service_role or RLS-aware queries in app)
-- ══════════════════════════════════════════════════════════════════════════════

-- Win rate and average margin by process
CREATE OR REPLACE VIEW rfq_win_rate_by_process AS
SELECT
  r.user_id,
  r.process_group,
  r.process_name,
  COUNT(*)                                                       AS total_rfqs,
  COUNT(*) FILTER (WHERE o.outcome = 'Won')                     AS won,
  COUNT(*) FILTER (WHERE o.outcome = 'Lost')                    AS lost,
  COUNT(*) FILTER (WHERE o.outcome = 'No-bid')                  AS no_bid,
  ROUND(
    COUNT(*) FILTER (WHERE o.outcome = 'Won') * 100.0
    / NULLIF(COUNT(*) FILTER (WHERE o.outcome IN ('Won','Lost')), 0), 1
  )                                                              AS win_rate_pct,
  ROUND(AVG(o.gross_margin_pct) FILTER (WHERE o.outcome = 'Won'), 1) AS avg_win_margin_pct,
  ROUND(AVG(o.price_gap_pct), 1)                                AS avg_price_gap_pct
FROM rfq_history r
LEFT JOIN quote_outcomes o ON o.rfq_id = r.id
WHERE r.status IN ('Won','Lost','No-bid')
GROUP BY r.user_id, r.process_group, r.process_name;

-- Estimation accuracy by process
CREATE OR REPLACE VIEW estimation_accuracy_by_process AS
SELECT
  user_id,
  process_name,
  COUNT(*)                                           AS production_runs,
  ROUND(AVG(total_variance_pct), 2)                 AS avg_variance_pct,
  ROUND(AVG(ABS(total_variance_pct)), 2)            AS avg_abs_variance_pct,
  ROUND(AVG(act_scrap_pct - est_scrap_pct), 2)     AS avg_scrap_variance_pct,
  ROUND(
    AVG((act_cycle_time_min - est_cycle_time_min)
        / NULLIF(est_cycle_time_min,0) * 100), 2
  )                                                  AS avg_cycle_time_variance_pct,
  ROUND(SUM(act_total_cost_usd - est_total_cost_usd), 2) AS total_cost_variance_usd,
  COUNT(*) FILTER (WHERE total_variance_pct > 15)   AS overrun_count,
  COUNT(*) FILTER (WHERE total_variance_pct < -10)  AS underrun_count
FROM actual_vs_estimated_cost
GROUP BY user_id, process_name;

-- Price-to-win intelligence: what price wins in each process segment
CREATE OR REPLACE VIEW price_to_win_intelligence AS
SELECT
  r.user_id,
  r.process_group,
  r.process_name,
  r.customer_industry,
  ROUND(AVG(o.customer_target_usd / NULLIF(o.total_cost_usd, 0) * 100), 1) AS target_as_pct_of_cost,
  ROUND(AVG(o.price_to_win_usd / NULLIF(o.total_cost_usd, 0) * 100), 1)    AS ptw_as_pct_of_cost,
  ROUND(AVG(o.competitor_price_usd), 2)                                      AS avg_competitor_price_usd,
  COUNT(*) FILTER (WHERE o.outcome = 'Lost' AND o.loss_reason = 'Price')     AS price_losses,
  COUNT(*) FILTER (WHERE o.outcome = 'Won')                                   AS wins
FROM rfq_history r
JOIN quote_outcomes o ON o.rfq_id = r.id
WHERE o.outcome IN ('Won','Lost')
GROUP BY r.user_id, r.process_group, r.process_name, r.customer_industry;

-- BOM cost driver summary (top contributors per snapshot)
CREATE OR REPLACE VIEW bom_cost_drivers AS
SELECT
  acb.user_id,
  acb.snapshot_id,
  bcs.assembly_name,
  bcs.snapshot_date,
  acb.part_name,
  acb.process_name,
  acb.item_type,
  acb.extended_total_usd,
  ROUND(acb.extended_total_usd / NULLIF(bcs.total_cost_usd, 0) * 100, 1) AS pct_of_total_cost,
  acb.cost_driver,
  acb.should_cost_opportunity
FROM assembly_cost_breakdown acb
JOIN bom_cost_snapshots bcs ON bcs.id = acb.snapshot_id
ORDER BY acb.extended_total_usd DESC;

-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE '=== Migration 165 — RFQ → Quote → Production Feedback Loop ===';
  RAISE NOTICE 'Tables created:';
  RAISE NOTICE '  rfq_history              — incoming RFQ capture';
  RAISE NOTICE '  quote_line_items         — per-part cost breakdown';
  RAISE NOTICE '  quote_outcomes           — win/loss + market intelligence';
  RAISE NOTICE '  actual_vs_estimated_cost — post-production variance (learning loop)';
  RAISE NOTICE '  bom_cost_snapshots       — assembly cost rollup header';
  RAISE NOTICE '  assembly_cost_breakdown  — line-item BOM costs';
  RAISE NOTICE 'Analytics views created:';
  RAISE NOTICE '  rfq_win_rate_by_process';
  RAISE NOTICE '  estimation_accuracy_by_process';
  RAISE NOTICE '  price_to_win_intelligence';
  RAISE NOTICE '  bom_cost_drivers';
  RAISE NOTICE 'All tables: RLS owner-only (user_id = auth.uid())';
  RAISE NOTICE '=============================================================';
END $$;
