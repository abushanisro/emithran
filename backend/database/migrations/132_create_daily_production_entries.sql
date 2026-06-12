-- Migration 132: Create daily_production_entries table
-- The production "Production Entry" tab fires GET /lots/:id/production-entries
-- which fails because this table was never created in this DB.

CREATE TABLE IF NOT EXISTS daily_production_entries (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_lot_id     UUID NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
    production_process_id UUID REFERENCES production_processes(id) ON DELETE SET NULL,
    entry_date            DATE NOT NULL,
    entry_type            VARCHAR(20) NOT NULL DEFAULT 'daily'
                              CHECK (entry_type IN ('daily', 'weekly', 'shift')),
    planned_quantity      INTEGER NOT NULL DEFAULT 0,
    actual_quantity       INTEGER NOT NULL DEFAULT 0,
    rejected_quantity     INTEGER NOT NULL DEFAULT 0,
    rework_quantity       INTEGER NOT NULL DEFAULT 0,
    efficiency_percentage DECIMAL(5, 2) NOT NULL DEFAULT 0,
    downtime_hours        DECIMAL(8, 2) NOT NULL DEFAULT 0,
    downtime_reason       TEXT,
    shift                 VARCHAR(50),
    operators_count       INTEGER NOT NULL DEFAULT 1,
    supervisor            VARCHAR(255),
    remarks               TEXT,
    issues_encountered    TEXT,
    entered_by            UUID NOT NULL REFERENCES auth.users(id),
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_prod_entries_lot_id
    ON daily_production_entries(production_lot_id);
CREATE INDEX IF NOT EXISTS idx_daily_prod_entries_process_id
    ON daily_production_entries(production_process_id);
CREATE INDEX IF NOT EXISTS idx_daily_prod_entries_date
    ON daily_production_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_daily_prod_entries_entered_by
    ON daily_production_entries(entered_by);

ALTER TABLE daily_production_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'daily_production_entries'
          AND policyname = 'Users can manage production entries for their lots'
    ) THEN
        CREATE POLICY "Users can manage production entries for their lots"
            ON daily_production_entries FOR ALL
            USING (
                EXISTS (
                    SELECT 1 FROM production_lots pl
                    JOIN boms b ON b.id = pl.bom_id
                    WHERE pl.id = daily_production_entries.production_lot_id
                      AND b.user_id = auth.uid()
                )
            );
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_daily_production_entries_updated_at') THEN
        CREATE TRIGGER update_daily_production_entries_updated_at
            BEFORE UPDATE ON daily_production_entries
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('132', 'Create daily_production_entries table')
ON CONFLICT (version) DO NOTHING;
