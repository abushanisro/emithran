-- ============================================================================
-- Migration 307: part_wise_cost_analysis and part_wise_cost_base_data tables
-- These tables are used by PartWiseCostAnalysisService but were never created.
-- ============================================================================

-- ============================================================================
-- part_wise_cost_base_data
-- ============================================================================

CREATE TABLE IF NOT EXISTS part_wise_cost_base_data (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_id                   UUID NOT NULL REFERENCES supplier_nomination_evaluations(id) ON DELETE CASCADE,
  bom_item_id                     UUID NOT NULL,
  base_raw_material_cost          NUMERIC(15, 4),
  base_process_cost               NUMERIC(15, 4),
  base_overheads_profit           NUMERIC(15, 4),
  base_packing_forwarding_cost    NUMERIC(15, 4),
  base_payment_terms              TEXT,
  base_net_price_unit             NUMERIC(15, 4),
  base_development_cost           NUMERIC(15, 4),
  base_financial_risk             NUMERIC(15, 4),
  base_cost_competency_score      NUMERIC(15, 4),
  base_lead_time_days             NUMERIC(15, 4),
  cost_factor_weight              NUMERIC(10, 4) NOT NULL DEFAULT 33.33,
  development_cost_factor_weight  NUMERIC(10, 4) NOT NULL DEFAULT 33.33,
  lead_time_factor_weight         NUMERIC(10, 4) NOT NULL DEFAULT 33.34,
  created_by                      UUID REFERENCES auth.users(id),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (nomination_id, bom_item_id)
);

CREATE INDEX IF NOT EXISTS idx_part_wise_cost_base_data_nomination_id
  ON part_wise_cost_base_data(nomination_id);

-- ============================================================================
-- part_wise_cost_analysis
-- ============================================================================

CREATE TABLE IF NOT EXISTS part_wise_cost_analysis (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_id             UUID NOT NULL REFERENCES supplier_nomination_evaluations(id) ON DELETE CASCADE,
  bom_item_id               UUID NOT NULL,
  vendor_id                 UUID NOT NULL,
  raw_material_cost         NUMERIC(15, 4),
  process_cost              NUMERIC(15, 4),
  overheads_profit          NUMERIC(15, 4),
  packing_forwarding_cost   NUMERIC(15, 4),
  payment_terms             TEXT,
  net_price_unit            NUMERIC(15, 4),
  development_cost          NUMERIC(15, 4),
  financial_risk            NUMERIC(15, 4),
  cost_competency_score     NUMERIC(15, 4),
  lead_time_days            NUMERIC(15, 4),
  rank_cost                 INTEGER,
  rank_development_cost     INTEGER,
  rank_lead_time            INTEGER,
  total_score               NUMERIC(15, 4),
  overall_rank              INTEGER,
  created_by                UUID REFERENCES auth.users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (nomination_id, bom_item_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_part_wise_cost_analysis_nomination_id
  ON part_wise_cost_analysis(nomination_id);

CREATE INDEX IF NOT EXISTS idx_part_wise_cost_analysis_nomination_bom
  ON part_wise_cost_analysis(nomination_id, bom_item_id);

-- ============================================================================
-- updated_at trigger helper (reuse if exists)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON part_wise_cost_base_data;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON part_wise_cost_base_data
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON part_wise_cost_analysis;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON part_wise_cost_analysis
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- calculate_part_wise_rankings function
-- Ranks vendors for a given nomination + BOM item using weighted factors.
-- Weights come from part_wise_cost_base_data; fallback to equal thirds.
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_part_wise_rankings(
  p_nomination_id UUID,
  p_bom_item_id   UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cost_weight    NUMERIC;
  v_dev_weight     NUMERIC;
  v_lead_weight    NUMERIC;
BEGIN
  -- Fetch factor weights
  SELECT
    COALESCE(cost_factor_weight, 33.33),
    COALESCE(development_cost_factor_weight, 33.33),
    COALESCE(lead_time_factor_weight, 33.34)
  INTO v_cost_weight, v_dev_weight, v_lead_weight
  FROM part_wise_cost_base_data
  WHERE nomination_id = p_nomination_id
    AND bom_item_id   = p_bom_item_id;

  -- Default weights when no base data row yet
  IF NOT FOUND THEN
    v_cost_weight := 33.33;
    v_dev_weight  := 33.33;
    v_lead_weight := 33.34;
  END IF;

  -- Write individual ranks + weighted total score + overall rank in one pass
  WITH ranked AS (
    SELECT
      id,
      RANK() OVER (
        PARTITION BY nomination_id, bom_item_id
        ORDER BY COALESCE(net_price_unit, 0) ASC
      ) AS r_cost,
      RANK() OVER (
        PARTITION BY nomination_id, bom_item_id
        ORDER BY COALESCE(development_cost, 0) ASC
      ) AS r_dev,
      RANK() OVER (
        PARTITION BY nomination_id, bom_item_id
        ORDER BY COALESCE(lead_time_days, 0) ASC
      ) AS r_lead
    FROM part_wise_cost_analysis
    WHERE nomination_id = p_nomination_id
      AND bom_item_id   = p_bom_item_id
  ),
  scored AS (
    SELECT
      id,
      r_cost,
      r_dev,
      r_lead,
      (r_cost * v_cost_weight / 100.0)
        + (r_dev  * v_dev_weight  / 100.0)
        + (r_lead * v_lead_weight / 100.0) AS total_score
    FROM ranked
  ),
  overall AS (
    SELECT
      id,
      r_cost,
      r_dev,
      r_lead,
      total_score,
      RANK() OVER (ORDER BY total_score ASC) AS overall_rank
    FROM scored
  )
  UPDATE part_wise_cost_analysis pca
  SET
    rank_cost             = o.r_cost,
    rank_development_cost = o.r_dev,
    rank_lead_time        = o.r_lead,
    total_score           = o.total_score,
    overall_rank          = o.overall_rank,
    updated_at            = NOW()
  FROM overall o
  WHERE pca.id = o.id;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_part_wise_rankings(UUID, UUID) TO authenticated;

-- ============================================================================
-- RLS: part_wise_cost_base_data
-- ============================================================================

ALTER TABLE part_wise_cost_base_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view part wise cost base data" ON part_wise_cost_base_data;
DROP POLICY IF EXISTS "Users can insert part wise cost base data" ON part_wise_cost_base_data;
DROP POLICY IF EXISTS "Users can update part wise cost base data" ON part_wise_cost_base_data;
DROP POLICY IF EXISTS "Users can delete part wise cost base data" ON part_wise_cost_base_data;

CREATE POLICY "Users can view part wise cost base data"
  ON part_wise_cost_base_data FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = part_wise_cost_base_data.nomination_id
      AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert part wise cost base data"
  ON part_wise_cost_base_data FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = part_wise_cost_base_data.nomination_id
      AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can update part wise cost base data"
  ON part_wise_cost_base_data FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = part_wise_cost_base_data.nomination_id
      AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete part wise cost base data"
  ON part_wise_cost_base_data FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = part_wise_cost_base_data.nomination_id
      AND sne.user_id = auth.uid()
  ));

-- ============================================================================
-- RLS: part_wise_cost_analysis
-- ============================================================================

ALTER TABLE part_wise_cost_analysis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view part wise cost analysis" ON part_wise_cost_analysis;
DROP POLICY IF EXISTS "Users can insert part wise cost analysis" ON part_wise_cost_analysis;
DROP POLICY IF EXISTS "Users can update part wise cost analysis" ON part_wise_cost_analysis;
DROP POLICY IF EXISTS "Users can delete part wise cost analysis" ON part_wise_cost_analysis;

CREATE POLICY "Users can view part wise cost analysis"
  ON part_wise_cost_analysis FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = part_wise_cost_analysis.nomination_id
      AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert part wise cost analysis"
  ON part_wise_cost_analysis FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = part_wise_cost_analysis.nomination_id
      AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can update part wise cost analysis"
  ON part_wise_cost_analysis FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = part_wise_cost_analysis.nomination_id
      AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete part wise cost analysis"
  ON part_wise_cost_analysis FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = part_wise_cost_analysis.nomination_id
      AND sne.user_id = auth.uid()
  ));
