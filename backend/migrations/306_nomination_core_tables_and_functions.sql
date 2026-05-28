-- ============================================================================
-- Migration 306: Core tables and functions for supplier nomination system
-- Tables: cost_competency_analysis, cost_competency_vendor_values,
--         capability_criteria, capability_vendor_scores,
--         vendor_assessment_criteria, vendor_rating_matrix,
--         supplier_ranking_calculations, nomination_factor_weights
-- ============================================================================

-- ============================================================================
-- TABLES
-- ============================================================================

-- Cost Competency Analysis (rows per nomination, columns = vendors)
CREATE TABLE IF NOT EXISTS cost_competency_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_evaluation_id UUID NOT NULL REFERENCES supplier_nomination_evaluations(id) ON DELETE CASCADE,
  cost_component VARCHAR(255) NOT NULL,
  base_value DECIMAL(15,4) DEFAULT 0,
  base_payment_term VARCHAR(100),
  unit VARCHAR(50),
  is_ranking BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(nomination_evaluation_id, cost_component)
);

-- Vendor-specific values for each cost row
CREATE TABLE IF NOT EXISTS cost_competency_vendor_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_analysis_id UUID NOT NULL REFERENCES cost_competency_analysis(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL,
  numeric_value DECIMAL(15,4),
  text_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cost_analysis_id, vendor_id)
);

-- Capability criteria per nomination
CREATE TABLE IF NOT EXISTS capability_criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_evaluation_id UUID NOT NULL REFERENCES supplier_nomination_evaluations(id) ON DELETE CASCADE,
  criteria_name VARCHAR(255) NOT NULL,
  max_score INTEGER NOT NULL DEFAULT 10,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vendor scores per capability criterion
CREATE TABLE IF NOT EXISTS capability_vendor_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  criteria_id UUID NOT NULL REFERENCES capability_criteria(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL,
  score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(criteria_id, vendor_id)
);

-- Vendor Assessment Criteria (detailed scoring per vendor)
CREATE TABLE IF NOT EXISTS vendor_assessment_criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_evaluation_id UUID NOT NULL REFERENCES supplier_nomination_evaluations(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL,
  category VARCHAR(100) NOT NULL,
  assessment_aspects TEXT NOT NULL,
  total_score DECIMAL(8,2) DEFAULT 0,
  actual_score DECIMAL(8,2) DEFAULT 0,
  high_threshold DECIMAL(5,2) DEFAULT 70,
  low_threshold DECIMAL(5,2) DEFAULT 50,
  sectionwise_capability DECIMAL(8,4) DEFAULT 0,
  risk_section_total DECIMAL(8,2) DEFAULT 0,
  risk_actual_score DECIMAL(8,2) DEFAULT 0,
  risk_mitigation DECIMAL(8,4) DEFAULT 0,
  minor_nc INTEGER DEFAULT 0,
  major_nc INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vendor Rating Matrix
CREATE TABLE IF NOT EXISTS vendor_rating_matrix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_evaluation_id UUID NOT NULL REFERENCES supplier_nomination_evaluations(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL,
  s_no INTEGER NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT '',
  assessment_aspects TEXT NOT NULL DEFAULT '',
  section_wise_capability_percent DECIMAL(8,4) DEFAULT 0,
  risk_mitigation_percent DECIMAL(8,4) DEFAULT 0,
  minor_nc INTEGER DEFAULT 0,
  major_nc INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Supplier Ranking Calculations (cached results)
CREATE TABLE IF NOT EXISTS supplier_ranking_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_evaluation_id UUID NOT NULL REFERENCES supplier_nomination_evaluations(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL,
  net_price_unit DECIMAL(15,4) DEFAULT 0,
  development_cost DECIMAL(15,4) DEFAULT 0,
  lead_time_days INTEGER DEFAULT 0,
  cost_rank INTEGER,
  development_cost_rank INTEGER,
  lead_time_rank INTEGER,
  total_score DECIMAL(8,4) DEFAULT 0,
  overall_rank INTEGER,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(nomination_evaluation_id, vendor_id)
);

-- Factor weights per nomination
CREATE TABLE IF NOT EXISTS nomination_factor_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_evaluation_id UUID NOT NULL REFERENCES supplier_nomination_evaluations(id) ON DELETE CASCADE UNIQUE,
  cost_factor DECIMAL(5,2) DEFAULT 33.33,
  development_cost_factor DECIMAL(5,2) DEFAULT 33.33,
  lead_time_factor DECIMAL(5,2) DEFAULT 33.34,
  updated_by UUID,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cost_competency_analysis_nomination ON cost_competency_analysis(nomination_evaluation_id);
CREATE INDEX IF NOT EXISTS idx_cost_competency_vendor_values_analysis ON cost_competency_vendor_values(cost_analysis_id);
CREATE INDEX IF NOT EXISTS idx_capability_criteria_nomination ON capability_criteria(nomination_evaluation_id);
CREATE INDEX IF NOT EXISTS idx_capability_vendor_scores_criteria ON capability_vendor_scores(criteria_id);
CREATE INDEX IF NOT EXISTS idx_vendor_assessment_criteria_nomination ON vendor_assessment_criteria(nomination_evaluation_id, vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_rating_matrix_nomination ON vendor_rating_matrix(nomination_evaluation_id, vendor_id);
CREATE INDEX IF NOT EXISTS idx_supplier_ranking_calculations_nomination ON supplier_ranking_calculations(nomination_evaluation_id);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Initialize cost competency analysis for a nomination
CREATE OR REPLACE FUNCTION initialize_cost_competency_analysis(
  p_nomination_evaluation_id UUID,
  p_vendor_ids UUID[]
)
RETURNS VOID AS $$
DECLARE
  v_analysis_id UUID;
  v_row RECORD;
BEGIN
  -- Insert default cost components if none exist
  INSERT INTO cost_competency_analysis (nomination_evaluation_id, cost_component, unit, is_ranking, sort_order)
  SELECT p_nomination_evaluation_id, cost_component, unit, is_ranking, sort_order
  FROM (VALUES
    ('Net Price/unit',       'INR',  true,  1),
    ('Development cost',     'INR',  true,  2),
    ('Lead Time Days',       'Days', true,  3),
    ('Tooling Cost',         'INR',  false, 4),
    ('Payment Terms',        'Days', false, 5),
    ('Annual Volume',        'Nos',  false, 6),
    ('Warranty Period',      'Months', false, 7),
    ('Freight Cost',         'INR',  false, 8)
  ) AS defaults(cost_component, unit, is_ranking, sort_order)
  WHERE NOT EXISTS (
    SELECT 1 FROM cost_competency_analysis
    WHERE nomination_evaluation_id = p_nomination_evaluation_id
  )
  ON CONFLICT (nomination_evaluation_id, cost_component) DO NOTHING;

  -- Initialize vendor values for each analysis row + vendor
  FOR v_row IN
    SELECT id FROM cost_competency_analysis
    WHERE nomination_evaluation_id = p_nomination_evaluation_id
  LOOP
    INSERT INTO cost_competency_vendor_values (cost_analysis_id, vendor_id, numeric_value)
    SELECT v_row.id, vendor_id, 0
    FROM UNNEST(p_vendor_ids) AS vendor_id
    ON CONFLICT (cost_analysis_id, vendor_id) DO NOTHING;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Initialize vendor assessment criteria
CREATE OR REPLACE FUNCTION initialize_vendor_assessment_criteria(
  p_nomination_evaluation_id UUID,
  p_vendor_id UUID
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO vendor_assessment_criteria (
    nomination_evaluation_id, vendor_id, category, assessment_aspects,
    total_score, actual_score, high_threshold, low_threshold,
    risk_section_total, risk_actual_score, sort_order
  )
  SELECT
    p_nomination_evaluation_id, p_vendor_id,
    category, assessment_aspects, total_score, 0, 70, 50,
    risk_total, 0, sort_order
  FROM (VALUES
    ('Quality',           'Quality Management System',        20, 10, 1),
    ('Quality',           'Process Control & Inspection',     20, 10, 2),
    ('Delivery',          'On-Time Delivery Performance',     15, 8,  3),
    ('Delivery',          'Logistics & Supply Chain',         15, 8,  4),
    ('Technical',         'Manufacturing Capability',         25, 12, 5),
    ('Technical',         'Process Equipment & Technology',   25, 12, 6),
    ('Cost',              'Cost Competitiveness',             20, 10, 7),
    ('Cost',              'Value Engineering Capability',     20, 10, 8),
    ('Management',        'Financial Stability',              15, 8,  9),
    ('Management',        'Regulatory Compliance',            15, 8,  10),
    ('Management',        'Continuous Improvement',           10, 5,  11),
    ('HSE',               'Health, Safety & Environment',     15, 8,  12),
    ('Communication',     'Response & Communication',         10, 5,  13)
  ) AS defaults(category, assessment_aspects, total_score, risk_total, sort_order)
  WHERE NOT EXISTS (
    SELECT 1 FROM vendor_assessment_criteria
    WHERE nomination_evaluation_id = p_nomination_evaluation_id
    AND vendor_id = p_vendor_id
  )
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Initialize vendor rating matrix
CREATE OR REPLACE FUNCTION initialize_vendor_rating_matrix(
  p_nomination_evaluation_id UUID,
  p_vendor_id UUID
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO vendor_rating_matrix (
    nomination_evaluation_id, vendor_id, s_no, category, assessment_aspects, sort_order
  )
  SELECT
    p_nomination_evaluation_id, p_vendor_id, s_no, category, assessment_aspects, s_no
  FROM (VALUES
    (1,  'Quality',      'Quality Management System'),
    (2,  'Quality',      'Process Control & Inspection'),
    (3,  'Quality',      'Incoming Material Inspection'),
    (4,  'Delivery',     'On-Time Delivery Performance'),
    (5,  'Delivery',     'Logistics & Packaging'),
    (6,  'Technical',    'Manufacturing Capability'),
    (7,  'Technical',    'Process Equipment'),
    (8,  'Technical',    'Technical Support'),
    (9,  'Cost',         'Cost Competitiveness'),
    (10, 'Cost',         'Value Engineering'),
    (11, 'Management',   'Financial Stability'),
    (12, 'Management',   'Compliance & Certifications'),
    (13, 'Management',   'Continuous Improvement')
  ) AS defaults(s_no, category, assessment_aspects)
  WHERE NOT EXISTS (
    SELECT 1 FROM vendor_rating_matrix
    WHERE nomination_evaluation_id = p_nomination_evaluation_id
    AND vendor_id = p_vendor_id
  )
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Get factor weights for a nomination
CREATE OR REPLACE FUNCTION get_factor_weights(p_nomination_evaluation_id UUID)
RETURNS JSON AS $$
DECLARE
  v_weights RECORD;
BEGIN
  SELECT cost_factor, development_cost_factor, lead_time_factor
  INTO v_weights
  FROM nomination_factor_weights
  WHERE nomination_evaluation_id = p_nomination_evaluation_id;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'costFactor', 33.33,
      'developmentCostFactor', 33.33,
      'leadTimeFactor', 33.34
    );
  END IF;

  RETURN json_build_object(
    'costFactor', v_weights.cost_factor,
    'developmentCostFactor', v_weights.development_cost_factor,
    'leadTimeFactor', v_weights.lead_time_factor
  );
END;
$$ LANGUAGE plpgsql;

-- Update factor weights for a nomination
CREATE OR REPLACE FUNCTION update_factor_weights(
  p_nomination_evaluation_id UUID,
  p_cost_factor DECIMAL,
  p_development_cost_factor DECIMAL,
  p_lead_time_factor DECIMAL,
  p_updated_by UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO nomination_factor_weights (
    nomination_evaluation_id, cost_factor, development_cost_factor,
    lead_time_factor, updated_by, updated_at
  )
  VALUES (
    p_nomination_evaluation_id, p_cost_factor, p_development_cost_factor,
    p_lead_time_factor, p_updated_by, NOW()
  )
  ON CONFLICT (nomination_evaluation_id) DO UPDATE SET
    cost_factor = EXCLUDED.cost_factor,
    development_cost_factor = EXCLUDED.development_cost_factor,
    lead_time_factor = EXCLUDED.lead_time_factor,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW();

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Calculate supplier rankings from cost competency data
CREATE OR REPLACE FUNCTION calculate_supplier_rankings(p_nomination_evaluation_id UUID)
RETURNS JSON AS $$
DECLARE
  v_vendors UUID[];
  v_weights RECORD;
  v_result JSON;
BEGIN
  -- Get vendors in this nomination
  SELECT ARRAY_AGG(vendor_id) INTO v_vendors
  FROM vendor_nomination_evaluations
  WHERE nomination_evaluation_id = p_nomination_evaluation_id;

  IF v_vendors IS NULL OR array_length(v_vendors, 1) = 0 THEN
    RETURN '[]'::JSON;
  END IF;

  -- Get factor weights
  SELECT cost_factor, development_cost_factor, lead_time_factor
  INTO v_weights
  FROM nomination_factor_weights
  WHERE nomination_evaluation_id = p_nomination_evaluation_id;

  IF NOT FOUND THEN
    v_weights.cost_factor := 33.33;
    v_weights.development_cost_factor := 33.33;
    v_weights.lead_time_factor := 33.34;
  END IF;

  -- Calculate rankings
  WITH vendor_data AS (
    SELECT
      vne.vendor_id,
      COALESCE((
        SELECT cvv.numeric_value FROM cost_competency_analysis cca
        JOIN cost_competency_vendor_values cvv ON cvv.cost_analysis_id = cca.id
        WHERE cca.nomination_evaluation_id = p_nomination_evaluation_id
        AND cca.cost_component = 'Net Price/unit'
        AND cvv.vendor_id = vne.vendor_id
      ), 0) AS net_price,
      COALESCE((
        SELECT cvv.numeric_value FROM cost_competency_analysis cca
        JOIN cost_competency_vendor_values cvv ON cvv.cost_analysis_id = cca.id
        WHERE cca.nomination_evaluation_id = p_nomination_evaluation_id
        AND cca.cost_component = 'Development cost'
        AND cvv.vendor_id = vne.vendor_id
      ), 0) AS dev_cost,
      COALESCE((
        SELECT cvv.numeric_value FROM cost_competency_analysis cca
        JOIN cost_competency_vendor_values cvv ON cvv.cost_analysis_id = cca.id
        WHERE cca.nomination_evaluation_id = p_nomination_evaluation_id
        AND cca.cost_component = 'Lead Time Days'
        AND cvv.vendor_id = vne.vendor_id
      ), 0) AS lead_time
    FROM vendor_nomination_evaluations vne
    WHERE vne.nomination_evaluation_id = p_nomination_evaluation_id
  ),
  ranked AS (
    SELECT
      vendor_id,
      net_price, dev_cost, lead_time,
      RANK() OVER (ORDER BY CASE WHEN net_price = 0 THEN 999999 ELSE net_price END ASC) AS cost_rank,
      RANK() OVER (ORDER BY CASE WHEN dev_cost = 0 THEN 999999 ELSE dev_cost END ASC) AS dev_cost_rank,
      RANK() OVER (ORDER BY CASE WHEN lead_time = 0 THEN 999999 ELSE lead_time END ASC) AS lead_time_rank
    FROM vendor_data
  ),
  scored AS (
    SELECT
      vendor_id,
      net_price, dev_cost, lead_time,
      cost_rank, dev_cost_rank, lead_time_rank,
      (cost_rank * v_weights.cost_factor +
       dev_cost_rank * v_weights.development_cost_factor +
       lead_time_rank * v_weights.lead_time_factor) / 100.0 AS total_score
    FROM ranked, (SELECT v_weights.cost_factor, v_weights.development_cost_factor, v_weights.lead_time_factor) w
  )
  SELECT json_agg(json_build_object(
    'vendorId', vendor_id,
    'netPriceUnit', net_price,
    'developmentCost', dev_cost,
    'leadTimeDays', lead_time,
    'costRank', cost_rank,
    'developmentCostRank', dev_cost_rank,
    'leadTimeRank', lead_time_rank,
    'totalScore', total_score,
    'overallRank', RANK() OVER (ORDER BY total_score ASC)
  ) ORDER BY total_score ASC)
  INTO v_result
  FROM scored;

  RETURN COALESCE(v_result, '[]'::JSON);
END;
$$ LANGUAGE plpgsql;

-- Store supplier rankings
CREATE OR REPLACE FUNCTION store_supplier_rankings(p_nomination_evaluation_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_rankings JSON;
  v_row JSON;
BEGIN
  v_rankings := calculate_supplier_rankings(p_nomination_evaluation_id);

  FOR v_row IN SELECT * FROM json_array_elements(v_rankings)
  LOOP
    INSERT INTO supplier_ranking_calculations (
      nomination_evaluation_id, vendor_id,
      net_price_unit, development_cost, lead_time_days,
      cost_rank, development_cost_rank, lead_time_rank,
      total_score, overall_rank, calculated_at
    ) VALUES (
      p_nomination_evaluation_id,
      (v_row->>'vendorId')::UUID,
      (v_row->>'netPriceUnit')::DECIMAL,
      (v_row->>'developmentCost')::DECIMAL,
      (v_row->>'leadTimeDays')::INTEGER,
      (v_row->>'costRank')::INTEGER,
      (v_row->>'developmentCostRank')::INTEGER,
      (v_row->>'leadTimeRank')::INTEGER,
      (v_row->>'totalScore')::DECIMAL,
      (v_row->>'overallRank')::INTEGER,
      NOW()
    )
    ON CONFLICT (nomination_evaluation_id, vendor_id) DO UPDATE SET
      net_price_unit = EXCLUDED.net_price_unit,
      development_cost = EXCLUDED.development_cost,
      lead_time_days = EXCLUDED.lead_time_days,
      cost_rank = EXCLUDED.cost_rank,
      development_cost_rank = EXCLUDED.development_cost_rank,
      lead_time_rank = EXCLUDED.lead_time_rank,
      total_score = EXCLUDED.total_score,
      overall_rank = EXCLUDED.overall_rank,
      calculated_at = NOW();
  END LOOP;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Get vendor assessment metrics
CREATE OR REPLACE FUNCTION get_vendor_assessment_metrics(
  p_nomination_evaluation_id UUID,
  p_vendor_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'overallScore1',
    CASE WHEN SUM(total_score) > 0
      THEN ROUND((SUM(actual_score) / NULLIF(SUM(total_score), 0)) * 100, 2)
      ELSE 0 END,
    'overallScore2',
    CASE WHEN SUM(risk_section_total) > 0
      THEN ROUND((SUM(risk_actual_score) / NULLIF(SUM(risk_section_total), 0)) * 100, 2)
      ELSE 0 END,
    'totalActual', COALESCE(SUM(actual_score), 0),
    'totalPossible', COALESCE(SUM(total_score), 0),
    'totalMinorNC', COALESCE(SUM(minor_nc), 0),
    'totalMajorNC', COALESCE(SUM(major_nc), 0),
    'ratingStatus',
    CASE
      WHEN COALESCE(SUM(total_score), 0) = 0 THEN 'needs_improvement'
      WHEN (SUM(actual_score) / NULLIF(SUM(total_score), 0)) >= 0.7 THEN 'excellent'
      WHEN (SUM(actual_score) / NULLIF(SUM(total_score), 0)) >= 0.5 THEN 'good'
      ELSE 'needs_improvement'
    END
  ) INTO v_result
  FROM vendor_assessment_criteria
  WHERE nomination_evaluation_id = p_nomination_evaluation_id
  AND vendor_id = p_vendor_id;

  RETURN COALESCE(v_result, json_build_object(
    'overallScore1', 0, 'overallScore2', 0, 'totalActual', 0,
    'totalPossible', 0, 'totalMinorNC', 0, 'totalMajorNC', 0,
    'ratingStatus', 'needs_improvement'
  ));
END;
$$ LANGUAGE plpgsql;

-- Calculate and cache vendor rating overall scores
CREATE OR REPLACE FUNCTION calculate_vendor_rating_overall_scores(
  p_nomination_evaluation_id UUID,
  p_vendor_id UUID
)
RETURNS VOID AS $$
BEGIN
  -- This is a no-op cache trigger; get_vendor_rating_overall_scores calculates on the fly
  NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- RLS for new tables (ownership via nomination_evaluation_id)
-- ============================================================================

ALTER TABLE cost_competency_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_competency_vendor_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_vendor_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_assessment_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_rating_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_ranking_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE nomination_factor_weights ENABLE ROW LEVEL SECURITY;

-- cost_competency_analysis
DROP POLICY IF EXISTS "Users own cost_competency_analysis" ON cost_competency_analysis;
CREATE POLICY "Users own cost_competency_analysis" ON cost_competency_analysis FOR ALL
  USING (EXISTS (SELECT 1 FROM supplier_nomination_evaluations sne WHERE sne.id = nomination_evaluation_id AND sne.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM supplier_nomination_evaluations sne WHERE sne.id = nomination_evaluation_id AND sne.user_id = auth.uid()));

-- cost_competency_vendor_values
DROP POLICY IF EXISTS "Users own cost_competency_vendor_values" ON cost_competency_vendor_values;
CREATE POLICY "Users own cost_competency_vendor_values" ON cost_competency_vendor_values FOR ALL
  USING (EXISTS (
    SELECT 1 FROM cost_competency_analysis cca
    JOIN supplier_nomination_evaluations sne ON sne.id = cca.nomination_evaluation_id
    WHERE cca.id = cost_analysis_id AND sne.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM cost_competency_analysis cca
    JOIN supplier_nomination_evaluations sne ON sne.id = cca.nomination_evaluation_id
    WHERE cca.id = cost_analysis_id AND sne.user_id = auth.uid()
  ));

-- capability_criteria
DROP POLICY IF EXISTS "Users own capability_criteria" ON capability_criteria;
CREATE POLICY "Users own capability_criteria" ON capability_criteria FOR ALL
  USING (EXISTS (SELECT 1 FROM supplier_nomination_evaluations sne WHERE sne.id = nomination_evaluation_id AND sne.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM supplier_nomination_evaluations sne WHERE sne.id = nomination_evaluation_id AND sne.user_id = auth.uid()));

-- capability_vendor_scores
DROP POLICY IF EXISTS "Users own capability_vendor_scores" ON capability_vendor_scores;
CREATE POLICY "Users own capability_vendor_scores" ON capability_vendor_scores FOR ALL
  USING (EXISTS (
    SELECT 1 FROM capability_criteria cc
    JOIN supplier_nomination_evaluations sne ON sne.id = cc.nomination_evaluation_id
    WHERE cc.id = criteria_id AND sne.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM capability_criteria cc
    JOIN supplier_nomination_evaluations sne ON sne.id = cc.nomination_evaluation_id
    WHERE cc.id = criteria_id AND sne.user_id = auth.uid()
  ));

-- vendor_assessment_criteria
DROP POLICY IF EXISTS "Users own vendor_assessment_criteria" ON vendor_assessment_criteria;
CREATE POLICY "Users own vendor_assessment_criteria" ON vendor_assessment_criteria FOR ALL
  USING (EXISTS (SELECT 1 FROM supplier_nomination_evaluations sne WHERE sne.id = nomination_evaluation_id AND sne.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM supplier_nomination_evaluations sne WHERE sne.id = nomination_evaluation_id AND sne.user_id = auth.uid()));

-- vendor_rating_matrix
DROP POLICY IF EXISTS "Users own vendor_rating_matrix" ON vendor_rating_matrix;
CREATE POLICY "Users own vendor_rating_matrix" ON vendor_rating_matrix FOR ALL
  USING (EXISTS (SELECT 1 FROM supplier_nomination_evaluations sne WHERE sne.id = nomination_evaluation_id AND sne.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM supplier_nomination_evaluations sne WHERE sne.id = nomination_evaluation_id AND sne.user_id = auth.uid()));

-- supplier_ranking_calculations
DROP POLICY IF EXISTS "Users own supplier_ranking_calculations" ON supplier_ranking_calculations;
CREATE POLICY "Users own supplier_ranking_calculations" ON supplier_ranking_calculations FOR ALL
  USING (EXISTS (SELECT 1 FROM supplier_nomination_evaluations sne WHERE sne.id = nomination_evaluation_id AND sne.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM supplier_nomination_evaluations sne WHERE sne.id = nomination_evaluation_id AND sne.user_id = auth.uid()));

-- nomination_factor_weights
DROP POLICY IF EXISTS "Users own nomination_factor_weights" ON nomination_factor_weights;
CREATE POLICY "Users own nomination_factor_weights" ON nomination_factor_weights FOR ALL
  USING (EXISTS (SELECT 1 FROM supplier_nomination_evaluations sne WHERE sne.id = nomination_evaluation_id AND sne.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM supplier_nomination_evaluations sne WHERE sne.id = nomination_evaluation_id AND sne.user_id = auth.uid()));

-- ============================================================================
-- Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION initialize_cost_competency_analysis TO authenticated;
GRANT EXECUTE ON FUNCTION initialize_vendor_assessment_criteria TO authenticated;
GRANT EXECUTE ON FUNCTION initialize_vendor_rating_matrix TO authenticated;
GRANT EXECUTE ON FUNCTION get_factor_weights TO authenticated;
GRANT EXECUTE ON FUNCTION update_factor_weights TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_supplier_rankings TO authenticated;
GRANT EXECUTE ON FUNCTION store_supplier_rankings TO authenticated;
GRANT EXECUTE ON FUNCTION get_vendor_assessment_metrics TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_vendor_rating_overall_scores TO authenticated;
