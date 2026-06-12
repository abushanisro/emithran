-- Migration 142: Add missing columns to existing quality_inspections table
-- The table existed with a minimal schema; migration 141 was skipped by IF NOT EXISTS.

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS description         TEXT;

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS bom_id              UUID REFERENCES boms(id) ON DELETE SET NULL;

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS inspector           VARCHAR(255);

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS planned_date        TIMESTAMP WITH TIME ZONE;

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS actual_start_date   TIMESTAMP WITH TIME ZONE;

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS actual_end_date     TIMESTAMP WITH TIME ZONE;

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS selected_items      JSONB NOT NULL DEFAULT '[]';

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS quality_standards   TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS checklist           JSONB NOT NULL DEFAULT '[]';

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS metadata            JSONB NOT NULL DEFAULT '{}';

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS notes               TEXT;

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS overall_result      VARCHAR(50);

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS approved_by         UUID;

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS approved_at         TIMESTAMP WITH TIME ZONE;

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS rejected_by         UUID;

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS rejected_at         TIMESTAMP WITH TIME ZONE;

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS rejection_reason    TEXT;

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS created_by          UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Also ensure the project_id FK exists (column may exist without the FK constraint)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'quality_inspections_project_id_fkey'
          AND table_name = 'quality_inspections'
    ) THEN
        -- Only add FK if column exists and projects table is present
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'quality_inspections' AND column_name = 'project_id'
        ) THEN
            ALTER TABLE quality_inspections
                ADD CONSTRAINT quality_inspections_project_id_fkey
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
        END IF;
    END IF;
END $$;

-- Ensure supporting tables exist (idempotent)
CREATE TABLE IF NOT EXISTS quality_inspection_results (
    id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    inspection_id       UUID NOT NULL UNIQUE REFERENCES quality_inspections(id) ON DELETE CASCADE,
    checklist_results   JSONB NOT NULL DEFAULT '[]',
    overall_result      VARCHAR(50),
    notes               TEXT,
    recommendations     TEXT,
    attachments         TEXT[] NOT NULL DEFAULT '{}',
    submitted_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    submitted_at        TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality_non_conformances (
    id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    inspection_id       UUID REFERENCES quality_inspections(id) ON DELETE CASCADE,
    title               VARCHAR(255),
    description         TEXT,
    severity            VARCHAR(50),
    status              VARCHAR(50) DEFAULT 'open',
    corrective_action   TEXT,
    created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality_approved_items (
    id                    UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    bom_item_id           UUID REFERENCES bom_items(id) ON DELETE SET NULL,
    approved_quantity     NUMERIC NOT NULL DEFAULT 0,
    approval_status       VARCHAR(50) NOT NULL DEFAULT 'approved',
    approval_notes        TEXT,
    delivery_ready        BOOLEAN NOT NULL DEFAULT false,
    delivery_ready_date   TIMESTAMP WITH TIME ZONE,
    approved_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    approved_at           TIMESTAMP WITH TIME ZONE,
    qc_certificate_number VARCHAR(100),
    quality_grade         VARCHAR(10) DEFAULT 'A',
    created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, description)
VALUES ('142', 'Add missing columns to quality_inspections; create quality_inspection_results, quality_non_conformances, quality_approved_items')
ON CONFLICT (version) DO NOTHING;
