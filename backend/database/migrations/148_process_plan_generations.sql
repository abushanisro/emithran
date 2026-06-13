-- ============================================================================
-- Migration: Process Plan Generations + Line Edits
-- Purpose: Audit + feedback storage for the AI Process Plan Generator
--
-- Two tables:
--   1. process_plan_generations  — one row per Generate click; stores the
--      engineering brief, candidate set, LLM tool calls, abstract plan,
--      resolved draft lines, proposed master rows, and the applied IDs.
--      This is the audit log AND the "why this?" replay source.
--
--   2. process_plan_line_edits   — every user modification to a draft line
--      between Generate and Apply. This is the offline-eval / per-customer
--      calibration dataset that lets the system learn what engineers
--      actually correct.
--
-- Author: Principal Engineering Team
-- Date: 2026-06-13
-- Version: 1.0.0
-- ============================================================================

DROP TABLE IF EXISTS process_plan_line_edits CASCADE;
DROP TABLE IF EXISTS process_plan_generations CASCADE;

-- ============================================================================
-- TABLE 1: process_plan_generations
-- ============================================================================
CREATE TABLE process_plan_generations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    bom_item_id UUID NOT NULL REFERENCES bom_items(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID,

    status VARCHAR(32) NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'draft_ready', 'applied', 'failed', 'discarded', 'out_of_scope')),

    model VARCHAR(64) NOT NULL,

    -- sha256(bom_item_id || canonical(brief)) — dedupes accidental re-clicks
    -- within a short window. Unique across all users (a hash collision across
    -- users is astronomically unlikely and not a security concern since
    -- generations are tenant-scoped on read).
    idempotency_key VARCHAR(128) UNIQUE,

    -- { family: 'cnc_turned'|'cnc_milled'|'sheet_metal'|'out_of_scope',
    --   inScope: bool, reason: string, confidence: number }
    scope_decision JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Full EngineeringBrief sent to LLM (BOM data + DFM + location + constraints)
    brief JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- CandidateSet snapshot at generation time
    -- (top-N raw_materials, mhr_records, lsr_records, processes, calculators)
    candidates JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Append-only log of LLM tool calls + results (for replay + audit)
    tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Stage 2 output: model's abstract plan with symbolic candidate refs
    abstract_plan JSONB,

    -- Stage 3 output: resolved + validated draft lines (5 sections)
    draft_lines JSONB,

    -- Master rows the model proposed adding (raw_material | process)
    proposed_masters JSONB,

    -- After apply: { rawMaterials: [...ids], processes: [...ids], ... }
    applied_line_ids JSONB,

    -- Token + cost accounting
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cache_creation_tokens INTEGER DEFAULT 0,
    credit_cost INTEGER DEFAULT 0,

    error_message TEXT,
    error_stage VARCHAR(32),  -- which stage failed: retrieval | reasoning | resolver | persistence

    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    applied_at TIMESTAMP,

    CONSTRAINT positive_tokens CHECK (tokens_in >= 0 AND tokens_out >= 0)
);

CREATE INDEX idx_ppg_bom_item ON process_plan_generations(bom_item_id, started_at DESC);
CREATE INDEX idx_ppg_user_status ON process_plan_generations(user_id, status);
CREATE INDEX idx_ppg_idempotency ON process_plan_generations(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_ppg_status_started ON process_plan_generations(status, started_at DESC);

-- ============================================================================
-- TABLE 2: process_plan_line_edits
-- ============================================================================
CREATE TABLE process_plan_line_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    generation_id UUID NOT NULL REFERENCES process_plan_generations(id) ON DELETE CASCADE,
    bom_item_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Which of the 5 sections the edited line belongs to
    line_kind VARCHAR(32) NOT NULL
        CHECK (line_kind IN ('raw_material', 'process', 'tooling', 'logistics', 'procured_part')),

    -- Position within its draft array (stable while the draft is open)
    line_index INTEGER NOT NULL CHECK (line_index >= 0),

    -- Dot-notation field path: 'cycleTimeSeconds', 'machineId', 'grossUsageKg', etc.
    field_path VARCHAR(128) NOT NULL,

    original_value JSONB,
    new_value JSONB,

    -- Optional: 'removed_line' | 'added_line' | 'field_change' (for batch UX)
    edit_action VARCHAR(32) NOT NULL DEFAULT 'field_change'
        CHECK (edit_action IN ('field_change', 'added_line', 'removed_line')),

    edit_reason TEXT,

    edited_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ppe_generation ON process_plan_line_edits(generation_id, edited_at DESC);
CREATE INDEX idx_ppe_kind_field ON process_plan_line_edits(line_kind, field_path);
CREATE INDEX idx_ppe_user ON process_plan_line_edits(user_id, edited_at DESC);

-- ============================================================================
-- Row Level Security
-- ============================================================================
ALTER TABLE process_plan_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_plan_line_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own generations"
    ON process_plan_generations FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own generations"
    ON process_plan_generations FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own generations"
    ON process_plan_generations FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own generations"
    ON process_plan_generations FOR DELETE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view own line edits"
    ON process_plan_line_edits FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own line edits"
    ON process_plan_line_edits FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- Grants
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON process_plan_generations TO authenticated;
GRANT SELECT, INSERT ON process_plan_line_edits TO authenticated;

-- ============================================================================
-- Documentation
-- ============================================================================
COMMENT ON TABLE process_plan_generations IS 'AI Process Plan Generator: one row per Generate click. Stores brief, candidates, LLM tool calls, draft, applied IDs. Audit + replay source.';
COMMENT ON COLUMN process_plan_generations.idempotency_key IS 'sha256(bom_item_id || canonical(brief)) — dedupes accidental double-clicks within a short window';
COMMENT ON COLUMN process_plan_generations.scope_decision IS 'Stage-1 part-family classification: {family, inScope, reason, confidence}';
COMMENT ON COLUMN process_plan_generations.brief IS 'EngineeringBrief: BOM data + DFM features + organization location + constraints';
COMMENT ON COLUMN process_plan_generations.candidates IS 'Pre-ranked CandidateSet: top-N raw_materials, mhr, lsr, processes, calculators';
COMMENT ON COLUMN process_plan_generations.abstract_plan IS 'Stage-2 model output: lines reference candidates by symbolic ID, not DB UUID';
COMMENT ON COLUMN process_plan_generations.draft_lines IS 'Stage-3 resolved DraftLines, validated against existing CreateXxxCostDto shapes';
COMMENT ON COLUMN process_plan_generations.proposed_masters IS 'New raw_material or process rows the model proposed (require user approval before write)';

COMMENT ON TABLE process_plan_line_edits IS 'Every user modification to a generated draft line. Offline-eval / per-customer calibration dataset. The moat.';
COMMENT ON COLUMN process_plan_line_edits.field_path IS 'Dot-notation field: cycleTimeSeconds, machineId, grossUsageKg, scrapPercentage, etc.';
COMMENT ON COLUMN process_plan_line_edits.edit_action IS 'field_change | added_line | removed_line';
