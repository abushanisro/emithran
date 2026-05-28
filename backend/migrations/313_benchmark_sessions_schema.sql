-- Benchmark Sessions Module Schema
-- Migration 313: Create benchmark_sessions table

CREATE TABLE IF NOT EXISTS benchmark_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               VARCHAR NOT NULL,
  description        TEXT,
  status             VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  owner_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  selected_projects  JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_boms      JSONB NOT NULL DEFAULT '[]'::jsonb,
  bom_count          INTEGER NOT NULL DEFAULT 0,
  saved_insights     JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_benchmark_sessions_owner_id ON benchmark_sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_sessions_status    ON benchmark_sessions(status);


-- Row Level Security
ALTER TABLE benchmark_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "benchmark_sessions_select" ON benchmark_sessions
  FOR SELECT USING (auth.uid() = owner_id OR owner_id IS NULL);



CREATE POLICY "benchmark_sessions_insert" ON benchmark_sessions
  FOR INSERT WITH CHECK (auth.uid() = owner_id OR owner_id IS NULL);

CREATE POLICY "benchmark_sessions_update" ON benchmark_sessions
  FOR UPDATE USING (auth.uid() = owner_id OR owner_id IS NULL);

CREATE POLICY "benchmark_sessions_delete" ON benchmark_sessions
  FOR DELETE USING (auth.uid() = owner_id OR owner_id IS NULL);

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $func$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $func$ LANGUAGE plpgsql;
  END IF;
END$$;

CREATE TRIGGER update_benchmark_sessions_updated_at
  BEFORE UPDATE ON benchmark_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
