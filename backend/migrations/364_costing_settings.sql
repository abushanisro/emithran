-- Migration 364: costing_settings table
-- Stores business-level costing parameters (SGA, profit margin) so they can
-- be configured per environment without code changes. All cost engines read
-- from this table; falling back to hardcoded values only when the table is
-- empty (with an explicit warning surfaced in the API response).

CREATE TABLE IF NOT EXISTS costing_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL UNIQUE,
  value       NUMERIC NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Default seed — admin can UPDATE these rows from the Settings UI.
INSERT INTO costing_settings (key, value, description) VALUES
  ('sga_pct',    0.125, 'SG&A (Selling, General & Administrative) as fraction of manufacturing cost — e.g. 0.125 = 12.5%'),
  ('profit_pct', 0.08,  'Target profit margin as fraction of manufacturing cost — e.g. 0.08 = 8%')
ON CONFLICT (key) DO NOTHING;
