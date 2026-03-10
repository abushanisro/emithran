-- Migration: Add CAD Analysis Support to BOM Items
-- Purpose: Integrate advanced CAD analysis results with BOM items
-- Author: Principal Engineer - CAD Memory Management System  
-- Date: March 2026

-- ============================================================================
-- CAD ANALYSIS ENHANCEMENT FOR BOM ITEMS
-- ============================================================================

-- Add comprehensive CAD analysis columns to bom_items table
ALTER TABLE bom_items 
ADD COLUMN IF NOT EXISTS geometry_analysis JSONB,
ADD COLUMN IF NOT EXISTS dfm_analysis JSONB,
ADD COLUMN IF NOT EXISTS memory_optimization_metrics JSONB,
ADD COLUMN IF NOT EXISTS manufacturability_score DECIMAL(3,2),
ADD COLUMN IF NOT EXISTS difficulty_level VARCHAR(20),
ADD COLUMN IF NOT EXISTS recommended_processes TEXT[],
ADD COLUMN IF NOT EXISTS cad_analysis_warnings JSONB,
ADD COLUMN IF NOT EXISTS geometry_hash VARCHAR(64),
ADD COLUMN IF NOT EXISTS analysis_timestamp TIMESTAMP,
ADD COLUMN IF NOT EXISTS analysis_version VARCHAR(20),
ADD COLUMN IF NOT EXISTS optimization_strategy VARCHAR(20),
ADD COLUMN IF NOT EXISTS lod_levels_available INTEGER,
ADD COLUMN IF NOT EXISTS cache_key VARCHAR(64);

-- Add constraints for data integrity
ALTER TABLE bom_items 
ADD CONSTRAINT chk_manufacturability_score 
    CHECK (manufacturability_score IS NULL OR manufacturability_score BETWEEN 0.00 AND 1.00);

ALTER TABLE bom_items 
ADD CONSTRAINT chk_difficulty_level 
    CHECK (difficulty_level IS NULL OR difficulty_level IN ('easy', 'medium', 'hard', 'very_hard'));

ALTER TABLE bom_items 
ADD CONSTRAINT chk_optimization_strategy 
    CHECK (optimization_strategy IS NULL OR optimization_strategy IN ('aggressive', 'balanced', 'conservative', 'custom'));

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================

-- Index for manufacturability queries (finding parts by manufacturing difficulty)
CREATE INDEX IF NOT EXISTS idx_bom_items_manufacturability_score 
    ON bom_items(manufacturability_score DESC) 
    WHERE manufacturability_score IS NOT NULL;

-- Index for difficulty level filtering
CREATE INDEX IF NOT EXISTS idx_bom_items_difficulty_level 
    ON bom_items(difficulty_level) 
    WHERE difficulty_level IS NOT NULL;

-- Index for recent analysis lookups
CREATE INDEX IF NOT EXISTS idx_bom_items_analysis_timestamp 
    ON bom_items(analysis_timestamp DESC) 
    WHERE analysis_timestamp IS NOT NULL;

-- Index for geometry hash lookups (cache efficiency)
CREATE INDEX IF NOT EXISTS idx_bom_items_geometry_hash 
    ON bom_items(geometry_hash) 
    WHERE geometry_hash IS NOT NULL;

-- Composite index for filtering analyzed items
CREATE INDEX IF NOT EXISTS idx_bom_items_analyzed 
    ON bom_items(bom_id, analysis_timestamp DESC) 
    WHERE analysis_timestamp IS NOT NULL;

-- Index for recommended processes queries
CREATE INDEX IF NOT EXISTS idx_bom_items_recommended_processes 
    ON bom_items USING GIN(recommended_processes) 
    WHERE recommended_processes IS NOT NULL;

-- ============================================================================
-- CAD ANALYSIS HISTORY TABLE
-- ============================================================================

-- Create table to track CAD analysis history for audit and performance monitoring
CREATE TABLE IF NOT EXISTS cad_analysis_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_item_id UUID NOT NULL REFERENCES bom_items(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    
    -- Analysis metadata
    geometry_hash VARCHAR(64) NOT NULL,
    analysis_version VARCHAR(20) NOT NULL,
    optimization_strategy VARCHAR(20) NOT NULL,
    
    -- Performance metrics
    processing_time_ms INTEGER NOT NULL,
    memory_reduction_percent DECIMAL(5,2),
    cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Results summary
    manufacturability_score DECIMAL(3,2),
    difficulty_level VARCHAR(20),
    warnings_count INTEGER DEFAULT 0,
    recommendations_count INTEGER DEFAULT 0,
    
    -- Full analysis data
    geometry_analysis JSONB,
    dfm_analysis JSONB,
    memory_metrics JSONB,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_cad_history_manufacturability_score 
        CHECK (manufacturability_score IS NULL OR manufacturability_score BETWEEN 0.00 AND 1.00),
    CONSTRAINT chk_cad_history_difficulty_level 
        CHECK (difficulty_level IS NULL OR difficulty_level IN ('easy', 'medium', 'hard', 'very_hard')),
    CONSTRAINT chk_cad_history_processing_time 
        CHECK (processing_time_ms > 0),
    CONSTRAINT chk_cad_history_warnings_count 
        CHECK (warnings_count >= 0),
    CONSTRAINT chk_cad_history_recommendations_count 
        CHECK (recommendations_count >= 0)
);

-- Performance indexes for history table
CREATE INDEX IF NOT EXISTS idx_cad_history_bom_item 
    ON cad_analysis_history(bom_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cad_history_user 
    ON cad_analysis_history(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cad_history_geometry_hash 
    ON cad_analysis_history(geometry_hash);

CREATE INDEX IF NOT EXISTS idx_cad_history_performance 
    ON cad_analysis_history(processing_time_ms, memory_reduction_percent) 
    WHERE processing_time_ms IS NOT NULL;

-- ============================================================================
-- CAD ANALYSIS CACHE TABLE  
-- ============================================================================

-- Create optimized cache table for frequent geometry analysis lookups
CREATE TABLE IF NOT EXISTS cad_analysis_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    geometry_hash VARCHAR(64) UNIQUE NOT NULL,
    
    -- Cache metadata
    file_size_bytes BIGINT,
    optimization_strategy VARCHAR(20) NOT NULL,
    analysis_version VARCHAR(20) NOT NULL,
    
    -- Cached results
    geometry_analysis JSONB NOT NULL,
    dfm_analysis JSONB NOT NULL,
    memory_metrics JSONB NOT NULL,
    
    -- Cache statistics
    access_count INTEGER DEFAULT 1,
    last_accessed TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '24 hours'),
    
    -- Constraints
    CONSTRAINT chk_cache_access_count CHECK (access_count > 0),
    CONSTRAINT chk_cache_file_size CHECK (file_size_bytes IS NULL OR file_size_bytes > 0),
    CONSTRAINT chk_cache_expiry CHECK (expires_at > created_at)
);

-- Performance indexes for cache table
CREATE INDEX IF NOT EXISTS idx_cad_cache_geometry_hash 
    ON cad_analysis_cache(geometry_hash);

CREATE INDEX IF NOT EXISTS idx_cad_cache_expires_at 
    ON cad_analysis_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_cad_cache_last_accessed 
    ON cad_analysis_cache(last_accessed DESC);

CREATE INDEX IF NOT EXISTS idx_cad_cache_strategy 
    ON cad_analysis_cache(optimization_strategy, analysis_version);

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- View for BOM items with complete CAD analysis
CREATE OR REPLACE VIEW bom_items_with_cad_analysis AS
SELECT 
    bi.*,
    -- Extract key metrics from JSON for easier querying
    (bi.geometry_analysis->>'volume_mm3')::NUMERIC AS volume_mm3,
    (bi.geometry_analysis->>'surface_area_mm2')::NUMERIC AS surface_area_mm2,
    (bi.geometry_analysis->>'complexity_score')::NUMERIC AS complexity_score,
    (bi.memory_optimization_metrics->>'memory_reduction_percent')::NUMERIC AS memory_reduction_percent,
    (bi.memory_optimization_metrics->>'processing_time_ms')::NUMERIC AS processing_time_ms,
    ARRAY_LENGTH(bi.recommended_processes, 1) AS process_count,
    (bi.cad_analysis_warnings->>'warnings')::JSONB AS warnings_details,
    
    -- Analysis freshness indicators
    CASE 
        WHEN bi.analysis_timestamp IS NULL THEN 'not_analyzed'
        WHEN bi.analysis_timestamp > NOW() - INTERVAL '7 days' THEN 'fresh'
        WHEN bi.analysis_timestamp > NOW() - INTERVAL '30 days' THEN 'recent'
        ELSE 'stale'
    END AS analysis_freshness,
    
    -- Manufacturing readiness score
    CASE 
        WHEN bi.manufacturability_score IS NULL THEN NULL
        WHEN bi.manufacturability_score >= 0.85 THEN 'excellent'
        WHEN bi.manufacturability_score >= 0.70 THEN 'good'
        WHEN bi.manufacturability_score >= 0.50 THEN 'acceptable'
        ELSE 'needs_improvement'
    END AS manufacturing_readiness

FROM bom_items bi
WHERE bi.analysis_timestamp IS NOT NULL;

-- View for manufacturing insights dashboard
CREATE OR REPLACE VIEW manufacturing_insights_summary AS
SELECT 
    b.id AS bom_id,
    b.name AS bom_name,
    COUNT(*) AS total_items,
    COUNT(bi.analysis_timestamp) AS analyzed_items,
    ROUND(AVG(bi.manufacturability_score), 3) AS avg_manufacturability_score,
    COUNT(*) FILTER (WHERE bi.difficulty_level = 'easy') AS easy_items,
    COUNT(*) FILTER (WHERE bi.difficulty_level = 'medium') AS medium_items,
    COUNT(*) FILTER (WHERE bi.difficulty_level = 'hard') AS hard_items,
    COUNT(*) FILTER (WHERE bi.difficulty_level = 'very_hard') AS very_hard_items,
    
    -- Most common process (using subquery to avoid aggregate with set-returning function)
    (
        SELECT process_name 
        FROM (
            SELECT unnest(bi2.recommended_processes) as process_name, COUNT(*) as process_count
            FROM bom_items bi2 
            WHERE bi2.bom_id = b.id AND bi2.recommended_processes IS NOT NULL
            GROUP BY unnest(bi2.recommended_processes)
            ORDER BY process_count DESC, process_name
            LIMIT 1
        ) top_process
    ) AS most_common_process,
    
    -- Performance metrics
    ROUND(AVG((bi.memory_optimization_metrics->>'memory_reduction_percent')::NUMERIC), 1) AS avg_memory_reduction,
    ROUND(AVG((bi.memory_optimization_metrics->>'processing_time_ms')::NUMERIC), 0) AS avg_processing_time_ms,
    
    MAX(bi.analysis_timestamp) AS latest_analysis

FROM boms b
LEFT JOIN bom_items bi ON bi.bom_id = b.id
GROUP BY b.id, b.name;

-- ============================================================================
-- FUNCTIONS FOR CAD ANALYSIS OPERATIONS
-- ============================================================================

-- Function to update BOM item with CAD analysis results
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
BEGIN
    -- Update bom_items table with analysis results
    UPDATE bom_items 
    SET 
        geometry_analysis = p_geometry_analysis,
        dfm_analysis = p_dfm_analysis,
        memory_optimization_metrics = p_memory_metrics,
        manufacturability_score = (p_dfm_analysis->>'manufacturability_score')::DECIMAL(3,2),
        difficulty_level = p_dfm_analysis->>'difficulty_level',
        recommended_processes = ARRAY(SELECT jsonb_array_elements_text(p_dfm_analysis->'recommended_processes')),
        cad_analysis_warnings = p_dfm_analysis->'warnings',
        geometry_hash = p_geometry_hash,
        analysis_timestamp = NOW(),
        analysis_version = p_analysis_version,
        optimization_strategy = p_optimization_strategy,
        lod_levels_available = (p_memory_metrics->>'lod_levels_generated')::INTEGER,
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
        p_bom_item_id, p_user_id, p_geometry_hash, p_analysis_version, p_optimization_strategy,
        (p_memory_metrics->>'processing_time_ms')::INTEGER,
        (p_memory_metrics->>'memory_reduction_percent')::DECIMAL(5,2),
        (p_dfm_analysis->>'manufacturability_score')::DECIMAL(3,2),
        p_dfm_analysis->>'difficulty_level',
        COALESCE(jsonb_array_length(p_dfm_analysis->'warnings'), 0),
        COALESCE(jsonb_array_length(p_dfm_analysis->'recommendations'), 0),
        p_geometry_analysis, p_dfm_analysis, p_memory_metrics
    );
    
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old cache entries
CREATE OR REPLACE FUNCTION cleanup_cad_analysis_cache() RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM cad_analysis_cache 
    WHERE expires_at < NOW() 
       OR last_accessed < NOW() - INTERVAL '7 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS FOR AUTOMATIC MAINTENANCE
-- ============================================================================

-- Trigger to update cache access statistics
CREATE OR REPLACE FUNCTION update_cache_access_stats() RETURNS TRIGGER AS $$
BEGIN
    UPDATE cad_analysis_cache 
    SET 
        access_count = access_count + 1,
        last_accessed = NOW()
    WHERE geometry_hash = NEW.geometry_hash;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for cache access tracking
DROP TRIGGER IF EXISTS trg_update_cache_access ON bom_items;
CREATE TRIGGER trg_update_cache_access
    AFTER UPDATE OF analysis_timestamp ON bom_items
    FOR EACH ROW
    WHEN (NEW.geometry_hash IS NOT NULL)
    EXECUTE FUNCTION update_cache_access_stats();

-- ============================================================================
-- INITIAL DATA AND COMMENTS
-- ============================================================================

-- Add helpful comments to tables
COMMENT ON TABLE bom_items IS 'Enhanced with CAD analysis integration for advanced manufacturing insights';
COMMENT ON COLUMN bom_items.geometry_analysis IS 'Complete geometry analysis results from CAD engine';
COMMENT ON COLUMN bom_items.dfm_analysis IS 'Design for Manufacturing analysis with AI insights';
COMMENT ON COLUMN bom_items.memory_optimization_metrics IS 'Memory optimization performance metrics';
COMMENT ON COLUMN bom_items.manufacturability_score IS 'Overall manufacturability score (0.00-1.00)';
COMMENT ON COLUMN bom_items.geometry_hash IS 'SHA-256 hash for caching and deduplication';

COMMENT ON TABLE cad_analysis_history IS 'Audit trail and performance monitoring for CAD analysis operations';
COMMENT ON TABLE cad_analysis_cache IS 'Optimized cache for frequently analyzed geometries';

COMMENT ON VIEW bom_items_with_cad_analysis IS 'BOM items with extracted CAD analysis metrics for reporting';
COMMENT ON VIEW manufacturing_insights_summary IS 'Summary statistics for manufacturing insights dashboard';

-- ============================================================================
-- COMPLETION LOG
-- ============================================================================

-- Note: Migration completed successfully
-- Migration: 076_add_cad_analysis_columns
-- Description: Add comprehensive CAD analysis support with memory optimization and DFM insights
-- Date: March 2026