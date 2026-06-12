-- Migration 141: Create quality control tables
-- quality_inspections and related tables were never migrated to this DB instance.

-- ============================================================
-- 1. quality_inspections
-- ============================================================
CREATE TABLE IF NOT EXISTS quality_inspections (
    id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name                VARCHAR(255)             NOT NULL,
    description         TEXT,
    type                VARCHAR(50)              NOT NULL,
    status              VARCHAR(50)              NOT NULL DEFAULT 'planned',
    project_id          UUID                     REFERENCES projects(id) ON DELETE SET NULL,
    bom_id              UUID                     REFERENCES boms(id)     ON DELETE SET NULL,
    inspector           VARCHAR(255),
    planned_date        TIMESTAMP WITH TIME ZONE,
    actual_start_date   TIMESTAMP WITH TIME ZONE,
    actual_end_date     TIMESTAMP WITH TIME ZONE,
    selected_items      JSONB                    NOT NULL DEFAULT '[]',
    quality_standards   TEXT[]                   NOT NULL DEFAULT '{}',
    checklist           JSONB                    NOT NULL DEFAULT '[]',
    metadata            JSONB                    NOT NULL DEFAULT '{}',
    notes               TEXT,
    overall_result      VARCHAR(50),
    approved_by         UUID,
    approved_at         TIMESTAMP WITH TIME ZONE,
    rejected_by         UUID,
    rejected_at         TIMESTAMP WITH TIME ZONE,
    rejection_reason    TEXT,
    created_by          UUID                     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_inspections_project_id  ON quality_inspections(project_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_bom_id      ON quality_inspections(bom_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_created_by  ON quality_inspections(created_by);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_status      ON quality_inspections(status);

-- ============================================================
-- 2. quality_inspection_results
-- ============================================================
CREATE TABLE IF NOT EXISTS quality_inspection_results (
    id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    inspection_id       UUID                     NOT NULL UNIQUE REFERENCES quality_inspections(id) ON DELETE CASCADE,
    checklist_results   JSONB                    NOT NULL DEFAULT '[]',
    overall_result      VARCHAR(50),
    notes               TEXT,
    recommendations     TEXT,
    attachments         TEXT[]                   NOT NULL DEFAULT '{}',
    submitted_by        UUID                     REFERENCES auth.users(id) ON DELETE SET NULL,
    submitted_at        TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qir_inspection_id ON quality_inspection_results(inspection_id);

-- ============================================================
-- 3. quality_non_conformances
-- ============================================================
CREATE TABLE IF NOT EXISTS quality_non_conformances (
    id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    inspection_id       UUID                     REFERENCES quality_inspections(id) ON DELETE CASCADE,
    title               VARCHAR(255),
    description         TEXT,
    severity            VARCHAR(50),
    status              VARCHAR(50)              DEFAULT 'open',
    corrective_action   TEXT,
    created_by          UUID                     REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qnc_inspection_id ON quality_non_conformances(inspection_id);
CREATE INDEX IF NOT EXISTS idx_qnc_status        ON quality_non_conformances(status);

-- ============================================================
-- 4. quality_approved_items
-- ============================================================
CREATE TABLE IF NOT EXISTS quality_approved_items (
    id                      UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    bom_item_id             UUID                     REFERENCES bom_items(id) ON DELETE SET NULL,
    approved_quantity       NUMERIC                  NOT NULL DEFAULT 0,
    approval_status         VARCHAR(50)              NOT NULL DEFAULT 'approved',
    approval_notes          TEXT,
    delivery_ready          BOOLEAN                  NOT NULL DEFAULT false,
    delivery_ready_date     TIMESTAMP WITH TIME ZONE,
    approved_by             UUID                     REFERENCES auth.users(id) ON DELETE SET NULL,
    approved_at             TIMESTAMP WITH TIME ZONE,
    qc_certificate_number   VARCHAR(100),
    quality_grade           VARCHAR(10)              DEFAULT 'A',
    created_by              UUID                     REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qai_bom_item_id ON quality_approved_items(bom_item_id);

-- ============================================================
-- 5. updated_at triggers
-- ============================================================
DROP TRIGGER IF EXISTS trg_quality_inspections_updated_at        ON quality_inspections;
DROP TRIGGER IF EXISTS trg_quality_inspection_results_updated_at ON quality_inspection_results;
DROP TRIGGER IF EXISTS trg_quality_non_conformances_updated_at   ON quality_non_conformances;
DROP TRIGGER IF EXISTS trg_quality_approved_items_updated_at     ON quality_approved_items;

CREATE TRIGGER trg_quality_inspections_updated_at
    BEFORE UPDATE ON quality_inspections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_quality_inspection_results_updated_at
    BEFORE UPDATE ON quality_inspection_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_quality_non_conformances_updated_at
    BEFORE UPDATE ON quality_non_conformances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_quality_approved_items_updated_at
    BEFORE UPDATE ON quality_approved_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 6. RLS
-- ============================================================
ALTER TABLE quality_inspections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_inspection_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_non_conformances   ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_approved_items     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own inspections"    ON quality_inspections;
DROP POLICY IF EXISTS "Users manage own insp results"   ON quality_inspection_results;
DROP POLICY IF EXISTS "Users manage own non-conformances" ON quality_non_conformances;
DROP POLICY IF EXISTS "Users manage own approved items" ON quality_approved_items;

CREATE POLICY "Users manage own inspections"
    ON quality_inspections FOR ALL
    USING (auth.uid() = created_by);

CREATE POLICY "Users manage own insp results"
    ON quality_inspection_results FOR ALL
    USING (
        inspection_id IN (
            SELECT id FROM quality_inspections WHERE created_by = auth.uid()
        )
    );

CREATE POLICY "Users manage own non-conformances"
    ON quality_non_conformances FOR ALL
    USING (
        inspection_id IN (
            SELECT id FROM quality_inspections WHERE created_by = auth.uid()
        )
    );

CREATE POLICY "Users manage own approved items"
    ON quality_approved_items FOR ALL
    USING (auth.uid() = created_by);

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, description)
VALUES ('141', 'Create quality_inspections, quality_inspection_results, quality_non_conformances, quality_approved_items')
ON CONFLICT (version) DO NOTHING;
