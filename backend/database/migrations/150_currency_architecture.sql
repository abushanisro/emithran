-- ============================================================================
-- Migration 150: Multi-currency architecture — Phase 1
--
-- Adds:
--   1. exchange_rates table (budget rates, admin-set, not live FX)
--   2. currency_code to mhr_records (was implicit INR)
--   3. currency_code to lsr_records (was implicit INR)
--   4. exchange_rate_snapshot + costing_currency to process_plan_generations
--
-- raw_materials already has `currency` column from migration 075.
-- ============================================================================

-- ── 1. exchange_rates ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exchange_rates (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency    VARCHAR(3)  NOT NULL,
    to_currency      VARCHAR(3)  NOT NULL,
    rate             NUMERIC(12, 6) NOT NULL CHECK (rate > 0),
    rate_type        VARCHAR(20) NOT NULL DEFAULT 'budget',  -- 'budget' | 'spot' | 'contract'
    effective_date   DATE        NOT NULL,
    is_active        BOOLEAN     NOT NULL DEFAULT true,
    set_by           UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_exchange_rates_active_pair
    ON exchange_rates (from_currency, to_currency)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_exchange_rates_pair
    ON exchange_rates (from_currency, to_currency, is_active);

-- Seed: USD → INR at standard FY2026-27 budget rate
-- Admins can update this via the settings UI (Phase 2).
INSERT INTO exchange_rates (from_currency, to_currency, rate, rate_type, effective_date, is_active, notes)
VALUES
    ('USD', 'INR', 83.50, 'budget', '2026-04-01', true, 'FY2026-27 budget rate — update via admin settings'),
    ('EUR', 'INR', 89.00, 'budget', '2026-04-01', true, 'FY2026-27 budget rate'),
    ('GBP', 'INR', 104.00, 'budget', '2026-04-01', true, 'FY2026-27 budget rate'),
    ('AED', 'INR', 22.75, 'budget', '2026-04-01', true, 'FY2026-27 budget rate'),
    ('SGD', 'INR', 61.50, 'budget', '2026-04-01', true, 'FY2026-27 budget rate')
ON CONFLICT DO NOTHING;

-- ── 2. mhr_records — add currency_code ───────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'mhr_records' AND column_name = 'currency_code'
    ) THEN
        ALTER TABLE mhr_records ADD COLUMN currency_code VARCHAR(3) NOT NULL DEFAULT 'INR';
        COMMENT ON COLUMN mhr_records.currency_code IS 'Currency of total_machine_hour_rate (ISO 4217). Default INR.';
    END IF;
END $$;

-- ── 3. lsr_records — add currency_code ───────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'lsr_records' AND column_name = 'currency_code'
    ) THEN
        ALTER TABLE lsr_records ADD COLUMN currency_code VARCHAR(3) NOT NULL DEFAULT 'INR';
        COMMENT ON COLUMN lsr_records.currency_code IS 'Currency of lhr (ISO 4217). Default INR.';
    END IF;
END $$;

-- ── 4. process_plan_generations — add currency snapshot columns ───────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'process_plan_generations' AND column_name = 'exchange_rate_snapshot'
    ) THEN
        ALTER TABLE process_plan_generations
            ADD COLUMN exchange_rate_snapshot JSONB,
            ADD COLUMN costing_currency VARCHAR(3) NOT NULL DEFAULT 'INR';

        COMMENT ON COLUMN process_plan_generations.exchange_rate_snapshot IS
            'Exchange rates used at generation time, e.g. {"USD":83.50,"EUR":89.00}. Ensures reproducibility.';
        COMMENT ON COLUMN process_plan_generations.costing_currency IS
            'Target currency for all cost lines in this generation. Always INR for now.';
    END IF;
END $$;

-- ── RLS: exchange_rates readable by all authenticated users, writable by service role ──
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exchange_rates_read_authenticated"
    ON exchange_rates FOR SELECT
    TO authenticated
    USING (true);
