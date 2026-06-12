-- Migration 133: Create production_entries table
-- Used by ProductionEntryService (/production-entries/* routes).
-- Distinct from daily_production_entries (migration 132) which is used by
-- ProductionPlanningService (/lots/:id/production-entries).

CREATE TABLE IF NOT EXISTS production_entries (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_id            UUID NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
    process_id        UUID REFERENCES production_processes(id) ON DELETE SET NULL,
    process_name      VARCHAR(255),
    entry_date        DATE NOT NULL,
    shift             VARCHAR(50) NOT NULL DEFAULT 'day',
    target_quantity   INTEGER NOT NULL DEFAULT 0,
    produced_quantity INTEGER NOT NULL DEFAULT 0,
    rejected_quantity INTEGER NOT NULL DEFAULT 0,
    rework_quantity   INTEGER NOT NULL DEFAULT 0,
    downtime_minutes  INTEGER NOT NULL DEFAULT 0,
    downtime_reason   TEXT,
    quality_issues    TEXT,
    operator_notes    TEXT,
    entered_by        UUID NOT NULL REFERENCES auth.users(id),
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (lot_id, process_id, entry_date, shift)
);

CREATE INDEX IF NOT EXISTS idx_production_entries_lot_id
    ON production_entries(lot_id);
CREATE INDEX IF NOT EXISTS idx_production_entries_process_id
    ON production_entries(process_id);
CREATE INDEX IF NOT EXISTS idx_production_entries_date
    ON production_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_production_entries_entered_by
    ON production_entries(entered_by);

ALTER TABLE production_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'production_entries'
          AND policyname = 'Users can manage production entries for their lots'
    ) THEN
        CREATE POLICY "Users can manage production entries for their lots"
            ON production_entries FOR ALL
            USING (
                EXISTS (
                    SELECT 1 FROM production_lots pl
                    JOIN boms b ON b.id = pl.bom_id
                    WHERE pl.id = production_entries.lot_id
                      AND b.user_id = auth.uid()
                )
            );
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_production_entries_updated_at') THEN
        CREATE TRIGGER update_production_entries_updated_at
            BEFORE UPDATE ON production_entries
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('133', 'Create production_entries table for ProductionEntryService')
ON CONFLICT (version) DO NOTHING;
