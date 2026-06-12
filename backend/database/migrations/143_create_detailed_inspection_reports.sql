-- Migration 143: Create detailed_inspection_reports table

CREATE TABLE IF NOT EXISTS detailed_inspection_reports (
    id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    inspection_id       UUID NOT NULL UNIQUE REFERENCES quality_inspections(id) ON DELETE CASCADE,
    part_name           VARCHAR(255),
    material            VARCHAR(255),
    surface_treatment   VARCHAR(255),
    drawing_title       VARCHAR(255),
    drawing_size        VARCHAR(50),
    balloon_annotations JSONB NOT NULL DEFAULT '[]',
    company_name        VARCHAR(255),
    revision_number     VARCHAR(100),
    inspection_date     VARCHAR(100),
    raw_material        VARCHAR(255),
    inspection_by       VARCHAR(255),
    approved_by         VARCHAR(255),
    general_remarks     TEXT,
    status              VARCHAR(50),
    samples             JSONB NOT NULL DEFAULT '[]',
    measurements        JSONB NOT NULL DEFAULT '[]',
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dir_inspection_id ON detailed_inspection_reports(inspection_id);

DROP TRIGGER IF EXISTS trg_detailed_inspection_reports_updated_at ON detailed_inspection_reports;
CREATE TRIGGER trg_detailed_inspection_reports_updated_at
    BEFORE UPDATE ON detailed_inspection_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE detailed_inspection_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own detailed reports" ON detailed_inspection_reports;
CREATE POLICY "Users manage own detailed reports"
    ON detailed_inspection_reports FOR ALL
    USING (
        inspection_id IN (
            SELECT id FROM quality_inspections WHERE created_by = auth.uid()
        )
    );

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, description)
VALUES ('143', 'Create detailed_inspection_reports table')
ON CONFLICT (version) DO NOTHING;
