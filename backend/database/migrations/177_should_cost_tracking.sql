-- Migration 177: Should-Cost Prediction Tracking
--
-- Creates three tables that power the calibration feedback loop.
-- This is the instrumentation layer — you can't calibrate what you don't measure.
--
--   should_cost_predictions  — every auto-fill cost estimate the engine makes
--   should_cost_actuals      — actual costs from supplier quotes/invoices (ground truth)
--   rate_calibration_history — history of Ridge-regression rate corrections
--
-- Design decisions:
--   - Predictions log cycle_time_source + mhr_source + lhr_source + material_source
--     so calibration can distinguish physics-driven vs heuristic predictions and
--     weight them accordingly.
--   - rate_snapshot JSONB locks the rates used at prediction time so future rate
--     changes don't corrupt historical accuracy calculations.
--   - All prediction inserts are non-blocking (application catches and logs errors,
--     never fails the main response).
--
-- Safe to re-run: all CREATE TABLE statements use IF NOT EXISTS.

-- ── Predictions ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS should_cost_predictions (
    id                           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_item_id                  UUID         REFERENCES bom_items(id) ON DELETE CASCADE,
    project_id                   UUID,
    user_id                      UUID,
    predicted_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- Classification
    process_family               VARCHAR(30),   -- sheet_metal | cnc_milled | cnc_turned | injection_molded
    location                     VARCHAR(50),   -- India | USA | Germany | China | ...

    -- Cost breakdown in USD (currency-neutral for cross-location comparison)
    predicted_material_cost_usd  DECIMAL(12,4),
    predicted_process_cost_usd   DECIMAL(12,4),
    predicted_tooling_cost_usd   DECIMAL(12,4),
    predicted_total_cost_usd     DECIMAL(12,4),
    predicted_cycle_time_min     DECIMAL(10,4),

    -- Source audit trail — calibration weights physics estimates higher than heuristics
    cycle_time_source            VARCHAR(30),   -- physics | heuristic | calculator | fallback
    mhr_source                   VARCHAR(30),   -- db_benchmark | db_user | hardcoded_default
    lhr_source                   VARCHAR(30),   -- db_benchmark | db_user | hardcoded_default
    material_source              VARCHAR(30),   -- db_global | db_india | hardcoded_default

    -- Feature vector: CAD signals that drove this prediction (locked at prediction time)
    feature_vector               JSONB,
    -- {
    --   cut_length_mm, bend_count, hole_count, pierce_count,
    --   volume_mm3, surface_area_mm2,
    --   sheet_thickness_mm, wall_thickness_mm,
    --   slot_count, pocket_count, undercut_count,
    --   bbox_length_mm, bbox_width_mm, bbox_height_mm,
    --   material_grade, detected_family, family_confidence
    -- }

    -- Rate snapshot: what was actually used (rates drift — lock the values)
    rate_snapshot                JSONB,
    -- { mhr_rate: 1400, lhr_rate: 155, material_cost_per_kg: 68, currency: "INR" }

    confidence_score             DECIMAL(4,3),
    confidence_breakdown         JSONB,
    -- { geometry: 0.9, material: 0.8, process: 0.75, cost: 0.7 }

    -- Version of the cost engine that made this prediction.
    -- Bump COST_ENGINE_VERSION constant on any breaking formula change to enable
    -- cohort analysis (compare accuracy before/after a formula change).
    engine_version               VARCHAR(20)
);

-- ── Actuals ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS should_cost_actuals (
    id                           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Link to the prediction that was compared against this actual.
    -- NULL is allowed — actuals can be entered without a linked prediction.
    prediction_id                UUID         REFERENCES should_cost_predictions(id) ON DELETE SET NULL,
    bom_item_id                  UUID         REFERENCES bom_items(id) ON DELETE CASCADE,
    project_id                   UUID,

    actual_type                  VARCHAR(20)  NOT NULL,
    -- rfq_response   — quote received from a supplier in response to an RFQ
    -- po_invoice      — actual cost from a delivered/invoiced purchase order
    -- emuski_shopfloor — cost from Emuski's own production (highest quality data)
    -- internal_quote  — internal estimate from engineering / purchasing

    actual_total_cost_usd        DECIMAL(12,4),
    actual_material_cost_usd     DECIMAL(12,4),
    actual_process_cost_usd      DECIMAL(12,4),
    actual_cycle_time_min        DECIMAL(10,4),

    supplier_name                VARCHAR(100),
    supplier_location            VARCHAR(50),
    rfq_date                     DATE,
    entered_by_user_id           UUID,
    notes                        TEXT,
    created_at                   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── Calibration history ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rate_calibration_history (
    id                           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    calibrated_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
    process_family               VARCHAR(30),
    location                     VARCHAR(50),

    -- The correction multiplier applied: new_rate = old_rate × correction_multiplier
    -- Values > 1.0 mean predictions were systematically under-costing (rates raised).
    -- Values < 1.0 mean predictions were systematically over-costing (rates lowered).
    correction_multiplier        DECIMAL(8,4),
    sample_count                 INT,

    -- Accuracy metrics before and after this calibration run
    mape_before                  DECIMAL(6,2),   -- Mean Absolute Percentage Error
    mape_after                   DECIMAL(6,2),
    bias_before                  DECIMAL(6,2),   -- Systematic over/under-quoting (signed)
    bias_after                   DECIMAL(6,2),
    pct_within_10pct_before      DECIMAL(6,2),   -- % of quotes within ±10% of actual
    pct_within_10pct_after       DECIMAL(6,2),

    method                       VARCHAR(30),    -- ridge_regression | median_scaling | manual
    applied_to_mhr_ids           UUID[],         -- which mhr_records rows were updated
    notes                        TEXT
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_scp_bom_item
    ON should_cost_predictions(bom_item_id);

CREATE INDEX IF NOT EXISTS idx_scp_family_location
    ON should_cost_predictions(process_family, location);

CREATE INDEX IF NOT EXISTS idx_scp_predicted_at
    ON should_cost_predictions(predicted_at DESC);

CREATE INDEX IF NOT EXISTS idx_sca_prediction
    ON should_cost_actuals(prediction_id);

CREATE INDEX IF NOT EXISTS idx_sca_bom_item
    ON should_cost_actuals(bom_item_id);

CREATE INDEX IF NOT EXISTS idx_rch_family_location
    ON rate_calibration_history(process_family, location, calibrated_at DESC);
