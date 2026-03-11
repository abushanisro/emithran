-- Migration 214: Fix CAD analysis stored procedure numeric overflow
-- The stored procedure was throwing "numeric field overflow" (code 22003)
-- because:
--   1. manufacturability_score stored as DECIMAL(3,2) expects 0.00–1.00
--      but the CAD engine could return 0–100 scale values.
--   2. memory_reduction_percent cast to DECIMAL(5,2) could also overflow
--      for percentage values without normalization.
-- Fix: normalize score if >1 (assume it was a 0–100 value), clamp to valid range.

CREATE OR REPLACE FUNCTION update_bom_item_cad_analysis(
    p_bom_item_id UUID,
    p_geometry_analysis JSONB,
    p_dfm_analysis JSONB,
    p_memory_metrics JSONB,
    p_geometry_hash VARCHAR(64),
    p_analysis_version VARCHAR(20),
    p_optimization_strategy VARCHAR(20),
    p_user_id UUID
) RETURNS VOID AS $$
DECLARE
    v_manufacturability_score DECIMAL(3,2);
    v_memory_reduction_percent DECIMAL(5,2);
    v_processing_time_ms INTEGER;
    v_raw_score NUMERIC;
    v_raw_reduction NUMERIC;
    v_raw_time NUMERIC;
BEGIN
    -- Safely parse manufacturability_score: normalize from 0–100 to 0.00–1.00 if needed
    v_raw_score := (p_dfm_analysis->>'manufacturability_score')::NUMERIC;
    IF v_raw_score IS NOT NULL THEN
        IF v_raw_score > 1.0 THEN
            v_raw_score := v_raw_score / 100.0; -- normalize 0–100 scale to 0–1
        END IF;
        v_manufacturability_score := LEAST(GREATEST(v_raw_score, 0.00), 1.00); -- clamp to [0,1]
    END IF;

    -- Safely parse memory_reduction_percent: cap at 99.99
    v_raw_reduction := COALESCE(
        (p_memory_metrics->>'memory_reduction_percent')::NUMERIC,
        (p_memory_metrics->>'reduction_percentage')::NUMERIC
    );
    IF v_raw_reduction IS NOT NULL THEN
        v_memory_reduction_percent := LEAST(GREATEST(v_raw_reduction, 0.00), 99.99);
    END IF;

    -- Safely parse processing_time_ms
    v_raw_time := COALESCE(
        (p_memory_metrics->>'processing_time_ms')::NUMERIC,
        (p_memory_metrics->>'analysis_time_ms')::NUMERIC,
        50
    );
    v_processing_time_ms := GREATEST(v_raw_time::INTEGER, 1);

    -- Update bom_items table with analysis results
    UPDATE bom_items
    SET
        geometry_analysis = p_geometry_analysis,
        dfm_analysis = p_dfm_analysis,
        memory_optimization_metrics = p_memory_metrics,
        manufacturability_score = v_manufacturability_score,
        difficulty_level = p_dfm_analysis->>'difficulty_level',
        recommended_processes = ARRAY(
            SELECT jsonb_array_elements_text(p_dfm_analysis->'recommended_processes')
        ),
        cad_analysis_warnings = p_dfm_analysis->'warnings',
        geometry_hash = p_geometry_hash,
        analysis_timestamp = NOW(),
        analysis_version = p_analysis_version,
        optimization_strategy = p_optimization_strategy,
        lod_levels_available = COALESCE(
            (p_memory_metrics->>'lod_levels_generated')::INTEGER,
            (p_memory_metrics->>'lod_levels')::INTEGER
        ),
        cache_key = p_geometry_hash,
        updated_at = NOW()
    WHERE id = p_bom_item_id;

    -- Insert into analysis history
    INSERT INTO cad_analysis_history (
        bom_item_id, user_id, geometry_hash, analysis_version, optimization_strategy,
        processing_time_ms, memory_reduction_percent, manufacturability_score,
        difficulty_level, warnings_count, recommendations_count,
        geometry_analysis, dfm_analysis, memory_metrics
    ) VALUES (
        p_bom_item_id,
        p_user_id,
        p_geometry_hash,
        p_analysis_version,
        p_optimization_strategy,
        v_processing_time_ms,
        v_memory_reduction_percent,
        v_manufacturability_score,
        p_dfm_analysis->>'difficulty_level',
        COALESCE(jsonb_array_length(p_dfm_analysis->'warnings'), 
                 jsonb_array_length(p_dfm_analysis->'manufacturing_warnings'), 0),
        COALESCE(jsonb_array_length(p_dfm_analysis->'recommendations'), 0),
        p_geometry_analysis,
        p_dfm_analysis,
        p_memory_metrics
    )
    ON CONFLICT DO NOTHING; -- avoid duplicate history entries on re-analysis

END;
$$ LANGUAGE plpgsql;

-- Log migration
INSERT INTO schema_migrations (version, description)
VALUES ('214', 'Fix CAD analysis stored procedure to handle numeric overflow safely')
ON CONFLICT (version) DO NOTHING;
